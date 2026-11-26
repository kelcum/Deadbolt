/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const MAX_BYTES = 64 * 1024 * 1024;
export const PAGE_CHARS = 48_000;
export const PAGE_LINES = 400;
const extensions = /\.(?:txt|text|log|lua|luau|js|mjs|cjs|jsx|ts|tsx|json|jsonc|jsonl|ndjson|py|pyw|rb|rs|go|java|kt|kts|c|h|cc|cpp|hpp|cs|swift|sh|bash|zsh|fish|ps1|bat|cmd|md|markdown|rst|html?|css|scss|sass|less|xml|svg|ya?ml|toml|ini|cfg|conf|properties|csv|tsv|sql|graphql|gql|php|pl|r|asm|s|diff|patch|tex|v|sv|vb|vue|svelte|rbxlx|rbxmx|env|gitignore|gitattributes|dockerfile)$/i;

export function isTextFile(filename: string, mime?: string) {
    return extensions.test(filename) || /^(?:dockerfile|makefile|license|readme|\.gitignore|\.env)$/i.test(filename) || /^text\//i.test(mime ?? "");
}

export function attachmentUrl(value: string): URL | null {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
        if (url.hostname !== "cdn.discordapp.com" && url.hostname !== "media.discordapp.net") return null;
        if (!/^\/attachments\/\d+\/\d+\/[^/]+$/.test(url.pathname)) return null;
        const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        if (!name || /[\\/\x00-\x1f]/.test(name) || name === "." || name === "..") return null;
        return url;
    } catch {
        return null;
    }
}

export async function readResponse(response: Response): Promise<ArrayBuffer> {
    if (!response.ok) throw new Error(`Could not open attachment (HTTP ${response.status}). It may have expired.`);
    if (response.status === 206 || response.headers.has("content-range")) {
        await response.body?.cancel();
        throw new Error("Discord returned only part of the file. Try downloading the original attachment.");
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error("This file exceeds the 64 MiB preview limit.");
    }
    if (!response.body) return new ArrayBuffer(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BYTES) {
                await reader.cancel();
                throw new Error("This file exceeds the 64 MiB preview limit.");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}

export function decodeText(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let encoding = "UTF-8";
    let text: string;
    if (bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 254 && bytes[1] === 255) {
        encoding = bytes[0] === 255 ? "UTF-16LE" : "UTF-16BE";
        text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } else {
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
            encoding = "Windows-1252";
            text = new TextDecoder("windows-1252").decode(buffer);
        }
    }
    if (text.includes("\0")) throw new Error("This attachment appears to contain binary data, not text.");
    return { text, encoding };
}

export interface Page {
    start: number;
    end: number;
    firstLine: number;
    lastLine: number;
}

export function indexText(text: string) {
    const pages: Page[] = [];
    let start = 0;
    let line = 1;
    while (start < text.length) {
        let end = Math.min(start + PAGE_CHARS, text.length);
        // Keep surrogate pairs and CRLF together at section boundaries.
        if (end < text.length && (/^[\uDC00-\uDFFF]$/.test(text[end]) || text[end - 1] === "\r" && text[end] === "\n")) end--;
        let nextLine = line;
        for (let cursor = start; cursor < end; cursor++) {
            if (text.charCodeAt(cursor) !== 10) continue;
            nextLine++;
            if (nextLine - line >= PAGE_LINES) {
                end = cursor + 1;
                break;
            }
        }
        const endsLine = text[end - 1] === "\n";
        pages.push({ start, end, firstLine: line, lastLine: nextLine - (endsLine && end < text.length ? 1 : 0) });
        line = nextLine;
        start = end;
    }
    if (!pages.length) pages.push({ start: 0, end: 0, firstLine: 1, lastLine: 1 });
    return { pages, lineCount: line };
}

export function pageForOffset(pages: Page[], offset: number) {
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (pages[mid].end <= offset) low = mid + 1;
        else high = mid;
    }
    return low;
}

export function pageForLine(pages: Page[], line: number) {
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (pages[mid].lastLine < line) low = mid + 1;
        else high = mid;
    }
    return low;
}

export function findMatch(text: string, query: string, current: number, backwards: boolean) {
    if (!query) return -1;
    if (backwards) {
        const previous = current > 0 ? text.lastIndexOf(query, current - 1) : -1;
        return previous < 0 ? text.lastIndexOf(query) : previous;
    }
    const next = text.indexOf(query, Math.max(0, current + 1));
    return next < 0 ? text.indexOf(query) : next;
}
