/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { accessible, column, launchButton, list, messageAction, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, useEffect, useState } from "@webpack/common";

import { attachmentUrl } from "../TextFilePreview/text";

const Native = VencordNative.pluginHelpers.DownloadManager as PluginNative<typeof import("./native")>;
type Job = Awaited<ReturnType<typeof Native.listDownloads>>[number];
function show(message?: Message) {
    showPanel("Download manager", ({ userId }) => {
        const [jobs, setJobs] = useState<Job[]>([]);
        const [status, setStatus] = useState("");
        const [busy, setBusy] = useState(false);
        useEffect(() => { let active = true; const refresh = () => Native.listDownloads(userId).then(data => { if (active && owns(userId)) setJobs(data); }).catch(() => { if (active) setStatus("Could not load downloads."); }); void refresh(); const timer = setInterval(refresh, 750); return () => { active = false; clearInterval(timer); }; }, [userId]);
        const files = message && accessible(ChannelStore.getChannel(message.channel_id)) ? message.attachments.filter(a => attachmentUrl(a.url)) : [];
        async function download(file: Message["attachments"][number]) { if (!owns(userId) || !message || !accessible(ChannelStore.getChannel(message.channel_id)) || busy) return; setBusy(true); try { await Native.startDownload(file.url, file.filename, file.size, userId); setStatus("Choose a save location. Existing files will not be overwritten."); } catch (e) { setStatus(e instanceof Error ? e.message : "Could not start download."); } finally { setBusy(false); } }
        return <div style={column}><Text size="sm">Save attachments to a chosen new file, with progress and cancellation. Downloads are limited to one active file and 1 GiB per file.</Text>{files.map(a => <div key={a.id} style={{ ...row, justifyContent: "space-between" }}><Text size="sm">{a.spoiler ? "Spoiler attachment" : a.filename}</Text><Button size="small" disabled={busy || jobs.some(j => ["choosing", "downloading"].includes(j.status))} onClick={() => void download(a)}>Save / retry</Button></div>)}<div style={list}>{jobs.map(j => <div key={j.id} style={column}><Text size="sm" weight="semibold">{j.name}</Text><Text size="xs" color="text-muted">{j.status} · {Math.round(j.received / 1024)} / {Math.round(j.total / 1024)} KiB</Text>{j.status === "downloading" && <progress value={j.received} max={j.total || 1}/>}<Status>{j.error}</Status>{["choosing", "downloading"].includes(j.status) && <Button size="small" variant="secondary" onClick={() => void Native.cancelDownload(j.id, userId).catch(() => setStatus("Could not cancel."))}>Cancel</Button>}</div>)}</div><Status>{status || (!message ? "Right-click a message with attachments to start a download." : "Choose a file to save.")}</Status></div>;
    });
}
function open() { show(); }
export default definePlugin({ name: "DownloadManager", description: "Save selected Discord attachments with a native save dialog, progress, and cancellation.", authors: [Devs.Zot], tags: ["Media", "Utility"], contextMenus: { message: messageAction("download-manager", "Manage attachment downloads", show, m => !!m.attachments?.length) }, toolboxActions: { "Download manager": open }, settingsAboutComponent: launchButton("Open download manager", open), flux: { LOGOUT() { void Native.cancelAllDownloads().catch(() => {}); } }, stop() { void Native.cancelAllDownloads().catch(() => {}); } });
