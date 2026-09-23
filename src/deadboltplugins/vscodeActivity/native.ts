/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/**
 * Windows-only: ask the OS for VS Code's own window title. VS Code keeps
 * this up to date with the current file / folder / unsaved-changes state
 * itself, so this reads nothing more than what's already visible in your
 * taskbar/title bar - no file contents, no workspace paths beyond the
 * folder name VS Code already puts in its own title.
 */
export async function getVSCodeWindowTitle(): Promise<string | null> {
    if (process.platform !== "win32") return null;

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
