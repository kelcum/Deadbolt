/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const speedValues = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export function mediaType(filename: string, mime?: string): "audio" | "video" | null {
    if (mime?.startsWith("video/") || /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(filename)) return "video";
    if (mime?.startsWith("audio/") || /\.(?:mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(filename)) return "audio";
    return null;
}
export function clampTime(time: number, duration: number) {
    return Number.isFinite(time) && Number.isFinite(duration) ? Math.max(0, Math.min(time, duration)) : 0;
}
