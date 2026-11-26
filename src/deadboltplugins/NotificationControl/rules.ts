/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Scope = "user" | "channel" | "server";
export interface Rule { scope: Scope; id: string; owner: string; expires: number; }
export const validId = (value: unknown): value is string => typeof value === "string" && /^\d{17,20}$/.test(value);
export function activeRules(rules: Rule[], now: number) {
    return (Array.isArray(rules) ? rules : []).slice(0, 200).filter(r => r && validId(r.id) && validId(r.owner) && (r.scope === "user" || r.scope === "channel" || r.scope === "server") && (r.expires === 0 || Number.isFinite(r.expires) && r.expires > now));
}
export function shouldSilence(rules: Rule[], owner: string, event: { user?: string; channel?: string; server?: string; }, now: number) {
    if (!validId(owner) || event.user === owner) return false;
    return activeRules(rules, now).some(r => r.owner === owner && r.id === event[r.scope]);
}
