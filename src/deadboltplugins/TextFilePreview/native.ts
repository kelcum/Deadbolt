/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dialog, IpcMainInvokeEvent } from "electron";

import { attachmentUrl, readResponse } from "./text";

export async function fetchTextAttachment(_: IpcMainInvokeEvent, value: string): Promise<{ data?: ArrayBuffer; error?: string; }> {
    const url = attachmentUrl(value);
    if (!url) return { error: "Invalid Discord attachment URL." };
    try {
        const { response } = await dialog.showMessageBox({
            title: "Preview attachment",
            message: "Allow Deadbolt to fetch this Discord attachment?",
            detail: decodeURIComponent(url.pathname.split("/").at(-1) ?? "Attachment"),
            type: "question",
            buttons: ["Cancel", "Preview"],
            defaultId: 0,
            cancelId: 0
        });
        if (response !== 1) return { error: "Preview cancelled." };
        return { data: await readResponse(await fetch(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(60_000) })) };
    } catch {
        return { error: "Could not fetch the attachment. It may be expired, too large, or unavailable." };
    }
}
