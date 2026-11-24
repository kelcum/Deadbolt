/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Credential {
    version: 1;
    salt: string;
    hash: string;
}

export const STORAGE_KEY = "deadbolt:app-lock:v1";
const ITERATIONS = 600_000;

function hex(bytes: Uint8Array) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string) {
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

export function parseCredential(value: string | null): Credential | null {
    if (!value) return null;
    try {
        const record = JSON.parse(value);
        if (record?.version !== 1 || typeof record.salt !== "string" || !/^[0-9a-f]{32}$/.test(record.salt)
            || typeof record.hash !== "string" || !/^[0-9a-f]{64}$/.test(record.hash)) return null;
        return { version: 1, salt: record.salt, hash: record.hash };
    } catch {
        return null;
    }
}

async function derive(password: string, salt: string) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations: ITERATIONS }, key, 256);
    return hex(new Uint8Array(bits));
}

export async function createCredential(password: string): Promise<Credential> {
    if (password.length < 8 || password.length > 128) throw new Error("Use 8 to 128 characters.");
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { version: 1, salt, hash: await derive(password, salt) };
}

export async function verifyPassword(password: string, record: Credential) {
    if (!password || password.length > 128) return false;
    const candidate = await derive(password, record.salt);
    let difference = 0;
    for (let i = 0; i < record.hash.length; i++) difference |= candidate.charCodeAt(i) ^ record.hash.charCodeAt(i);
    return difference === 0;
}
