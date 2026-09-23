/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export default definePlugin({
    name: "RandomColor",
    description: "Adds a /randomcolor slash command that generates a random color in hex, RGB and HSL.",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands", "Fun"],
    authors: [Devs.K3],
    commands: [
        {
            name: "randomcolor",
            description: "Generates a random color.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => {
                const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0");
                const [r, g, b] = hexToRgb(hex);
                const [h, s, l] = rgbToHsl(r, g, b);

                sendBotMessage(ctx.channel.id, {
                    content: `🎨 \`#${hex}\` · rgb(${r}, ${g}, ${b}) · hsl(${h}, ${s}%, ${l}%)`
                });
            }
        }
    ]
});
