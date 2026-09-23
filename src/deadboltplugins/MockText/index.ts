/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "MockText",
    description: "Adds a /mock slash command that converts text to sPoNgEbOb mOcKiNg CaSe.",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "mock",
            description: "Converts text to alternating mocking case.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "The text to mock.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const text = findOption(opts, "text", "");
                let upper = false;
                const mocked = Array.from(text).map(ch => {
                    if (!/[a-z]/i.test(ch)) return ch;
                    upper = !upper;
                    return upper ? ch.toUpperCase() : ch.toLowerCase();
                }).join("");

                sendBotMessage(ctx.channel.id, { content: mocked });
            }
        }
    ]
});
