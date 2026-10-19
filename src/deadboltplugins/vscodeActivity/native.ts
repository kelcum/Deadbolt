/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export async function getVSCodeWindowTitle(): Promise<string | null> {
    if (process.platform === "win32") return getWindowsTitle();
    if (process.platform === "darwin") return getMacTitle();
    return null;
}

async function getWindowsTitle(): Promise<string | null> {
    try {
        const { stdout } = await exec("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Process -Name Code -ErrorAction SilentlyContinue | " +
            "Where-Object { $_.MainWindowTitle } | " +
            "Select-Object -First 1 -ExpandProperty MainWindowTitle"
        ], { timeout: 5000, windowsHide: true });

        const title = stdout.trim();
        return title || null;
    } catch {
        return null;
    }
}

async function getMacTitle(): Promise<string | null> {
    const script =
        'tell application "System Events"\n' +
        'if not (exists process "Code") then return ""\n' +
        'tell process "Code"\n' +
        "if (count of windows) = 0 then return \"\"\n" +
        "return name of front window\n" +
        "end tell\n" +
        "end tell";

    try {
        const { stdout } = await exec("osascript", ["-e", script], { timeout: 5000 });
        const title = stdout.trim();
        return title || null;
    } catch {
        return null;
    }
}
