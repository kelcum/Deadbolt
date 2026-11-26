/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ProfilePlugin { name: string; required?: boolean; hidden?: boolean; dependencies?: string[]; }
export const protectedNames = new Set(["PluginProfiles", "SafeMode", "UpdateRollback", "DeadboltDoctor", "CrashHandler"]);
export function selectable(plugin: ProfilePlugin) { return !plugin.required && !plugin.hidden && !protectedNames.has(plugin.name); }
export function resolveProfile(plugins: ProfilePlugin[], enabled: string[]) {
    const known = new Map(plugins.map(p => [p.name, p]));
    const requested = new Set(enabled.filter(n => known.has(n)));
    const missing = enabled.filter(n => !known.has(n));
    const queue = [...requested];
    for (const p of plugins) if (p.required) queue.push(p.name);
    const seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        if (seen.has(name)) continue;
        seen.add(name);
        for (const dep of known.get(name)?.dependencies ?? []) {
            if (!known.has(dep)) { if (!missing.includes(dep)) missing.push(dep); continue; }
            requested.add(dep);
            queue.push(dep);
        }
    }
    return { enabled: requested, missing };
}
