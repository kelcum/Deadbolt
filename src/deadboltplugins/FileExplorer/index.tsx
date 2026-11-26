/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { accessible, column, field, list, messageAction, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, openMediaModal, useEffect, useState } from "@webpack/common";

import { canPlay, open as openMedia } from "../MediaPlayerPlus";
import { canPreview, loadAttachment, openPreview } from "../TextFilePreview";
import { attachmentUrl } from "../TextFilePreview/text";
import { archiveDirectory, ArchiveEntry, isArchive } from "./archive";

type Attachment = Message["attachments"][number];
function kind(a: Attachment) {
    if (canPreview(a)) return "Text / code";
    if (canPlay(a)) return "Audio / video";
    if (/\.pdf$/i.test(a.filename)) return "PDF";
    if (isArchive(a.filename)) return "Archive / document package";
    if (/^image\/(?:png|jpeg|gif|webp|avif|bmp)$/i.test(a.content_type ?? "") && a.width && a.height) return "Image";
    return "Other file";
}
function ArchivePanel({ attachment }: { attachment: Attachment; }) {
    const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(100);
    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        loadAttachment(attachment, controller.signal).then(data => { if (active && !controller.signal.aborted) setEntries(archiveDirectory(data)); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not inspect archive."); }).finally(() => { clearTimeout(timer); if (active && controller.signal.aborted) setError("Preview timed out."); });
        return () => { active = false; controller.abort(); clearTimeout(timer); };
    }, [attachment]);
    const matches = entries?.filter(e => e.name.toLowerCase().includes(query.toLowerCase())) ?? [];
    return <div style={column}><Text size="sm">Directory inspection only. Files are not extracted or executed. Office document contents are not rendered.</Text><input style={field} aria-label="Search archive" value={query} placeholder="Filter archive entries" onChange={e => { setQuery(e.target.value); setLimit(100); }}/><div style={list}>{matches.slice(0, limit).map((entry, i) => <div key={i} style={{ ...row, justifyContent: "space-between" }}><Text size="sm" style={{ overflowWrap: "anywhere" }}>{entry.name}</Text><Text size="xs" color="text-muted">{entry.directory ? "Folder" : `${entry.bytes.toLocaleString()} bytes`}</Text></div>)}</div>{matches.length > limit && <Button size="small" variant="secondary" onClick={() => setLimit(n => n + 100)}>Show more</Button>}<Status>{error || (entries ? `${matches.length} of ${entries.length} entries` : "Reading archive directory…")}</Status></div>;
}
function open(message: Message) {
    showPanel("File explorer", ({ userId, close }) => {
        const [query, setQuery] = useState("");
        const [filter, setFilter] = useState("All files");
        const [status, setStatus] = useState("");
        const files = message.attachments.filter(a => attachmentUrl(a.url));
        const label = (a: Attachment) => a.spoiler || a.filename.startsWith("SPOILER_") ? "Spoiler attachment" : a.filename;
        const pdfNative = VencordNative?.pluginHelpers?.PDFPreview as PluginNative<typeof import("../PDFPreview.desktop/native")> | undefined;
        async function preview(a: Attachment) {
            if (!owns(userId) || !accessible(ChannelStore.getChannel(message.channel_id))) return;
            if (canPreview(a)) { close(); openPreview(a); }
            else if (canPlay(a)) { close(); openMedia(a); }
            else if (isArchive(a.filename)) { close(); showPanel("Archive directory", () => <ArchivePanel attachment={a}/>, "lg"); }
            else if (kind(a) === "Image" && a.width && a.height) { close(); openMediaModal({ items: [{ url: a.url, type: "IMAGE", width: a.width, height: a.height }] }); }
            else if (kind(a) === "PDF" && pdfNative) {
                try { const result = await pdfNative.previewPdf(a.url); setStatus(result.ok ? "PDF viewer opened." : result.error ?? "Unable to open PDF."); } catch { setStatus("Unable to open PDF."); }
            } else setStatus("No integrated viewer for this format. Use Discord's normal attachment controls.");
        }
        const types = ["All files", ...new Set(files.map(kind))];
        return <div style={column}>
            <div style={row}><input aria-label="Find attachment" placeholder="Search filenames" value={query} onChange={e => setQuery(e.target.value)} style={{ ...field, flex: 1 }}/><select aria-label="File type" value={filter} onChange={e => setFilter(e.target.value)} style={field}>{types.map(t => <option key={t}>{t}</option>)}</select></div>
            <div style={list}>{files.filter(a => (filter === "All files" || filter === kind(a)) && label(a).toLowerCase().includes(query.toLowerCase())).map(a => <div key={a.id} style={{ ...row, justifyContent: "space-between" }}><div style={{ minWidth: 0, overflowWrap: "anywhere" }}><Text size="sm" weight="semibold">{label(a)}</Text><Text size="xs" color="text-muted">{kind(a)} · {(a.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB</Text></div><Button size="small" disabled={kind(a) === "Other file" || kind(a) === "PDF" && !pdfNative} onClick={() => void preview(a)}>Preview</Button></div>)}</div>
            <Status>{status || "Archive packages show their directories. For extracting ZIP entries, use the existing ZipPreview plugin."}</Status>
        </div>;
    });
}
export default definePlugin({ name: "FileExplorer", description: "Browse and filter attachments on a message and open the existing text, media, image or desktop PDF viewers.", authors: [Devs.Zot], tags: ["Media", "Utility"], dependencies: ["TextFilePreview", "MediaPlayerPlus"], contextMenus: { message: messageAction("file-explorer", "Explore attachments", open, m => !!m.attachments?.length) } });
