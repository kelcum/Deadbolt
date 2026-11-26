/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, dialog, IpcMainInvokeEvent, session } from "electron";

import { attachmentUrl, readResponse } from "../TextFilePreview/text";

const localUrl = "https://deadbolt-pdf.invalid/document.pdf";
let preview: BrowserWindow | undefined;
let busy = false;

export async function previewPdf(_: IpcMainInvokeEvent, value: string): Promise<{ ok: boolean; error?: string; }> {
    if (busy || preview) return { ok: false, error: "Close the existing PDF viewer first." };
    const url = attachmentUrl(value);
    if (!url || !/\.pdf$/i.test(decodeURIComponent(url.pathname))) return { ok: false, error: "Invalid PDF attachment." };
    busy = true;
    let registered = false;
    const isolated = session.fromPartition("deadbolt-pdf-preview", { cache: false });
    const cleanup = () => {
        if (registered) {
            isolated.protocol.unhandle("https");
            registered = false;
        }
        preview = undefined;
    };
    try {
        const { response } = await dialog.showMessageBox({ type: "question", title: "PDF preview", message: "Open this PDF in an isolated preview window?", detail: decodeURIComponent(url.pathname.split("/").at(-1) ?? "PDF"), buttons: ["Cancel", "Open PDF"], defaultId: 0, cancelId: 0 });
        if (response !== 1) return { ok: false, error: "Cancelled." };
        const data = await readResponse(await fetch(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(60_000) }));
        if (new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") throw new Error("Not a PDF file.");
        isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        isolated.setPermissionCheckHandler(() => false);
        isolated.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => callback({ cancel: details.url !== localUrl }));
        isolated.protocol.handle("https", request => request.url === localUrl ? new Response(data, { headers: { "Content-Type": "application/pdf", "Content-Length": String(data.byteLength), "Cache-Control": "no-store", "Content-Disposition": "inline" } }) : new Response(null, { status: 403 }));
        registered = true;
        const window = new BrowserWindow({ title: "Deadbolt PDF Preview", width: 1000, height: 800, show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, plugins: true } });
        preview = window;
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event, target) => { if (target !== localUrl) event.preventDefault(); });
        window.webContents.on("will-redirect", event => event.preventDefault());
        window.on("closed", cleanup);
        await window.loadURL(localUrl);
        if (!window.isDestroyed()) window.show();
        return { ok: true };
    } catch {
        if (preview && !preview.isDestroyed()) preview.destroy();
        cleanup();
        return { ok: false, error: "Could not display this PDF. It may be expired, unsupported, or over 64 MiB." };
    } finally {
        busy = false;
    }
}
