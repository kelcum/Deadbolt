/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isAlreadyPatched, patchResourcesDir } from "@main/applyHostPatch";
import { execFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "original-fs";
import { basename, dirname, join } from "path";

const patcherPath = join(__dirname, "patcher.js");
const repoRoot = join(__dirname, "..", "..");
const VERSION_DIR = /^app-\d+(\.\d+)+$/;
const TASKS = ["Deadbolt Auto-Update", "Deadbolt Guard"];

export type Level = "ok" | "warn" | "bad";

export interface VersionState {
    name: string;
    running: boolean;
    newest: boolean;
    state: "injected" | "other-patcher" | "vanilla" | "broken";
}

export interface Health {
    platform: string;
    discordDir: string | null;
    versions: VersionState[];
    updateInstalling: boolean;
    sourceInstall: boolean;
    built: { sha: string | null; head: string | null; } | null;
    tasks: { name: string; registered: boolean; }[] | null;
    alerts: { key: string; since: string; }[];
    logPath: string | null;
}

function versionKey(name: string) {
    return name.slice(4).split(".").map(n => parseInt(n, 10) || 0);
}

function newer(a: string, b: string) {
    const x = versionKey(a);
    const y = versionKey(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    }
    return false;
}

function stubFor(path: string) {
    return `require(${JSON.stringify(path)});`;
}

function readText(path: string) {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
}

function stateOf(resources: string): VersionState["state"] {
    const app = join(resources, "app.asar");
    if (!existsSync(app)) return "broken";
    let isDir = false;
    try {
        isDir = lstatSync(app).isDirectory();
    } catch {
        return "broken";
    }
    if (!isDir) return isAlreadyPatched(resources) ? "broken" : "vanilla";
    if (!isAlreadyPatched(resources)) return "broken";
    const index = readText(join(app, "index.js"));
    if (index === null) return "broken";
    const norm = (s: string) => {
        const slashed = s.replace(/\\\\/g, "/").replace(/\\/g, "/");
        return process.platform === "win32" ? slashed.toLowerCase() : slashed;
    };
    return norm(index).includes(norm(patcherPath)) ? "injected" : "other-patcher";
}

function discordRoot() {
    if (process.platform !== "win32") return null;
    const versionDir = dirname(process.execPath);
    return VERSION_DIR.test(basename(versionDir)) ? dirname(versionDir) : null;
}

function listVersions(root: string): VersionState[] {
    const running = basename(dirname(process.execPath));
    const names = readdirSync(root).filter(n => {
        if (!VERSION_DIR.test(n)) return false;
        try {
            return statSync(join(root, n)).isDirectory();
        } catch {
            return false;
        }
    });
    const newestName = names.reduce<string | null>((best, n) => (!best || newer(n, best) ? n : best), null);
    return names
        .sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0))
        .map(name => ({
            name,
            running: name === running,
            newest: name === newestName,
            state: stateOf(join(root, name, "resources"))
        }));
}

function run(file: string, args: string[], timeout = 120_000) {
    return new Promise<{ code: number; output: string; }>(resolve => {
        execFile(file, args, { cwd: repoRoot, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
            resolve({ code, output: `${stdout ?? ""}${stderr ?? ""}`.trim() });
        });
    });
}

function isSourceInstall() {
    return existsSync(join(repoRoot, "src")) && existsSync(join(repoRoot, "package.json"));
}

async function taskStates() {
    if (process.platform !== "win32" || !isSourceInstall()) return null;
    return Promise.all(TASKS.map(async name => ({ name, registered: (await run("schtasks.exe", ["/query", "/tn", name], 15_000)).code === 0 })));
}

function gitHead() {
    const head = readText(join(repoRoot, ".git", "HEAD"))?.trim();
    if (!head) return null;
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const loose = readText(join(repoRoot, ".git", ...ref.split("/")))?.trim();
    if (loose) return loose;
    const packed = readText(join(repoRoot, ".git", "packed-refs")) ?? "";
    return packed.split(/\r?\n/).find(l => l.endsWith(` ${ref}`))?.split(" ")[0] ?? null;
}

function readAlerts() {
    const file = join(process.env.LOCALAPPDATA ?? "", "DeadboltAutoUpdate", "last-alert.json");
    const raw = readText(file);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
        if (parsed.alerts) return Object.entries<any>(parsed.alerts).map(([key, v]) => ({ key, since: String(v?.first ?? "") }));
        if (parsed.key) return [{ key: String(parsed.key), since: String(parsed.time ?? "") }];
    } catch { }
    return [];
}

export async function getHealth(_: IpcMainInvokeEvent): Promise<Health> {
    const root = discordRoot();
    const source = isSourceInstall();
    const log = join(repoRoot, "scripts", "auto-update.log");
    return {
        platform: process.platform,
        discordDir: root,
        versions: root ? listVersions(root) : [],
        updateInstalling: root ? readdirSync(root).some(n => /^\.app-.*\.installing$/.test(n)) : false,
        sourceInstall: source,
        built: source ? { sha: readText(join(repoRoot, "dist", "built-from.txt"))?.trim() ?? null, head: gitHead() } : null,
        tasks: await taskStates(),
        alerts: process.platform === "win32" && source ? readAlerts() : [],
        logPath: source && existsSync(log) ? log : null
    };
}

export async function injectAll(_: IpcMainInvokeEvent): Promise<{ fixed: string[]; failed: string[]; }> {
    const root = discordRoot();
    const fixed: string[] = [];
    const failed: string[] = [];
    if (!root) return { fixed, failed };

    for (const v of listVersions(root)) {
        const resources = join(root, v.name, "resources");
        try {
            if (v.state === "vanilla") {
                if (patchResourcesDir(resources, patcherPath)) fixed.push(v.name);
                else failed.push(v.name);
            } else if (v.state === "other-patcher") {
                writeFileSync(join(resources, "app.asar", "index.js"), stubFor(patcherPath));
                fixed.push(v.name);
            } else if (v.state === "broken") {
                failed.push(v.name);
            }
        } catch (e) {
            console.error("[Deadbolt] Doctor couldn't inject", v.name, e);
            failed.push(v.name);
        }
    }
    return { fixed, failed };
}

export async function runRepairScript(_: IpcMainInvokeEvent): Promise<{ code: number; output: string; } | null> {
    if (process.platform !== "win32" || !isSourceInstall()) return null;
    const script = join(repoRoot, "scripts", "repair.ps1");
    if (!existsSync(script)) return null;
    return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-NoRestart"], 600_000);
}

export async function startUpdateTask(_: IpcMainInvokeEvent): Promise<boolean> {
    if (process.platform !== "win32" || !isSourceInstall()) return false;
    return (await run("schtasks.exe", ["/run", "/tn", TASKS[0]], 15_000)).code === 0;
}

export { exportBackup, inspectBackup, restoreBackup } from "./backup";
