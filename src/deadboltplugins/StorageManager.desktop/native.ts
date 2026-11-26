/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, dialog, IpcMainInvokeEvent } from "electron";
import { lstat, readdir } from "fs/promises";
import { join } from "path";

const cacheNames = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache"];
export async function inspectCache(event: IpcMainInvokeEvent) {
    const root = app.getPath("userData");
    let remaining = 50_000;
    async function size(path: string): Promise<number> {
        if (--remaining < 0) return 0;
        try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink()) return 0;
            if (!stat.isDirectory()) return stat.isFile() ? stat.size : 0;
            let total = 0;
            for (const name of await readdir(path)) { if (remaining <= 0) break; total += await size(join(path, name)); }
            return total;
        } catch { return 0; }
    }
    const rows: { name: string; bytes: number; }[] = [];
    for (const name of cacheNames) rows.push({ name, bytes: await size(join(root, name)) });
    return { rows, httpBytes: await event.sender.session.getCacheSize(), partial: remaining <= 0 };
}
export async function clearHttpCache(event: IpcMainInvokeEvent) {
    const choice = await dialog.showMessageBox({ title: "Clear HTTP cache", message: "Clear Discord's temporary HTTP cache?", detail: "This does not remove settings, cookies, saved messages, themes, plugins, or account data. Media may need to download again.", type: "question", buttons: ["Cancel", "Clear cache"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return false;
    await event.sender.session.clearCache();
    return true;
}
