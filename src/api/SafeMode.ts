/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotice } from "@api/Notices";
import { relaunch } from "@utils/native";
import { wreq } from "@webpack";
import { getFactoryPatchedBy } from "@webpack/patcher";

export const SAFE_MODE_CORE = new Set(["DeadboltDoctor", "CrashHandler"]);

export const safeMode = IS_WEB || IS_REPORTER ? null : VencordNative.safeMode.boot();

const blamed = new Set<string>();
let crashed = false;

function blame(text: string) {
    if (!wreq) return;
    for (const [, id] of text.matchAll(/WebpackModule(\d+)/g)) {
        for (const plugin of getFactoryPatchedBy(id) ?? []) {
            if (blamed.has(plugin)) continue;
            blamed.add(plugin);
            VencordNative.safeMode.note(plugin);
        }
    }
}

function onError(e: ErrorEvent) {
    blame(`${e.filename}\n${e.error?.stack}`);
}

function onRejection(e: PromiseRejectionEvent) {
    blame(String(e.reason?.stack ?? e.reason));
}

if (safeMode) {
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
}

export function noteCrash(state?: { error?: Error; info?: { componentStack?: string; }; }) {
    if (!safeMode) return;
    crashed = true;
    blame(`${state?.error?.stack}\n${state?.info?.componentStack}`);
}

export async function leaveSafeMode() {
    await VencordNative.safeMode.exit();
    relaunch();
}

export function safeModeReason() {
    const why = "Discord didn't start properly twice in a row, so Deadbolt only loaded its core plugins.";
    return safeMode?.suspect ? `${why} ${safeMode.suspect} looks like the cause.` : `${why} It couldn't tell which plugin caused it.`;
}

export function initSafeMode() {
    if (!safeMode) return;

    setTimeout(() => {
        removeEventListener("error", onError);
        removeEventListener("unhandledrejection", onRejection);
        if (!crashed) VencordNative.safeMode.ready();
        if (safeMode.active) showNotice(`Safe mode: ${safeModeReason()}`, "Turn everything back on", leaveSafeMode);
    }, 15_000);
}
