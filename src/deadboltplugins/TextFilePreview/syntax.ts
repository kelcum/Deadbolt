/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Language = "plain" | "lua" | "javascript" | "python" | "json" | "shell" | "c" | "markup";
const mapping: Record<string, Language> = { lua: "lua", luau: "lua", js: "javascript", jsx: "javascript", ts: "javascript", tsx: "javascript", mjs: "javascript", cjs: "javascript", py: "python", json: "json", jsonc: "json", sh: "shell", bash: "shell", zsh: "shell", c: "c", cpp: "c", h: "c", hpp: "c", cs: "c", java: "c", rs: "c", go: "c", html: "markup", htm: "markup", xml: "markup", svg: "markup" };
export function detectLanguage(filename: string, sample: string): Language {
    const ext = filename.split(".").at(-1)?.toLowerCase() ?? "";
    if (Object.hasOwn(mapping, ext)) return mapping[ext];
    if (/\blocal\s+\w+\s*=|\bgame:GetService\(|\bfunction\s+\w+\([^)]*\)[\s\S]*\bend\b/.test(sample)) return "lua";
    if (/^\s*[[{]\s*"[^"\n]+"\s*:/.test(sample)) return "json";
    if (/\b(?:const|let)\s+\w+\s*=|\bimport\s+.*\bfrom\b/.test(sample)) return "javascript";
    if (/^\s*(?:def\s+\w+\(|from\s+\w+\s+import\s+)/m.test(sample)) return "python";
    if (/^#!.*(?:bash|sh)\b/.test(sample)) return "shell";
    if (/^\s*<\?xml\b|^\s*<!DOCTYPE\s+html/i.test(sample)) return "markup";
    return "plain";
}
const words: Record<Language, string> = {
    plain: "", lua: "local function end if then else elseif for in do while repeat until return break continue and or not nil true false type export", javascript: "const let var function return async await import export from if else for while new class extends throw try catch finally true false null undefined this typeof switch case break continue interface type", python: "def class return import from if elif else for while in is not and or True False None try except finally with as lambda pass yield async await raise", json: "true false null", shell: "if then else fi for do done case esac function export local return", c: "int void char bool float double public private class struct const static return if else for while switch case break continue true false null fn let mut use package func", markup: ""
};
export interface Token { text: string; kind: string; }
export function tokens(line: string, language: Language): Token[] {
    if (language === "plain" || line.length > 4000) return [{ text: line, kind: "plain" }];
    const keyword = new Set(words[language].split(" "));
    const prefix = language === "lua" ? "--" : language === "python" || language === "shell" ? "#" : language === "json" || language === "markup" ? "" : "//";
    const pattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|--|\/\/|#|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|[A-Za-z_$][\w$]*|[<>/=]+/g;
    const out: Token[] = [];
    function push(text: string, kind: string) {
        if (!text) return;
        const previous = out.at(-1);
        if (previous?.kind === kind) previous.text += text;
        else out.push({ text, kind });
    }
    let end = 0;
    for (const match of line.matchAll(pattern)) {
        const i = match.index ?? 0;
        const text = match[0];
        if (i > end) push(line.slice(end, i), "plain");
        if (prefix && text.startsWith(prefix)) { push(line.slice(i), "comment"); return out; }
        const kind = /^["'`]/.test(text) ? "string" : /^\d/.test(text) ? "number" : keyword.has(text) ? "keyword" : language === "markup" && /^[<>/=]/.test(text) ? "operator" : "plain";
        push(text, kind);
        end = i + text.length;
        if (out.length > 600) { push(line.slice(end), "plain"); return out; }
    }
    if (end < line.length) push(line.slice(end), "plain");
    return out;
}
export function foldEnd(rows: readonly string[], index: number) {
    if (!rows[index]?.trim()) return index;
    const width = (line: string) => (line.match(/^[\t ]*/)?.[0] ?? "").replace(/\t/g, "    ").length;
    const indent = width(rows[index]);
    let end = index;
    for (let i = index + 1; i < rows.length; i++) {
        if (!rows[i].trim()) continue;
        if (width(rows[i]) <= indent) break;
        end = i;
    }
    return end;
}
