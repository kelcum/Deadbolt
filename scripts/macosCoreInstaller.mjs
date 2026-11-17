/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { copyFile, readdir, readFile, rename, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORT_DIR = join(homedir(), "Library", "Application Support");
const PATCHER = process.env.DEADBOLT_PATCHER ?? join(REPO_ROOT, "dist", "desktop", "patcher.js");
const BACKUP_NAME = "index.deadbolt-original.js";
const MARKER = "DEADBOLT_CORE_INJECT";

export const BRANCHES = {
    stable: { data: "discord", app: "Discord" },
    canary: { data: "discordcanary", app: "Discord Canary" },
    ptb: { data: "discordptb", app: "Discord PTB" }
};

function hostVersion(name) {
    const match = /^(?:app-)?(\d+)\.(\d+)\.(\d+)$/.exec(name);
    return match ? match.slice(1).map(Number) : null;
}

function moduleNumber(name) {
    if (name === "discord_desktop_core") return 0;
    const match = /^discord_desktop_core-(\d+)$/.exec(name);
    return match ? Number(match[1]) : null;
}

async function subdirs(path) {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
}

function coreIn(moduleDir) {
    for (const dir of [join(moduleDir, "discord_desktop_core"), moduleDir]) {
        const index = join(dir, "index.js");
        const backup = join(dir, BACKUP_NAME);
        if (existsSync(index) || existsSync(backup)) return { dir, index, backup };
    }
    return null;
}

function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return b[i] - a[i];
    }
    return 0;
}

export async function listCoreInstallations(dataDir) {
    const installations = [];

    for (const host of await subdirs(dataDir)) {
        const version = hostVersion(host);
        if (!version) continue;

        const modulesDir = join(dataDir, host, "modules");
        for (const moduleName of await subdirs(modulesDir)) {
            const number = moduleNumber(moduleName);
            if (number === null) continue;

            const core = coreIn(join(modulesDir, moduleName));
            if (core) installations.push({ ...core, app: host, module: moduleName, key: [...version, number] });
        }
    }

    return installations.sort((a, b) => compareKeys(a.key, b.key));
}

export function coreWrapper(patcherPath, backupPath) {
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

export async function wrapCore(core, patcherPath) {
    const current = existsSync(core.index) ? await readFile(core.index, "utf8") : null;

    if (current !== null && !current.includes(MARKER))
        await copyFile(core.index, core.backup);

    if (!existsSync(core.backup))
        throw new Error(`${core.index} is a Deadbolt loader but its original (${BACKUP_NAME}) is gone. Reinstall Discord, then run this again.`);

    const temp = `${core.index}.deadbolt-new`;
    await writeFile(temp, coreWrapper(patcherPath, core.backup));
    await rename(temp, core.index);
}

function appBundles(branch) {
    const name = `${BRANCHES[branch].app}.app`;
    return [join("/Applications", name), join(homedir(), "Applications", name)].filter(existsSync);
}

export function otherModIn(bundles) {
    return bundles.find(bundle => existsSync(join(bundle, "Contents", "Resources", "_app.asar"))) ?? null;
}

function warnIfSignatureBroken(bundles) {
    for (const bundle of bundles) {
        try {
            execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "ignore" });
        } catch {
            console.warn(`[Deadbolt] ${bundle} fails codesign --verify. Deadbolt didn't change it, but macOS may call it damaged. Reinstall it from discord.com if Discord won't open.`);
        }
    }
}

async function pickBranch() {
    const wanted = process.env.DEADBOLT_BRANCH || "auto";
    const order = wanted === "auto" ? Object.keys(BRANCHES) : [wanted];

    if (!order.every(branch => BRANCHES[branch]))
        throw new Error(`DEADBOLT_BRANCH must be one of auto, ${Object.keys(BRANCHES).join(", ")}.`);

    for (const branch of order) {
        const [core] = await listCoreInstallations(join(SUPPORT_DIR, BRANCHES[branch].data));
        if (core) return { branch, core };
    }

    return { branch: order[0], core: null };
}

async function install() {
    if (!existsSync(PATCHER)) {
        throw new Error(
            `Deadbolt is not built. Run "pnpm build" first.\nMissing: ${PATCHER}`
        );
    }

    const { branch, core } = await pickBranch();
    const { app } = BRANCHES[branch];

    if (!core) {
        throw new Error(
            `Could not find ${app}'s discord_desktop_core. Start ${app} once, close it, then run pnpm inject again.`
        );
    }

    const bundles = appBundles(branch);
    const modded = otherModIn(bundles);
    if (modded) {
        throw new Error(
            `Another client mod is installed inside ${modded} (Contents/Resources/_app.asar exists).\n` +
            "Remove it first: reinstall Discord from discord.com, or run that mod's uninstaller. Then run this again."
        );
    }

    await wrapCore(core, PATCHER);
    warnIfSignatureBroken(bundles);

    console.log();
    console.log("[Deadbolt] macOS injection complete.");
    console.log(`[Deadbolt] ${app}.app was not modified.`);
    console.log(`[Deadbolt] Discord host: ${core.app}`);
    console.log(`[Deadbolt] Core module: ${core.module}`);
    console.log(`[Deadbolt] Patched: ${core.index}`);
    console.log(`[Deadbolt] Backup: ${core.backup}`);
    console.log();
    console.log(`Restart ${app} to load Deadbolt.`);
}

async function uninstall() {
    let restored = 0;

    for (const { data } of Object.values(BRANCHES)) {
        for (const core of await listCoreInstallations(join(SUPPORT_DIR, data))) {
            if (!existsSync(core.backup))
                continue;

            if (existsSync(core.index) && !(await readFile(core.index, "utf8")).includes(MARKER)) {
                await rm(core.backup, { force: true });
                continue;
            }

            await copyFile(core.backup, core.index);
            await rm(core.backup, { force: true });

            console.log(`[Deadbolt] Restored ${core.index}`);
            restored++;
        }
    }

    if (restored === 0) {
        console.log("[Deadbolt] No macOS core injection was found.");
        return;
    }

    console.log();
    console.log(`[Deadbolt] Restored ${restored} Discord core installation(s).`);
    console.log("[Deadbolt] Discord.app was not modified.");
}

export async function runMacOSInstaller(args) {
    if (process.platform !== "darwin")
        throw new Error("The macOS core installer can only run on macOS.");

    if (args.includes("--uninstall")) {
        await uninstall();
        return;
    }

    if (args.includes("--install") || args.includes("--repair")) {
        await install();
        return;
    }

    throw new Error(
        "Unknown macOS installer action. Expected --install, --uninstall or --repair."
    );
}
