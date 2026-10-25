/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

const HIDDEN_URL = "https://api.xan.gripe/v1/badges/hidden";
const CACHE_KEY = "Deadbolt_HiddenBadgeUsers";

const logger = new Logger("HiddenBadges");

let hidden = new Set<string>();
let fetched = false;

export const isBadgeHidden = (userId: string) => hidden.has(userId);

export function setHiddenBadgeUsers(users: string[]) {
    hidden = new Set(users.map(String));
    fetched = true;
    DataStore.set(CACHE_KEY, [...hidden]).catch(() => { });
}

export async function loadHiddenBadges() {
    if (!fetched) {
        const cached = await DataStore.get<string[]>(CACHE_KEY).catch(() => undefined);
        if (cached && !fetched) hidden = new Set(cached);
    }
    try {
        const res = await fetch(HIDDEN_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status}`);
        setHiddenBadgeUsers((await res.json()).users ?? []);
    } catch (e) {
        logger.warn("Couldn't load hidden badges, using the saved list", e);
    }
}
