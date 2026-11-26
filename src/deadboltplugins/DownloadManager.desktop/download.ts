/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { link, open, unlink } from "fs/promises";
import { dirname, join } from "path";

export const DOWNLOAD_LIMIT = 1024 * 1024 * 1024;
export async function saveResponse(response: Response, destination: string, expectedBytes: number, signal: AbortSignal, progress: (value: number) => void) {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > DOWNLOAD_LIMIT) throw new Error("Invalid expected file size.");
    if (!response.ok || response.status === 206 || response.headers.has("content-range") || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error("Attachment unavailable or incomplete."); }
    const header = response.headers.get("content-length");
    if (header !== null && (!/^\d+$/.test(header) || Number(header) !== expectedBytes)) {
        await response.body.cancel().catch(() => {});
        throw new Error("Attachment size does not match.");
    }
    signal.throwIfAborted();
    const temporary = join(dirname(destination), `.deadbolt-download-${randomUUID()}.part`);
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    let file: Awaited<ReturnType<typeof open>> | undefined;
    let received = 0;
    let closed = false;
    let created = false;
    try {
        file = await open(temporary, "wx", 0o600);
        created = true;
        for (;;) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            if (received + value.byteLength > expectedBytes || received + value.byteLength > DOWNLOAD_LIMIT) throw new Error("Attachment exceeds expected size.");
            let offset = 0;
            while (offset < value.byteLength) {
                const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
                if (!bytesWritten) throw new Error("Could not write the file.");
                offset += bytesWritten;
            }
            received += value.byteLength;
            progress(received);
        }
        signal.throwIfAborted();
        if (received !== expectedBytes) throw new Error("Attachment was incomplete.");
        await file.sync();
        await file.close(); closed = true;
        signal.throwIfAborted();
        // An exclusive hard link publishes the complete file without overwriting existing files.
        await link(temporary, destination);
    } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {}); reader.releaseLock();
        if (!closed) await file?.close().catch(() => {});
        if (created) await unlink(temporary).catch(() => {});
    }
}
