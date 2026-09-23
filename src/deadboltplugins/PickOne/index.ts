/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "PickOne",
    description: "Adds a /pick slash command that randomly picks one option from a comma-separated list.",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "pick",
            description: "Randomly picks one option from a comma-separated list.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "options",
                    description: "Comma-separated list of choices, e.g. pizza, tacos, sushi",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const raw = findOption(opts, "options", "");
                const choices = raw.split(",").map(s => s.trim()).filter(Boolean);

                if (choices.length < 2) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Give me at least two comma-separated options to pick from."
                    });
                    return;
                }

                const picked = choices[Math.floor(Math.random() * choices.length)];
                sendBotMessage(ctx.channel.id, {
                    content: `🎯 I pick: **${picked}**`
                });
            }
        }
    ]
});
