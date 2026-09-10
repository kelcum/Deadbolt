/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

const ANSWERS = [
    "It is certain.",
    "Without a doubt.",
    "Yes, definitely.",
    "You may rely on it.",
    "As I see it, yes.",
    "Most likely.",
    "Outlook good.",
    "Yes.",
    "Signs point to yes.",
    "Reply hazy, try again.",
    "Ask again later.",
    "Better not tell you now.",
    "Cannot predict now.",
    "Concentrate and ask again.",
    "Don't count on it.",
    "My reply is no.",
    "My sources say no.",
    "Outlook not so good.",
    "Very doubtful."
];

export default definePlugin({
    name: "EightBall",
    description: "Adds a /8ball slash command that answers a yes-or-no question.",
    dependencies: ["CommandsAPI"],
    tags: ["Fun", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "8ball",
            description: "Ask the magic 8-ball a question.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "question",
                    description: "The question to ask.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const question = findOption(opts, "question", "");
                const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];

                sendBotMessage(ctx.channel.id, {
                    content: `🎱 **${question}**\n${answer}`
                });
            }
        }
    ]
});
