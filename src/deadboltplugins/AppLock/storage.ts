/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { type Credential, parseCredential, STORAGE_KEY } from "./password";

// Keep the verifier outside the normal settings and DataStore backups.
let store: DataStore.UseStore | undefined;

function localStore() {
    return store ??= DataStore.createStore("DeadboltAppLock", "Credentials");
}

export async function readCredential(): Promise<Credential | null> {
    const saved = await DataStore.get<string | null>(STORAGE_KEY, localStore());
    if (saved !== undefined) return parseCredential(saved);

    let legacy: Credential | null = null;
    try {
        legacy = parseCredential(globalThis.localStorage.getItem(STORAGE_KEY));
    } catch {
        // Discord may make its localStorage accessor unavailable.
    }
    if (legacy) await writeCredential(legacy);
    return legacy;
}

export async function writeCredential(credential: Credential | null) {
    // A null marker prevents a removed legacy password being restored.
    await DataStore.set(STORAGE_KEY, credential ? JSON.stringify(credential) : null, localStore());
}
