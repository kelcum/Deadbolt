/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ArchiveEntry { name: string; compressed: number; bytes: number; directory: boolean; }
export function isArchive(filename: string) { return /\.(?:zip|docx|xlsx|pptx|odt|ods|odp|jar|epub)$/i.test(filename); }
export function archiveDirectory(buffer: ArrayBuffer): ArchiveEntry[] {
    const data = new DataView(buffer);
    const min = Math.max(0, data.byteLength - 22 - 65535);
    let end = data.byteLength - 22;
    for (; end >= min; end--) if (data.getUint32(end, true) === 0x06054b50 && end + 22 + data.getUint16(end + 20, true) === data.byteLength) break;
    if (end < min) throw new Error("No valid ZIP directory was found.");
    const disk = data.getUint16(end + 4, true), directoryDisk = data.getUint16(end + 6, true);
    const diskCount = data.getUint16(end + 8, true), count = data.getUint16(end + 10, true);
    const length = data.getUint32(end + 12, true), start = data.getUint32(end + 16, true);
    if (disk || directoryDisk || diskCount !== count || count > 10000 || count === 65535 || start === 0xffffffff || length === 0xffffffff || start + length > end) throw new Error("This ZIP format or directory size is unsupported.");
    const entries: ArchiveEntry[] = [];
    let pos = start;
    for (let i = 0; i < count; i++) {
        if (pos + 46 > start + length || data.getUint32(pos, true) !== 0x02014b50) throw new Error("ZIP directory is incomplete.");
        const flags = data.getUint16(pos + 8, true), compressed = data.getUint32(pos + 20, true), bytes = data.getUint32(pos + 24, true);
        const nameSize = data.getUint16(pos + 28, true), extraSize = data.getUint16(pos + 30, true), commentSize = data.getUint16(pos + 32, true);
        const next = pos + 46 + nameSize + extraSize + commentSize;
        if (!nameSize || next > start + length || compressed === 0xffffffff || bytes === 0xffffffff) throw new Error("Unsupported ZIP entry.");
        const name = new TextDecoder(flags & 0x800 ? "utf-8" : "windows-1252").decode(new Uint8Array(buffer, pos + 46, nameSize));
        entries.push({ name, compressed, bytes, directory: name.endsWith("/") }); pos = next;
    }
    return entries;
}
