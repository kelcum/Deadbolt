/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "DiceRoll",
    description: "Adds a /roll slash command to roll dice (e.g. 6-sided, 3 of them).",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "roll",
            description: "Rolls one or more dice.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "sides",
                    description: "Number of sides per die. Defaults to 6.",
                    type: ApplicationCommandOptionType.INTEGER
                },
                {
                    name: "count",
                    description: "Number of dice to roll. Defaults to 1.",
                    type: ApplicationCommandOptionType.INTEGER
                }
            ],
            execute: (opts, ctx) => {
                const sides = Math.max(2, Math.min(1000, findOption(opts, "sides", 6)));
                const count = Math.max(1, Math.min(20, findOption(opts, "count", 1)));

                const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
                const total = rolls.reduce((a, b) => a + b, 0);

                sendBotMessage(ctx.channel.id, {
                    content: count === 1
                        ? `🎲 Rolled a **${rolls[0]}** (d${sides})`
                        : `🎲 Rolled [${rolls.join(", ")}] (${count}d${sides}) · Total: **${total}**`
                });
            }
        }
    ]
});
