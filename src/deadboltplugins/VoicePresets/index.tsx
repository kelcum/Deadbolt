/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { MediaEngineStore, Modal, openModal, useEffect, UserStore, useState, useStateFromStores, VoiceActions } from "@webpack/common";

interface VoicePreset {
    name: string;
    input: string;
    output: string;
    inputVolume: number;
    outputVolume: number;
    echo: boolean;
    noise: boolean;
    gain: boolean;
    krisp: boolean;
}
interface Actions {
    setInputDevice?(id: string): void;
    setOutputDevice?(id: string): void;
    setInputVolume?(value: number): void;
    setOutputVolume?(value: number): void;
    setEchoCancellation?(enabled: boolean): void;
    setNoiseSuppression?(enabled: boolean): void;
    setAutomaticGainControl?(enabled: boolean): void;
    setNoiseCancellation?(enabled: boolean): void;
}
const LIMIT = 16;
const owns = (id: string) => UserStore.getCurrentUser()?.id === id;
const key = (id: string) => `zot:VoicePresets:${id}`;

function capture(name: string): VoicePreset {
    return { name, input: MediaEngineStore.getInputDeviceId(), output: MediaEngineStore.getOutputDeviceId(), inputVolume: MediaEngineStore.getInputVolume(), outputVolume: MediaEngineStore.getOutputVolume(), echo: MediaEngineStore.getEchoCancellation(), noise: MediaEngineStore.getNoiseSuppression(), gain: MediaEngineStore.getAutomaticGainControl(), krisp: MediaEngineStore.getNoiseCancellation() };
}

function restore(preset: VoicePreset, userId: string) {
    const actions = VoiceActions as Actions;
    const unavailable: string[] = [];
    const attempt = (label: string, action: (() => void) | undefined) => {
        if (!owns(userId)) throw new Error("Account changed.");
        if (!action) { unavailable.push(label); return; }
        try { action(); } catch { unavailable.push(label); }
    };
    const inputExists = preset.input === "default" || Object.hasOwn(MediaEngineStore.getInputDevices(), preset.input);
    const outputExists = preset.output === "default" || Object.hasOwn(MediaEngineStore.getOutputDevices(), preset.output);
    if (MediaEngineStore.getInputDeviceId() !== preset.input) attempt("microphone", inputExists && typeof actions.setInputDevice === "function" ? () => actions.setInputDevice?.(preset.input) : undefined);
    if (MediaEngineStore.getOutputDeviceId() !== preset.output) attempt("speaker", outputExists && typeof actions.setOutputDevice === "function" ? () => actions.setOutputDevice?.(preset.output) : undefined);
    if (Number.isFinite(preset.inputVolume) && preset.inputVolume >= 0 && preset.inputVolume <= 200 && MediaEngineStore.getInputVolume() !== preset.inputVolume) attempt("input volume", typeof actions.setInputVolume === "function" ? () => actions.setInputVolume?.(preset.inputVolume) : undefined);
    if (Number.isFinite(preset.outputVolume) && preset.outputVolume >= 0 && preset.outputVolume <= 200 && MediaEngineStore.getOutputVolume() !== preset.outputVolume) attempt("output volume", typeof actions.setOutputVolume === "function" ? () => actions.setOutputVolume?.(preset.outputVolume) : undefined);
    if (typeof preset.echo === "boolean" && MediaEngineStore.getEchoCancellation() !== preset.echo) attempt("echo cancellation", typeof actions.setEchoCancellation === "function" ? () => actions.setEchoCancellation?.(preset.echo) : undefined);
    if (typeof preset.noise === "boolean" && MediaEngineStore.getNoiseSuppression() !== preset.noise) attempt("noise suppression", MediaEngineStore.isNoiseSuppressionSupported() && typeof actions.setNoiseSuppression === "function" ? () => actions.setNoiseSuppression?.(preset.noise) : undefined);
    if (typeof preset.gain === "boolean" && MediaEngineStore.getAutomaticGainControl() !== preset.gain) attempt("automatic gain", MediaEngineStore.isAutomaticGainControlSupported() && typeof actions.setAutomaticGainControl === "function" ? () => actions.setAutomaticGainControl?.(preset.gain) : undefined);
    if (typeof preset.krisp === "boolean" && MediaEngineStore.getNoiseCancellation() !== preset.krisp) attempt("Krisp", MediaEngineStore.isNoiseCancellationSupported() && typeof actions.setNoiseCancellation === "function" ? () => actions.setNoiseCancellation?.(preset.krisp) : undefined);
    return unavailable;
}

function Panel({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [items, setItems] = useState<VoicePreset[]>([]);
    const [name, setName] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(true);
    const [confirm, setConfirm] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        DataStore.get<VoicePreset[]>(key(userId)).then(list => { if (active) setItems(list ?? []); }).catch(() => { if (active) setStatus("Could not read presets."); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [userId]);

    async function save() {
        if (!owns(userId) || busy || !name.trim()) return;
        const title = name.trim().slice(0, 40);
        setBusy(true);
        try {
            const preset = capture(title);
            await DataStore.update<VoicePreset[]>(key(userId), old => {
                const previous = old ?? [];
                if (previous.length >= LIMIT && !previous.some(p => p.name === title)) throw new Error("Preset limit reached.");
                return [preset, ...previous.filter(p => p.name !== title)];
            });
            if (owns(userId)) setItems(await DataStore.get<VoicePreset[]>(key(userId)) ?? []);
            setName(""); setStatus("Saved current voice settings.");
        } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save."); }
        finally { setBusy(false); }
    }
    async function remove(title: string) {
        if (!owns(userId) || busy) return;
        setBusy(true);
        try {
            await DataStore.update<VoicePreset[]>(key(userId), old => (old ?? []).filter(p => p.name !== title));
            if (owns(userId)) setItems(await DataStore.get<VoicePreset[]>(key(userId)) ?? []);
            setStatus("Preset removed.");
        } catch { setStatus("Could not remove preset."); }
        finally { setBusy(false); }
    }
    function apply(preset: VoicePreset) {
        if (confirm !== preset.name) { setConfirm(preset.name); setStatus("Applying can change your live audio devices and processing. Click Apply again to confirm."); return; }
        setConfirm(null);
        try {
            const skipped = restore(preset, userId);
            setStatus(skipped.length ? `Applied supported settings. Skipped: ${skipped.join(", ")}. Check Voice & Video settings.` : "Requested all saved settings. Check Voice & Video to confirm.");
        } catch { setStatus("Could not apply the preset. Some settings may have changed."); }
    }
    return <Modal {...modalProps} title="Voice presets" subtitle="Save your current microphone, speaker, volume and processing settings. Does not change mute, deafen or join calls." size="md" actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        {account !== userId ? <Text size="sm">Account changed. Reopen the panel.</Text> : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>Preset name <input aria-label="Preset name" value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
            <Button size="small" disabled={!name.trim() || busy} onClick={() => void save()}>Save current settings</Button>
            {items.map(p => <div key={p.name} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderBottom: "1px solid var(--border-subtle)" }}>
                <Text size="sm" weight="semibold">{p.name}</Text><Text size="xs" color="text-muted">Input {Math.round(p.inputVolume)} · Output {Math.round(p.outputVolume)} · Noise suppression {p.noise ? "on" : "off"}</Text>
                <div style={{ display: "flex", gap: 8 }}><Button size="small" disabled={busy} onClick={() => apply(p)}>{confirm === p.name ? "Confirm apply" : "Apply"}</Button><Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => void remove(p.name)}>Remove</Button></div>
            </div>)}
            <Text size="xs" role="status" color="text-muted">{busy ? "Loading…" : status}</Text>
        </div>}
    </Modal>;
}
const SafePanel = ErrorBoundary.wrap(Panel);
function open() { const userId = UserStore.getCurrentUser()?.id; if (userId) openModal(props => <SafePanel userId={userId} modalProps={props} />); }
export default definePlugin({ name: "VoicePresets", description: "Save and restore named voice device, volume and audio processing presets without joining calls or changing mute state.", authors: [Devs.Zot], tags: ["Voice", "Utility"], toolboxActions: { "Voice presets": open }, settingsAboutComponent: () => <Button size="small" onClick={open}>Open voice presets</Button> });
