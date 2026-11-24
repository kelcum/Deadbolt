/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCredential, parseCredential, verifyPassword } from "../src/deadboltplugins/AppLock/password.ts";

test("AppLock password verification", async () => {
    const password = "test password 123";
    const first = await createCredential(password);
    const second = await createCredential(password);
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword("wrong password", first), false);
    assert.equal(await verifyPassword("", first), false);
    assert.equal(await verifyPassword("x".repeat(129), first), false);
    assert.deepEqual(parseCredential(JSON.stringify(first)), first);
    assert.ok(!JSON.stringify(first).includes(password));
    await assert.rejects(createCredential("short"));
    await assert.rejects(createCredential("x".repeat(129)));
});

test("AppLock rejects malformed stored credentials", () => {
    for (const value of [null, "{", "null", "[]", '{"version":2}', '{"version":1,"salt":"abc","hash":"abc"}']) {
        assert.equal(parseCredential(value), null);
    }
});
