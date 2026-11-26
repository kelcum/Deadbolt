/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clampTime, mediaType } from "../src/deadboltplugins/MediaPlayerPlus/media.ts";
import { activeRules, shouldSilence } from "../src/deadboltplugins/NotificationControl/rules.ts";
import { resolveProfile, selectable } from "../src/deadboltplugins/PluginProfiles/profiles.ts";
import { boundedSize, normalizeBox } from "../src/deadboltplugins/UploadEditor/image.ts";
import { checkpointStatus, createCheckpoint, isUpdateInProgress, restoreCheckpoint, withUpdateCheckpoint } from "../src/main/updater/checkpoint.ts";

const files = ["patcher.js", "preload.js", "renderer.js", "renderer.css"];
function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "deadbolt-checkpoint-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, "desktop");
    mkdirSync(dir);
    for (const file of files) writeFileSync(join(dir, file), `original ${file}`);
    return { root, dir };
}

test("notification rules respect account, scope, expiration and own messages", () => {
    const owner = "111111111111111111", user = "222222222222222222", channel = "333333333333333333", server = "444444444444444444";
    const rules = [{ scope: "user", id: user, owner, expires: 0 }, { scope: "channel", id: channel, owner, expires: 1000 }, { scope: "server", id: server, owner, expires: 3000 }];
    assert.equal(shouldSilence(rules, owner, { user }, 2000), true);
    assert.equal(shouldSilence(rules, owner, { channel }, 2000), false);
    assert.equal(shouldSilence(rules, owner, { server }, 2000), true);
    assert.equal(shouldSilence(rules, owner, { user: owner, server }, 2000), false);
    assert.equal(shouldSilence(rules, user, { server }, 2000), false);
    assert.equal(activeRules([null, { scope: "bogus", id: user, owner, expires: 0 }], 0).length, 0);
});

test("plugin profiles close dependency graphs, including cycles and missing dependencies", () => {
    const plugins = [{ name: "A", dependencies: ["B"] }, { name: "B", dependencies: ["A", "missing"] }, { name: "core", required: true, dependencies: ["API"] }, { name: "API", hidden: true }];
    const result = resolveProfile(plugins, ["A", "uninstalled"]);
    assert.deepEqual([...result.enabled].sort(), ["A", "API", "B"]);
    assert.deepEqual(result.missing.sort(), ["missing", "uninstalled"]);
    assert.equal(selectable(plugins[2]), false);
    assert.equal(selectable({ name: "SafeMode" }), false);
});

test("image dimensions and crop bounds stay valid", () => {
    assert.deepEqual(boundedSize(640, 480), { width: 640, height: 480 });
    const size = boundedSize(10000, 8000);
    assert.ok(size.width <= 4096 && size.height <= 4096 && size.width * size.height <= 8_000_000);
    assert.deepEqual(normalizeBox({ x: 200, y: 200 }, { x: -5, y: 20 }, 100, 100), { x: 0, y: 20, w: 100, h: 80 });
    assert.throws(() => boundedSize(0, 10), /Invalid/);
});

test("media classification and seek clamping", () => {
    assert.equal(mediaType("clip.MP4"), "video");
    assert.equal(mediaType("voice", "audio/ogg"), "audio");
    assert.equal(mediaType("script.lua"), null);
    assert.equal(clampTime(-3, 10), 0);
    assert.equal(clampTime(20, 10), 10);
    assert.equal(clampTime(NaN, 10), 0);
});

test("checkpoint restores complete build and removes only managed optional files", t => {
    const { dir, root } = fixture(t);
    const info = createCheckpoint(dir);
    assert.equal(info.files, 4);
    assert.ok(existsSync(join(root, ".deadbolt-previous-build-desktop", "manifest.json")));
    for (const file of files) writeFileSync(join(dir, file), "updated");
    writeFileSync(join(dir, "release.json"), "new release state");
    writeFileSync(join(dir, "user-data.txt"), "untouched");
    restoreCheckpoint(dir);
    for (const file of files) assert.equal(readFileSync(join(dir, file), "utf8"), `original ${file}`);
    assert.equal(existsSync(join(dir, "release.json")), false);
    assert.equal(readFileSync(join(dir, "user-data.txt"), "utf8"), "untouched");
    assert.equal(checkpointStatus(dir).created, info.created);
});

test("corrupted checkpoint is refused without modifying current files", t => {
    const { dir, root } = fixture(t);
    createCheckpoint(dir);
    writeFileSync(join(root, ".deadbolt-previous-build-desktop", "renderer.js"), "corrupt");
    writeFileSync(join(dir, "renderer.js"), "current");
    assert.throws(() => restoreCheckpoint(dir), /validation failed/);
    assert.equal(readFileSync(join(dir, "renderer.js"), "utf8"), "current");
});

test("failed update restores previous build, even if one required file vanished", async t => {
    const { dir } = fixture(t);
    await assert.rejects(withUpdateCheckpoint(dir, async () => {
        assert.equal(isUpdateInProgress(), true);
        writeFileSync(join(dir, "renderer.js"), "partial update");
        rmSync(join(dir, "patcher.js"));
        throw new Error("simulated failure");
    }), /simulated failure/);
    assert.equal(isUpdateInProgress(), false);
    for (const file of files) assert.equal(readFileSync(join(dir, file), "utf8"), `original ${file}`);
});

test("failed checkpoint leaves existing backup intact and prevents update", async t => {
    const { dir } = fixture(t);
    createCheckpoint(dir);
    const before = checkpointStatus(dir);
    rmSync(join(dir, "renderer.js"));
    let called = false;
    await assert.rejects(withUpdateCheckpoint(dir, async () => { called = true; return true; }), /Missing build file/);
    assert.equal(called, false);
    assert.equal(checkpointStatus(dir).created, before.created);
});

test("successful update keeps exactly one previous snapshot", async t => {
    const { dir } = fixture(t);
    await withUpdateCheckpoint(dir, async () => { writeFileSync(join(dir, "renderer.js"), "second"); return true; });
    await withUpdateCheckpoint(dir, async () => { writeFileSync(join(dir, "renderer.js"), "third"); return true; });
    restoreCheckpoint(dir);
    assert.equal(readFileSync(join(dir, "renderer.js"), "utf8"), "second");
});
