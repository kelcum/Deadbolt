/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcEvents } from "@shared/IpcEvents";
import { ipcMain } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { RendererSettings } from "./settings";
import { SETTINGS_DIR } from "./utils/constants";

const STATE_FILE = join(SETTINGS_DIR, "safe-mode.json");

interface State {
    failedBoots: number;
    active: boolean;
    suspect: string | null;
    blamed: string[];
    lastGood: string[];
}

function read(): State {
    const fresh: State = { failedBoots: 0, active: false, suspect: null, blamed: [], lastGood: [] };
    try {
        return { ...fresh, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
    } catch {
        return fresh;
    }
}

function write(state: State) {
    try {
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 4));
    } catch (e) {
        console.error("Failed to write safe mode state", e);
    }
}

function enabledPlugins() {
    return Object.entries(RendererSettings.plain.plugins ?? {}).filter(([, p]) => p?.enabled).map(([name]) => name);
}

function mostBlamed(names: string[]) {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

ipcMain.on(IpcEvents.SAFE_MODE_BOOT, e => {
    const state = read();
    if (!state.active && state.failedBoots >= 2) {
        const newlyEnabled = state.lastGood.length ? enabledPlugins().filter(p => !state.lastGood.includes(p)) : [];
        state.active = true;
        state.suspect = mostBlamed(state.blamed) ?? newlyEnabled.at(-1) ?? null;
    }
    state.failedBoots++;
    write(state);
    e.returnValue = { active: state.active, suspect: state.suspect };
});

ipcMain.handle(IpcEvents.SAFE_MODE_NOTE, (_, plugin: unknown) => {
    if (typeof plugin !== "string" || plugin.length > 100) return;
    const state = read();
    state.blamed = [...state.blamed, plugin].slice(-50);
    write(state);
});

ipcMain.handle(IpcEvents.SAFE_MODE_READY, () => {
    const state = read();
    state.failedBoots = 0;
    state.blamed = [];
    if (!state.active) state.lastGood = enabledPlugins();
    write(state);
});

ipcMain.handle(IpcEvents.SAFE_MODE_EXIT, () => {
    const state = read();
    state.active = false;
    state.suspect = null;
    state.failedBoots = 0;
    write(state);
});
