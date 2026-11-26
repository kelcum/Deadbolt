/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { plugins } from "@api/PluginManager";
import { leaveSafeMode, SAFE_MODE_CORE, safeMode } from "@api/SafeMode";
import { PlainSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin, { PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useState } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.SafeMode as PluginNative<typeof import("./native")> | undefined;
function affected(name: string) {
    const names = new Set([name]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const plugin of Object.values(plugins)) {
            if (!Settings.plugins[plugin.name].enabled || names.has(plugin.name) || !plugin.dependencies?.some(dep => names.has(dep))) continue;
            names.add(plugin.name); changed = true;
        }
    }
    return [...names];
}
const Panel = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const [selected, setSelected] = useState(safeMode?.suspect ?? "");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState<"disable" | "normal" | null>(null);
    const available = Object.values(plugins).filter(p => !p.required && !p.hidden && !SAFE_MODE_CORE.has(p.name) && Settings.plugins[p.name].enabled).map(p => p.name).sort();
    const blocked = selected ? affected(selected) : [];
    const canDisable = available.includes(selected) && blocked.every(name => available.includes(name));
    async function enter() {
        if (!Native || busy) return;
        setBusy(true);
        try { if (await Native.enter()) relaunch(); }
        catch { setStatus("Could not enter safe mode."); } finally { setBusy(false); }
    }
    async function recover(disable: boolean) {
        if (busy || disable && !canDisable) return;
        const intent = disable ? "disable" : "normal";
        if (confirm !== intent) { setConfirm(intent); setStatus(disable ? "Click confirm to disable the listed plugins and restart normally." : "Click confirm to restart normally with all configured plugins."); return; }
        setBusy(true);
        try {
            if (disable) {
                const next = structuredClone(PlainSettings.plugins);
                for (const name of blocked) next[name] = { ...next[name], enabled: false };
                Settings.plugins = next;
                await VencordNative.settings.set(PlainSettings);
            }
            await leaveSafeMode();
        } catch { setStatus("Could not leave safe mode. Settings may have been saved; review before trying again."); } finally { setBusy(false); setConfirm(null); }
    }
    return <Modal {...modalProps} title="Safe mode recovery" size="md" subtitle={safeMode?.active ? "Only recovery and core plugins are running." : "Manually enter Deadbolt's existing safe mode before troubleshooting a broken plugin."} actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!safeMode?.active ? <Button size="small" disabled={busy || !Native} onClick={() => void enter()}>Restart into safe mode</Button> : <>
                <Text size="sm">Suspected plugin: {safeMode.suspect ?? "Unknown"}</Text>
                <input aria-label="Search enabled plugins" placeholder="Find a plugin to disable" value={query} onChange={e => setQuery(e.target.value)} />
                <select size={Math.min(8, Math.max(2, available.length))} aria-label="Choose suspected plugin" value={selected} onChange={e => { setSelected(e.target.value); setConfirm(null); }}>{available.filter(n => n.toLowerCase().includes(query.toLowerCase())).map(n => <option value={n} key={n}>{n}</option>)}</select>
                <Text size="xs" color="text-muted">Plugins to disable, including dependent plugins: {blocked.join(", ") || "None"}</Text>
                <Button size="small" variant="dangerSecondary" disabled={busy || !canDisable} onClick={() => void recover(true)}>{confirm === "disable" ? "Confirm disable and restart" : "Disable selected and restart"}</Button>
                <Button size="small" variant="secondary" disabled={busy} onClick={() => void recover(false)}>{confirm === "normal" ? "Confirm normal restart" : "Restart without disabling plugins"}</Button>
            </>}
            <Text size="xs" role="status" color="text-muted">{status}</Text>
        </div>
    </Modal>;
});
export function openRecovery() { openModal(props => <Panel modalProps={props} />); }
export default definePlugin({ name: "SafeMode", description: "Manually enter safe mode and selectively disable suspected plugins and their dependents before restarting.", authors: [Devs.Zot], tags: ["Utility"], toolboxActions: { "Safe mode recovery": openRecovery }, settingsAboutComponent: () => <Button size="small" onClick={openRecovery}>Open recovery tools</Button> });
