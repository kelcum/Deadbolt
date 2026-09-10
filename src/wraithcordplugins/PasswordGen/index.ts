/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}";

export default definePlugin({
    name: "PasswordGen",
    description: "Adds a /genpass slash command that generates a random password (shown only to you).",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "genpass",
            description: "Generates a random password, shown only to you.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "length",
                    description: "Password length. Defaults to 16.",
                    type: ApplicationCommandOptionType.INTEGER
                },
                {
                    name: "symbols",
                    description: "Include symbols. Defaults to true.",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute: (opts, ctx) => {
                const length = Math.max(4, Math.min(128, findOption(opts, "length", 16)));
                const useSymbols = findOption(opts, "symbols", true);

                const pool = LOWER + UPPER + DIGITS + (useSymbols ? SYMBOLS : "");
                const bytes = new Uint32Array(length);
                crypto.getRandomValues(bytes);

                const password = Array.from(bytes, b => pool[b % pool.length]).join("");

                sendBotMessage(ctx.channel.id, {
                    content: `🔐 \`${password}\`\n_This message is only visible to you, and was never sent to the channel._`
                });
            }
        }
    ]
});
