/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, DraftType, Modal, openModal, PermissionsBits, PermissionStore, SelectedChannelStore, UploadHandler, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { PointerEvent } from "react";

import { boundedSize, normalizeBox } from "./image";

type Tool = "crop" | "redact" | "blur" | "draw";
type Point = { x: number; y: number; };
const accepted = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp", "image/avif"]);
const maxFile = 24 * 1024 * 1024;

function canvas(width: number, height: number) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c;
}
function context(c: HTMLCanvasElement) {
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    return ctx;
}
function clone(source: HTMLCanvasElement) {
    const result = canvas(source.width, source.height);
    context(result).drawImage(source, 0, 0);
    return result;
}
function encode(source: HTMLCanvasElement, name: string, type: string, quality: number) {
    return new Promise<File>((resolve, reject) => source.toBlob(blob => {
        if (!blob || blob.type !== type) return reject(new Error("This format is unavailable."));
        resolve(new File([blob], `${name.replace(/\.[^.]+$/, "")}-edited.${type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"}`, { type }));
    }, type, quality));
}

function Editor({ userId, channelId, modalProps }: { userId: string; channelId: string; modalProps: RenderModalProps; }) {
    const [history, setHistory] = useState<HTMLCanvasElement[]>([]);
    const [filename, setFilename] = useState("image");
    const [tool, setTool] = useState<Tool>("crop");
    const [color, setColor] = useState("#ff4545");
    const [width, setWidth] = useState(8);
    const [format, setFormat] = useState("image/png");
    const [quality, setQuality] = useState(0.85);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number; } | null>(null);
    const view = useRef<HTMLCanvasElement>(null);
    const stroke = useRef<{ start: Point; last: Point; draft: HTMLCanvasElement | null; pointer: number; } | null>(null);
    const alive = useRef(true);
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const current = history.at(-1);

    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (!current || !view.current) return;
        view.current.width = current.width;
        view.current.height = current.height;
        context(view.current).drawImage(current, 0, 0);
    }, [current]);

    function commit(next: HTMLCanvasElement) {
        setHistory(old => [...old.slice(-3), next]);
        setSelection(null);
        setStatus("");
    }

    async function load(file: File | undefined) {
        if (!file || busy) return;
        if (!accepted.has(file.type) || file.size > maxFile) return setStatus("Choose a PNG, JPEG, WebP, BMP or AVIF up to 24 MiB.");
        setBusy(true);
        try {
            const bitmap = await createImageBitmap(file);
            try {
                if (!alive.current || UserStore.getCurrentUser()?.id !== userId) return;
                const { width, height } = boundedSize(bitmap.width, bitmap.height);
                const next = canvas(width, height);
                context(next).drawImage(bitmap, 0, 0, width, height);
                setHistory([next]);
                setSelection(null);
                setFilename(file.name);
                setStatus(width !== bitmap.width || height !== bitmap.height ? `Resized for editing to ${width} × ${height}.` : "Ready to edit.");
            } finally { bitmap.close(); }
        } catch { if (alive.current) setStatus("Could not decode the image."); }
        finally { if (alive.current) setBusy(false); }
    }

    function point(event: PointerEvent<HTMLCanvasElement>) {
        const r = event.currentTarget.getBoundingClientRect();
        return { x: Math.max(0, Math.min(event.currentTarget.width, (event.clientX - r.left) / r.width * event.currentTarget.width)), y: Math.max(0, Math.min(event.currentTarget.height, (event.clientY - r.top) / r.height * event.currentTarget.height)) };
    }

    function down(event: PointerEvent<HTMLCanvasElement>) {
        if (!current || busy || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = point(event);
        stroke.current = { start, last: start, draft: tool === "draw" ? clone(current) : null, pointer: event.pointerId };
        setSelection(null);
    }

    function move(event: PointerEvent<HTMLCanvasElement>) {
        const data = stroke.current;
        if (!data || data.pointer !== event.pointerId || !current || !view.current) return;
        const end = point(event);
        if (data.draft) {
            const ctx = context(data.draft);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(data.last.x, data.last.y); ctx.lineTo(end.x, end.y); ctx.stroke();
            data.last = end;
            context(view.current).drawImage(data.draft, 0, 0);
        } else {
            const box = normalizeBox(data.start, end, current.width, current.height);
            setSelection(box);
            const ctx = context(view.current);
            ctx.clearRect(0, 0, current.width, current.height);
            ctx.drawImage(current, 0, 0);
            ctx.strokeStyle = "#6fa8ff";
            ctx.lineWidth = Math.max(2, current.width / 400);
            ctx.strokeRect(box.x, box.y, box.w, box.h);
        }
    }

    function finish(event: PointerEvent<HTMLCanvasElement>, cancelled = false) {
        const data = stroke.current;
        if (!data || data.pointer !== event.pointerId || !current || !view.current) return;
        stroke.current = null;
        if (cancelled) { setSelection(null); context(view.current).clearRect(0, 0, current.width, current.height); context(view.current).drawImage(current, 0, 0); return; }
        if (data.draft) { commit(data.draft); return; }
        const box = normalizeBox(data.start, point(event), current.width, current.height);
        if (box.w < 1 || box.h < 1) { setSelection(null); context(view.current).clearRect(0, 0, current.width, current.height); context(view.current).drawImage(current, 0, 0); return; }
        if (tool === "crop") {
            const next = canvas(box.w, box.h);
            context(next).drawImage(current, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
            commit(next);
        } else {
            const next = clone(current);
            const ctx = context(next);
            if (tool === "redact") { ctx.fillStyle = "#000"; ctx.fillRect(box.x, box.y, box.w, box.h); }
            else {
                ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
                ctx.filter = `blur(${Math.max(12, Math.round(current.width / 80))}px)`;
                ctx.drawImage(current, 0, 0); ctx.restore();
            }
            commit(next);
        }
    }

    function rotate() {
        if (!current) return;
        const next = canvas(current.height, current.width);
        const ctx = context(next);
        ctx.translate(next.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(current, 0, 0);
        commit(next);
    }

    async function output(upload: boolean) {
        if (!current || busy || account !== userId) return;
        setBusy(true);
        try {
            const file = await encode(current, filename, format, quality);
            if (!alive.current || UserStore.getCurrentUser()?.id !== userId) return;
            if (!upload) { saveFile(file); setStatus(`Saved ${file.name}.`); return; }
            const channel = ChannelStore.getChannel(channelId);
            if (!channel || SelectedChannelStore.getChannelId() !== channelId || channel.guild_id && (!PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) || !PermissionStore.can(PermissionsBits.ATTACH_FILES, channel))) throw new Error("Return to the original conversation with upload permission.");
            await UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage);
            if (alive.current) setStatus("Image passed to Discord's upload composer. Review it before sending.");
        } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : "Could not export image."); }
        finally { if (alive.current) setBusy(false); }
    }

    return <Modal {...modalProps} size="xl" title="Upload editor" subtitle="Edit a local image before attaching it. Nothing is sent automatically." actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        {account !== userId ? <Text size="sm">Account changed. Reopen the editor.</Text> : <div className="db-upload-editor">
            <input type="file" aria-label="Choose image" accept="image/png,image/jpeg,image/webp,image/bmp,image/avif" disabled={busy} onChange={e => void load(e.target.files?.[0])} />
            <div className="db-upload-tools">
                {(["crop", "redact", "blur", "draw"] as const).map(t => <Button key={t} size="small" variant={tool === t ? "primary" : "secondary"} disabled={!current || busy} onClick={() => setTool(t)}>{t === "redact" ? "Solid redaction" : t[0].toUpperCase() + t.slice(1)}</Button>)}
                <Button size="small" variant="secondary" disabled={!current || busy} onClick={rotate}>Rotate 90°</Button>
                <Button size="small" variant="secondary" disabled={history.length < 2 || busy} onClick={() => { setHistory(old => old.slice(0, -1)); setSelection(null); }}>Undo</Button>
                {tool === "draw" && <><input type="color" aria-label="Brush color" value={color} onChange={e => setColor(e.target.value)} /><label>Brush <input type="range" aria-label="Brush width" min={2} max={32} value={width} onChange={e => setWidth(Number(e.target.value))} /></label></>}
            </div>
            <Text size="xs" color="text-muted">{current ? `${current.width} × ${current.height} · Drag on image to ${tool}.` : "Choose an image to begin."}{selection ? ` ${selection.w} × ${selection.h}` : ""} For sensitive text use solid redaction, not blur.</Text>
            <div className="db-upload-preview" hidden={!current}><canvas ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} /></div>
            <div className="db-upload-tools">
                <label>Format <select aria-label="Export format" value={format} onChange={e => setFormat(e.target.value)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
                {format !== "image/png" && <label>Quality {Math.round(quality * 100)}% <input type="range" min="0.2" max="1" step="0.05" aria-label="Image quality" value={quality} onChange={e => setQuality(Number(e.target.value))} /></label>}
                <Button size="small" variant="secondary" disabled={!current || busy} onClick={() => void output(false)}>Save image</Button>
                <Button size="small" disabled={!current || busy || !channelId} onClick={() => void output(true)}>Attach to chat</Button>
            </div>
            <Text size="xs" color="text-muted" role="status">{busy ? "Processing…" : status}</Text>
        </div>}
    </Modal>;
}

const SafeEditor = ErrorBoundary.wrap(Editor);
function open() {
    const userId = UserStore.getCurrentUser()?.id;
    if (userId) openModal(props => <SafeEditor userId={userId} channelId={SelectedChannelStore.getChannelId()} modalProps={props} />);
}
export default definePlugin({ name: "UploadEditor", description: "Crop, draw, rotate, redact and compress local images before adding them to Discord's normal upload composer.", authors: [Devs.Zot], tags: ["Media", "Utility"], toolboxActions: { "Open upload editor": open }, settingsAboutComponent: () => <Button size="small" onClick={open}>Open upload editor</Button> });
