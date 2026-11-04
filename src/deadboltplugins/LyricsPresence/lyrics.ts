/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LyricLine {
    time: number;
    text: string;
}

export interface Song {
    title: string;
    artist: string;
    album?: string;
}

export interface LyricsQuery extends Song {
    durationSeconds?: number;
}

interface LrcLibTrack {
    artistName: string;
    duration: number | null;
    syncedLyrics: string | null;
}

const API_BASE = "https://lrclib.net/api";
const REQUEST_TIMEOUT_MS = 10_000;
const TIMESTAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
const INSTRUMENTAL_LINE = "♪";
const MAX_DURATION_DRIFT_SECONDS = 5;
const MIN_FIELD_LENGTH = 2;
const MAX_FIELD_LENGTH = 128;

export function parseLrc(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];

    for (const raw of lrc.split(/\r?\n/)) {
        const stamps = [...raw.matchAll(TIMESTAMP)];
        if (!stamps.length) continue;

        const text = raw.replace(TIMESTAMP, "").trim() || INSTRUMENTAL_LINE;
        for (const [, minutes, seconds] of stamps) {
            lines.push({ time: Math.round((Number(minutes) * 60 + Number(seconds)) * 1000), text });
        }
    }

    return lines.sort((a, b) => a.time - b.time);
}

export function lineIndexAt(lines: LyricLine[], positionMs: number) {
    return lines.findLastIndex(line => line.time <= positionMs);
}

export function primaryArtist(artist: string) {
    return artist.split(/[,;] | (?:&|x|\/|feat\.?|ft\.?) /i)[0].trim() || artist;
}

export function stripExtras(title: string) {
    return title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "").trim() || title;
}

function fitField(text: string) {
    return text.slice(0, MAX_FIELD_LENGTH).padEnd(MIN_FIELD_LENGTH, "⠀");
}

export function lyricFields({ title, artist, album }: Song, lines: LyricLine[], index: number) {
    const current = lines[index]?.text;
    const next = lines[index + 1]?.text;

    return {
        details: fitField(current ?? title),
        state: fitField(next ?? (current ? title : artist)),
        largeText: fitField(album ? `${artist} - ${album}` : artist)
    };
}

async function getJson<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T | null> {
    const response = await fetch(`${API_BASE}/${path}?${new URLSearchParams(params)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB responded with ${response.status}`);

    return response.json();
}

const comparable = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function isMatch(result: LrcLibTrack, artist: string, durationSeconds?: number) {
    if (!result.syncedLyrics) return false;
    if (durationSeconds != null) return Math.abs((result.duration ?? Infinity) - durationSeconds) <= MAX_DURATION_DRIFT_SECONDS;

    const found = comparable(result.artistName);
    const wanted = comparable(artist);
    return found.includes(wanted) || wanted.includes(found);
}

export async function fetchLyrics({ title, artist, album, durationSeconds }: LyricsQuery, signal: AbortSignal): Promise<LyricLine[]> {
    if (album && durationSeconds != null) {
        const exact = await getJson<LrcLibTrack>("get", {
            track_name: title,
            artist_name: artist,
            album_name: album,
            duration: String(Math.round(durationSeconds))
        }, signal);
        if (exact?.syncedLyrics) return parseLrc(exact.syncedLyrics);
    }

    for (const artistName of new Set([artist, primaryArtist(artist)])) {
        for (const trackName of new Set([title, stripExtras(title)])) {
            const results = await getJson<LrcLibTrack[]>("search", { track_name: trackName, artist_name: artistName }, signal);
            const match = results?.find(result => isMatch(result, artistName, durationSeconds));
            if (match?.syncedLyrics) return parseLrc(match.syncedLyrics);
        }
    }

    return [];
}
