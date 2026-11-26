/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function boundedSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("Invalid image dimensions.");
    const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function normalizeBox(a: { x: number; y: number; }, b: { x: number; y: number; }, width: number, height: number) {
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
    const x = clamp(Math.min(a.x, b.x), width);
    const y = clamp(Math.min(a.y, b.y), height);
    return { x, y, w: clamp(Math.max(a.x, b.x), width) - x, h: clamp(Math.max(a.y, b.y), height) - y };
}
