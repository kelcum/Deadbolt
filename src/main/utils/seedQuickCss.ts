/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

/**
 * Writes `css` to `path` only if nothing exists there yet.
 *
 * The "wx" flag makes the write fail if the file is already present (even
 * an empty one), so this can never overwrite someone's own QuickCSS - it only
 * ever fills in a brand-new install. Anything that goes wrong (the file
 * already existing, an unwritable folder) just means "don't seed" - not worth
 * failing startup over.
 *
 * @returns whether the file was created
 */
export function seedQuickCss(path: string, css: string): boolean {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, css, { flag: "wx" });
        return true;
    } catch {
        return false;
    }
}
