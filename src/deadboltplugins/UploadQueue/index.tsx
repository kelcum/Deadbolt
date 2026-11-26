/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { moveItem, safeFilename } from "@utils/zotExpansion";
import { canAttach, chatButton, column, currentChannel, field, launchButton, list, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { CloudUpload } from "@vencord/discord-types";
import { DraftType, UploadAttachmentStore, UploadHandler, UploadManager, useState, useStateFromStores } from "@webpack/common";

function Panel({ userId }: { userId: string; }) {
    const [channelId] = useState(() => currentChannel()?.id);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState("");
    const [name, setName] = useState("");
    const [confirm, setConfirm] = useState("");
    const uploads = useStateFromStores([UploadAttachmentStore], () => channelId ? UploadAttachmentStore.getUploads(channelId, DraftType.ChannelMessage) : []);
    function mutate(update: (current: typeof uploads) => typeof uploads) {
        const channel = currentChannel();
        if (busy || !channelId || channel?.id !== channelId || !canAttach(channel) || !owns(userId)) { setStatus("Channel changed. Reopen the queue."); return; }
        try {
            const latest = UploadAttachmentStore.getUploads(channelId, DraftType.ChannelMessage);
            if (latest.some(u => u.status !== "NOT_STARTED" && u.status !== "ERROR")) { setStatus("An upload is active or complete. Use Discord’s normal upload controls."); return; }
            UploadManager.setUploads({ channelId, draftType: DraftType.ChannelMessage, uploads: update([...latest]) });
            setStatus("Draft attachments updated.");
        } catch { setStatus("Could not update the draft. Use Discord's attachment controls."); }
    }
    async function requeue(upload: CloudUpload) {
        const channel = currentChannel();
        if (busy || !owns(userId) || !channel || channel.id !== channelId || !canAttach(channel)) return;
        const before = UploadAttachmentStore.getUploads(channel.id, DraftType.ChannelMessage);
        const failed = before.find(u => u.id === upload.id);
        if (failed?.status !== "ERROR" || before.some(u => u.status !== "ERROR" && u.status !== "NOT_STARTED")) return;
        setBusy(true);
        try {
            const ids = before.map(u => u.id);
            const original = failed.item.file;
            await UploadHandler.promptToUpload([new File([original], safeFilename(failed.filename), { type: original.type })], channel, DraftType.ChannelMessage);
            const current = currentChannel();
            if (!owns(userId) || current?.id !== channelId || !canAttach(current)) return;
            const now = UploadAttachmentStore.getUploads(channel.id, DraftType.ChannelMessage);
            const known = new Set(ids);
            const added = now.filter(u => !known.has(u.id));
            const existing = now.filter(u => known.has(u.id));
            const previous = existing.find(u => u.id === failed.id);
            if (added.length !== 1 || existing.length !== ids.length || existing.some((u, i) => u.id !== ids[i]) || previous?.status !== "ERROR" || added[0].status !== "NOT_STARTED" || now.some(u => u.status !== "ERROR" && u.status !== "NOT_STARTED")) {
                setStatus("Draft changed. Review the attachments in Discord before sending.");
                return;
            }
            const fresh = added[0];
            fresh.spoiler = previous.spoiler;
            fresh.description = previous.description;
            fresh.filename = safeFilename(previous.filename);
            UploadManager.setUploads({ channelId: channel.id, draftType: DraftType.ChannelMessage, uploads: now.filter(u => u.id !== fresh.id).map(u => u.id === upload.id ? fresh : u) });
            setStatus("Failed attachment requeued. Send it normally when ready.");
        } catch { setStatus("Could not requeue. Check Discord's normal draft controls."); }
        finally { setBusy(false); }
    }
    return <div style={column}>
        <Text size="sm">Reorder, rename or remove attachments in the current unsent draft. Sending is always manual.</Text>
        <div style={list}>{uploads.map((upload, index) => <div key={upload.id} style={{ ...column, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 8 }}>
            <Text size="sm" weight="semibold">{index + 1}. {upload.filename}</Text>
            <Text size="xs" color="text-muted">{upload.status === "ERROR" ? "Failed — requeue or retry in the composer" : upload.status.toLowerCase().replaceAll("_", " ")}</Text>
            {editing === upload.id && <div style={row}><input style={{ ...field, flex: 1 }} aria-label="New filename" value={name} maxLength={180} onChange={e => setName(e.target.value)}/><Button size="small" disabled={!name.trim()} onClick={() => { mutate(items => { const item = items.find(x => x.id === upload.id); if (item) item.filename = safeFilename(name); return items; }); setEditing(""); }}>Save</Button><Button size="small" variant="secondary" onClick={() => setEditing("")}>Cancel</Button></div>}
            <div style={row}>{upload.status === "ERROR" && <Button size="xs" disabled={busy} onClick={() => void requeue(upload)}>Requeue</Button>}<Button size="xs" variant="secondary" disabled={busy || index === 0} onClick={() => mutate(items => { const i = items.findIndex(x => x.id === upload.id); return moveItem(items, i, i - 1); })}>Up</Button><Button size="xs" variant="secondary" disabled={busy || index === uploads.length - 1} onClick={() => mutate(items => { const i = items.findIndex(x => x.id === upload.id); return moveItem(items, i, i + 1); })}>Down</Button><Button size="xs" variant="secondary" onClick={() => { setName(upload.filename); setEditing(upload.id); }}>Rename</Button><Button size="xs" variant="dangerSecondary" onClick={() => { if (confirm !== upload.id) { setConfirm(upload.id); return; } setConfirm(""); mutate(items => items.filter(x => x.id !== upload.id)); }}>{confirm === upload.id ? "Confirm remove" : "Remove"}</Button></div>
        </div>)}</div>
        <Status>{status || (!uploads.length ? "No attachments in this draft." : `${uploads.length} pending attachments`)}</Status>
    </div>;
}
function open() { showPanel("Upload queue", Panel); }
export default definePlugin({ name: "UploadQueue", description: "Manage the current draft's pending attachments, including reorder, rename and remove.", authors: [Devs.Zot], tags: ["Media", "Utility"], chatBarButton: chatButton("Upload queue", open), toolboxActions: { "Upload queue": open }, settingsAboutComponent: launchButton("Open upload queue", open) });
