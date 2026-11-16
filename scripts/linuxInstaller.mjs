/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFileSync } from "child_process";
import { accessSync, constants, existsSync, readdirSync, readlinkSync, realpathSync } from "fs";
import { homedir, userInfo } from "os";
import { posix } from "path";

const { basename, dirname, join } = posix;

const DISCORD_NAMES = new Set([
    "Discord",
    "DiscordPTB",
    "DiscordCanary",
    "DiscordDevelopment",
    "discord",
    "discordptb",
    "discordcanary",
    "discorddevelopment",
    "discord-ptb",
    "discord-canary",
    "discord-development",
    "com.discordapp.Discord",
    "com.discordapp.DiscordPTB",
    "com.discordapp.DiscordCanary",
    "com.discordapp.DiscordDevelopment"
]);

const AUTO_ORDER = ["stable", "canary", "ptb"];
const ELEVATORS = ["sudo", "doas", "run0", "pkexec"];
const PASSED_VARS = ["EQUICORD_USER_DATA_DIR", "EQUICORD_DIRECTORY", "EQUICORD_DEV_INSTALL"];

export function branchOf(name) {
    const lower = name.toLowerCase();
    return ["canary", "development", "ptb"].find(branch => lower.endsWith(branch)) ?? "stable";
}

function listDirs(path) {
    try {
        return readdirSync(path, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
    } catch {
        return [];
    }
}

function appVersion(name) {
    if (!name.startsWith("app-")) return null;
    const parts = name.slice(4).split(".");
    return parts.every(part => /^\d+$/.test(part)) ? parts.map(Number) : null;
}

function compareVersions(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff) return diff;
    }
    return 0;
}

function appResources(root, name) {
    if (!appVersion(name)) return null;
    const resources = join(root, name, "resources");
    if (!existsSync(resources)) return null;
    if (!existsSync(join(resources, "_app.asar")) && !existsSync(join(resources, "app.asar"))) return null;
    return resources;
}

function newestAppResources(root) {
    try {
        const linked = appResources(root, basename(dirname(readlinkSync(join(root, "Discord")))));
        if (linked) return linked;
    } catch { }

    let best = null;
    for (const name of listDirs(root)) {
        const resources = appResources(root, name);
        if (resources && (!best || compareVersions(appVersion(name), best.version) > 0))
            best = { version: appVersion(name), resources };
    }
    return best?.resources ?? null;
}

function classicInstall(dir) {
    const name = basename(dir);
    let base = dir;

    if (dir.includes("/flatpak/") && !dir.includes("/current/active/files/") && name.startsWith("com.discordapp.")) {
        let flatpakName = name.slice("com.discordapp.".length).toLowerCase();
        if (flatpakName !== "discord") flatpakName = `${flatpakName.slice(0, 7)}-${flatpakName.slice(7)}`;
        base = join(dir, "current/active/files", flatpakName);
    }

    const resources = join(base, "resources");
    if (!existsSync(join(resources, "app.asar"))) return null;
    return { root: dir, resources, branch: branchOf(name) };
}

export function findLinuxDiscords(home = homedir(), systemRoot = "/") {
    const system = path => join(systemRoot, path);
    const roots = [
        system("usr/share"),
        system("usr/lib"),
        system("usr/lib64"),
        system("opt"),
        join(home, "Applications"),
        join(home, "AppImages"),
        join(home, ".local/share"),
        join(home, ".local/bin"),
        join(home, ".dvm"),
        join(home, ".config"),
        join(home, ".var/app"),
        system("var/lib/flatpak/app"),
        join(home, ".local/share/flatpak/app")
    ];

    const seen = new Set();
    const installs = [];

    for (const root of roots) {
        let resolved;
        try {
            resolved = realpathSync(root);
        } catch {
            continue;
        }
        if (seen.has(resolved)) continue;
        seen.add(resolved);

        for (const name of listDirs(root)) {
            if (!DISCORD_NAMES.has(name)) continue;
            const install = classicInstall(join(root, name));
            if (install) installs.push(install);
        }
    }

    for (const name of ["discord", "discordcanary", "discordptb"]) {
        const root = join(home, ".config", name);
        const resources = newestAppResources(root);
        if (resources) installs.push({ root, resources, branch: branchOf(name) });
    }

    for (const name of ["Discord", "DiscordCanary", "DiscordPTB"]) {
        const root = join(home, ".var/app", `com.discordapp.${name}`, "config/discord");
        const resources = newestAppResources(root);
        if (resources) installs.push({ root, resources, branch: branchOf(name) });
    }

    return installs;
}

export function pickDiscord(installs, branch) {
    for (const wanted of branch === "auto" ? AUTO_ORDER : [branch]) {
        const install = installs.find(i => i.branch === wanted);
        if (install) return install;
    }
    return null;
}

function flagValue(args, name) {
    const pattern = new RegExp(`^--?${name}(?:=(.*))?$`);
    for (let i = 0; i < args.length; i++) {
        const match = pattern.exec(args[i]);
        if (match) return match[1] ?? args[i + 1] ?? "";
    }
    return null;
}

function canWrite(path) {
    try {
        accessSync(path, constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function findCommand(name) {
    return (process.env.PATH ?? "").split(":").some(dir => {
        try {
            accessSync(join(dir || ".", name), constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

export function planLinuxInstall(bin, args, env, {
    home = homedir(),
    systemRoot = "/",
    interactive = Boolean(process.stdin.isTTY),
    isRoot = process.getuid?.() === 0,
    writable = canWrite,
    which = findCommand,
    user = userInfo().username
} = {}) {
    const finalArgs = [...args];
    let branch = flagValue(args, "branch");
    const location = flagValue(args, "location");

    if (branch === null && location === null && (env.DEADBOLT_BRANCH || !interactive)) {
        branch = env.DEADBOLT_BRANCH || "auto";
        finalArgs.push("--branch", branch);
    }

    const installs = findLinuxDiscords(home, systemRoot);
    const targets = location !== null
        ? [newestAppResources(location) ?? classicInstall(location)?.resources]
        : branch !== null
            ? [pickDiscord(installs, branch)?.resources]
            : installs.map(install => install.resources);

    const locked = isRoot ? undefined : targets.find(resources => resources && !writable(resources));
    if (!locked) return { command: bin, args: finalArgs, locked: null, elevator: null };

    const elevator = ELEVATORS.find(which);
    if (!elevator) {
        throw new Error(
            `${locked} belongs to root and none of ${ELEVATORS.join(", ")} is installed.\n` +
            "Install sudo, or run this command again from a root shell with SUDO_USER set to your username."
        );
    }

    const vars = PASSED_VARS.filter(key => env[key] !== undefined).map(key => `${key}=${env[key]}`);
    return {
        command: elevator,
        args: ["env", ...vars, `SUDO_USER=${user}`, bin, ...finalArgs],
        locked,
        elevator
    };
}

export function runLinuxInstaller(bin, args, env) {
    let plan;
    try {
        plan = planLinuxInstall(bin, args, env);
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        throw err;
    }

    if (plan.locked) {
        console.log(`${plan.locked} belongs to root, so only the patch step runs through ${plan.elevator}.`);
        console.log("Deadbolt's own files stay owned by you.");
    }

    execFileSync(plan.command, plan.args, { stdio: "inherit", env });
}
