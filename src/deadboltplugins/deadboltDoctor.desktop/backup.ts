/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings, RendererSettings } from "@main/settings";
import { DATA_DIR, NATIVE_SETTINGS_FILE, QUICK_CSS_PATH, SETTINGS_FILE, THEMES_DIR } from "@main/utils/constants";
import { exec } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "fs/promises";
import { dirname, join, normalize, relative, sep } from "path";

const repoRoot = join(__dirname, "..", "..");
const userPluginsDir = join(repoRoot, "src", "userplugins");
const MAX_BYTES = 200 * 1024 * 1024;
const MANIFEST = "deadbolt-backup.json";
const SETTINGS = "settings/settings.json";
const NATIVE_SETTINGS = "settings/native-settings.json";
const QUICK_CSS = "settings/quickCss.css";
const PLUGINS = "userplugins/";
const THEMES = "themes/";
const BACKUPS_DIR = join(DATA_DIR, "backups");
const AUTO = /^auto-[\w-]+\.zip$/;
const SAVED = /^(auto|before-restore)-[\w-]+\.zip$/;

export interface FileDiff {
    overwritten: string[];
    added: string[];
    unchanged: number;
}

export interface SavedBackup {
    name: string;
    path: string;
    auto: boolean;
    created: string;
    size: number;
}

export interface BackupPreview {
    created: string | null;
    settings: { changed: boolean; enabledNow: number; enabledAfter: number; } | null;
    quickCss: { changed: boolean; linesNow: number; linesAfter: number; } | null;
    userplugins: FileDiff | null;
    themes: FileDiff | null;
    userpluginsSkipped: boolean;
}

export type RestoreResult = { error: string; } | { buildError: string; } | { safetyCopy: string; };

const hasSource = () => existsSync(join(repoRoot, "src"));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

async function listFiles(dir: string, base = dir): Promise<string[]> {
    const out: string[] = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const full = join(dir, item.name);
        if (item.isDirectory()) out.push(...await listFiles(full, base));
        else if (item.isFile()) out.push(relative(base, full).split(sep).join("/"));
    }
    return out;
}

async function currentFiles() {
    const files: Record<string, Uint8Array> = {
        [MANIFEST]: strToU8(JSON.stringify({ version: 1, created: new Date().toISOString() }))
    };
    for (const [name, path] of [[SETTINGS, SETTINGS_FILE], [NATIVE_SETTINGS, NATIVE_SETTINGS_FILE], [QUICK_CSS, QUICK_CSS_PATH]]) {
        const data = await readFile(path).catch(() => null);
        if (data) files[name] = data;
    }
    if (hasSource() && existsSync(userPluginsDir)) {
        for (const rel of await listFiles(userPluginsDir)) {
            files[PLUGINS + rel] = await readFile(join(userPluginsDir, ...rel.split("/")));
        }
    }
    if (existsSync(THEMES_DIR)) {
        for (const rel of await listFiles(THEMES_DIR)) {
            files[THEMES + rel] = await readFile(join(THEMES_DIR, ...rel.split("/")));
        }
    }
    return files;
}

function safeTarget(name: string, prefix: string, root: string) {
    const rel = name.slice(prefix.length);
    if (!rel || rel.endsWith("/") || rel.includes("\\") || rel.split("/").some(p => !p || p === "." || p === "..")) return null;
    const full = normalize(join(root, ...rel.split("/")));
    return full.startsWith(root + sep) ? full : null;
}

const pluginTarget = (name: string) => safeTarget(name, PLUGINS, userPluginsDir);
const themeTarget = (name: string) => safeTarget(name, THEMES, THEMES_DIR);

function parseSettings(data: Uint8Array | undefined) {
    if (!data) return null;
    const text = strFromU8(data);
    if (/"(__proto__|constructor|prototype)"\s*:/.test(text)) throw new Error("unsafe keys");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
}

function readBackup(data: unknown) {
    if (!(data instanceof Uint8Array) || data.length > MAX_BYTES) throw new Error("That file is too big or isn't a zip.");
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(data);
    } catch {
        throw new Error("That file isn't a zip Deadbolt can read.");
    }
    if (!files[MANIFEST]) throw new Error("That zip isn't a Deadbolt backup.");
    let settings: object | null;
    let nativeSettings: object | null;
    try {
        settings = parseSettings(files[SETTINGS]);
        nativeSettings = parseSettings(files[NATIVE_SETTINGS]);
    } catch {
        throw new Error("The settings in that backup are damaged, so nothing was restored.");
    }
    const plugins = Object.keys(files).filter(n => n.startsWith(PLUGINS) && !n.endsWith("/"));
    if (plugins.some(n => !pluginTarget(n))) throw new Error("That backup has userplugins files with unsafe paths, so nothing was restored.");
    const themes = Object.keys(files).filter(n => n.startsWith(THEMES) && !n.endsWith("/"));
    if (themes.some(n => !themeTarget(n))) throw new Error("That backup has theme files with unsafe paths, so nothing was restored.");
    return { files, settings, nativeSettings, plugins, themes, created: createdAt(files[MANIFEST]) };
}

function createdAt(manifest: Uint8Array) {
    try {
        return String(JSON.parse(strFromU8(manifest)).created ?? "") || null;
    } catch {
        return null;
    }
}

function enabledCount(settings: unknown) {
    const plugins = (settings as { plugins?: Record<string, { enabled?: boolean; }>; })?.plugins ?? {};
    return Object.values(plugins).filter(p => p?.enabled).length;
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
const lines = (s: string) => s ? s.split(/\r?\n/).length : 0;

async function diffFiles(files: Record<string, Uint8Array>, names: string[], prefix: string, target: (name: string) => string | null) {
    const diff: FileDiff = { overwritten: [], added: [], unchanged: 0 };
    for (const name of names) {
        const now = await readFile(target(name) as string).catch(() => null);
        const rel = name.slice(prefix.length);
        if (!now) diff.added.push(rel);
        else if (sameBytes(now, files[name])) diff.unchanged++;
        else diff.overwritten.push(rel);
    }
    return diff;
}

export async function exportBackup(_: IpcMainInvokeEvent): Promise<Uint8Array> {
    return zipSync(await currentFiles(), { level: 6 });
}

export async function inspectBackup(_: IpcMainInvokeEvent, data: Uint8Array): Promise<{ error: string; } | BackupPreview> {
    try {
        const { files, settings, plugins, themes, created } = readBackup(data);
        const cssAfter = files[QUICK_CSS] ? strFromU8(files[QUICK_CSS]) : null;
        const cssNow = await readFile(QUICK_CSS_PATH, "utf8").catch(() => "");
        const source = hasSource();
        return {
            created,
            settings: settings && {
                changed: JSON.stringify(settings) !== JSON.stringify(RendererSettings.plain),
                enabledNow: enabledCount(RendererSettings.plain),
                enabledAfter: enabledCount(settings)
            },
            quickCss: cssAfter === null ? null : { changed: cssAfter !== cssNow, linesNow: lines(cssNow), linesAfter: lines(cssAfter) },
            userplugins: source && plugins.length ? await diffFiles(files, plugins, PLUGINS, pluginTarget) : null,
            themes: themes.length ? await diffFiles(files, themes, THEMES, themeTarget) : null,
            userpluginsSkipped: !source && plugins.length > 0
        };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

function runBuild() {
    return new Promise<string | null>(resolve => exec(
        IS_DEV ? "pnpm build --dev" : "pnpm build",
        { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } },
        (err, stdout, stderr) => {
            if (!err) return resolve(null);
            const clean = `${stdout}\n${stderr}`.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim();
            resolve((clean.length > 1500 ? "...\n" + clean.slice(-1500) : clean) || err.message);
        }
    ));
}

export async function restoreBackup(_: IpcMainInvokeEvent, data: Uint8Array): Promise<RestoreResult> {
    let backup: ReturnType<typeof readBackup>;
    try {
        backup = readBackup(data);
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    const { files, settings, nativeSettings, plugins, themes } = backup;

    const safetyCopy = join(BACKUPS_DIR, `before-restore-${stamp()}.zip`);
    try {
        await mkdir(dirname(safetyCopy), { recursive: true });
        await writeFile(safetyCopy, zipSync(await currentFiles(), { level: 6 }));
    } catch {
        return { error: "Couldn't save a copy of your current setup first, so nothing was restored." };
    }

    try {
        const previous = new Map<string, Uint8Array | null>();
        const createdDirs: string[] = [];
        if (hasSource()) {
            for (const name of plugins) {
                const target = pluginTarget(name) as string;
                const now = await readFile(target).catch(() => null);
                if (sameBytes(now, files[name])) continue;
                previous.set(target, now);
                const dir = await mkdir(dirname(target), { recursive: true });
                if (dir) createdDirs.push(dir);
                await writeFile(target, files[name]);
            }
        }
        if (previous.size) {
            const buildError = await runBuild();
            if (buildError) {
                for (const [target, now] of previous) await (now ? writeFile(target, now) : rm(target, { force: true }));
                for (const dir of createdDirs) await rm(dir, { recursive: true, force: true });
                await runBuild();
                return { buildError };
            }
        }
        for (const name of themes) {
            const target = themeTarget(name) as string;
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, files[name]);
        }
        if (files[QUICK_CSS]) await writeFile(QUICK_CSS_PATH, files[QUICK_CSS]);
        if (nativeSettings) NativeSettings.setData(nativeSettings as typeof NativeSettings.plain);
        if (settings) RendererSettings.setData(settings as typeof RendererSettings.plain);
    } catch (e) {
        return { error: `Restoring stopped partway (${e instanceof Error ? e.message : String(e)}). Your setup from before is saved in ${safetyCopy}` };
    }
    return { safetyCopy };
}

function sameContent(a: Record<string, Uint8Array>, b: Record<string, Uint8Array>) {
    const keys = Object.keys(a).filter(k => k !== MANIFEST);
    return keys.length === Object.keys(b).filter(k => k !== MANIFEST).length && keys.every(k => b[k] && sameBytes(a[k], b[k]));
}

export async function autoBackup(_: IpcMainInvokeEvent, keep: unknown): Promise<boolean> {
    if (typeof keep !== "number" || !Number.isInteger(keep) || keep < 1 || keep > 100) return false;
    await mkdir(BACKUPS_DIR, { recursive: true });
    const autos = (await readdir(BACKUPS_DIR)).filter(n => AUTO.test(n)).sort();
    const last = autos.length ? join(BACKUPS_DIR, autos[autos.length - 1]) : null;
    if (last && Date.now() - (await stat(last)).mtimeMs < 24 * 36e5) return false;
    const files = await currentFiles();
    const previous = last ? await readFile(last).then(d => unzipSync(d)).catch(() => null) : null;
    if (last && previous && sameContent(files, previous)) {
        await utimes(last, new Date(), new Date());
        return false;
    }
    const name = `auto-${stamp()}.zip`;
    await writeFile(join(BACKUPS_DIR, name), zipSync(files, { level: 6 }));
    for (const old of [...autos, name].slice(0, -keep)) await rm(join(BACKUPS_DIR, old), { force: true });
    return true;
}

export async function listBackups(_: IpcMainInvokeEvent): Promise<SavedBackup[]> {
    const names = (await readdir(BACKUPS_DIR).catch(() => [] as string[])).filter(n => SAVED.test(n));
    const list = await Promise.all(names.map(async name => {
        const path = join(BACKUPS_DIR, name);
        const { size, mtime } = await stat(path);
        const m = /(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/.exec(name);
        return { name, path, auto: name.startsWith("auto-"), created: m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : mtime.toISOString(), size };
    }));
    return list.sort((a, b) => b.created.localeCompare(a.created));
}

export async function readSavedBackup(_: IpcMainInvokeEvent, name: unknown): Promise<Uint8Array | null> {
    if (typeof name !== "string" || !SAVED.test(name)) return null;
    return readFile(join(BACKUPS_DIR, name)).catch(() => null);
}
