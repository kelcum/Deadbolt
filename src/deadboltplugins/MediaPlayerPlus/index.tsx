/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Message, RenderModalProps } from "@vencord/discord-types";
import { Menu, Modal, openModal, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { attachmentUrl } from "../TextFilePreview/text";
import { clampTime, mediaType, speedValues } from "./media";

type Attachment = Message["attachments"][number];
interface Position { id: string; time: number; updated: number; }
interface Preferences { volume: number; muted: boolean; speed: number; positions: Position[]; }
const defaults: Preferences = { volume: 1, muted: false, speed: 1, positions: [] };
const key = (id: string) => `zot:MediaPlayerPlus:${id}`;
export const canPlay = (a: Attachment) => Boolean(mediaType(a.filename, a.content_type) && attachmentUrl(a.url));
const label = (a: Attachment) => a.spoiler || a.filename.startsWith("SPOILER_") ? "Spoiler media" : a.filename;
function clock(seconds: number) {
    const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return `${Math.floor(n / 3600) ? `${Math.floor(n / 3600)}:` : ""}${Math.floor(n / 60) % 60}:${String(n % 60).padStart(2, "0")}`;
}

function Viewer({ attachment, userId, modalProps }: { attachment: Attachment; userId: string; modalProps: RenderModalProps; }) {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [prefs, setPrefs] = useState<Preferences | null>(null);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [loop, setLoop] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [status, setStatus] = useState("");
    const media = useRef<HTMLMediaElement | null>(null);
    const lastSave = useRef(0);
    const snapshot = useRef<Preferences | null>(null);
    const ready = useRef(false);
    const type = mediaType(attachment.filename, attachment.content_type);
    const url = attachmentUrl(attachment.url)?.href;

    useEffect(() => {
        let active = true;
        DataStore.get<Preferences>(key(userId)).then(p => { if (active) setPrefs(p ?? defaults); }).catch(() => { if (active) { setPrefs(defaults); setStatus("Preferences could not be loaded."); } });
        return () => { active = false; };
    }, [userId]);

    function persist(force = false) {
        const player = media.current;
        if (!player || !ready.current || UserStore.getCurrentUser()?.id !== userId || !Number.isFinite(player.duration)) return;
        const now = Date.now();
        if (!force && now - lastSave.current < 5000) return;
        lastSave.current = now;
        const current = { id: attachment.id, time: player.ended ? 0 : clampTime(player.currentTime, player.duration), updated: now };
        const values = { volume: player.volume, muted: player.muted, speed: player.playbackRate };
        snapshot.current = { ...values, positions: [current] };
        void DataStore.update<Preferences>(key(userId), old => ({ ...values, positions: [current, ...(old?.positions ?? []).filter(p => p.id !== attachment.id)].slice(0, 100) })).catch(() => { });
    }
    useEffect(() => () => {
        if (!snapshot.current || UserStore.getCurrentUser()?.id !== userId) return;
        const { positions, ...values } = snapshot.current;
        void DataStore.update<Preferences>(key(userId), old => ({ ...values, positions: [...positions, ...(old?.positions ?? []).filter(p => p.id !== attachment.id)].slice(0, 100) })).catch(() => { });
    }, [userId, attachment.id]);
    function onMetadata() {
        if (ready.current) return;
        const player = media.current;
        if (!player || !prefs) return;
        player.volume = Number.isFinite(prefs.volume) ? Math.max(0, Math.min(1, prefs.volume)) : 1;
        player.muted = Boolean(prefs.muted);
        player.playbackRate = speedValues.includes(prefs.speed) ? prefs.speed : 1;
        setSpeed(player.playbackRate);
        const resume = prefs.positions?.find(p => p.id === attachment.id)?.time ?? 0;
        const length = Number.isFinite(player.duration) ? player.duration : 0;
        setDuration(length);
        if (length && resume > 0 && resume < length - 1) player.currentTime = clampTime(resume, length);
        setTime(player.currentTime);
        ready.current = true;
    }
    function seek(delta: number, absolute = false) {
        const player = media.current;
        if (!player || !Number.isFinite(player.duration)) return;
        player.currentTime = clampTime(absolute ? delta : player.currentTime + delta, player.duration);
        setTime(player.currentTime);
        persist(true);
    }
    function step(delta: number) { media.current?.pause(); seek(delta / 30); }
    function togglePlay() {
        const player = media.current;
        if (!player) return;
        if (player.paused) void player.play().catch(() => setStatus("Could not start playback.")); else player.pause();
    }
    const attrs = { src: url, controls: true, preload: "metadata" as const, loop, onLoadedMetadata: onMetadata, onTimeUpdate: () => { setTime(media.current?.currentTime ?? 0); persist(); }, onSeeked: () => persist(true), onPause: () => persist(true), onEnded: () => persist(true), onVolumeChange: () => persist(true), onRateChange: () => persist(true), onError: () => setStatus("This media format or URL could not be played. Try Discord's regular download option.") };
    return <Modal {...modalProps} size="xl" title={attachment.filename} subtitle="Enhanced attachment player" actions={[{ text: "Close", variant: "secondary", onClick: () => { persist(true); modalProps.onClose(); } }]}>
        {account !== userId ? <Text size="sm">Account changed. Reopen the player.</Text> : !prefs ? <Text size="sm">Loading player preferences…</Text> : <div className="db-player-plus" onKeyDown={event => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLMediaElement) return;
            if (event.code === "Space") { event.preventDefault(); togglePlay(); }
            else if (event.key === "ArrowLeft") { event.preventDefault(); seek(-5); }
            else if (event.key === "ArrowRight") { event.preventDefault(); seek(5); }
        }} tabIndex={0}>
            {type === "video" ? <video {...attrs} ref={element => { media.current = element; }} playsInline /> : <audio {...attrs} ref={element => { media.current = element; }} />}
            <div className="db-player-tools"><Button size="small" variant="secondary" onClick={() => seek(-10)}>−10s</Button><Button size="small" variant="secondary" onClick={togglePlay}>Play / pause</Button><Button size="small" variant="secondary" onClick={() => seek(10)}>+10s</Button>
                {type === "video" && <><Button size="small" variant="secondary" onClick={() => step(-1)}>Previous step</Button><Button size="small" variant="secondary" onClick={() => step(1)}>Next step</Button></>}
                <Button size="small" variant={loop ? "primary" : "secondary"} onClick={() => setLoop(v => !v)}>{loop ? "Loop on" : "Loop off"}</Button>
                <label>Speed <select aria-label="Playback speed" value={speed} onChange={event => { const n = Number(event.target.value); if (media.current && speedValues.includes(n)) { media.current.playbackRate = n; setSpeed(n); } }}>{speedValues.map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
            </div>
            <div className="db-player-tools"><Text size="xs" color="text-muted">{clock(time)} / {clock(duration)}</Text><input aria-label="Seek" type="range" min={0} max={duration || 1} step={0.1} disabled={!duration} value={time} onChange={event => seek(Number(event.target.value), true)} /><Button size="small" variant="secondary" onClick={() => seek(0, true)}>Restart media</Button></div>
            <Text size="xs" color="text-muted">Player remembers volume, speed and up to 100 positions on this account. Video step is approximately 1/30 second. No autoplay.</Text>
            <Text size="xs" color="text-muted" role="status">{status}</Text>
        </div>}
    </Modal>;
}
const SafeViewer = ErrorBoundary.wrap(Viewer);
export function open(attachment: Attachment) { const userId = UserStore.getCurrentUser()?.id; if (userId && canPlay(attachment)) openModal(props => <SafeViewer attachment={attachment} userId={userId} modalProps={props} />); }
function Buttons({ message }: { message?: Message; }) {
    const files = message?.attachments?.filter(canPlay);
    if (!files?.length) return null;
    return <div className="db-player-buttons">{files.map(a => <Button key={a.id} size="xs" variant="secondary" onClick={() => open(a)}>Enhanced player: {label(a)}</Button>)}</div>;
}
const menu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => { const files = message?.attachments?.filter(canPlay); if (files?.length) children.push(<Menu.MenuItem id="db-media-player" label="Open enhanced player">{files.map(a => <Menu.MenuItem key={a.id} id={`db-player-${a.id}`} label={label(a)} action={() => open(a)} />)}</Menu.MenuItem>); };
export default definePlugin({ name: "MediaPlayerPlus", description: "Play audio and video attachments with remembered position, volume, speed, looping, seeking and fine video steps.", authors: [Devs.Zot], tags: ["Media", "Utility"], renderMessageAccessory: Buttons, contextMenus: { message: menu } });
