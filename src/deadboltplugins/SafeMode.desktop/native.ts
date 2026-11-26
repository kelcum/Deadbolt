/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SETTINGS_DIR } from "@main/utils/constants";
import { dialog, IpcMainInvokeEvent } from "electron";
import { readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

export async function enter(_: IpcMainInvokeEvent): Promise<boolean> {
    const { response } = await dialog.showMessageBox({ type: "question", title: "Enter Deadbolt safe mode", message: "Restart Discord with only its core recovery plugins?", detail: "Enabled plugin settings are preserved. You can select a suspected plugin to disable before restarting normally.", buttons: ["Cancel", "Enter safe mode"], defaultId: 0, cancelId: 0 });
    if (response !== 1) return false;
    const file = join(SETTINGS_DIR, "safe-mode.json");
    const temp = `${file}.manual-${process.pid}`;
    let state: { lastGood?: unknown; } = {};
    try { state = JSON.parse(readFileSync(file, "utf8")); } catch { }
    try { writeFileSync(temp, JSON.stringify({ ...state, failedBoots: 0, active: true, suspect: null, blamed: [], lastGood: Array.isArray(state.lastGood) ? state.lastGood.filter(n => typeof n === "string").slice(0, 2000) : [] }), { flush: true, mode: 0o600 }); renameSync(temp, file); return true; }
    finally { rmSync(temp, { force: true }); }
}
