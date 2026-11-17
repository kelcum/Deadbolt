/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "original-fs";
import { join } from "path";

export const CORE_BACKUP_NAME = "index.deadbolt-original.js";

export interface CoreModule {
    dir: string;
    index: string;
    backup: string;
}

function hostVersion(name: string) {
    const match = /^(?:app-)?(\d+)\.(\d+)\.(\d+)$/.exec(name);
    return match ? match.slice(1).map(Number) : null;
}

function moduleNumber(name: string) {
    if (name === "discord_desktop_core") return 0;
    const match = /^discord_desktop_core-(\d+)$/.exec(name);
    return match ? Number(match[1]) : null;
}

function subdirs(path: string) {
    try {
        return readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return [];
    }
}

function coreIn(moduleDir: string): CoreModule | null {
    for (const dir of [join(moduleDir, "discord_desktop_core"), moduleDir]) {
        const index = join(dir, "index.js");
        const backup = join(dir, CORE_BACKUP_NAME);
        if (existsSync(index) || existsSync(backup)) return { dir, index, backup };
    }
    return null;
}

function compare(a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

export function findNewestCore(dataDir: string): CoreModule | null {
    let best: { key: number[]; core: CoreModule; } | null = null;

    for (const name of subdirs(dataDir)) {
        const version = hostVersion(name);
        if (!version) continue;

        const modulesDir = join(dataDir, name, "modules");
        for (const moduleName of subdirs(modulesDir)) {
            const number = moduleNumber(moduleName);
            if (number === null) continue;

            const core = coreIn(join(modulesDir, moduleName));
            const key = [...version, number];
            if (core && (!best || compare(key, best.key) > 0)) best = { key, core };
        }
    }

    return best?.core ?? null;
}

export function coreWrapper(patcherPath: string, backupPath: string) {
    return `"use strict";

process.env.DEADBOLT_CORE_INJECT = "1";

try {
    require(${JSON.stringify(patcherPath)});
} catch (err) {
    console.error("[Deadbolt] Core injection failed:", err);
}

module.exports = require(${JSON.stringify(backupPath)});
`;
}

export function ensureCoreWrapped(dataDir: string, patcherPath: string) {
    const core = findNewestCore(dataDir);
    if (!core) return null;

    const current = existsSync(core.index) ? readFileSync(core.index, "utf8") : null;
    const wrapper = coreWrapper(patcherPath, core.backup);
    if (current === wrapper) return null;

    if (current !== null && !current.includes("DEADBOLT_CORE_INJECT")) copyFileSync(core.index, core.backup);
    if (!existsSync(core.backup)) return null;

    const temp = `${core.index}.deadbolt-new`;
    writeFileSync(temp, wrapper);
    renameSync(temp, core.index);
    return core;
}

function rewrapNewestCore() {
    try {
        const core = ensureCoreWrapped(app.getPath("userData"), join(__dirname, "patcher.js"));
        if (core) console.log("[Deadbolt] Re-applied core injection to", core.dir);
    } catch (err) {
        console.error("[Deadbolt] Failed to re-apply core injection", err);
    }
}

app.on("before-quit", rewrapNewestCore);
