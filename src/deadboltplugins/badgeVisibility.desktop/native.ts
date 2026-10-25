/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { IpcMainInvokeEvent } from "electron";
import { readFile } from "fs/promises";
import { join } from "path";

const KEY_FILE = join(DATA_DIR, "badge-owner.key");
const HIDDEN_URL = "https://api.xan.gripe/v1/badges/hidden";

async function ownerKey() {
    try {
        return (await readFile(KEY_FILE, "utf-8")).trim() || null;
    } catch {
        return null;
    }
}

export async function canToggle(_: IpcMainInvokeEvent) {
    return !!await ownerKey();
}

export async function setHidden(_: IpcMainInvokeEvent, hidden: boolean): Promise<string[]> {
    const key = await ownerKey();
    if (!key) throw new Error("This computer doesn't have the badge owner key.");

    const res = await fetch(HIDDEN_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ hidden })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.users ?? [];
}
