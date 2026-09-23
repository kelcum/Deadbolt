/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ReverseText",
    description: "Adds a /reverse slash command that reverses the given text.",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "reverse",
            description: "Reverses the given text.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "The text to reverse.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const text = findOption(opts, "text", "");
                const reversed = Array.from(text).reverse().join("");

                sendBotMessage(ctx.channel.id, { content: reversed });
            }
        }
    ]
});
