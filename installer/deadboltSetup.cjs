"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { spawnSync } = require("child_process");

const REPO = "kelcum/Deadbolt";
const EQUILOTL_URL = "https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli.exe";
const INSTALL_DIR = path.join(os.homedir(), "AppData", "Local", "DeadboltInstall");
const DIST_DIR = path.join(INSTALL_DIR, "dist");
const ZIP_PATH = path.join(INSTALL_DIR, "deadbolt-dist.zip");
const EQUILOTL_PATH = path.join(INSTALL_DIR, "EquilotlCli.exe");
const LOG_PATH = path.join(INSTALL_DIR, "setup.log");

// Seconds the window stays up if stdin isn't interactive (so "Press Enter"
// can't be answered) - long enough to read, instead of closing instantly.
const STDIN_CLOSED_LINGER_MS = 60_000;

try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
} catch { /* reported properly by main() if this is actually a problem */ }

// Everything printed is also written to setup.log, so even if the window
// does get closed, there's a record of what happened.
function log(msg) {
    console.log(msg);
    try {
        fs.appendFileSync(LOG_PATH, `${msg}\n`);
    } catch { /* logging must never be the thing that breaks setup */ }
}

let exiting = false;

// Keeps the window open until Enter is pressed, no matter how setup ended.
function waitAndExit(code) {
    if (exiting) return;
    exiting = true;

    log(`A log of this run is saved at: ${LOG_PATH}`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;

    rl.question("Press Enter to close this window...", () => {
        answered = true;
        rl.close();
        process.exit(code);
    });

    // stdin already closed / not interactive - don't let the window vanish
    // before it can be read.
    rl.on("close", () => {
        if (!answered) setTimeout(() => process.exit(code), STDIN_CLOSED_LINGER_MS);
    });
}

function fail(err) {
    log("");
    log(`Setup failed: ${(err && err.message) || err}`);
    waitAndExit(1);
}

// A crash anywhere (a dropped connection mid-download, etc.) used to kill
// the process outright, taking the window with it before anything could be
// read. Route every one of them through the same keep-the-window-open path.
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "deadbolt-setup" } }, res => {
            res.on("error", reject);
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                resolve(fetchJson(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`GET ${url} failed: ${res.statusCode}`));
                return;
            }
            let data = "";
            res.on("data", chunk => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on("error", reject);
    });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const request = res => {
            res.on("error", reject);
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                https.get(res.headers.location, { headers: { "User-Agent": "deadbolt-setup" } }, request).on("error", reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`GET ${url} failed: ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve()));
            file.on("error", reject);
        };
        https.get(url, { headers: { "User-Agent": "deadbolt-setup" } }, request).on("error", reject);
    });
}

async function main() {
    log("=== Deadbolt Setup ===");
    log("");

    fs.mkdirSync(INSTALL_DIR, { recursive: true });

    log("Checking latest Deadbolt release...");
    const release = await fetchJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const asset = (release.assets || []).find(a => a.name === "deadbolt-dist.zip");
    if (!asset) {
        throw new Error("Could not find deadbolt-dist.zip in the latest release. Has one been published?");
    }

    log(`Downloading Deadbolt ${release.tag_name}...`);
    await downloadFile(asset.browser_download_url, ZIP_PATH);

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

    if (!fs.existsSync(EQUILOTL_PATH)) {
        log("Downloading the Discord patcher (Equilotl, from Equicord)...");
        await downloadFile(EQUILOTL_URL, EQUILOTL_PATH);
    } else {
        log("Discord patcher already downloaded.");
    }

    log("");
    log("Launching installer - pick your Discord install (Stable/PTB/Canary) when prompted.");
    log("Make sure Discord is fully closed (check your system tray) before continuing.");
    log("");

    // EQUICORD_DEV_INSTALL=1 is what tells Equilotl to patch Discord to load
    // the build in EQUICORD_DIRECTORY (Deadbolt) instead of downloading and
    // installing stock Equicord's own desktop.asar over it.
    const result = spawnSync(EQUILOTL_PATH, ["--install"], {
        stdio: "inherit",
        env: {
            ...process.env,
            EQUICORD_USER_DATA_DIR: INSTALL_DIR,
            EQUICORD_DIRECTORY: DIST_DIR,
            EQUICORD_DEV_INSTALL: "1"
        }
    });

    log("");
    if (result.status === 0) {
        log("Done! Relaunch Discord to see Deadbolt.");
    } else {
        log("Something went wrong during install. Scroll up for details.");
    }
    waitAndExit(result.status ?? 1);
}

main().catch(fail);
