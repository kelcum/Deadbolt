/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

const STYLES: Array<[string, string]> = [
    ["t", "Short Time"],
    ["T", "Long Time"],
    ["d", "Short Date"],
    ["D", "Long Date"],
    ["f", "Short Date/Time"],
    ["F", "Long Date/Time"],
    ["R", "Relative"]
];

export default definePlugin({
    name: "UnixTime",
    description: "Adds a /timestamp slash command that turns a date/time into every Discord timestamp format (<t:...:R> etc).",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "timestamp",
            description: "Converts a date/time into Discord timestamp tags.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "when",
                    description: "A date/time your browser can parse, e.g. \"2026-12-25 09:00\" or \"in 2 hours\" won't work, use a real date.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const when = findOption(opts, "when", "");
                const date = new Date(when);

                if (isNaN(date.getTime())) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Couldn't parse "${when}" as a date. Try something like \`2026-12-25 09:00\`.`
                    });
                    return;
                }

                const unix = Math.round(date.getTime() / 1000);
                const lines = STYLES.map(([style, label]) => `${label}: \`<t:${unix}:${style}>\` → <t:${unix}:${style}>`);

                sendBotMessage(ctx.channel.id, {
                    content: `🕒 Unix: \`${unix}\`\n${lines.join("\n")}`
                });
            }
        }
    ]
});
