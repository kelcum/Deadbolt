"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = "kelcum/Deadbolt";
const EQUILOTL_URL = "https://github.com/Equicord/Equilotl/releases/latest/download/EquilotlCli.exe";
const INSTALL_DIR = path.join(os.homedir(), "AppData", "Local", "DeadboltInstall");
const DIST_DIR = path.join(INSTALL_DIR, "dist");
const ZIP_PATH = path.join(INSTALL_DIR, "deadbolt-dist.zip");
const EQUILOTL_PATH = path.join(INSTALL_DIR, "EquilotlCli.exe");

function log(msg) {
    console.log(msg);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "deadbolt-setup" } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(fetchJson(res.headers.location));
                return;
            }
            if (res.statusCode !== 200) {
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
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                https.get(res.headers.location, { headers: { "User-Agent": "deadbolt-setup" } }, request).on("error", reject);
                return;
            }
            if (res.statusCode !== 200) {
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

    const result = spawnSync(EQUILOTL_PATH, ["--install"], {
        stdio: "inherit",
        env: {
            ...process.env,
            EQUICORD_USER_DATA_DIR: INSTALL_DIR,
            EQUICORD_DIRECTORY: DIST_DIR
        }
    });

    log("");
    if (result.status === 0) {
        log("Done! Relaunch Discord to see Deadbolt.");
    } else {
        log("Something went wrong during install. Scroll up for details.");
    }
    log("Press Enter to close this window...");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(result.status ?? 1));
}

main().catch(err => {
    console.error("Setup failed:", err.message || err);
    console.log("Press Enter to close this window...");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
});
