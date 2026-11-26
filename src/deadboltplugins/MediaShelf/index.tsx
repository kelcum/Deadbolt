/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { safeFilename } from "@utils/zotExpansion";
import { canAttach, chatButton, column, currentChannel, field, launchButton, list, owns, row, showPanel, Status } from "@utils/zotPanels";
import { DraftType, UploadHandler, useEffect, useState } from "@webpack/common";

interface Entry { id: string; name: string; file: Blob; type: string; }
const LIMIT = 48 * 1024 * 1024;
let shelfStore: ReturnType<typeof DataStore.createStore> | undefined;
const store = () => shelfStore ??= DataStore.createStore("DeadboltMediaShelf", "files");
const key = (user: string) => `zot:MediaShelf:${user}`;
function Panel({ userId, close }: { userId: string; close(): void; }) {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [channelId] = useState(() => currentChannel()?.id);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(true);
    const [status, setStatus] = useState("");
    const [confirm, setConfirm] = useState("");
    useEffect(() => { let active = true; DataStore.get<Entry[]>(key(userId), store()).then(v => { if (active) setEntries(v ?? []); }, () => { if (active) setStatus("Could not load shelf."); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [userId]);
    async function change(update: (old: Entry[]) => Entry[]) {
        if (busy || !owns(userId)) return;
        setBusy(true);
        try { await DataStore.update<Entry[]>(key(userId), old => update(old ?? []), store()); if (owns(userId)) setEntries(await DataStore.get<Entry[]>(key(userId), store()) ?? []); setStatus("Shelf updated."); }
        catch (error) { setStatus(error instanceof Error ? error.message : "Could not update shelf."); }
        finally { setBusy(false); }
    }
    async function attach(entry: Entry) {
        const channel = currentChannel();
        if (!owns(userId) || channel?.id !== channelId || !channel || !canAttach(channel)) { setStatus("Select an accessible channel and reopen the shelf."); return; }
        try { await UploadHandler.promptToUpload([new File([entry.file], entry.name, { type: entry.type })], channel, DraftType.ChannelMessage); close(); } catch { setStatus("Could not add attachment to draft."); }
    }
    return <div style={column}>
        <Text size="sm">Keep frequently used local files here. Nothing is uploaded until you send a message yourself.</Text>
        <label>Add files <input type="file" multiple disabled={busy} onChange={e => { const files = Array.from<File>(e.currentTarget.files ?? []); e.currentTarget.value = ""; if (!files.length) return; void change(old => { const items = [...old, ...files.map(file => ({ id: crypto.randomUUID(), name: safeFilename(file.name), file, type: file.type }))]; if (items.length > 40 || items.some(x => x.file.size > 12 * 1024 * 1024) || items.reduce((n, x) => n + x.file.size, 0) > LIMIT) throw new Error("Shelf limit: 40 files, 12 MiB per file and 48 MiB total."); return items; }); }}/></label>
        <input style={field} value={query} placeholder="Find saved files" aria-label="Find saved files" onChange={e => setQuery(e.target.value)}/>
        <Text size="xs" color="text-muted">{entries.length} files · {(entries.reduce((n, x) => n + x.file.size, 0) / 1048576).toFixed(1)} of 48 MiB</Text>
        <div style={list}>{entries.filter(x => x.name.toLowerCase().includes(query.toLowerCase())).map(x => <div key={x.id} style={{ ...row, justifyContent: "space-between" }}><Text size="sm" style={{ overflowWrap: "anywhere" }}>{x.name} ({Math.ceil(x.file.size / 1024)} KiB)</Text><div style={row}><Button size="small" disabled={busy} onClick={() => void attach(x)}>Attach</Button><Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => { if (confirm !== x.id) { setConfirm(x.id); return; } setConfirm(""); void change(old => old.filter(v => v.id !== x.id)); }}>{confirm === x.id ? "Confirm remove" : "Remove"}</Button></div></div>)}</div>
        <Status>{busy ? "Working…" : status}</Status>
    </div>;
}
function open() { showPanel("Media shelf", Panel); }
export default definePlugin({ name: "MediaShelf", description: "Save frequently used local files and attach them to a draft on demand.", authors: [Devs.Zot], tags: ["Media", "Organisation"], chatBarButton: chatButton("Media shelf", open), toolboxActions: { "Media shelf": open }, settingsAboutComponent: launchButton("Open media shelf", open) });
