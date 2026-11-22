/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

const logger = new Logger("StripImageMetadata");

const PNG_PRIVATE_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
const WEBP_PRIVATE_CHUNKS = new Set(["EXIF", "XMP "]);

const settings = definePluginSettings({
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a short message when hidden photo info gets removed.",
        default: true
    }
});

function ascii(bytes: Uint8Array, start: number, length: number) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
}

function view(bytes: Uint8Array) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function keepJpegSegment(marker: number, segment: Uint8Array) {
    if (marker === 0xfe) return false;
    if (marker < 0xe1 || marker > 0xef || marker === 0xee) return true;
    return marker === 0xe2 && ascii(segment, 4, 11) === "ICC_PROFILE";
}

function exifOrientation(bytes: Uint8Array, tiff: number) {
    if (tiff + 8 > bytes.length) return 1;
    const data = view(bytes);
    const little = ascii(bytes, tiff, 2) === "II";
    const ifd = tiff + data.getUint32(tiff + 4, little);
    if (ifd + 2 > bytes.length) return 1;

    const count = data.getUint16(ifd, little);
    for (let entry = ifd + 2; entry < ifd + 2 + count * 12 && entry + 10 <= bytes.length; entry += 12) {
        if (data.getUint16(entry, little) !== 0x0112) continue;
        const orientation = data.getUint16(entry + 8, little);
        return orientation >= 2 && orientation <= 8 ? orientation : 1;
    }
    return 1;
}

function orientationTiff(orientation: number) {
    return [
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    ];
}

function crc32(bytes: Uint8Array) {
    let crc = ~0;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function orientationPngChunk(orientation: number) {
    const chunk = Uint8Array.of(0x00, 0x00, 0x00, 0x1a, 0x65, 0x58, 0x49, 0x66, ...orientationTiff(orientation), 0, 0, 0, 0);
    view(chunk).setUint32(34, crc32(chunk.subarray(4, 34)));
    return chunk;
}

function stripJpeg(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] | null {
    const parts = [bytes.subarray(0, 2)];
    let removed = false;
    let pos = 2;

    while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
        const marker = bytes[pos + 1];
        if (marker === 0xff) {
            pos++;
            continue;
        }
        if (marker === 0xda) break;

        const end = pos + 2 + view(bytes).getUint16(pos + 2);
        if (end > bytes.length) return null;

        const segment = bytes.subarray(pos, end);
        if (keepJpegSegment(marker, segment)) parts.push(segment);
        else {
            removed = true;
            const orientation = marker === 0xe1 && ascii(segment, 4, 6) === "Exif\0\0" ? exifOrientation(segment, 10) : 1;
            if (orientation > 1) parts.push(Uint8Array.of(0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...orientationTiff(orientation)));
        }
        pos = end;
    }

    if (!removed) return null;
    parts.push(bytes.subarray(pos));
    return parts;
}

function stripPng(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] | null {
    const parts = [bytes.subarray(0, 8)];
    let removed = false;
    let pos = 8;

    while (pos + 12 <= bytes.length) {
        const type = ascii(bytes, pos + 4, 4);
        const end = pos + 12 + view(bytes).getUint32(pos);
        if (end > bytes.length) return null;

        if (PNG_PRIVATE_CHUNKS.has(type)) {
            removed = true;
            const orientation = type === "eXIf" ? exifOrientation(bytes.subarray(pos + 8, end - 4), 0) : 1;
            if (orientation > 1) parts.push(orientationPngChunk(orientation));
        } else parts.push(bytes.subarray(pos, end));
        pos = end;
        if (type === "IEND") break;
    }

    return removed ? parts : null;
}

function stripWebp(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] | null {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let removed = false;
    let pos = 12;

    while (pos + 8 <= bytes.length) {
        const size = view(bytes).getUint32(pos + 4, true);
        const end = pos + 8 + size + (size & 1);
        if (end > bytes.length) return null;

        const chunk = bytes.subarray(pos, end);
        const type = ascii(chunk, 0, 4);
        if (WEBP_PRIVATE_CHUNKS.has(type)) removed = true;
        else if (type === "VP8X") {
            const copy = chunk.slice();
            copy[8] &= ~0x0c;
            parts.push(copy);
        } else parts.push(chunk);
        pos = end;
    }

    if (!removed) return null;
    const header = bytes.slice(0, 12);
    view(header).setUint32(4, parts.reduce((total, part) => total + part.length, 4), true);
    return [header, ...parts];
}

function strip(bytes: Uint8Array<ArrayBuffer>) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes);
    if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return stripPng(bytes);
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return stripWebp(bytes);
    return null;
}

export default definePlugin({
    name: "StripImageMetadata",
    description: "Removes location, camera and other hidden info from JPEG, PNG and WebP images before they upload, without touching the picture itself.",
    tags: ["Privacy", "Media"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: "Unexpected mismatch between files and file metadata",
            replacement: {
                match: /(?<=file metadata"\);let \i=\i\.getGuildId\(\),\i=)Array\.from\(\i\)/,
                replace: "await $self.stripFiles($&)"
            }
        }
    ],

    async stripFiles(files: File[]): Promise<File[]> {
        let cleaned = 0;

        const result = await Promise.all(files.map(async file => {
            if (!file.type.startsWith("image/")) return file;

            try {
                const parts = strip(new Uint8Array(await file.arrayBuffer()));
                if (!parts) return file;

                cleaned++;
                return new File(parts, file.name, { type: file.type, lastModified: file.lastModified });
            } catch (e) {
                logger.error("Failed to strip image metadata", e);
                return file;
            }
        }));

        if (cleaned && settings.store.showToast) showToast({ text: cleaned === 1 ? "Removed hidden photo info from 1 image." : `Removed hidden photo info from ${cleaned} images.`, variant: "success" });
        return result;
    }
});
