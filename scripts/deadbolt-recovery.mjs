/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkpointStatus, createCheckpoint, restoreCheckpoint } from "../src/main/updater/checkpoint.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "desktop");
const [action, ...args] = process.argv.slice(2);

try {
    switch (action) {
        case "checkpoint":
            console.log("Saved current desktop build:", createCheckpoint(dist));
            break;
        case "status":
            console.log("Previous desktop build:", checkpointStatus(dist));
            break;
        case "rollback":
            if (!args.includes("--confirm")) throw new Error("Quit Discord. Add --confirm to restore the previous build. Git and settings will not change.");
            console.log("Restored previous desktop build:", restoreCheckpoint(dist));
            break;
        case "safe-mode": {
            const [mode, settingsDir] = args;
            if ((mode !== "on" && mode !== "off") || !settingsDir || !existsSync(join(settingsDir, "settings.json"))) throw new Error("Quit Discord. Provide on/off and the exact active Deadbolt settings directory containing settings.json.");
            if (!args.includes("--confirm")) throw new Error("Add --confirm after checking the settings directory and quitting Discord.");
            const file = join(settingsDir, "safe-mode.json");
            const temp = `${file}.manual-${process.pid}`;
            let state = {};
            try { state = JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { }
            try {
                writeFileSync(temp, JSON.stringify({ ...state, active: mode === "on", failedBoots: 0, suspect: null, blamed: [], lastGood: Array.isArray(state.lastGood) ? state.lastGood : [] }), { flush: true, mode: 0o600 });
                renameSync(temp, file);
            } finally { rmSync(temp, { force: true }); }
            console.log(`Safe mode ${mode}. Restart Discord.`);
            break;
        }
        default:
            throw new Error("Use checkpoint, status, rollback --confirm, or safe-mode on/off <settings-directory> --confirm. Quit Discord before any write.");
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
