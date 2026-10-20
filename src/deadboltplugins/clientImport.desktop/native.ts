/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SETTINGS_DIR, THEMES_DIR } from "@main/utils/constants";
import { app, IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve } from "path";

export interface ImportSource {
    id: string;
    name: string;
    dir: string;
    themesOnly: boolean;
    enabledPlugins: number;
    themeFiles: number;
    themeLinks: number;
    quickCss: boolean;
    lastUsed: number;
}

interface Candidate {
    id: string;
    name: string;
    dir: string;
    themesOnly?: boolean;
}

const MAX_SETTINGS_BYTES = 10_000_000;

function candidates(): Candidate[] {
    const appData = app.getPath("appData");
    const home = app.getPath("home");
    return [
        { id: "equicord", name: "Equicord", dir: join(appData, "Equicord") },
        { id: "vencord", name: "Vencord", dir: join(appData, "Vencord") },
        { id: "equibop", name: "Equibop", dir: join(appData, "equibop") },
        { id: "vesktop", name: "Vesktop", dir: join(appData, "vesktop") },
        { id: "vencorddesktop", name: "Vesktop (old Vencord Desktop)", dir: join(appData, "VencordDesktop") },
        { id: "equibop-flatpak", name: "Equibop (Flatpak)", dir: join(home, ".var", "app", "io.github.equicord.equibop", "config", "equibop") },
        { id: "vesktop-flatpak", name: "Vesktop (Flatpak)", dir: join(home, ".var", "app", "dev.vencord.Vesktop", "config", "vesktop") },
        { id: "betterdiscord", name: "BetterDiscord", dir: join(appData, "BetterDiscord"), themesOnly: true },
    ].filter(c => resolve(c.dir) !== resolve(SETTINGS_DIR, ".."));
}

async function readJson(path: string) {
    try {
        if ((await stat(path)).size > MAX_SETTINGS_BYTES) return null;
        return JSON.parse(await readFile(path, "utf-8"));
    } catch {
        return null;
    }
}

async function readText(path: string) {
    try {
        return await readFile(path, "utf-8");
    } catch {
        return "";
    }
}

async function themeFiles(dir: string) {
    try {
        return (await readdir(join(dir, "themes"), { withFileTypes: true }))
            .filter(f => f.isFile() && f.name.toLowerCase().endsWith(".css"))
            .map(f => f.name);
    } catch {
        return [];
    }
}

async function lastModified(...paths: string[]) {
    let latest = 0;
    for (const p of paths) {
        const info = await stat(p).catch(() => null);
        if (info) latest = Math.max(latest, info.mtimeMs);
    }
    return latest;
}

export async function findSources(_: IpcMainInvokeEvent): Promise<ImportSource[]> {
    const found: ImportSource[] = [];
    for (const c of candidates()) {
        if (!existsSync(c.dir)) continue;
        const settingsPath = join(c.dir, "settings", "settings.json");
        const quickCssPath = join(c.dir, "settings", "quickCss.css");
        const settings = c.themesOnly ? null : await readJson(settingsPath);
        const quickCss = c.themesOnly ? "" : (await readText(quickCssPath)).trim();
        const themes = await themeFiles(c.dir);
        const enabledPlugins = settings?.plugins && typeof settings.plugins === "object"
            ? Object.values(settings.plugins).filter((p: any) => p?.enabled).length
            : 0;
        const themeLinks = Array.isArray(settings?.themeLinks) ? settings.themeLinks.length : 0;
        if (!enabledPlugins && !themes.length && !themeLinks && !quickCss) continue;
        found.push({
            id: c.id,
            name: c.name,
            dir: c.dir,
            themesOnly: !!c.themesOnly,
            enabledPlugins,
            themeFiles: themes.length,
            themeLinks,
            quickCss: !!quickCss,
            lastUsed: await lastModified(settingsPath, quickCssPath, join(c.dir, "themes")),
        });
    }
    return found.sort((a, b) => b.lastUsed - a.lastUsed);
}

function sourceDir(id: string) {
    const c = candidates().find(x => x.id === id);
    if (!c) throw new Error("Unknown import source.");
    return c;
}

export async function readSource(_: IpcMainInvokeEvent, id: string) {
    const c = sourceDir(id);
    if (c.themesOnly) return { settings: null, quickCss: "" };
    return {
        settings: await readJson(join(c.dir, "settings", "settings.json")),
        quickCss: await readText(join(c.dir, "settings", "quickCss.css")),
    };
}

export async function copyThemes(_: IpcMainInvokeEvent, id: string) {
    const c = sourceDir(id);
    await mkdir(THEMES_DIR, { recursive: true });
    const copied: string[] = [];
    const skipped: string[] = [];
    for (const name of await themeFiles(c.dir)) {
        const target = join(THEMES_DIR, name);
        if (existsSync(target)) {
            skipped.push(name);
            continue;
        }
        await copyFile(join(c.dir, "themes", name), target);
        copied.push(name);
    }
    return { copied, skipped };
}

export async function backupQuickCss(_: IpcMainInvokeEvent, css: string) {
    if (typeof css !== "string" || !css.trim()) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(SETTINGS_DIR, `quickCss.before-import-${stamp}.css`);
    await mkdir(SETTINGS_DIR, { recursive: true });
    await writeFile(path, css, "utf-8");
    return path;
}
