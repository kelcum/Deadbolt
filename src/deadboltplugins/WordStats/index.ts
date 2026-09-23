/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "WordStats",
    description: "Adds a /wordstats slash command that counts words, characters and sentences in a block of text.",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "wordstats",
            description: "Counts words, characters and sentences in text.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "The text to analyze.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const text = findOption(opts, "text", "");
                const words = text.trim().split(/\s+/).filter(Boolean);
                const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
                const chars = Array.from(text).length;
                const charsNoSpaces = Array.from(text.replace(/\s/g, "")).length;

                sendBotMessage(ctx.channel.id, {
                    content: `📊 Words: **${words.length}** · Characters: **${chars}** (${charsNoSpaces} without spaces) · Sentences: **${sentences.length}**`
                });
            }
        }
    ]
});
