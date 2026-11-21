"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const REPO = "kelcum/Deadbolt";
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const APP_DATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const HOME = process.env.USERPROFILE || os.homedir();
const INSTALL_DIR = path.join(LOCAL_APP_DATA, "DeadboltInstall");
const DIST_DIR = path.join(INSTALL_DIR, "dist");
const DIST_NEW = `${DIST_DIR}.new`;
const DIST_OLD = `${DIST_DIR}.old`;
const ZIP_PATH = path.join(INSTALL_DIR, "deadbolt-dist.zip");
const STATE_PATH = path.join(INSTALL_DIR, "installed.json");
const SETUP_EXE = path.join(INSTALL_DIR, "DeadboltSetup.exe");
const ICON_PATH = path.join(INSTALL_DIR, "deadbolt.ico");
const PATCHER_PATH = path.join(DIST_DIR, "patcher.js");
const DIST_FILES = ["package.json", "patcher.js", "preload.js", "renderer.css", "renderer.js"];
const LEGACY_FILES = ["EquilotlCli.exe"];
const STUB_PACKAGE = JSON.stringify({ name: "discord", main: "index.js" });
const LOADER_MAX_BYTES = 1024 * 1024;
const STDIN_CLOSED_LINGER_MS = 60_000;
const NETWORK_TIMEOUT_MS = 60_000;
const REPAIR_LOG_MAX_LINES = 400;

const REG_BASE = process.env.DEADBOLT_REG_BASE || "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion";
const RUN_KEY = `${REG_BASE}\\Run`;
const RUN_VALUE = "Deadbolt Repair";
const UNINSTALL_KEY = `${REG_BASE}\\Uninstall\\Deadbolt`;
const START_MENU_DIR = path.join(APP_DATA, "Microsoft", "Windows", "Start Menu", "Programs", "Deadbolt");

const ARGS = process.argv.slice(2).map(a => a.toLowerCase());
const MODE = ARGS.includes("--uninstall") ? "uninstall" : ARGS.includes("--repair") ? "repair" : "install";
const QUIET = ARGS.includes("--quiet");
const NO_PAUSE = QUIET || ARGS.includes("--no-pause");
const LOG_PATH = path.join(INSTALL_DIR, QUIET ? "repair.log" : "setup.log");

const BRANCHES = [
    { branch: "stable", label: "Discord", folder: "Discord", exe: "Discord.exe", shortcut: "Discord.lnk" },
    { branch: "ptb", label: "Discord PTB", folder: "DiscordPTB", exe: "DiscordPTB.exe", shortcut: "Discord PTB.lnk" },
    { branch: "canary", label: "Discord Canary", folder: "DiscordCanary", exe: "DiscordCanary.exe", shortcut: "Discord Canary.lnk" }
];

try {
    if (MODE === "install" || (MODE === "repair" && !QUIET)) fs.mkdirSync(INSTALL_DIR, { recursive: true });
    fs.rmSync(`${SETUP_EXE}.old`, { force: true });
} catch { }

const logLines = [];
let changed = false;
let iconAdded = false;

function log(msg) {
    logLines.push(msg);
    if (QUIET) return;
    console.log(msg);
    if (MODE === "uninstall") return;
    try {
        fs.appendFileSync(LOG_PATH, `${msg}\n`);
    } catch { }
}

function flushQuietLog(code) {
    if (!QUIET || MODE === "uninstall" || (!changed && code === 0)) return;
    try {
        let old = [];
        try {
            old = fs.readFileSync(LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean);
        } catch { }
        const lines = [...old, `=== ${new Date().toISOString()} | exit ${code} ===`, ...logLines.filter(Boolean)];
        fs.writeFileSync(LOG_PATH, `${lines.slice(-REPAIR_LOG_MAX_LINES).join("\n")}\n`);
    } catch { }
}

function launchHidden(script, env) {
    const conhost = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");
    spawn("cmd.exe", [`/d /c start "" "${conhost}" --headless powershell.exe -NoProfile -NonInteractive -Command "${script}"`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
        env: { ...process.env, ...env }
    }).unref();
}

function notify(message) {
    if (process.env.DEADBOLT_SILENT === "1") return;
    try {
        launchHidden(
            "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:DEADBOLT_MESSAGE, 'Deadbolt', 'OK', 'Warning', 'Button1', 'DefaultDesktopOnly')",
            { DEADBOLT_MESSAGE: message }
        );
    } catch { }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let rl = null;
let stdinClosed = false;
const pendingLines = [];
const waiters = [];

function input() {
    if (rl) return rl;
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on("line", line => {
        const waiter = waiters.shift();
        if (waiter) waiter(line.trim());
        else pendingLines.push(line.trim());
    });
    rl.on("close", () => {
        stdinClosed = true;
        while (waiters.length) waiters.shift()(null);
    });
    return rl;
}

function ask(question) {
    if (QUIET) return Promise.resolve(null);
    input();
    process.stdout.write(question);
    if (pendingLines.length) return Promise.resolve(pendingLines.shift());
    if (stdinClosed) return Promise.resolve(null);
    return new Promise(resolve => waiters.push(resolve));
}

let exiting = false;

function exitAfterOutput(code) {
    process.exitCode = code;
    if (rl) rl.close();
    process.stdout.write("", () => process.exit(code));
}

function finish(code) {
    if (exiting) return;
    exiting = true;

    if (QUIET) {
        flushQuietLog(code);
        process.exit(code);
    }

    if (MODE !== "uninstall") log(`A log of this run is saved at: ${LOG_PATH}`);
    if (NO_PAUSE) return exitAfterOutput(code);

    ask("Press Enter to close this window...").then(answer => {
        if (answer === null) setTimeout(() => process.exit(code), STDIN_CLOSED_LINGER_MS);
        else process.exit(code);
    });
}

function fail(err) {
    const msg = (err && err.message) || String(err);
    const what = MODE === "uninstall" ? "Uninstall" : MODE === "repair" ? "Repair" : "Setup";
    log("");
    log(`${what} failed: ${msg}`);
    if (QUIET && MODE === "repair") {
        notify(`Deadbolt couldn't put itself back on Discord after a Discord update.\n\n${msg}\n\nOpen Start, search for "Repair Deadbolt" and run it. Details are in ${LOG_PATH}`);
    } else if (QUIET) {
        notify(`${what} failed: ${msg}`);
    }
    finish(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

function get(url, headers, onResponse, reject) {
    const req = https.get(url, { headers: { "User-Agent": "deadbolt-setup", ...headers } }, res => {
        res.on("error", reject);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            get(res.headers.location, {}, onResponse, reject);
            return;
        }
        if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`GET ${url} failed: ${res.statusCode}`));
            return;
        }
        onResponse(res);
    });
    req.setTimeout(NETWORK_TIMEOUT_MS, () => req.destroy(new Error(`GET ${url} timed out`)));
    req.on("error", reject);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        get(url, { Accept: "application/vnd.github+json" }, res => {
            let data = "";
            res.on("data", chunk => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }, reject);
    });
}

function downloadFile(url, destPath, headers = {}) {
    const partial = `${destPath}.part`;
    return new Promise((resolve, reject) => {
        get(url, headers, res => {
            const expected = Number(res.headers["content-length"]) || 0;
            const file = fs.createWriteStream(partial);
            res.pipe(file);
            file.on("finish", () => file.close(() => {
                try {
                    const size = fs.statSync(partial).size;
                    if (expected && size !== expected) throw new Error(`The download stopped early (${size} of ${expected} bytes).`);
                    fs.renameSync(partial, destPath);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            }));
            file.on("error", reject);
        }, reject);
    });
}

function isAdmin() {
    return spawnSync("net", ["session"], { stdio: "ignore", windowsHide: true }).status === 0;
}

function samePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isInside(child, parent) {
    return path.resolve(child).toLowerCase().startsWith(`${path.resolve(parent).toLowerCase()}${path.sep}`);
}

function parseVersion(name) {
    const m = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
    return m ? m.slice(1).map(Number) : null;
}

function newerThan(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

function versionDirs(root) {
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(e => e.isDirectory() && parseVersion(e.name))
        .map(e => ({ dir: path.join(root, e.name), ver: parseVersion(e.name) }))
        .sort((a, b) => (newerThan(a.ver, b.ver) ? -1 : newerThan(b.ver, a.ver) ? 1 : 0));
}

function findInstall(b) {
    const root = path.join(LOCAL_APP_DATA, b.folder);
    const best = versionDirs(root).find(v => {
        const resources = path.join(v.dir, "resources");
        return fs.existsSync(path.join(resources, "app.asar")) || fs.existsSync(path.join(resources, "_app.asar"));
    });
    if (!best) return null;
    const resources = path.join(best.dir, "resources");
    return { ...b, root, versionDir: best.dir, resources, patched: fs.existsSync(path.join(resources, "_app.asar")) };
}

function findInstalls() {
    return BRANCHES.map(findInstall).filter(Boolean);
}

function readState() {
    try {
        const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
        return {
            branches: Array.isArray(s.branches) ? s.branches.filter(b => BRANCHES.some(x => x.branch === b)) : [],
            release: typeof s.release === "string" ? s.release : null
        };
    } catch {
        return { branches: [], release: null };
    }
}

function writeState(state) {
    fs.writeFileSync(STATE_PATH, `${JSON.stringify({ ...state, updated: new Date().toISOString() }, null, 4)}\n`);
}

function distComplete(dir) {
    return DIST_FILES.every(f => {
        try {
            return fs.statSync(path.join(dir, f)).isFile();
        } catch {
            return false;
        }
    });
}

function recoverDist() {
    if (distComplete(DIST_DIR) || !distComplete(DIST_OLD)) return;
    try {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
        fs.renameSync(DIST_OLD, DIST_DIR);
        changed = true;
        log("Put Deadbolt's files back after an update that was cut short.");
    } catch { }
}

async function pickInstalls(installs) {
    if (installs.length === 0) {
        throw new Error("No Discord install found. Install Discord (Stable, PTB or Canary) from discord.com first, open it once, then run this again.");
    }
    if (installs.length === 1) {
        log(`Found ${installs[0].label} at ${installs[0].root}`);
        return installs;
    }
    if (QUIET) throw new Error("More than one Discord is installed. Run DeadboltSetup.exe without --quiet to pick one.");
    log("Which Discord should Deadbolt go on?");
    installs.forEach((d, i) => log(`  ${i + 1}) ${d.label}${d.patched ? " (has a client mod on it now)" : ""}`));
    const all = installs.length + 1;
    log(`  ${all}) All of them`);
    for (; ;) {
        const answer = await ask(`Type a number (1-${all}) and press Enter: `);
        if (answer === null) throw new Error("No Discord was picked.");
        const n = Number(answer);
        if (n === all) return installs;
        if (Number.isInteger(n) && n >= 1 && n <= installs.length) return [installs[n - 1]];
        log("That's not one of the numbers above.");
    }
}

function discordProcesses(install) {
    const quick = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${install.exe}`, "/NH", "/FO", "CSV"], { encoding: "utf8", windowsHide: true });
    if (!(quick.stdout || "").toLowerCase().includes(`"${install.exe.toLowerCase()}"`)) return [];
    const r = spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-Process -Name $env:DEADBOLT_PROCESS -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id)|$($_.Path)\" }"
    ], { encoding: "utf8", windowsHide: true, env: { ...process.env, DEADBOLT_PROCESS: install.exe.replace(/\.exe$/i, "") } });
    return (r.stdout || "")
        .split(/\r?\n/)
        .map(line => {
            const i = line.indexOf("|");
            return { pid: Number(line.slice(0, i)), path: line.slice(i + 1).trim() };
        })
        .filter(p => p.pid > 0 && p.path && isInside(p.path, install.root));
}

async function closeDiscord(install, onlyVersionDir) {
    let procs = discordProcesses(install);
    if (onlyVersionDir) procs = procs.filter(p => samePath(path.dirname(p.path), onlyVersionDir));
    if (!procs.length) return false;
    log(`Closing ${install.label} so its files can be changed...`);
    const pids = new Set(procs.map(p => p.pid));
    spawnSync("taskkill", ["/F", "/T", ...procs.flatMap(p => ["/PID", String(p.pid)])], { stdio: "ignore", windowsHide: true });
    const stillRunning = () => discordProcesses(install).some(p => pids.has(p.pid));
    for (let i = 0; i < 20 && stillRunning(); i++) await sleep(500);
    if (stillRunning()) {
        throw new Error(`${install.label} won't close. Quit it from the system tray (right-click its icon, then Quit), or restart your PC, then run this again.`);
    }
    await sleep(1500);
    return true;
}

function startDiscord(install) {
    const updater = path.join(install.root, "Update.exe");
    if (!fs.existsSync(updater)) return false;
    spawn(updater, ["--processStart", install.exe], { detached: true, stdio: "ignore" }).unref();
    return true;
}

async function withRetries(what, fn) {
    let last;
    for (let i = 0; i < 10; i++) {
        try {
            return fn();
        } catch (e) {
            last = e;
            if (!["EBUSY", "EPERM", "EACCES"].includes(e.code)) break;
            await sleep(1000);
        }
    }
    const locked = last && ["EBUSY", "EPERM", "EACCES"].includes(last.code);
    throw new Error(locked
        ? `Couldn't ${what} because Windows says the file is in use or locked (${last.code}). Close Discord from the system tray, pause any antivirus scan of the Discord folder, or restart your PC, then run this again.`
        : `Couldn't ${what}: ${last && last.message}`);
}

function looksLikeLoader(appAsar) {
    let st;
    try {
        st = fs.statSync(appAsar);
    } catch {
        return true;
    }
    if (st.isDirectory()) return !fs.existsSync(path.join(appAsar, "app_bootstrap"));
    return st.size < LOADER_MAX_BYTES;
}

function loaderTarget(appAsar) {
    let text;
    try {
        const st = fs.statSync(appAsar);
        if (st.isDirectory()) text = fs.readFileSync(path.join(appAsar, "index.js"), "utf8");
        else if (st.size < LOADER_MAX_BYTES) text = fs.readFileSync(appAsar, "utf8");
        else return null;
    } catch {
        return null;
    }
    const m = /require\(\s*(["'])(.*?)\1\s*\)/s.exec(text);
    if (!m) return null;
    let target;
    try {
        target = JSON.parse(`"${m[2]}"`);
    } catch {
        target = m[2].replace(/\\\\/g, "\\");
    }
    try {
        return path.resolve(target);
    } catch {
        return null;
    }
}

function inspect(resources) {
    const appAsar = path.join(resources, "app.asar");
    const hasOriginal = fs.existsSync(path.join(resources, "_app.asar"));
    if (!fs.existsSync(appAsar)) return hasOriginal ? "loader-missing" : "missing";
    if (!hasOriginal) return "stock";
    if (!looksLikeLoader(appAsar)) return "leftover";
    const target = loaderTarget(appAsar);
    if (target && samePath(target, PATCHER_PATH)) return "ok";
    if (target && !isInside(target, INSTALL_DIR)) return "other";
    return "loader-broken";
}

function usesDeadbolt(install) {
    return versionDirs(install.root).some(v => {
        const appAsar = path.join(v.dir, "resources", "app.asar");
        const target = fs.existsSync(path.join(v.dir, "resources", "_app.asar")) && loaderTarget(appAsar);
        return Boolean(target) && isInside(target, INSTALL_DIR);
    });
}

async function restoreStock(resources) {
    const appAsar = path.join(resources, "app.asar");
    const original = path.join(resources, "_app.asar");
    const leftover = path.join(resources, "app.asar.tmp");

    if (fs.existsSync(leftover)) await withRetries("remove a leftover app.asar.tmp", () => fs.rmSync(leftover, { recursive: true, force: true }));
    if (!fs.existsSync(original)) return "none";

    if (!looksLikeLoader(appAsar)) {
        await withRetries("remove the leftover _app.asar", () => fs.rmSync(original, { recursive: true, force: true }));
        return "cleaned";
    }

    const hadPatch = fs.existsSync(appAsar);
    if (hadPatch) await withRetries("move the old patch aside", () => fs.renameSync(appAsar, leftover));
    try {
        await withRetries("restore Discord's original app.asar", () => fs.renameSync(original, appAsar));
    } catch (e) {
        if (hadPatch) {
            try {
                fs.renameSync(leftover, appAsar);
            } catch { }
        }
        throw e;
    }
    if (hadPatch) {
        try {
            fs.rmSync(leftover, { recursive: true, force: true });
        } catch { }
    }
    return "restored";
}

async function removeOldPatch(install) {
    const original = path.join(install.resources, "_app.asar");
    if (!fs.existsSync(original)) {
        await restoreStock(install.resources);
        return;
    }
    const isLoader = looksLikeLoader(path.join(install.resources, "app.asar"));
    log(isLoader
        ? "Removing the client mod that's on it now (Equicord, Vencord or an older Deadbolt)..."
        : "Cleaning up a leftover from an old client mod (Discord updated while it was installed)...");
    await restoreStock(install.resources);
    log("Discord is back to stock, ready for Deadbolt.");
}

function writeLoader(appAsar) {
    fs.mkdirSync(appAsar, { recursive: true });
    fs.writeFileSync(path.join(appAsar, "package.json"), STUB_PACKAGE);
    fs.writeFileSync(path.join(appAsar, "index.js"), `require(${JSON.stringify(PATCHER_PATH)});`);
}

async function applyShim(resources) {
    const appAsar = path.join(resources, "app.asar");
    const original = path.join(resources, "_app.asar");
    let moved = false;

    if (!fs.existsSync(original)) {
        if (!fs.existsSync(appAsar)) throw new Error(`${resources} has no app.asar. Reinstall Discord from discord.com, then run this again.`);
        await withRetries("move Discord's app.asar aside", () => fs.renameSync(appAsar, original));
        moved = true;
    } else if (fs.existsSync(appAsar)) {
        await withRetries("clear the old loader", () => fs.rmSync(appAsar, { recursive: true, force: true }));
    }

    try {
        writeLoader(appAsar);
    } catch (e) {
        try {
            fs.rmSync(appAsar, { recursive: true, force: true });
            if (moved) fs.renameSync(original, appAsar);
        } catch { }
        throw new Error(`Couldn't write Deadbolt's loader into ${appAsar}: ${e.message}`);
    }
}

function fileHash(p) {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function sameFile(a, b) {
    try {
        return fs.statSync(a).size === fs.statSync(b).size && fileHash(a) === fileHash(b);
    } catch {
        return false;
    }
}

function coreImageDirs(versionDir) {
    const modules = path.join(versionDir, "modules");
    let entries;
    try {
        entries = fs.readdirSync(modules, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(e => e.isDirectory() && /^discord_desktop_core-\d+$/.test(e.name))
        .map(e => path.join(modules, e.name, "discord_desktop_core", "app", "images"));
}

function brandFile(source, target) {
    if (!fs.existsSync(target) || sameFile(source, target)) return false;
    const orig = `${target}.orig`;
    if (!fs.existsSync(orig)) fs.copyFileSync(target, orig);
    fs.copyFileSync(source, target);
    return true;
}

function brand(install) {
    const ico = path.join(DIST_DIR, "deadbolt.ico");
    const svg = path.join(DIST_DIR, "splash.svg");
    const done = [];
    try {
        if (fs.existsSync(ico)) {
            if (!fs.existsSync(ICON_PATH)) iconAdded = true;
            if (!sameFile(ico, ICON_PATH)) fs.copyFileSync(ico, ICON_PATH);
            for (const target of [path.join(install.root, "app.ico"), path.join(install.versionDir, "app.ico")]) {
                if (brandFile(ICON_PATH, target)) done.push(target);
            }
        }
        if (fs.existsSync(svg)) {
            for (const images of coreImageDirs(install.versionDir)) {
                const target = path.join(images, "discord.svg");
                if (brandFile(svg, target)) done.push(target);
            }
        }
    } catch (e) {
        log(`Couldn't update ${install.label}'s icon or splash: ${e.message}`);
    }
    for (const target of done) log(`Deadbolt branding -> ${target}`);
    if (done.length) changed = true;
}

function unbrand(install) {
    const targets = [path.join(install.root, "app.ico")];
    for (const v of versionDirs(install.root)) {
        targets.push(path.join(v.dir, "app.ico"));
        for (const images of coreImageDirs(v.dir)) targets.push(path.join(images, "discord.svg"));
    }
    for (const target of targets) {
        const orig = `${target}.orig`;
        if (!fs.existsSync(orig)) continue;
        try {
            fs.copyFileSync(orig, target);
            fs.rmSync(orig, { force: true });
        } catch (e) {
            log(`Couldn't put Discord's own ${path.basename(target)} back at ${target}: ${e.message}`);
        }
    }
}

function runPowerShell(script, payload) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, DEADBOLT_JSON: JSON.stringify(payload) }
    });
    return (r.stdout || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function discordShortcuts(install) {
    const dirs = [
        path.join(APP_DATA, "Microsoft", "Windows", "Start Menu", "Programs", "Discord Inc"),
        path.join(APP_DATA, "Microsoft", "Windows", "Start Menu", "Programs"),
        path.join(APP_DATA, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
        path.join(HOME, "Desktop")
    ];
    if (process.env.OneDrive) dirs.push(path.join(process.env.OneDrive, "Desktop"));
    return dirs.map(d => path.join(d, install.shortcut)).filter(p => fs.existsSync(p));
}

function setShortcutIcons(installs, restore) {
    const items = [];
    for (const install of installs) {
        for (const p of discordShortcuts(install)) {
            items.push({
                path: p,
                root: install.root,
                icon: restore ? `${path.join(install.root, "app.ico")},0` : `${ICON_PATH},0`,
                only: restore ? ICON_PATH : ""
            });
        }
    }
    if (!items.length || (!restore && !fs.existsSync(ICON_PATH))) return;
    const out = runPowerShell([
        "$shell = New-Object -ComObject WScript.Shell",
        "$items = $env:DEADBOLT_JSON | ConvertFrom-Json",
        "foreach ($i in $items) {",
        "    try {",
        "        $lnk = $shell.CreateShortcut($i.path)",
        "        if (-not $lnk.TargetPath.ToLower().StartsWith($i.root.ToLower() + '\\')) { continue }",
        "        if ($i.only -and -not $lnk.IconLocation.ToLower().StartsWith($i.only.ToLower())) { continue }",
        "        if ($lnk.IconLocation -eq $i.icon) { continue }",
        "        $lnk.IconLocation = $i.icon",
        "        $lnk.Save()",
        "        \"changed|$($i.path)\"",
        "    } catch { \"failed|$($i.path)|$($_.Exception.Message)\" }",
        "}"
    ].join("\n"), items);
    for (const line of out) {
        const [kind, p, why] = line.split("|");
        if (kind === "changed") {
            changed = true;
            log(`${restore ? "Discord icon" : "Deadbolt icon"} -> ${p}`);
        } else if (kind === "failed") {
            log(`Couldn't update the shortcut ${p}: ${why}`);
        }
    }
}

function reg(args) {
    return spawnSync("reg.exe", args, { stdio: "ignore", windowsHide: true }).status === 0;
}

function installSelf() {
    if (!process.pkg) return fs.existsSync(SETUP_EXE);
    if (samePath(process.execPath, SETUP_EXE)) return true;
    const fresh = `${SETUP_EXE}.new`;
    const old = `${SETUP_EXE}.old`;
    try {
        fs.rmSync(old, { force: true });
    } catch { }
    try {
        fs.writeFileSync(fresh, fs.readFileSync(process.execPath));
        if (fs.existsSync(SETUP_EXE)) fs.renameSync(SETUP_EXE, old);
        fs.renameSync(fresh, SETUP_EXE);
    } catch (e) {
        log(`Couldn't keep a copy of setup in ${INSTALL_DIR}: ${e.message}`);
        try {
            fs.rmSync(fresh, { force: true });
        } catch { }
    }
    try {
        fs.rmSync(old, { force: true });
    } catch { }
    return fs.existsSync(SETUP_EXE);
}

function register(tag) {
    const conhost = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "conhost.exe");
    const quietRepair = `"${SETUP_EXE}" --repair --quiet`;
    const ok = [
        reg(["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", fs.existsSync(conhost) ? `"${conhost}" --headless ${quietRepair}` : quietRepair, "/f"]),
        ...[
            ["DisplayName", "Deadbolt"],
            ["DisplayIcon", fs.existsSync(ICON_PATH) ? ICON_PATH : SETUP_EXE],
            ["DisplayVersion", tag || "unknown"],
            ["Publisher", "Deadbolt"],
            ["InstallLocation", INSTALL_DIR],
            ["URLInfoAbout", `https://github.com/${REPO}`],
            ["UninstallString", `"${SETUP_EXE}" --uninstall`],
            ["QuietUninstallString", `"${SETUP_EXE}" --uninstall --quiet`],
            ["ModifyPath", `"${SETUP_EXE}" --repair`]
        ].map(([name, value]) => reg(["add", UNINSTALL_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])),
        reg(["add", UNINSTALL_KEY, "/v", "NoRepair", "/t", "REG_DWORD", "/d", "1", "/f"])
    ].every(Boolean);
    if (!ok) log("Couldn't register Deadbolt with Windows completely, so it may not re-apply itself at sign-in.");

    try {
        fs.mkdirSync(START_MENU_DIR, { recursive: true });
        const icon = fs.existsSync(ICON_PATH) ? `${ICON_PATH},0` : `${SETUP_EXE},0`;
        const out = runPowerShell([
            "$shell = New-Object -ComObject WScript.Shell",
            "$items = $env:DEADBOLT_JSON | ConvertFrom-Json",
            "foreach ($i in $items) {",
            "    try {",
            "        $lnk = $shell.CreateShortcut($i.path)",
            "        $lnk.TargetPath = $i.target",
            "        $lnk.Arguments = $i.arguments",
            "        $lnk.WorkingDirectory = $i.dir",
            "        $lnk.Description = $i.description",
            "        $lnk.IconLocation = $i.icon",
            "        $lnk.Save()",
            "    } catch { \"failed|$($i.path)|$($_.Exception.Message)\" }",
            "}"
        ].join("\n"), [
            { path: path.join(START_MENU_DIR, "Repair Deadbolt.lnk"), target: SETUP_EXE, arguments: "--repair", dir: INSTALL_DIR, description: "Download the latest Deadbolt and put it back on Discord", icon },
            { path: path.join(START_MENU_DIR, "Uninstall Deadbolt.lnk"), target: SETUP_EXE, arguments: "--uninstall", dir: INSTALL_DIR, description: "Remove Deadbolt and put Discord back to stock", icon }
        ]);
        for (const line of out) log(`Couldn't create a Start Menu shortcut: ${line.split("|").slice(1).join(": ")}`);
    } catch (e) {
        log(`Couldn't create the Start Menu shortcuts: ${e.message}`);
    }
}

function unregister() {
    reg(["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]);
    reg(["delete", UNINSTALL_KEY, "/f"]);
    try {
        fs.rmSync(START_MENU_DIR, { recursive: true, force: true });
    } catch { }
}

function removeLegacyFiles() {
    for (const name of LEGACY_FILES) {
        try {
            fs.rmSync(path.join(INSTALL_DIR, name), { force: true });
        } catch { }
    }
}

function removeInstallDir() {
    const self = process.pkg ? process.execPath : null;
    let entries = [];
    try {
        entries = fs.readdirSync(INSTALL_DIR);
    } catch { }
    let keep = null;
    for (const name of entries) {
        const p = path.join(INSTALL_DIR, name);
        if (self && samePath(p, self)) {
            keep = p;
            continue;
        }
        try {
            fs.rmSync(p, { recursive: true, force: true });
        } catch { }
    }
    if (!keep) {
        try {
            fs.rmdirSync(INSTALL_DIR);
        } catch { }
        return;
    }
    try {
        launchHidden(
            "Wait-Process -Id $env:DEADBOLT_PID -Timeout 3600 -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Remove-Item -LiteralPath $env:DEADBOLT_EXE -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $env:DEADBOLT_DIR -Recurse -Force -ErrorAction SilentlyContinue",
            { DEADBOLT_PID: String(process.pid), DEADBOLT_EXE: keep, DEADBOLT_DIR: INSTALL_DIR }
        );
    } catch { }
}

function extractBuild(releaseInfo) {
    fs.rmSync(DIST_NEW, { recursive: true, force: true });
    fs.mkdirSync(DIST_NEW, { recursive: true });
    const r = spawnSync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath $env:DEADBOLT_ZIP -DestinationPath $env:DEADBOLT_OUT -Force"
    ], { encoding: "utf8", windowsHide: true, env: { ...process.env, DEADBOLT_ZIP: ZIP_PATH, DEADBOLT_OUT: DIST_NEW } });
    if (r.status !== 0 || !distComplete(DIST_NEW)) {
        const why = (r.stderr || "").trim().split(/\r?\n/)[0];
        try {
            fs.rmSync(DIST_NEW, { recursive: true, force: true });
        } catch { }
        throw new Error(`The downloaded Deadbolt build couldn't be unpacked${why ? ` (${why})` : ""}. Run this again, and if it keeps failing, check that your antivirus isn't removing Deadbolt's files.`);
    }
    fs.writeFileSync(path.join(DIST_NEW, "release.json"), JSON.stringify(releaseInfo));
}

async function swapDist() {
    if (fs.existsSync(DIST_OLD)) await withRetries("remove an old copy of Deadbolt's files", () => fs.rmSync(DIST_OLD, { recursive: true, force: true }));
    const hadDist = fs.existsSync(DIST_DIR);
    if (hadDist) await withRetries("move the old Deadbolt files aside", () => fs.renameSync(DIST_DIR, DIST_OLD));
    try {
        await withRetries("put the new Deadbolt files in place", () => fs.renameSync(DIST_NEW, DIST_DIR));
    } catch (e) {
        if (hadDist) {
            try {
                fs.renameSync(DIST_OLD, DIST_DIR);
            } catch { }
        }
        throw e;
    }
    if (hadDist) {
        try {
            fs.rmSync(DIST_OLD, { recursive: true, force: true });
        } catch { }
    }
}

async function downloadBuild() {
    log("Checking latest Deadbolt release...");
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = (release.assets || []).find(a => a.name === "deadbolt-dist.zip");
    if (!asset) {
        throw new Error("Could not find deadbolt-dist.zip in the latest release. Has one been published?");
    }

    log(`Downloading Deadbolt ${release.tag_name}...`);
    await downloadFile(asset.url, ZIP_PATH, { Accept: "application/octet-stream" });

    log("Extracting...");
    extractBuild({ assetId: asset.id, hash: ((asset.label || "").match(/\b[0-9a-f]{40}\b/) || [null])[0] });
    return release.tag_name;
}

async function runInstall() {
    if (!QUIET) {
        try {
            fs.writeFileSync(LOG_PATH, "");
        } catch { }
    }
    log(MODE === "repair" ? "=== Deadbolt Repair ===" : "=== Deadbolt Setup ===");
    log(`${new Date().toISOString()} | Windows ${os.release()} | ${os.arch()}`);
    log("");

    if (isAdmin()) {
        log("Note: this window is running as Administrator. That isn't needed - next time just double-click DeadboltSetup.exe.");
        log("");
    }

    recoverDist();
    const state = readState();
    let targets = [];
    if (MODE === "repair") {
        targets = findInstalls().filter(i => state.branches.includes(i.branch) || usesDeadbolt(i));
        if (targets.length) log(`Repairing Deadbolt on ${targets.map(t => t.label).join(", ")}.`);
        else log("Deadbolt isn't on any Discord here yet, so this installs it.");
    }
    if (!targets.length) targets = await pickInstalls(findInstalls());
    log("");

    let tag = state.release;
    let fresh = false;
    try {
        tag = await downloadBuild();
        fresh = true;
    } catch (e) {
        if (MODE !== "repair" || !distComplete(DIST_DIR)) throw e;
        log(`Couldn't get the latest build (${e.message}). Putting back the Deadbolt build you already have instead.`);
    }
    log("");

    const wasRunning = [];
    for (const t of targets) if (await closeDiscord(t)) wasRunning.push(t);

    if (fresh) await swapDist();
    removeLegacyFiles();

    const failures = [];
    const done = [];
    for (const t of targets) {
        try {
            if (!["ok", "loader-missing", "loader-broken"].includes(inspect(t.resources))) await removeOldPatch(t);
            log(`Installing Deadbolt on ${t.label}...`);
            await applyShim(t.resources);
            brand(t);
            done.push(t);
            log(`Deadbolt is on ${t.label} (${path.basename(t.versionDir)}).`);
        } catch (e) {
            failures.push(`${t.label}: ${e.message}`);
        }
    }
    setShortcutIcons(done, false);

    writeState({ branches: [...new Set([...state.branches, ...done.map(t => t.branch)])], release: tag });
    if (installSelf()) {
        register(tag);
    } else {
        log("Setup is running from source, so the sign-in re-apply and Start Menu shortcuts were skipped.");
    }

    const toStart = wasRunning.length ? wasRunning : targets.slice(0, 1);
    log("");
    if (failures.length) {
        for (const t of toStart) startDiscord(t);
        throw new Error(failures.join("\n"));
    }
    log(MODE === "repair" ? "Done! Deadbolt is repaired." : "Done! Deadbolt is installed.");
    log("It puts itself back on Discord by itself each time you sign in to Windows, if a Discord update removed it.");
    log("To repair or remove it later, open Start and search for \"Repair Deadbolt\" or \"Uninstall Deadbolt\".");
    for (const t of toStart) {
        if (startDiscord(t)) log(`Starting ${t.label}...`);
        else log(`Open ${t.label} to see it.`);
    }
    finish(0);
}

async function quietRepairBranch(b) {
    const install = findInstall(b);
    if (!install) return null;
    const state = inspect(install.resources);
    const version = path.basename(install.versionDir);

    if (state === "other") {
        log(`${install.label} ${version} has another client mod on it, leaving it alone.`);
        return null;
    }
    if (state !== "ok") {
        const stock = state === "stock" || state === "leftover";
        let closed = stock && await closeDiscord(install, install.versionDir);
        try {
            if (state === "leftover") await restoreStock(install.resources);
            try {
                await applyShim(install.resources);
            } catch (e) {
                if (!await closeDiscord(install, install.versionDir)) throw e;
                closed = true;
                await applyShim(install.resources);
            }
            changed = true;
            log(stock
                ? `${install.label} ${version}: Discord had updated without Deadbolt, put it back on.`
                : `${install.label} ${version}: fixed Deadbolt's loader.`);
        } finally {
            if (closed && startDiscord(install)) log(`Restarted ${install.label}, it was running without Deadbolt.`);
        }
    }
    brand(install);
    return install;
}

async function runQuietRepair() {
    recoverDist();
    const state = readState();
    const branches = BRANCHES.filter(b => {
        if (state.branches.includes(b.branch)) return true;
        const install = findInstall(b);
        return install && usesDeadbolt(install);
    });
    if (!branches.length) return finish(0);
    if (!distComplete(DIST_DIR)) throw new Error(`Deadbolt's files are missing from ${DIST_DIR}.`);

    const failures = [];
    const installs = [];
    for (const b of branches) {
        try {
            const install = await quietRepairBranch(b);
            if (install) installs.push(install);
        } catch (e) {
            failures.push(`${b.label}: ${e.message}`);
        }
    }
    setShortcutIcons(installs, false);
    if (iconAdded && fs.existsSync(SETUP_EXE)) register(state.release);
    if (failures.length) throw new Error(failures.join("\n"));
    finish(0);
}

async function runUninstall() {
    if (!QUIET) {
        log("=== Deadbolt Uninstall ===");
        log("");
        const answer = await ask("This removes Deadbolt from every Discord it's on and puts Discord back to stock. Type Y and press Enter to continue: ");
        if (!answer || answer.toLowerCase() !== "y") {
            log("Nothing was changed.");
            return finish(0);
        }
    }

    const state = readState();
    const installs = findInstalls().filter(i => state.branches.includes(i.branch) || usesDeadbolt(i));
    const wasRunning = [];
    const failures = [];
    for (const install of installs) {
        try {
            const dirs = versionDirs(install.root)
                .map(v => path.join(v.dir, "resources"))
                .filter(r => !["stock", "missing", "other"].includes(inspect(r)));
            if (dirs.length && await closeDiscord(install)) wasRunning.push(install);
            for (const r of dirs) await restoreStock(r);
            unbrand(install);
            log(`${install.label} is back to stock.`);
        } catch (e) {
            failures.push(`${install.label}: ${e.message}`);
        }
    }
    setShortcutIcons(installs, true);
    for (const t of wasRunning) startDiscord(t);
    if (failures.length) throw new Error(`${failures.join("\n")}\nRun the uninstall again once Discord is closed.`);

    unregister();
    removeInstallDir();
    log("");
    log("Deadbolt is uninstalled. Your Deadbolt settings are still in %APPDATA%\\Deadbolt if you reinstall it later.");
    finish(0);
}

function main() {
    if (MODE === "uninstall") return runUninstall();
    if (MODE === "repair" && QUIET) return runQuietRepair();
    return runInstall();
}

main().catch(fail);
