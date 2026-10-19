"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const REPO = "kelcum/Deadbolt";
const EQUILOTL_URL = "https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli.exe";
const INSTALL_DIR = path.join(os.homedir(), "AppData", "Local", "DeadboltInstall");
const DIST_DIR = path.join(INSTALL_DIR, "dist");
const ZIP_PATH = path.join(INSTALL_DIR, "deadbolt-dist.zip");
const EQUILOTL_PATH = path.join(INSTALL_DIR, "EquilotlCli.exe");
const LOG_PATH = path.join(INSTALL_DIR, "setup.log");
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const EQUILOTL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOADER_MAX_BYTES = 1024 * 1024;

const BRANCHES = [
    { branch: "stable", label: "Discord", folder: "Discord", exe: "Discord.exe" },
    { branch: "ptb", label: "Discord PTB", folder: "DiscordPTB", exe: "DiscordPTB.exe" },
    { branch: "canary", label: "Discord Canary", folder: "DiscordCanary", exe: "DiscordCanary.exe" }
];

const STDIN_CLOSED_LINGER_MS = 60_000;

try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
} catch { }

function log(msg) {
    console.log(msg);
    try {
        fs.appendFileSync(LOG_PATH, `${msg}\n`);
    } catch { }
}

function logRaw(chunk, stream) {
    stream.write(chunk);
    try {
        fs.appendFileSync(LOG_PATH, chunk);
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
    input();
    process.stdout.write(question);
    if (pendingLines.length) return Promise.resolve(pendingLines.shift());
    if (stdinClosed) return Promise.resolve(null);
    return new Promise(resolve => waiters.push(resolve));
}

let exiting = false;

function waitAndExit(code) {
    if (exiting) return;
    exiting = true;

    log(`A log of this run is saved at: ${LOG_PATH}`);

    ask("Press Enter to close this window...").then(answer => {
        if (answer === null) setTimeout(() => process.exit(code), STDIN_CLOSED_LINGER_MS);
        else process.exit(code);
    });
}

function fail(err) {
    log("");
    log(`Setup failed: ${(err && err.message) || err}`);
    waitAndExit(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

function get(url, headers, onResponse, reject) {
    https.get(url, { headers: { "User-Agent": "deadbolt-setup", ...headers } }, res => {
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
    }).on("error", reject);
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
    return new Promise((resolve, reject) => {
        get(url, headers, res => {
            const file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
            file.on("error", reject);
        }, reject);
    });
}

function isAdmin() {
    return spawnSync("net", ["session"], { stdio: "ignore", windowsHide: true }).status === 0;
}

function parseVersion(name) {
    const m = /^app-(\d+)\.(\d+)\.(\d+)$/.exec(name);
    return m ? m.slice(1).map(Number) : null;
}

function newerThan(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

function findInstalls() {
    const found = [];
    for (const b of BRANCHES) {
        const root = path.join(LOCAL_APP_DATA, b.folder);
        let entries;
        try {
            entries = fs.readdirSync(root, { withFileTypes: true });
        } catch {
            continue;
        }
        let best = null;
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const ver = parseVersion(e.name);
            if (!ver) continue;
            const resources = path.join(root, e.name, "resources");
            if (!fs.existsSync(path.join(resources, "app.asar")) && !fs.existsSync(path.join(resources, "_app.asar"))) continue;
            if (!best || newerThan(ver, best.ver)) best = { ver, resources };
        }
        if (best) found.push({ ...b, root, resources: best.resources, patched: fs.existsSync(path.join(best.resources, "_app.asar")) });
    }
    return found;
}

async function pickInstall(installs) {
    if (installs.length === 0) {
        throw new Error("No Discord install found. Install Discord (Stable, PTB or Canary) from discord.com first, open it once, then run this again.");
    }
    if (installs.length === 1) {
        log(`Found ${installs[0].label} at ${installs[0].root}`);
        return installs[0];
    }
    log("Which Discord should Deadbolt go on?");
    installs.forEach((d, i) => log(`  ${i + 1}) ${d.label}${d.patched ? " (has a client mod on it now)" : ""}`));
    for (; ;) {
        const answer = await ask(`Type a number (1-${installs.length}) and press Enter: `);
        if (answer === null) throw new Error("No Discord was picked.");
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 1 && n <= installs.length) return installs[n - 1];
        log("That's not one of the numbers above.");
    }
}

function isRunning(exe) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${exe}`, "/NH", "/FO", "CSV"], { encoding: "utf8", windowsHide: true });
    return (r.stdout || "").toLowerCase().includes(`"${exe.toLowerCase()}"`);
}

async function closeDiscord(install) {
    if (!isRunning(install.exe)) return;
    log(`Closing ${install.label} so its files can be changed...`);
    spawnSync("taskkill", ["/F", "/T", "/IM", install.exe], { stdio: "ignore", windowsHide: true });
    for (let i = 0; i < 20 && isRunning(install.exe); i++) await sleep(500);
    if (isRunning(install.exe)) {
        throw new Error(`${install.label} won't close. Quit it from the system tray (right-click its icon, then Quit), or restart your PC, then run this again.`);
    }
    await sleep(1500);
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

async function removeOldPatch(install) {
    const appAsar = path.join(install.resources, "app.asar");
    const original = path.join(install.resources, "_app.asar");
    const leftover = path.join(install.resources, "app.asar.tmp");

    if (fs.existsSync(leftover)) await withRetries("remove a leftover app.asar.tmp", () => fs.rmSync(leftover, { recursive: true, force: true }));
    if (!fs.existsSync(original)) return;

    if (looksLikeLoader(appAsar)) {
        log("Removing the client mod that's on it now (Equicord, Vencord or an older Deadbolt)...");
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
    } else {
        log("Cleaning up a leftover from an old client mod (Discord updated while it was installed)...");
        await withRetries("remove the leftover _app.asar", () => fs.rmSync(original, { recursive: true, force: true }));
    }
    log("Discord is back to stock, ready for Deadbolt.");
}

function runEquilotl(install) {
    if (rl && !stdinClosed) rl.pause();
    return new Promise(resolve => {
        const child = spawn(EQUILOTL_PATH, ["--install", "--branch", install.branch], {
            stdio: ["inherit", "pipe", "pipe"],
            windowsHide: false,
            env: {
                ...process.env,
                EQUICORD_USER_DATA_DIR: INSTALL_DIR,
                EQUICORD_DIRECTORY: DIST_DIR,
                EQUICORD_DEV_INSTALL: "1"
            }
        });
        child.stdout.on("data", c => logRaw(c, process.stdout));
        child.stderr.on("data", c => logRaw(c, process.stderr));
        child.on("error", e => {
            log(`Couldn't start the patcher: ${e.message}`);
            resolve(1);
        });
        child.on("close", code => {
            if (rl && !stdinClosed) rl.resume();
            resolve(code ?? 1);
        });
    });
}

function startDiscord(install) {
    const updater = path.join(install.root, "Update.exe");
    if (!fs.existsSync(updater)) return false;
    spawn(updater, ["--processStart", install.exe], { detached: true, stdio: "ignore" }).unref();
    return true;
}

async function main() {
    try {
        fs.writeFileSync(LOG_PATH, "");
    } catch { }
    log("=== Deadbolt Setup ===");
    log(`${new Date().toISOString()} | Windows ${os.release()} | ${os.arch()}`);
    log("");

    if (isAdmin()) {
        log("Note: this window is running as Administrator. That isn't needed - next time just double-click DeadboltSetup.exe.");
        log("");
    }

    fs.mkdirSync(INSTALL_DIR, { recursive: true });

    const install = await pickInstall(findInstalls());
    log("");

    log("Checking latest Deadbolt release...");
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = (release.assets || []).find(a => a.name === "deadbolt-dist.zip");
    if (!asset) {
        throw new Error("Could not find deadbolt-dist.zip in the latest release. Has one been published?");
    }

    log(`Downloading Deadbolt ${release.tag_name}...`);
    await downloadFile(asset.url, ZIP_PATH, { Accept: "application/octet-stream" });

    log("Extracting...");
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIST_DIR, { recursive: true });
    const extract = spawnSync("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        `Expand-Archive -LiteralPath '${ZIP_PATH}' -DestinationPath '${DIST_DIR}' -Force`
    ], { stdio: "inherit" });
    if (extract.status !== 0) {
        throw new Error("Failed to extract Deadbolt build.");
    }

    let stale = true;
    try {
        stale = Date.now() - fs.statSync(EQUILOTL_PATH).mtimeMs > EQUILOTL_MAX_AGE_MS;
    } catch { }
    if (stale) {
        log("Downloading the Discord patcher (Equilotl, from Equicord)...");
        await downloadFile(EQUILOTL_URL, EQUILOTL_PATH);
    } else {
        log("Discord patcher already downloaded.");
    }
    log("");

    await closeDiscord(install);
    await removeOldPatch(install);

    log(`Installing Deadbolt on ${install.label}...`);
    log("");
    const code = await runEquilotl(install);

    log("");
    if (code === 0) {
        log("Done! Deadbolt is installed.");
        if (startDiscord(install)) log(`Starting ${install.label}...`);
        else log(`Open ${install.label} to see it.`);
    } else {
        log("Something went wrong during install. The details are above, and in the log below - send that file if you need help.");
    }
    waitAndExit(code);
}

main().catch(fail);
