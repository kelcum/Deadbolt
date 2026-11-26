/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { checkpointStatus, createCheckpoint, isUpdateInProgress, restoreCheckpoint } from "@main/updater/checkpoint";
import { dialog, IpcMainInvokeEvent } from "electron";

export async function status(_: IpcMainInvokeEvent) {
    if (IS_STANDALONE || !IS_DISCORD_DESKTOP) return { supported: false, backup: null };
    try { return { supported: true, backup: checkpointStatus(__dirname) }; }
    catch { return { supported: true, backup: null }; }
}
export async function checkpoint(_: IpcMainInvokeEvent) {
    if (IS_STANDALONE || !IS_DISCORD_DESKTOP || isUpdateInProgress()) return { ok: false, message: "Unavailable while updating or on a standalone build." };
    const { response } = await dialog.showMessageBox({ type: "question", title: "Save build checkpoint", message: "Replace the previous build checkpoint with the current desktop build?", detail: "Only the build files are saved. Settings and message data are unchanged.", buttons: ["Cancel", "Save checkpoint"], defaultId: 0, cancelId: 0 });
    if (response !== 1 || isUpdateInProgress()) return { ok: false, message: "Cancelled or update running." };
    try { createCheckpoint(__dirname); return { ok: true, message: "Checkpoint saved." }; }
    catch { return { ok: false, message: "Could not save checkpoint. Check free disk space." }; }
}
export async function rollback(_: IpcMainInvokeEvent) {
    if (IS_STANDALONE || !IS_DISCORD_DESKTOP || isUpdateInProgress()) return { ok: false, message: "Unavailable while updating or on a standalone build." };
    const { response } = await dialog.showMessageBox({ type: "warning", title: "Restore previous Deadbolt build", message: "Restore the previous desktop build files?", detail: "Restart Discord afterward. Git history, plugin settings, and saved data are not rolled back. A later automatic update or rebuild can replace this build.", buttons: ["Cancel", "Restore build"], defaultId: 0, cancelId: 0 });
    if (response !== 1 || isUpdateInProgress()) return { ok: false, message: "Cancelled or update running." };
    try { restoreCheckpoint(__dirname); return { ok: true, message: "Previous build restored. Restart Discord." }; }
    catch { return { ok: false, message: "Could not restore the build. The checkpoint was preserved. Use the recovery script or reinstall from the official source." }; }
}
