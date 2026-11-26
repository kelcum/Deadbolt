/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, randomUUID } from "crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

const required = ["patcher.js", "preload.js", "renderer.js", "renderer.css"];
const optional = ["package.json", "release.json", "deadbolt.ico", "splash.svg"];
const names = [...required, ...optional];
const manifestName = "manifest.json";
const backupName = ".deadbolt-previous-build";
const backupPath = (dir: string) => join(dirname(dir), `${backupName}-${basename(dir)}`);
const maxBytes = 192 * 1024 * 1024;
interface Manifest { version: 1; created: string; files: Record<string, { size: number; sha256: string; }>; }
let updating = false;
export function isUpdateInProgress() { return updating; }

function regular(file: string) {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unexpected non-regular build file.");
    return stat.size;
}
function hash(file: string) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function snapshot(source: string, destination: string) {
    const manifest: Manifest = { version: 1, created: new Date().toISOString(), files: {} };
    let total = 0;
    for (const name of names) {
        const path = join(source, name);
        if (!existsSync(path)) {
            if (required.includes(name)) throw new Error(`Missing build file: ${name}`);
            continue;
        }
        const size = regular(path);
        total += size;
        if (!size || total > maxBytes) throw new Error("Build checkpoint is empty or too large.");
        const target = join(destination, name);
        copyFileSync(path, target);
        manifest.files[name] = { size, sha256: hash(target) };
    }
    writeFileSync(join(destination, manifestName), JSON.stringify(manifest), { flush: true });
    return manifest;
}
function verify(directory: string): Manifest {
    if (!lstatSync(directory).isDirectory()) throw new Error("Invalid checkpoint directory.");
    const manifestPath = join(directory, manifestName);
    if (regular(manifestPath) > 16_384) throw new Error("Invalid checkpoint manifest.");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    if (manifest.version !== 1 || !manifest.files || !Number.isFinite(Date.parse(manifest.created)) || !required.every(name => Object.hasOwn(manifest.files, name))) throw new Error("Incomplete checkpoint.");
    let total = 0;
    for (const [name, entry] of Object.entries(manifest.files)) {
        if (!names.includes(name) || !entry || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid checkpoint entry.");
        total += entry.size;
        const file = join(directory, name);
        if (total > maxBytes || regular(file) !== entry.size || hash(file) !== entry.sha256) throw new Error(`Checkpoint validation failed: ${name}`);
    }
    return manifest;
}
export function checkpointStatus(dir: string) {
    const manifest = verify(backupPath(dir));
    return { created: manifest.created, bytes: Object.values(manifest.files).reduce((sum, entry) => sum + entry.size, 0), files: Object.keys(manifest.files).length };
}
export function createCheckpoint(dir: string) {
    const destination = backupPath(dir);
    const temp = `${destination}-new-${randomUUID()}`;
    const old = `${destination}-old-${randomUUID()}`;
    mkdirSync(temp, { mode: 0o700 });
    let moved = false;
    try {
        snapshot(dir, temp);
        verify(temp);
        if (existsSync(destination)) { renameSync(destination, old); moved = true; }
        try { renameSync(temp, destination); }
        catch (error) { if (moved) renameSync(old, destination); throw error; }
        if (moved) rmSync(old, { recursive: true, force: true });
        return checkpointStatus(dir);
    } finally { rmSync(temp, { recursive: true, force: true }); }
}

function applyFiles(dir: string, source: string, manifest: Manifest, work: string) {
    // Stage everything before touching a live build. Only known filenames are ever modified.
    mkdirSync(work, { mode: 0o700 });
    for (const name of Object.keys(manifest.files)) copyFileSync(join(source, name), join(work, name));
    for (const name of names) {
        const path = join(dir, name);
        if (Object.hasOwn(manifest.files, name)) renameSync(join(work, name), path);
        else if (existsSync(path)) rmSync(path, { force: true });
    }
}
export function restoreCheckpoint(dir: string) {
    const backup = backupPath(dir);
    const manifest = verify(backup);
    const temporary = join(dirname(dir), `.deadbolt-restore-${randomUUID()}`);
    mkdirSync(temporary, { mode: 0o700 });
    let recovered = true;
    try {
        const current = join(temporary, "current");
        mkdirSync(current, { mode: 0o700 });
        const before: Manifest = { version: 1, created: new Date().toISOString(), files: {} };
        // A failed update may have deleted one of the mandatory files. Capture only files that still exist.
        let total = 0;
        for (const name of names) {
            const file = join(dir, name);
            if (!existsSync(file)) continue;
            const size = regular(file);
            total += size;
            if (total > maxBytes) throw new Error("Current build too large to stage safely.");
            copyFileSync(file, join(current, name));
            before.files[name] = { size, sha256: hash(join(current, name)) };
        }
        try { applyFiles(dir, backup, manifest, join(temporary, "apply")); }
        catch (error) {
            try { applyFiles(dir, current, before, join(temporary, "undo")); }
            catch { recovered = false; throw new Error(`Restore failed; preserved recovery files at ${temporary}`); }
            throw error;
        }
        return checkpointStatus(dir);
    } finally { if (recovered) rmSync(temporary, { recursive: true, force: true }); }
}

export async function withUpdateCheckpoint<T extends boolean>(dir: string, apply: () => Promise<T>): Promise<T> {
    if (updating) throw new Error("An update is already running.");
    updating = true;
    try {
        createCheckpoint(dir);
        let result: T;
        try {
            result = await apply();
        } catch (error) {
            try { restoreCheckpoint(dir); }
            catch (rollbackError) { throw new Error(`Update failed and automatic restore failed: ${String(rollbackError)}`); }
            throw error;
        }
        if (!result) restoreCheckpoint(dir);
        return result;
    } finally { updating = false; }
}
