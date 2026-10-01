import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { copyFile, readdir, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(homedir(), "Library", "Application Support", "discord");
const DISCORD_APP = "/Applications/Discord.app";
const PATCHER = join(REPO_ROOT, "dist", "desktop", "patcher.js");
const BACKUP_NAME = "index.deadbolt-original.js";

function parseVersion(name) {
    const match = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
    return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i])
            return b[i] - a[i];
    }

    return 0;
}

function coreNumber(name) {
    return Number(/^discord_desktop_core-(\d+)$/.exec(name)?.[1] ?? -1);
}

async function listCoreInstallations() {
    const rootEntries = await readdir(DATA_DIR, { withFileTypes: true }).catch(() => []);

    const apps = rootEntries
        .filter(entry => entry.isDirectory())
        .map(entry => ({
            name: entry.name,
            version: parseVersion(entry.name)
        }))
        .filter(entry => entry.version !== null)
        .sort((a, b) => compareVersions(a.version, b.version));

    const installations = [];

    for (const app of apps) {
        const modulesDir = join(DATA_DIR, app.name, "modules");
        const modules = await readdir(modulesDir, { withFileTypes: true }).catch(() => []);

        const cores = modules
            .filter(entry =>
                entry.isDirectory() &&
                /^discord_desktop_core-\d+$/.test(entry.name)
            )
            .sort((a, b) => coreNumber(b.name) - coreNumber(a.name));

        for (const core of cores) {
            const dir = join(modulesDir, core.name, "discord_desktop_core");
            const index = join(dir, "index.js");
            const backup = join(dir, BACKUP_NAME);

            if (existsSync(index) || existsSync(backup)) {
                installations.push({
                    app: app.name,
                    module: core.name,
                    index,
                    backup
                });
            }
        }
    }

    return installations;
}

function verifyDiscordSignature() {
    if (!existsSync(DISCORD_APP))
        return;

    execFileSync(
        "codesign",
        ["--verify", "--deep", "--strict", DISCORD_APP],
        { stdio: "inherit" }
    );
}

async function install() {
    if (!existsSync(PATCHER)) {
        throw new Error(
            `Deadbolt is not built. Run "pnpm build" first.\nMissing: ${PATCHER}`
        );
    }

    const installations = await listCoreInstallations();
    const core = installations[0];

    if (!core) {
        throw new Error(
            "Could not find discord_desktop_core. Start Discord once, close it, then run pnpm inject again."
        );
    }

    if (existsSync(core.backup)) {
        await copyFile(core.backup, core.index);
    } else {
        await copyFile(core.index, core.backup);
    }

    const wrapper = `"use strict";

process.env.DEADBOLT_CORE_INJECT = "1";

try {
    require(${JSON.stringify(PATCHER)});
} catch (err) {
    console.error("[Deadbolt] Core injection failed:", err);
}

module.exports = require(${JSON.stringify(core.backup)});
`;

    await writeFile(core.index, wrapper);

    verifyDiscordSignature();

    console.log();
    console.log("[Deadbolt] macOS injection complete.");
    console.log("[Deadbolt] Discord.app was not modified.");
    console.log(`[Deadbolt] Discord host: ${core.app}`);
    console.log(`[Deadbolt] Core module: ${core.module}`);
    console.log(`[Deadbolt] Patched: ${core.index}`);
    console.log(`[Deadbolt] Backup: ${core.backup}`);
    console.log();
    console.log("Restart Discord to load Deadbolt.");
}

async function uninstall() {
    const installations = await listCoreInstallations();
    let restored = 0;

    for (const core of installations) {
        if (!existsSync(core.backup))
            continue;

        await copyFile(core.backup, core.index);
        await rm(core.backup, { force: true });

        console.log(`[Deadbolt] Restored ${core.index}`);
        restored++;
    }

    verifyDiscordSignature();

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
