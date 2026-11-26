/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import { accessible, column, launchButton, list, messageAction, owner, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, MessageStore, showToast, useState } from "@webpack/common";

interface Selection { channel: string; id: string; }
let account: string | undefined;
let selected: Selection[] = [];
function reset() { account = undefined; selected = []; }
function pick(m: Message) {
    const user = owner();
    if (!user) return;
    if (account !== user) { reset(); account = user; }
    if (selected.length && selected[0].channel !== m.channel_id) { showToast({ text: "Select messages from one conversation. Clear the selection first." }); return; }
    if (selected.some(x => x.id === m.id)) { selected = selected.filter(x => x.id !== m.id); showToast({ text: "Message removed from screenshot selection." }); return; }
    if (selected.length >= 15) { showToast({ text: "Select at most 15 messages." }); return; }
    selected = [...selected, { id: m.id, channel: m.channel_id }]; showToast({ text: `${selected.length} selected for chat screenshot.` });
}
function getMessages(userId: string) {
    if (account !== userId || !owns(userId)) return [];
    return selected.flatMap(s => { const c = ChannelStore.getChannel(s.channel); const m = accessible(c) ? MessageStore.getMessage(s.channel, s.id) : undefined; return m && !(m as Message & { deleted?: boolean; }).deleted && (!m.state || m.state === "SENT") ? [m] : []; }).sort((a, b) => a.id.localeCompare(b.id));
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
    const result: string[] = [];
    for (const raw of text.split("\n")) {
        let line = "";
        for (const char of raw) {
            if (line && ctx.measureText(line + char).width > width) { result.push(line); line = ""; }
            line += char;
        }
        result.push(line);
    }
    return result;
}
async function render(messages: Message[], redact: boolean, hideText: boolean, light: boolean) {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.font = "20px system-ui, sans-serif";
    const rows = messages.map(m => {
        const text = hideText ? "[Message hidden]" : m.content || "[No text content]";
        if (text.length > 4000) throw new Error("A selected message is too long to render. Select a shorter message or hide the message text.");
        return { label: redact ? `Participant ${messages.findIndex(x => x.author.id === m.author.id) + 1}` : m.author.username, text: wrap(ctx, text, 920), attachments: m.attachments?.length ?? 0 };
    });
    const height = 90 + rows.reduce((n, r) => n + 62 + r.text.length * 28 + (r.attachments ? 26 : 0), 0);
    if (height > 10000) throw new Error("Screenshot is too tall. Select fewer messages.");
    canvas.height = height;
    ctx.fillStyle = light ? "#f5f6f8" : "#18191c"; ctx.fillRect(0, 0, canvas.width, height);
    ctx.fillStyle = light ? "#25262b" : "#eeeeef"; ctx.font = "bold 24px system-ui, sans-serif"; ctx.fillText("Selected Discord messages", 36, 42);
    ctx.font = "15px system-ui, sans-serif"; ctx.fillText("Text-only reconstruction · selected excerpts", 36, 66);
    let y = 100;
    for (const r of rows) {
        ctx.fillStyle = light ? "#384aad" : "#a8b3ff"; ctx.font = "bold 20px system-ui, sans-serif"; ctx.fillText(r.label.slice(0, 80), 36, y);
        ctx.fillStyle = light ? "#222329" : "#e4e4e7"; ctx.font = "20px system-ui, sans-serif"; y += 32;
        for (const line of r.text) { ctx.fillText(line, 36, y); y += 28; }
        if (r.attachments) { ctx.font = "italic 16px system-ui, sans-serif"; ctx.fillText(`[${r.attachments} attachment(s) omitted]`, 36, y); y += 26; }
        y += 30;
    }
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not render screenshot.")), "image/png"));
}
function Panel({ userId }: { userId: string; }) {
    const [messages, setMessages] = useState(() => getMessages(userId));
    const [redact, setRedact] = useState(true);
    const [hideText, setHideText] = useState(false);
    const [light, setLight] = useState(false);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    async function save() {
        if (!owns(userId) || busy) return;
        setBusy(true);
        try { const rows = getMessages(userId); if (!rows.length) throw new Error("No accessible selected messages."); const blob = await render(rows, redact, hideText, light); if (owns(userId)) saveFile(new File([blob], "discord-messages.png", { type: "image/png" })); setStatus("Image prepared. Review it before sharing."); }
        catch (e) { setStatus(e instanceof Error ? e.message : "Could not create image."); } finally { setBusy(false); }
    }
    return <div style={column}><Text size="sm">Right-click messages to select them. Export a clearly labeled text-only reconstruction. Avatars, attachments and embeds are omitted.</Text><div style={row}><label><input type="checkbox" checked={redact} onChange={e => setRedact(e.target.checked)}/> Hide identities</label><label><input type="checkbox" checked={hideText} onChange={e => setHideText(e.target.checked)}/> Hide message text</label><label><input type="checkbox" checked={light} onChange={e => setLight(e.target.checked)}/> Light background</label></div><div style={list}>{messages.map((m, i) => <div key={m.id}><Text size="xs" color="text-muted">{redact ? `Message ${i + 1}` : m.author.username}</Text><Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{hideText ? "[Message hidden]" : m.content.slice(0, 180)}</Text></div>)}</div><div style={row}><Button disabled={!messages.length || busy} onClick={() => void save()}>Save PNG</Button><Button variant="secondary" onClick={() => setMessages(getMessages(userId))}>Refresh selection</Button><Button variant="secondary" onClick={() => { if (owns(userId)) { reset(); setMessages([]); } }}>Clear selection</Button></div><Status>{status || "Identity hiding does not remove names or personal details inside message text."}</Status></div>;
}
function open() { showPanel("Chat screenshot", Panel); }
export default definePlugin({ name: "ChatScreenshot", description: "Turn explicitly selected messages into a labeled text image with optional identity and content masking.", authors: [Devs.Zot], tags: ["Chat", "Media", "Privacy"], contextMenus: { message: messageAction("chat-screenshot", "Toggle screenshot selection", pick) }, toolboxActions: { "Chat screenshot": open }, settingsAboutComponent: launchButton("Open chat screenshot", open), flux: { LOGOUT: reset }, stop: reset });
