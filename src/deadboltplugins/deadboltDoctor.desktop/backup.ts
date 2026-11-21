/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings, RendererSettings } from "@main/settings";
import { DATA_DIR, NATIVE_SETTINGS_FILE, QUICK_CSS_PATH, SETTINGS_FILE } from "@main/utils/constants";
import { exec } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, normalize, relative, sep } from "path";

const repoRoot = join(__dirname, "..", "..");
const userPluginsDir = join(repoRoot, "src", "userplugins");
const MAX_BYTES = 200 * 1024 * 1024;
const MANIFEST = "deadbolt-backup.json";
const SETTINGS = "settings/settings.json";
const NATIVE_SETTINGS = "settings/native-settings.json";
const QUICK_CSS = "settings/quickCss.css";
const PLUGINS = "userplugins/";

export interface BackupPreview {
    created: string | null;
    settings: { changed: boolean; enabledNow: number; enabledAfter: number; } | null;
    quickCss: { changed: boolean; linesNow: number; linesAfter: number; } | null;
    userplugins: { overwritten: string[]; added: string[]; unchanged: number; } | null;
    userpluginsSkipped: boolean;
}

export type RestoreResult = { error: string; } | { buildError: string; } | { safetyCopy: string; };

const hasSource = () => existsSync(join(repoRoot, "src"));

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
    return files;
}

function pluginTarget(name: string) {
    const rel = name.slice(PLUGINS.length);
    if (!rel || rel.endsWith("/") || rel.includes("\\") || rel.split("/").some(p => !p || p === "." || p === "..")) return null;
    const full = normalize(join(userPluginsDir, ...rel.split("/")));
    return full.startsWith(userPluginsDir + sep) ? full : null;
}

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
    return { files, settings, nativeSettings, plugins, created: createdAt(files[MANIFEST]) };
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

export async function exportBackup(_: IpcMainInvokeEvent): Promise<Uint8Array> {
    return zipSync(await currentFiles(), { level: 6 });
}

export async function inspectBackup(_: IpcMainInvokeEvent, data: Uint8Array): Promise<{ error: string; } | BackupPreview> {
    try {
        const { files, settings, plugins, created } = readBackup(data);
        const cssAfter = files[QUICK_CSS] ? strFromU8(files[QUICK_CSS]) : null;
        const cssNow = await readFile(QUICK_CSS_PATH, "utf8").catch(() => "");
        const source = hasSource();
        let userplugins: BackupPreview["userplugins"] = null;
        if (source && plugins.length) {
            userplugins = { overwritten: [], added: [], unchanged: 0 };
            for (const name of plugins) {
                const now = await readFile(pluginTarget(name) as string).catch(() => null);
                const rel = name.slice(PLUGINS.length);
                if (!now) userplugins.added.push(rel);
                else if (sameBytes(now, files[name])) userplugins.unchanged++;
                else userplugins.overwritten.push(rel);
            }
        }
        return {
            created,
            settings: settings && {
                changed: JSON.stringify(settings) !== JSON.stringify(RendererSettings.plain),
                enabledNow: enabledCount(RendererSettings.plain),
                enabledAfter: enabledCount(settings)
            },
            quickCss: cssAfter === null ? null : { changed: cssAfter !== cssNow, linesNow: lines(cssNow), linesAfter: lines(cssAfter) },
            userplugins,
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
    const { files, settings, nativeSettings, plugins } = backup;

    const safetyCopy = join(DATA_DIR, "backups", `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
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
        if (files[QUICK_CSS]) await writeFile(QUICK_CSS_PATH, files[QUICK_CSS]);
        if (nativeSettings) NativeSettings.setData(nativeSettings as typeof NativeSettings.plain);
        if (settings) RendererSettings.setData(settings as typeof RendererSettings.plain);
    } catch (e) {
        return { error: `Restoring stopped partway (${e instanceof Error ? e.message : String(e)}). Your setup from before is saved in ${safetyCopy}` };
    }
    return { safetyCopy };
}
