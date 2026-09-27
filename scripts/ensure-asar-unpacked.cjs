/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Discord's own updater sometimes ships resources/app.asar as a genuine
 * packed archive (rather than the unpacked directory reapply-branding.ps1
 * expects to just write index.js into directly). This unpacks it in place
 * - same path, now a real directory - so the stub write that follows
 * always has somewhere to land, regardless of which form Discord shipped
 * this time.
 *
 * Usage: node ensure-asar-unpacked.cjs <path to resources/app.asar>
 */

const { extractAll } = require("@electron/asar");
const fs = require("fs");

const asarPath = process.argv[2];

if (!asarPath) {
    console.error("Usage: node ensure-asar-unpacked.cjs <path to app.asar>");
    process.exit(1);
}

if (!fs.existsSync(asarPath)) {
    console.log("SKIP: does not exist");
    process.exit(0);
}

if (fs.statSync(asarPath).isDirectory()) {
    console.log("OK: already unpacked");
    process.exit(0);
}

const tmpDir = asarPath + ".unpacked-tmp";
try {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    extractAll(asarPath, tmpDir);
    fs.rmSync(asarPath, { force: true });
    fs.renameSync(tmpDir, asarPath);
    console.log("OK: unpacked " + asarPath);
} catch (e) {
    console.error("FAILED to unpack " + asarPath + ": " + e.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    process.exit(1);
}
