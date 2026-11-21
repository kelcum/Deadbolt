/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = ["plugins/_api", "plugins/_core", "plugins", "equicordplugins/_api", "equicordplugins/_core", "equicordplugins", "deadboltplugins"];
const names = new Set();

for (const dir of dirs) {
    for (const entry of readdirSync(join("src", dir), { withFileTypes: true })) {
        const path = join("src", dir, entry.name);
        const files = entry.isDirectory() ? ["index.ts", "index.tsx"].map(f => join(path, f)) : /\.tsx?$/.test(entry.name) ? [path] : [];
        for (const file of files.filter(f => existsSync(f))) {
            const name = readFileSync(file, "utf8").match(/definePlugin\(\{[^]*?\bname:\s*["']([^"']+)["']/)?.[1];
            if (name) names.add(name);
        }
    }
}

writeFileSync(process.argv[2], JSON.stringify([...names].sort()));
console.log(`${names.size} plugin names`);
