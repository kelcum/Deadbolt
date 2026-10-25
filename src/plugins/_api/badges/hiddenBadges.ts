/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { UserStore } from "@webpack/common";

import team from "./team.json";

const PREFS_URL = "https://api.xan.gripe/v1/badges/prefs";
const CACHE_KEY = "Deadbolt_BadgePrefs";
const TEST_KEY = "Deadbolt_BadgeTestMode";

export const BADGE_OWNERS = team.find(b => b.key === "deadbolt_creator")?.users ?? [];

const logger = new Logger("HiddenBadges");

let hidden = new Map<string, Set<string>>();
let fetched = false;
let testMode = false;

DataStore.get<boolean>(TEST_KEY).then(v => testMode = !!v).catch(() => { });

export const isBadgeHidden = (userId: string, badgeId: string) => hidden.get(userId)?.has(badgeId) ?? false;

export const hiddenBadgesOf = (userId: string) => [...hidden.get(userId) ?? []];

export const isTestMode = () => testMode;

export function setTestMode(on: boolean) {
    testMode = on;
    DataStore.set(TEST_KEY, on).catch(() => { });
}

export function holdsEveryBadge(userId: string) {
    return testMode && BADGE_OWNERS.includes(userId) && UserStore.getCurrentUser()?.id === userId;
}

function apply(prefs: Record<string, { hidden: string[]; }>) {
    hidden = new Map(Object.entries(prefs).map(([user, p]) => [user, new Set(p.hidden)]));
    fetched = true;
    DataStore.set(CACHE_KEY, prefs).catch(() => { });
}

export async function loadHiddenBadges() {
    if (!fetched) {
        const cached = await DataStore.get<Record<string, { hidden: string[]; }>>(CACHE_KEY).catch(() => undefined);
        if (cached && !fetched) hidden = new Map(Object.entries(cached).map(([user, p]) => [user, new Set(p.hidden)]));
    }
    try {
        const res = await fetch(PREFS_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status}`);
        apply((await res.json()).prefs ?? {});
    } catch (e) {
        logger.warn("Couldn't load hidden badges, using the saved list", e);
    }
}

export async function saveHiddenBadges(userId: string, badgeIds: string[]) {
    const res = await fetch(PREFS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, hidden: badgeIds })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    apply(data.prefs ?? {});
}
