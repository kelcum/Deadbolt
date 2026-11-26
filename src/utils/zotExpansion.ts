/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function safeFilename(value: string) {
    const clean = value.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_").trim().slice(0, 180).replace(/[. ]+$/g, "");
    return !clean || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `file-${clean.slice(0, 175).replace(/[. ]+$/g, "") || "attachment"}` : clean;
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
    const result = [...items];
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
}

export function hexColor(value: string, fallback: string) {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number, fallback = min) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function markdownFormat(text: string, kind: string) {
    switch (kind) {
        case "bold": return `**${text}**`;
        case "italic": return `*${text}*`;
        case "underline": return `__${text}__`;
        case "strike": return `~~${text}~~`;
        case "spoiler": return `||${text}||`;
        case "quote": return text.split("\n").map(line => `> ${line}`).join("\n");
        case "list": return text.split("\n").map(line => `- ${line}`).join("\n");
        case "code": {
            const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
            return `${fence}\n${text}\n${fence}`;
        }
        default: return text;
    }
}

export interface MarkdownPart { kind: string; text: string; }
export function markdownPreview(value: string): MarkdownPart[] {
    const out: MarkdownPart[] = [];
    const bounded = value.slice(0, 20_000);
    const inline = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\|\|([^|\n]+)\|\||\*([^*\n]+)\*/g;
    const kinds = ["bold", "underline", "strike", "spoiler", "italic"];
    const lines = bounded.split("\n");
    let fence = "";
    let code = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const end = i < lines.length - 1 ? "\n" : "";
        if (out.length > 1000) { out.push({ kind: "plain", text: (fence ? fence + "\n" + code : "") + lines.slice(i).join("\n") }); break; }
        if (fence) {
            if (line.trim() === fence) { out.push({ kind: "code", text: code }); fence = ""; code = ""; }
            else code += line + end;
            continue;
        }
        const opener = /^(`{3,64})(?:[a-zA-Z0-9_+-]+)?\s*$/.exec(line);
        if (opener) { fence = opener[1]; code = ""; continue; }
        let last = 0;
        for (const match of line.matchAll(inline)) {
            const index = match.index ?? 0;
            if (index > last) out.push({ kind: "plain", text: line.slice(last, index) });
            const n = match.slice(1).findIndex(x => x !== undefined);
            out.push({ kind: kinds[n] ?? "plain", text: match[n + 1] ?? match[0] });
            last = index + match[0].length;
            if (out.length > 1000) break;
        }
        if (last < line.length || end) out.push({ kind: "plain", text: line.slice(last) + end });
    }
    if (fence) out.push({ kind: "plain", text: fence + "\n" + code });
    if (bounded.length < value.length) out.push({ kind: "plain", text: "\n[Preview limited to 20,000 characters]" });
    return out;
}

export function contrastRatio(foreground: string, background: string) {
    const luminance = (hex: string) => {
        const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
