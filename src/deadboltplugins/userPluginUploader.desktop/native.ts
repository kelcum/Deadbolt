/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { basename, extname, join, relative, sep } from "path";

const ENTRY_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];
const PLUGIN_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const PLUGIN_NAME_REGEX = /definePlugin\(\{\s*(["'])?name\1:\s*(["'`])(.+?)\2/;
const NEW_FOLDER_REGEX = /^[A-Za-z0-9][\w-]{0,63}$/;
const SHARE_LIMIT = 10;
const SHARE_MAX_BYTES = 1_000_000;
const repoRoot = join(__dirname, "..", "..");
const userPluginsDir = join(repoRoot, "src", "userplugins");
const removedDir = join(repoRoot, "removed-userplugins");

export interface UserPluginInfo {
    folder: string;
    entry: string;
    pluginName: string | null;
    files: string[];
    isFile: boolean;
}

type Result<T> = { error: string; } | T;

let buildQueue: Promise<unknown> = Promise.resolve();

function cleanBuildOutput(raw: string) {
    const clean = raw.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim();
    return clean.length > 1500 ? "...\n" + clean.slice(-1500) : clean;
}

function runBuild(): Promise<string | null> {
    const run = buildQueue.then(() => new Promise<string | null>(resolve =>
        exec(
            IS_DEV ? "pnpm build --dev" : "pnpm build",
            {
                cwd: repoRoot,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
            },
            (err, stdout, stderr) => {
                if (!err) return resolve(null);
                resolve(cleanBuildOutput(`${stdout}\n${stderr}`) || err.message);
            }
        )
    ));
    buildQueue = run.catch(() => null);
    return run;
}

function buildFailed(output: string, what: string) {
    return { error: `Deadbolt failed to rebuild ${what}, so nothing was changed.\n\`\`\`\n${output}\n\`\`\`` };
}

function nameFrom(code: string) {
    return PLUGIN_NAME_REGEX.exec(code)?.[3] ?? null;
}

function sourceMissing() {
    return existsSync(join(repoRoot, "src"))
        ? null
        : { error: "Couldn't find your Deadbolt source folder. Managing plugins only works when Deadbolt is built from source." };
}

function existingPath(folder: unknown) {
    if (typeof folder !== "string" || !folder || folder.length > 128) return null;
    if (folder.startsWith(".") || folder.includes("/") || folder.includes("\\") || folder.includes(sep)) return null;
    const full = join(userPluginsDir, folder);
    if (relative(userPluginsDir, full) !== folder || !existsSync(full)) return null;
    return full;
}

async function findEntry(full: string, isFile: boolean) {
    if (isFile) return basename(full);
    const names = await readdir(full);
    return ENTRY_FILES.find(f => names.includes(f)) ?? null;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
    const out: string[] = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const full = join(dir, item.name);
        if (item.isDirectory()) out.push(...await listFiles(full, base));
        else out.push(relative(base, full).split(sep).join("/"));
    }
    return out;
}

async function describe(folder: string): Promise<UserPluginInfo | null> {
    const full = join(userPluginsDir, folder);
    const isFile = !(await stat(full)).isDirectory();
    if (isFile && !PLUGIN_EXTENSIONS.includes(extname(folder))) return null;
    const entry = await findEntry(full, isFile);
    if (!entry) return null;
    const code = await readFile(isFile ? full : join(full, entry), "utf8").catch(() => "");
    return {
        folder,
        entry,
        pluginName: nameFrom(code),
        files: isFile ? [entry] : await listFiles(full),
        isFile
    };
}

async function entryPath(folder: string): Promise<Result<{ full: string; path: string; entry: string; isFile: boolean; }>> {
    const full = existingPath(folder);
    if (!full) return { error: `There's no plugin called ${folder} in your userplugins folder.` };
    const isFile = !(await stat(full)).isDirectory();
    const entry = await findEntry(full, isFile);
    if (!entry) return { error: `${folder} has no index.ts or index.tsx to open.` };
    return { full, path: isFile ? full : join(full, entry), entry, isFile };
}

export async function listUserPlugins(_: IpcMainInvokeEvent): Promise<Result<{ plugins: UserPluginInfo[]; }>> {
    const missing = sourceMissing();
    if (missing) return missing;
    if (!existsSync(userPluginsDir)) return { plugins: [] };
    const names = (await readdir(userPluginsDir)).filter(n => !n.startsWith("."));
    const plugins = (await Promise.all(names.map(n => describe(n).catch(() => null))))
        .filter((p): p is UserPluginInfo => p !== null)
        .sort((a, b) => (a.pluginName ?? a.folder).localeCompare(b.pluginName ?? b.folder, undefined, { sensitivity: "base" }));
    return { plugins };
}

export async function readUserPlugin(_: IpcMainInvokeEvent, folder: string): Promise<Result<{ code: string; entry: string; }>> {
    const found = await entryPath(folder);
    if ("error" in found) return found;
    return { code: await readFile(found.path, "utf8"), entry: found.entry };
}

export async function saveUserPlugin(_: IpcMainInvokeEvent, folder: string, code: string): Promise<Result<{ pluginName: string; entry: string; }>> {
    if (typeof code !== "string" || code.length > 2_000_000) return { error: "That's way too big to be a plugin." };
    const pluginName = nameFrom(code);
    if (!pluginName) return { error: "The code needs `export default definePlugin({ name: \"...\", ... })` with name as the first property." };

    const found = await entryPath(folder);
    if ("error" in found) return found;

    const before = await readFile(found.path, "utf8");
    if (before === code) return { pluginName, entry: found.entry };

    await writeFile(found.path, code);
    const output = await runBuild();
    if (output === null) return { pluginName, entry: found.entry };

    await writeFile(found.path, before);
    await runBuild();
    return buildFailed(output, "with your changes");
}

export async function addUserPlugin(_: IpcMainInvokeEvent, folder: string, code: string, replace: boolean): Promise<Result<{ pluginName: string; entry: string; }>> {
    if (typeof folder !== "string" || !NEW_FOLDER_REGEX.test(folder))
        return { error: "Plugin names can only use letters, numbers, dashes and underscores, and have to start with a letter or number." };
    if (typeof code !== "string" || code.length > 2_000_000)
        return { error: "That file is way too big to be a plugin." };

    const pluginName = nameFrom(code);
    if (!pluginName)
        return { error: "That file doesn't look like a plugin. It needs `export default definePlugin({ name: \"...\", ... })` with name as the first property." };

    const missing = sourceMissing();
    if (missing) return missing;

    const dir = join(userPluginsDir, folder);
    const existed = existsSync(dir);
    if (existed && replace !== true)
        return { error: `A plugin folder named ${folder} already exists. Run the command again with replace set to True to overwrite it.` };

    const backup = await Promise.all(ENTRY_FILES.map(f => readFile(join(dir, f), "utf8").catch(() => null)));
    const entry = /<\/|\/>/.test(code) ? "index.tsx" : "index.ts";

    await mkdir(dir, { recursive: true });
    await Promise.all(ENTRY_FILES.map(f => rm(join(dir, f), { force: true })));
    await writeFile(join(dir, entry), code);

    const output = await runBuild();
    if (output === null) return { pluginName, entry };

    if (existed)
        await Promise.all(
            ENTRY_FILES.map((f, i) =>
                backup[i] === null
                    ? rm(join(dir, f), { force: true })
                    : writeFile(join(dir, f), backup[i])
            )
        );
    else
        await rm(dir, { recursive: true });

    await runBuild();
    return buildFailed(output, "with your plugin");
}

export async function removeUserPlugin(_: IpcMainInvokeEvent, folder: string): Promise<Result<{ movedTo: string; }>> {
    const full = existingPath(folder);
    if (!full) return { error: `There's no plugin called ${folder} in your userplugins folder.` };

    await mkdir(removedDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(removedDir, `${folder}-${stamp}`);
    await rename(full, target);

    const output = await runBuild();
    if (output === null) return { movedTo: relative(repoRoot, target).split(sep).join("/") };

    await rename(target, full);
    await runBuild();
    return buildFailed(output, `without ${folder}`);
}

export async function readUserPluginFiles(_: IpcMainInvokeEvent, folder: string): Promise<Result<{ files: { name: string; content: string; }[]; skipped: number; }>> {
    const full = existingPath(folder);
    if (!full) return { error: `There's no plugin called ${folder} in your userplugins folder.` };

    const isFile = !(await stat(full)).isDirectory();
    const names = isFile ? [basename(full)] : await listFiles(full);
    const files: { name: string; content: string; }[] = [];
    let skipped = 0;
    for (const name of names) {
        const path = isFile ? full : join(full, ...name.split("/"));
        if (files.length >= SHARE_LIMIT || (await stat(path)).size > SHARE_MAX_BYTES) {
            skipped++;
            continue;
        }
        const content = await readFile(path, "utf8");
        if (content.includes("\u0000")) {
            skipped++;
            continue;
        }
        files.push({ name: isFile ? name : `${folder}-${name.replace(/\//g, "-")}`, content });
    }
    return { files, skipped };
}
