/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

const logger = new Logger("ImageAutoCompress");

const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/avif"]);
const MAX_ATTEMPTS = 12;

const settings = definePluginSettings({
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a short message when an image gets shrunk.",
        default: true
    }
});

interface PendingUpload {
    file: File;
}

function megabytes(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function shrink(file: File, tooBig: (files: File[]) => boolean): Promise<File | null> {
    const bitmap = await createImageBitmap(file);
    const type = file.type === "image/jpeg" || file.type === "image/bmp" ? "image/jpeg" : "image/webp";
    const name = `${file.name.replace(/\.[^.]+$/, "")}.${type === "image/jpeg" ? "jpg" : "webp"}`;

    try {
        let scale = 1;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;

            ctx.drawImage(bitmap, 0, 0, width, height);
            const blob = await canvas.convertToBlob({ type, quality: attempt === 0 ? 0.92 : 0.82 });
            const out = new File([blob], name, { type, lastModified: file.lastModified });
            if (!tooBig([out])) return out;

            if (attempt > 0) scale *= 0.75;
        }
        return null;
    } finally {
        bitmap.close();
    }
}

export default definePlugin({
    name: "ImageAutoCompress",
    description: "Shrinks images that are over your upload limit so they still send instead of failing.",
    tags: ["Media", "Utility"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: "Unexpected mismatch between files and file metadata",
            replacement: {
                match: /(?<=\i=)await Promise\.all\(\i\.map\(\i\.\i\)\)(?=,\i=\i\.map\(\i=>\i\.file\);if\(\(0,(\i\.\i)\)\(\{files:\i,guildId:(\i)\}\)\))/,
                replace: "await $self.shrinkUploads($&,vcFiles=>(0,$1)({files:vcFiles,guildId:$2}))"
            }
        }
    ],

    async shrinkUploads<T extends PendingUpload>(uploads: T[], tooBig: (files: File[]) => boolean): Promise<T[]> {
        if (!tooBig(uploads.map(u => u.file))) return uploads;

        return Promise.all(uploads.map(async upload => {
            const { file } = upload;
            if (!SHRINKABLE.has(file.type) || !tooBig([file])) return upload;

            try {
                const out = await shrink(file, tooBig);
                if (!out) {
                    if (settings.store.showToast) showToast(`Couldn't shrink ${file.name} enough to fit your upload limit.`, Toasts.Type.FAILURE);
                    return upload;
                }

                if (settings.store.showToast) showToast(`Shrunk ${file.name} from ${megabytes(file.size)} to ${megabytes(out.size)} so it fits.`, Toasts.Type.SUCCESS);
                return { ...upload, file: out };
            } catch (e) {
                logger.error("Failed to shrink image", e);
                return upload;
            }
        }));
    }
});
