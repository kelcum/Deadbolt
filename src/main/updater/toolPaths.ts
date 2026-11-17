/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

export function deadboltToolsBin() {
    const base = process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");

    return join(base, "DeadboltInstall", "tools", "bin");
}

export function addToolPaths() {
    if (process.platform !== "darwin" && process.platform !== "linux") return;

    const extra = [deadboltToolsBin()];
    if (process.platform === "darwin") extra.push("/opt/homebrew/bin", "/usr/local/bin");

    const current = (process.env.PATH ?? "").split(delimiter);
    const missing = extra.filter(dir => !current.includes(dir) && existsSync(dir));
    if (missing.length) process.env.PATH = [...missing, ...current].filter(Boolean).join(delimiter);
}
