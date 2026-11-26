/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { safeFilename } from "@utils/zotExpansion";
import { dialog, IpcMainInvokeEvent } from "electron";
import { basename } from "path";

import { attachmentUrl } from "../TextFilePreview/text";
import { DOWNLOAD_LIMIT, saveResponse } from "./download";

interface Job { id: string; name: string; received: number; total: number; status: "choosing" | "downloading" | "done" | "cancelled" | "failed"; error?: string; }

const jobs = new Map<string, { owner: number; account: string; data: Job; controller: AbortController; }>();
export async function startDownload(event: IpcMainInvokeEvent, rawUrl: string, name: string, total: number, account: string) {
    const url = attachmentUrl(rawUrl);
    if (!url || !Number.isSafeInteger(total) || total < 0 || total > DOWNLOAD_LIMIT || typeof name !== "string" || !/^\d{17,20}$/.test(account)) throw new Error("Unsupported attachment or file larger than 1 GiB.");
    if ([...jobs.values()].some(j => j.owner === event.sender.id && ["choosing", "downloading"].includes(j.data.status))) throw new Error("Finish or cancel the active download first.");
    for (const [id, entry] of jobs) if (jobs.size >= 30 && !["choosing", "downloading"].includes(entry.data.status)) jobs.delete(id);
    if (jobs.size >= 30) throw new Error("Download manager is busy.");
    const { href } = url;
    const id = crypto.randomUUID(); const data: Job = { id, name: safeFilename(name), received: 0, total, status: "choosing" };
    const controller = new AbortController(); const { sender } = event;
    jobs.set(id, { owner: sender.id, account, data, controller });
    const destroy = () => controller.abort(); sender.once("destroyed", destroy);
    async function run() {
        const timer = setTimeout(() => controller.abort(), 10 * 60_000);
        try {
            const choice = await dialog.showSaveDialog({ title: "Save attachment to a new file", defaultPath: data.name });
            if (choice.canceled || !choice.filePath || controller.signal.aborted) { data.status = "cancelled"; return; }
            const path = choice.filePath;
            data.name = basename(path); data.status = "downloading";
            const response = await fetch(href, { signal: controller.signal, redirect: "error", credentials: "omit" });
            await saveResponse(response, path, total, controller.signal, n => { data.received = n; });
            data.status = "done";
        } catch (error) {
            data.status = controller.signal.aborted ? "cancelled" : "failed";
            data.error = error instanceof Error && "code" in error && error.code === "EEXIST" ? "Choose a new filename. Existing files are never overwritten." : controller.signal.aborted ? "Download cancelled or timed out." : "Could not save the complete attachment. Retry or use Discord's normal download.";
        } finally { clearTimeout(timer); sender.removeListener("destroyed", destroy); }
    }
    void run(); return id;
}
export function listDownloads(event: IpcMainInvokeEvent, account: string) { return [...jobs.values()].filter(j => j.owner === event.sender.id && j.account === account).map(j => ({ ...j.data })); }
export function cancelDownload(event: IpcMainInvokeEvent, id: string, account: string) { const job = jobs.get(id); if (job?.owner === event.sender.id && job.account === account && ["choosing", "downloading"].includes(job.data.status)) job.controller.abort(); }

export function cancelAllDownloads(event: IpcMainInvokeEvent) { for (const job of jobs.values()) if (job.owner === event.sender.id && ["choosing", "downloading"].includes(job.data.status)) job.controller.abort(); }
