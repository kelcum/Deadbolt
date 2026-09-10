/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "CoinFlip",
    description: "Adds a /coinflip slash command that flips a coin.",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "coinflip",
            description: "Flips a coin.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => {
                const result = Math.random() < 0.5 ? "Heads" : "Tails";
                sendBotMessage(ctx.channel.id, {
                    content: `🪙 **${result}**`
                });
            }
        }
    ]
});
