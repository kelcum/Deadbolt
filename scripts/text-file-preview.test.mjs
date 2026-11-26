/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { attachmentUrl, decodeText, findMatch, indexText, isTextFile, MAX_BYTES, PAGE_CHARS, pageForLine, pageForOffset, readResponse } from "../src/deadboltplugins/TextFilePreview/text.ts";

function verifyIndex(text) {
    const { pages, lineCount } = indexText(text);
    assert.equal(pages.map(p => text.slice(p.start, p.end)).join(""), text);
    assert.equal(lineCount, text.split("\n").length);
    for (const p of pages) {
        assert.ok(p.end - p.start <= PAGE_CHARS);
        assert.ok(p.lastLine >= p.firstLine);
        assert.ok(p.lastLine - p.firstLine <= 400);
    }
    return pages;
}

test("recognizes text and source files", () => {
    for (const name of ["script.lua", "game.LUAU", "data.json", "readme.md", "Dockerfile", "test.rbxlx"]) assert.ok(isTextFile(name));
    assert.ok(isTextFile("extensionless", "text/plain"));
    assert.equal(isTextFile("photo.png", "image/png"), false);
});

test("only accepts HTTPS Discord attachment URLs", () => {
    assert.ok(attachmentUrl("https://cdn.discordapp.com/attachments/123/456/file.lua?ex=123&hm=abc"));
    assert.ok(attachmentUrl("https://media.discordapp.net/attachments/123/456/a%20b.txt"));
    for (const url of ["https://evil.test/attachments/1/2/a.txt", "https://cdn.discordapp.com.evil.test/attachments/1/2/a.txt", "http://cdn.discordapp.com/attachments/1/2/a.txt", "https://cdn.discordapp.com:123/attachments/1/2/a.txt", "https://user@cdn.discordapp.com/attachments/1/2/a.txt", "https://cdn.discordapp.com/attachments/1/2/%2Fetc", "https://cdn.discordapp.com/attachments/1/2/a%5cb.txt", "https://cdn.discordapp.com/api/test"]) assert.equal(attachmentUrl(url), null);
});

test("complete 250,000-line script has no dropped text", () => {
    const text = Array.from({ length: 250_000 }, (_, i) => `local value = ${i}\n`).join("");
    const pages = verifyIndex(text);
    const last = pages[pageForLine(pages, 250_000)];
    assert.ok(text.slice(last.start, last.end).includes("local value = 249999"));
    assert.equal(pages.at(-1).lastLine, 250001);
});

test("very long lines, CRLF and surrogate pairs are preserved", () => {
    const text = "a".repeat(PAGE_CHARS - 1) + "😀" + "x".repeat(200_000) + "\r\nlast\n";
    const pages = verifyIndex(text);
    assert.equal(pages[0].end, PAGE_CHARS - 1);
    assert.equal(pages[1].firstLine, 1);
    assert.equal(pageForLine(pages, 1), 0);
    verifyIndex("x".repeat(PAGE_CHARS - 1) + "\r\nnext");
    verifyIndex("");
    verifyIndex("\n".repeat(800));
});

test("search reaches matches across section boundaries and wraps", () => {
    const text = "a".repeat(PAGE_CHARS - 2) + "needle" + "b".repeat(80_000) + "needle";
    const { pages } = indexText(text);
    const first = findMatch(text, "needle", -1, false);
    const second = findMatch(text, "needle", first, false);
    assert.equal(first, PAGE_CHARS - 2);
    assert.equal(second, text.length - 6);
    assert.equal(pageForOffset(pages, first), 0);
    assert.equal(pageForOffset(pages, second), pages.length - 1);
    assert.equal(findMatch(text, "needle", second, false), first);
    assert.equal(findMatch(text, "needle", first, true), second);
    assert.equal(findMatch(text, "not found", -1, false), -1);
});

test("UTF-8, UTF-16 and legacy text decoding", () => {
    assert.deepEqual(decodeText(new TextEncoder().encode("Lua 😀\r\n").buffer), { text: "Lua 😀\r\n", encoding: "UTF-8" });
    assert.deepEqual(decodeText(Uint8Array.of(255, 254, 65, 0).buffer), { text: "A", encoding: "UTF-16LE" });
    assert.deepEqual(decodeText(Uint8Array.of(233).buffer), { text: "é", encoding: "Windows-1252" });
    assert.throws(() => decodeText(Uint8Array.of(65, 0, 66).buffer), /binary/);
});

test("reads the complete response and refuses partial or excessive responses", async () => {
    const data = "abc\n".repeat(60_000);
    assert.equal(decodeText(await readResponse(new Response(data))).text, data);
    await assert.rejects(readResponse(new Response("partial", { status: 206 })), /part of the file/);
    await assert.rejects(readResponse(new Response("not found", { status: 404 })), /HTTP 404/);
    await assert.rejects(readResponse(new Response("x", { headers: { "content-length": String(MAX_BYTES + 1) } })), /64 MiB/);
    let count = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({ pull(controller) { if (++count <= 65) controller.enqueue(chunk); else controller.close(); } });
    await assert.rejects(readResponse(new Response(stream)), /64 MiB/);
});
