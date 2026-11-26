/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { plugins } from "@api/PluginManager";
import { safeMode } from "@api/SafeMode";
import { PlainSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

import { resolveProfile, selectable } from "./profiles";

interface Profile { name: string; enabled: string[]; known: string[]; saved: number; }
const key = (userId: string) => `zot:PluginProfiles:${userId}`;
const owns = (userId: string) => UserStore.getCurrentUser()?.id === userId;
function capture(name: string): Profile {
    const available = Object.values(plugins).filter(selectable).map(p => p.name);
    return { name, enabled: available.filter(n => Settings.plugins[n].enabled), known: available, saved: Date.now() };
}
function plan(profile: Profile) {
    const all = Object.values(plugins);
    const available = all.filter(selectable).map(p => p.name);
    // Leave plugins installed after the profile was created alone.
    const requested = available.filter(n => profile.known.includes(n) ? profile.enabled.includes(n) : Settings.plugins[n].enabled);
    const always = all.filter(p => !selectable(p) && Settings.plugins[p.name].enabled).map(p => p.name);
    const result = resolveProfile(all, [...requested, ...always, ...profile.enabled.filter(n => !all.some(p => p.name === n))]);
    const change = available.filter(n => Settings.plugins[n].enabled !== result.enabled.has(n));
    return { missing: result.missing, change, enable: change.filter(n => result.enabled.has(n)), disable: change.filter(n => !result.enabled.has(n)) };
}
const Panel = ErrorBoundary.wrap(({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(true);
    const [restart, setRestart] = useState(false);
    useEffect(() => {
        let active = true;
        DataStore.get<Profile[]>(key(userId)).then(rows => { if (active) setProfiles(rows ?? []); }).catch(() => { if (active) setStatus("Could not load profiles."); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [userId]);
    async function save() {
        if (!owns(userId) || busy || !name.trim() || safeMode?.active) return;
        setBusy(true);
        const title = name.trim().slice(0, 40);
        try {
            const profile = capture(title);
            await DataStore.update<Profile[]>(key(userId), old => {
                const rows = old ?? [];
                if (rows.length >= 16 && !rows.some(p => p.name === title)) throw new Error("Profile limit reached.");
                return [profile, ...rows.filter(p => p.name !== title)];
            });
            if (owns(userId)) setProfiles(await DataStore.get<Profile[]>(key(userId)) ?? []);
            setName(""); setStatus("Saved plugin enablement profile.");
        } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save profile."); }
        finally { setBusy(false); }
    }
    async function remove(title: string) {
        if (!owns(userId) || busy) return;
        setBusy(true);
        try { await DataStore.update<Profile[]>(key(userId), old => (old ?? []).filter(p => p.name !== title)); if (owns(userId)) setProfiles(await DataStore.get<Profile[]>(key(userId)) ?? []); setSelected(null); }
        catch { setStatus("Could not remove profile."); } finally { setBusy(false); }
    }
    async function apply(profile: Profile) {
        if (!owns(userId) || busy || safeMode?.active) return;
        const changes = plan(profile);
        if (changes.missing.length) return setStatus("The profile includes unavailable plugins or dependencies.");
        if (!changes.change.length) return setStatus("Already matches this profile.");
        setBusy(true);
        try {
            // Save a recovery snapshot before modifying global plugin enablement.
            await DataStore.set(`${key(userId)}:previous`, capture("Before last apply"));
            if (!owns(userId)) return;
            const next = structuredClone(PlainSettings.plugins);
            for (const n of changes.change) next[n] = { ...next[n], enabled: changes.enable.includes(n) };
            Settings.plugins = next;
            await VencordNative.settings.set(PlainSettings);
            setRestart(true);
            setStatus("Saved. Restart Discord to load the new plugin set. This affects all accounts on this client.");
        } catch { setStatus("Could not complete profile change. Check your plugin settings before restarting."); }
        finally { setBusy(false); }
    }
    const picked = profiles.find(p => p.name === selected);
    const diff = picked ? plan(picked) : null;
    return <Modal {...modalProps} size="lg" title="Plugin profiles" subtitle="Save enabled plugin sets. Existing plugin options and required plugins are preserved." actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        {account !== userId || safeMode?.active ? <Text size="sm">Profiles are unavailable in safe mode or after switching accounts.</Text> : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}><input aria-label="Profile name" placeholder="Gaming, streaming, work…" value={name} maxLength={40} onChange={e => setName(e.target.value)} /><Button disabled={busy || !name.trim()} size="small" onClick={() => void save()}>Save current set</Button></div>
            {profiles.map(p => <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8 }}><Text size="sm" style={{ flex: 1 }}>{p.name} · {p.enabled.length} enabled</Text><Button size="small" variant={selected === p.name ? "primary" : "secondary"} onClick={() => setSelected(p.name)}>Preview changes</Button><Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => void remove(p.name)}>Remove</Button></div>)}
            {picked && diff && <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, background: "var(--background-base-lower)" }}>
                <Text size="sm" weight="semibold">{picked.name}: {diff.enable.length} enable, {diff.disable.length} disable</Text>
                <Text size="xs" selectable>Enable: {diff.enable.join(", ") || "None"}</Text><Text size="xs" selectable>Disable: {diff.disable.join(", ") || "None"}</Text>
                {!!diff.missing.length && <Text size="xs" color="text-danger">Unavailable dependencies: {diff.missing.join(", ")}</Text>}
                <Button size="small" disabled={busy || !diff.change.length || !!diff.missing.length} onClick={() => void apply(picked)}>Apply on next restart</Button>
            </div>}
            <Button size="small" variant="secondary" disabled={busy} onClick={async () => { try { const previous = await DataStore.get<Profile>(`${key(userId)}:previous`); if (previous && owns(userId)) { setProfiles(old => [previous, ...old.filter(p => p.name !== previous.name)]); setSelected(previous.name); } else setStatus("No previous profile saved."); } catch { setStatus("Could not load previous profile."); } }}>View previous plugin set</Button>
            {restart && <Button size="small" onClick={() => { if (IS_WEB) location.reload(); else relaunch(); }}>Restart Discord</Button>}
            <Text size="xs" color="text-muted" role="status">{status}</Text>
        </div>}
    </Modal>;
});
function open() { const userId = UserStore.getCurrentUser()?.id; if (userId) openModal(props => <Panel userId={userId} modalProps={props} />); }
export default definePlugin({ name: "PluginProfiles", description: "Save, preview and switch enabled plugin sets with dependency checks and a recovery snapshot.", authors: [Devs.Zot], tags: ["Utility", "Organisation"], toolboxActions: { "Plugin profiles": open }, settingsAboutComponent: () => <Button size="small" onClick={open}>Open plugin profiles</Button> });
