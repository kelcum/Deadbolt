/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { unzipSync } from "fflate";
import { readFileSync, renameSync, rmSync, writeFileSync } from "original-fs";
import { join } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { UpdateData, Updater } from ".";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
const DIST_ASSET = "deadbolt-dist.zip";
const DIST_FILES = ["package.json", "patcher.js", "preload.js", "renderer.css", "renderer.js"];
const STATE_FILE = join(__dirname, "release.json");

interface Build {
    id: number;
    url: string;
    hash: string | null;
}

let PendingUpdate: Build | null = null;

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

function installedAssetId(): number | null {
    try {
        return JSON.parse(readFileSync(STATE_FILE, "utf-8")).assetId ?? null;
    } catch {
        return null;
    }
}

async function latestBuild(): Promise<Build> {
    const release = await githubGet("/releases/latest");
    const asset = release.assets?.find((a: any) => a.name === DIST_ASSET);
    if (!asset) throw new Error(`The latest release has no ${DIST_ASSET}`);

    return {
        id: asset.id,
        url: asset.url,
        hash: asset.label?.match(/\b[0-9a-f]{40}\b/)?.[0] ?? null
    };
}

async function changesSince(build: Build): Promise<UpdateData[]> {
    if (build.hash) {
        if (build.hash === gitHash) return [];
        try {
            const data = await githubGet(`/compare/${gitHash}...${build.hash}`);
            if (data.status === "behind" || data.status === "identical") return [];
            if (data.commits?.length) {
                return data.commits.map((c: any) => ({
                    hash: c.sha,
                    author: c.author?.login ?? c.commit?.author?.name ?? "Unknown Author",
                    message: c.commit.message.split("\n")[0]
                }));
            }
        } catch { }
    } else if (installedAssetId() === build.id) {
        return [];
    }

    return [{
        hash: build.hash ?? String(build.id),
        author: "Deadbolt",
        message: "A new Deadbolt build is ready"
    }];
}

async function listUpdates() {
    const build = await latestBuild();
    const changes = await changesSince(build);
    PendingUpdate = changes.length ? build : null;
    return changes;
}

async function fetchUpdate() {
    if (!PendingUpdate) await listUpdates();
    return PendingUpdate !== null;
}

async function applyUpdate() {
    if (!PendingUpdate) return true;

    const zip = await fetchBuffer(PendingUpdate.url, {
        headers: {
            Accept: "application/octet-stream",
            "User-Agent": VENCORD_USER_AGENT
        }
    });

    const files = unzipSync(zip);
    const missing = DIST_FILES.filter(f => !files[f]);
    if (missing.length) throw new Error(`The downloaded build is missing ${missing.join(", ")}`);

    try {
        for (const f of DIST_FILES) writeFileSync(join(__dirname, `${f}.new`), files[f], { flush: true });
        for (const f of DIST_FILES) renameSync(join(__dirname, `${f}.new`), join(__dirname, f));
    } finally {
        for (const f of DIST_FILES) rmSync(join(__dirname, `${f}.new`), { force: true });
    }

    writeFileSync(STATE_FILE, JSON.stringify({ assetId: PendingUpdate.id, hash: PendingUpdate.hash }));
    PendingUpdate = null;

    return true;
}

const ReleaseUpdater: Updater = {
    getRepo: async () => `https://github.com/${gitRemote}`,
    listUpdates,
    fetchUpdate,
    applyUpdate
};

export default ReleaseUpdater;
