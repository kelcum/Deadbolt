/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * Ask the OS for VS Code's own window title. VS Code keeps this up to
 * date with the current file / folder / unsaved-changes state itself, so
 * this reads nothing more than what's already visible in your taskbar/
 * title bar - no file contents, no workspace paths beyond the folder
 * name VS Code already puts in its own title. Windows and macOS only -
 * Linux window-title access varies too much by window manager/compositor
 * to do reliably the same way, so it just returns null there (spoof mode
 * still works everywhere regardless).
 */
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
    // Reads VS Code's front window title via System Events. Like any
    // AppleScript that inspects another app's UI, macOS will prompt for
    // Accessibility permission the first time this runs - it has to be
    // granted once for this to work at all.
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
