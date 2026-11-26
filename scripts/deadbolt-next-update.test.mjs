/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DOWNLOAD_LIMIT, saveResponse } from "../src/deadboltplugins/DownloadManager.desktop/download.ts";
import { archiveDirectory, isArchive } from "../src/deadboltplugins/FileExplorer/archive.ts";
import { detectLanguage, foldEnd, tokens } from "../src/deadboltplugins/TextFilePreview/syntax.ts";
import { clamp, contrastRatio, hexColor, markdownFormat, markdownPreview, moveItem, safeFilename } from "../src/utils/zotExpansion.ts";

test("code language detection includes Lua disguised as text", () => {
    assert.equal(detectLanguage("message.txt", 'local Players=game:GetService("Players")'), "lua");
    assert.equal(detectLanguage("main.luau", ""), "lua");
    assert.equal(detectLanguage("config.json", ""), "json");
    assert.equal(detectLanguage("main.tsx", ""), "javascript");
    assert.equal(detectLanguage("script.py", ""), "python");
    assert.equal(detectLanguage("note.txt", "An ordinary note"), "plain");
});
test("syntax tokens preserve every character and correctly identify Lua strings and comments", () => {
    const line = 'local value = "--not a comment \\"" + 42 -- comment';
    const result = tokens(line, "lua");
    assert.equal(result.map(t => t.text).join(""), line);
    assert.equal(result[0].kind, "keyword");
    assert.ok(result.some(t => t.kind === "number" && t.text === "42"));
    assert.ok(result.some(t => t.kind === "comment" && t.text === "-- comment"));
    assert.equal(result.filter(t => t.kind === "comment").length, 1);
});
test("syntax highlighting preserves arbitrary Unicode, tabs, CRLF, markup and minified lines", () => {
    for (const lang of ["plain", "lua", "javascript", "python", "json", "shell", "c", "markup"]) {
        for (const line of ["", "\t雪😀\r", '<script>alert("x")</script>', '"a\\\"b" 0xFF # comment', "foo ".repeat(10000), "x + 3 ".repeat(500), "\t\t ", "a/b//c", "-- [[a]]"]) {
            assert.equal(tokens(line, lang).map(t => t.text).join(""), line, `${lang}: token loss`);
        }
    }
});
test("indentation folding is bounded to the current section and skips blank-only groups", () => {
    assert.equal(foldEnd(["local x = {", "    a = 1", "    b = 2", "}", "print(x)"], 0), 2);
    assert.equal(foldEnd(["one", "", "two"], 0), 0);
    assert.equal(foldEnd(["function f()", "\tif x then", "\t\treturn 1", "\tend", "end"], 1), 2);
    assert.equal(foldEnd(["function f()", "\treturn 1"], 0), 1);
    assert.equal(foldEnd(["x"], 99), 99);
});
test("safe filenames exclude invalid Windows names, separators and control characters", () => {
    assert.equal(safeFilename("CON.txt"), "file-CON.txt");
    assert.equal(safeFilename("..").includes(".."), false);
    assert.equal(safeFilename("../a\\b\0:c?.txt"), ".._a_b__c_.txt");
    assert.equal(safeFilename("a.txt... "), "a.txt");
    assert.equal(safeFilename("x".repeat(200)).length, 180);
    assert.equal(safeFilename("x".repeat(179) + ".txt"), "x".repeat(179));
    assert.equal(safeFilename("CON." + "x".repeat(200)).length, 180);
});
test("upload order changes never mutate source arrays or accept bad indexes", () => {
    const original = Object.freeze(["a", "b", "c"]);
    assert.deepEqual(moveItem(original, 0, 2), ["b", "c", "a"]);
    assert.deepEqual(moveItem(original, 2, 0), ["c", "a", "b"]);
    assert.deepEqual(moveItem(original, -1, 2), original);
    assert.deepEqual(moveItem(original, 1, 1.5), original);
    assert.deepEqual(original, ["a", "b", "c"]);
});
test("Markdown formatting retains selected text and adapts code fences", () => {
    assert.equal(markdownFormat("a\nb", "quote"), "> a\n> b");
    assert.equal(markdownFormat("a\nb", "list"), "- a\n- b");
    assert.equal(markdownFormat("word", "bold"), "**word**");
    assert.equal(markdownFormat("word", "spoiler"), "||word||");
    assert.equal(markdownFormat("```lua\nprint(1)\n```", "code"), "````\n```lua\nprint(1)\n```\n````");
});
test("theme CSS values and voice gain inputs are validated", () => {
    assert.equal(hexColor("#f0Aa12", "#111111"), "#f0Aa12");
    assert.equal(hexColor("red; url(https://example.com)", "#111111"), "#111111");
    assert.equal(clamp(Infinity, 0, 200, 100), 100);
    assert.equal(clamp(-1, 0, 200), 0);
    assert.equal(clamp(500, 0, 200), 200);
});

function directory(names) {
    const encoder = new TextEncoder();
    const parts = names.map(name => {
        const text = encoder.encode(name); const bytes = new Uint8Array(46 + text.length); const view = new DataView(bytes.buffer);
        view.setUint32(0, 0x02014b50, true); view.setUint16(8, 0x800, true); view.setUint32(20, 4, true); view.setUint32(24, 10, true); view.setUint16(28, text.length, true); bytes.set(text, 46); return bytes;
    });
    const length = parts.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(length + 22); let offset = 0;
    for (const p of parts) { bytes.set(p, offset); offset += p.length; }
    const v = new DataView(bytes.buffer); v.setUint32(length, 0x06054b50, true); v.setUint16(length + 8, names.length, true); v.setUint16(length + 10, names.length, true); v.setUint32(length + 12, length, true);
    return bytes.buffer;
}
test("archive inspector parses directory names without inflating files", () => {
    const entries = archiveDirectory(directory(["src/", "src/main.lua", "雪.txt", "../../evil.exe", "<html>"]));
    assert.equal(entries.length, 5);
    assert.equal(entries[0].directory, true);
    assert.equal(entries[1].bytes, 10);
    assert.equal(entries[2].name, "雪.txt");
    assert.equal(entries[3].name, "../../evil.exe");
    assert.equal(entries[4].name, "<html>");
    assert.ok(isArchive("Workbook.XLSX"));
    assert.ok(isArchive("document.docx"));
    assert.equal(isArchive("video.mp4"), false);
});
test("archive inspector rejects corrupt directories, ZIP64 and multidisk files", () => {
    assert.throws(() => archiveDirectory(new ArrayBuffer(0)));
    assert.throws(() => archiveDirectory(new ArrayBuffer(64)));
    const zip = directory(["a"]); const v = new DataView(zip); v.setUint16(zip.byteLength - 22 + 4, 1, true);
    assert.throws(() => archiveDirectory(zip));
    const zip64 = directory(["a"]); new DataView(zip64).setUint32(zip64.byteLength - 22 + 16, 0xffffffff, true);
    assert.throws(() => archiveDirectory(zip64));
    const broken = directory(["a"]); new DataView(broken).setUint16(28, 9999, true);
    assert.throws(() => archiveDirectory(broken));
});
test("archive directory handles zero entries and rejects excessive counts", () => {
    assert.deepEqual(archiveDirectory(directory([])), []);
    const zip = directory([]); const v = new DataView(zip); v.setUint16(8, 10001, true); v.setUint16(10, 10001, true);
    assert.throws(() => archiveDirectory(zip));
});
async function inTemp(fn) {
    const dir = await mkdtemp(join(tmpdir(), "deadbolt-next-tests-"));
    try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const signal = () => new AbortController().signal;
test("download writes exact bytes, reports progress, and removes temporary file", async () => {
    await inTemp(async dir => {
        const target = join(dir, "attachment.bin");
        const data = Uint8Array.from([0, 1, 255, 42, 5]);
        const progress = [];
        await saveResponse(new Response(data), target, data.length, signal(), n => progress.push(n));
        assert.deepEqual([...await readFile(target)], [...data]);
        assert.equal(progress.at(-1), data.length);
        assert.deepEqual(await readdir(dir), ["attachment.bin"]);
    });
});
test("download never overwrites an existing file", async () => {
    await inTemp(async dir => {
        const target = join(dir, "keep.txt"); await writeFile(target, "keep this");
        await assert.rejects(saveResponse(new Response("new"), target, 3, signal(), () => {}), { code: "EEXIST" });
        assert.equal(await readFile(target, "utf8"), "keep this");
        assert.deepEqual(await readdir(dir), ["keep.txt"]);
    });
});
test("download rejects truncated and oversized streams and removes partial files", async () => {
    await inTemp(async dir => {
        const target = join(dir, "new.txt");
        await assert.rejects(saveResponse(new Response("a"), target, 4, signal(), () => {}), /incomplete/);
        await assert.rejects(saveResponse(new Response("abcd"), target, 1, signal(), () => {}), /exceeds/);
        await assert.rejects(saveResponse(new Response("abc"), target, DOWNLOAD_LIMIT + 1, signal(), () => {}), /size/);
        assert.deepEqual(await readdir(dir), []);
    });
});
test("download rejects partial HTTP and invalid size metadata", async () => {
    await inTemp(async dir => {
        const target = join(dir, "new.txt");
        await assert.rejects(saveResponse(new Response("abc", { status: 206 }), target, 3, signal(), () => {}));
        await assert.rejects(saveResponse(new Response("abc", { headers: { "content-length": "4" } }), target, 3, signal(), () => {}));
        for (const value of ["0", "-1", "NaN", "3.0", "3, 3"]) {
            await assert.rejects(saveResponse(new Response("abc", { headers: { "content-length": value } }), target, 3, signal(), () => {}), /size/);
        }
        assert.deepEqual(await readdir(dir), []);
    });
});
test("download cancellation does not leave a final or partial file", async () => {
    await inTemp(async dir => {
        const target = join(dir, "cancel.txt");
        const controller = new AbortController();
        await assert.rejects(saveResponse(new Response("abc"), target, 3, controller.signal, () => controller.abort()));
        assert.deepEqual(await readdir(dir), []);
        const before = new AbortController(); before.abort();
        await assert.rejects(saveResponse(new Response("abc"), target, 3, before.signal, () => {}));
        assert.deepEqual(await readdir(dir), []);
    });
});
test("download accepts a legitimate empty file", async () => {
    await inTemp(async dir => { const target = join(dir, "empty.txt"); await saveResponse(new Response(new Uint8Array(0)), target, 0, signal(), () => {}); assert.equal((await readFile(target)).length, 0); });
});

test("formatting preview handles text, simple styles, code fences and hidden spoiler segments", () => {
    const result = markdownPreview("**bold** *italic* __under__ ~~strike~~ ||secret||\n```lua\nlocal x = 1\n```");
    assert.ok(result.some(p => p.kind === "bold" && p.text === "bold"));
    assert.ok(result.some(p => p.kind === "italic" && p.text === "italic"));
    assert.ok(result.some(p => p.kind === "underline" && p.text === "under"));
    assert.ok(result.some(p => p.kind === "strike" && p.text === "strike"));
    assert.ok(result.some(p => p.kind === "spoiler" && p.text === "secret"));
    assert.ok(result.some(p => p.kind === "code" && p.text === "local x = 1\n"));
    assert.equal(markdownPreview("<script>alert(1)</script>").map(p => p.text).join(""), "<script>alert(1)</script>");
    assert.equal(markdownPreview("`".repeat(20_000)).map(p => p.text).join("").length, 20_000);
});
test("theme contrast checks accept readable palettes and reject low contrast", () => {
    assert.equal(contrastRatio("#ffffff", "#000000"), 21);
    assert.equal(contrastRatio("#777777", "#777777"), 1);
    assert.ok(contrastRatio("#e8e9ed", "#202124") >= 4.5);
    assert.ok(contrastRatio("#20232c", "#f5f5f8") >= 4.5);
});
test("download does not create a temporary file when the response stream is already locked", async () => {
    await inTemp(async dir => {
        const response = new Response("abc"); const reader = response.body.getReader();
        try { await assert.rejects(saveResponse(response, join(dir, "locked.txt"), 3, signal(), () => {})); assert.deepEqual(await readdir(dir), []); }
        finally { reader.releaseLock(); }
    });
});

test("download cancellation interrupts a stalled response", { timeout: 2000 }, async () => {
    await inTemp(async dir => {
        const target = join(dir, "stalled.txt");
        const controller = new AbortController();
        const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); } }));
        const timer = setTimeout(() => controller.abort(), 50);
        try { await assert.rejects(saveResponse(response, target, 3, controller.signal, () => {})); }
        finally { clearTimeout(timer); }
        assert.deepEqual(await readdir(dir), []);
    });
});
