/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "JsonFormat",
    description: "Adds a /json slash command that pretty-prints (or minifies) and validates JSON (shown only to you).",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "json",
            description: "Pretty-print, minify, or validate JSON.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "json",
                    description: "The JSON text.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "minify",
                    description: "Minify instead of pretty-printing. Defaults to false.",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute: (opts, ctx) => {
                const raw = findOption(opts, "json", "");
                const minify = findOption(opts, "minify", false);

                let content: string;
                try {
                    const parsed = JSON.parse(raw);
                    const formatted = minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
                    content = `✅ Valid JSON\n\`\`\`json\n${formatted.slice(0, 1900)}\n\`\`\``;
                } catch (e) {
                    content = `❌ Invalid JSON: ${(e as Error).message}`;
                }

                sendBotMessage(ctx.channel.id, { content });
            }
        }
    ]
});
