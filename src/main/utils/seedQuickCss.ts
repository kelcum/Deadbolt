/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

export function seedQuickCss(path: string, css: string): boolean {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, css, { flag: "wx" });
        return true;
    } catch {
        return false;
    }
}
