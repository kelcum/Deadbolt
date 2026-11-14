/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const listeners = new Set<() => void>();
let version = 0;

export function notifyBadgesChanged() {
    version++;
    listeners.forEach(listener => listener());
}

export function subscribeBadgeChanges(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export const badgeChangesVersion = () => version;
