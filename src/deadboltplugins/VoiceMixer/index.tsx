/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { clamp } from "@utils/zotExpansion";
import { column, launchButton, list, owns, row, showPanel, Status } from "@utils/zotPanels";
import { findByPropsLazy } from "@webpack";
import { MediaEngineStore, UserStore, useState, useStateFromStores, VoiceActions, VoiceStateStore } from "@webpack/common";

const VolumeActions = findByPropsLazy("setLocalVolume") as { setLocalVolume?(userId: string, volume: number): void; };
interface Actions { toggleLocalMute?(userId: string): void; }
function Panel({ userId }: { userId: string; }) {
    const channelId = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateForUser(userId)?.channelId);
    const ids = useStateFromStores([VoiceStateStore], () => channelId ? Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId)).filter(id => id !== userId) : [], [channelId, userId]);
    const [ceiling, setCeiling] = useState(100);
    const [status, setStatus] = useState("");
    const actions = VoiceActions as Actions;
    function valid(id: string) { return owns(userId) && !!channelId && VoiceStateStore.getVoiceStateForUser(userId)?.channelId === channelId && VoiceStateStore.getVoiceStateForUser(id)?.channelId === channelId; }
    function change(id: string, value: number) { if (!valid(id) || typeof VolumeActions.setLocalVolume !== "function") { setStatus("Voice volume action is unavailable."); return; } try { VolumeActions.setLocalVolume(id, clamp(value, 0, 200)); } catch { setStatus("Could not change volume."); } }
    function renderParticipant(id: string) {
        return <Participant key={id} id={id} change={change} mute={() => { if (valid(id)) { try { actions.toggleLocalMute?.(id); } catch { setStatus("Could not change local mute."); } } }} canMute={typeof actions.toggleLocalMute === "function"} />;
    }
    return <div style={column}>
        <Text size="sm">Manage local participant volumes in your current voice channel. No audio recording or microphone changes.</Text>
        <div style={row}><label>Volume cap <input type="range" min={0} max={200} value={ceiling} onChange={e => setCeiling(Number(e.target.value))}/> {ceiling}%</label><Button size="small" disabled={!ids.length} onClick={() => { for (const id of ids) if (MediaEngineStore.getLocalVolume(id) > ceiling) change(id, ceiling); }}>Apply cap now</Button></div>
        <Status>Volume cap changes gain settings; it is not a peak limiter or hearing protection.</Status>
        <div style={list}>{ids.map(renderParticipant)}</div><Status>{status || (!channelId ? "Join a voice channel first." : `${ids.length} other participants`)}</Status>
    </div>;
}
function Participant({ id, change, mute, canMute }: { id: string; change(id: string, value: number): void; mute(): void; canMute: boolean; }) {
    const volume = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getLocalVolume(id));
    const muted = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isLocalMute(id));
    return <div style={column}><Text size="sm" weight="semibold">{UserStore.getUser(id)?.username ?? id}</Text><div style={row}><input aria-label="Participant volume" type="range" min={0} max={200} value={clamp(volume, 0, 200, 100)} onChange={e => change(id, Number(e.target.value))}/><Text size="xs">{Math.round(volume)}%</Text><Button size="xs" variant="secondary" disabled={!canMute} onClick={mute}>{muted ? "Unmute locally" : "Mute locally"}</Button></div></div>;
}
function open() { showPanel("Voice mixer", Panel); }
export default definePlugin({ name: "VoiceMixer", description: "Adjust individual local voice volumes and mute states from one panel, with a manual volume cap.", authors: [Devs.Zot], tags: ["Voice", "Utility"], toolboxActions: { "Voice mixer": open }, settingsAboutComponent: launchButton("Open voice mixer", open) });
