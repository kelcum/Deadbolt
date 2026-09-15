/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

function slugify(text: string): string {
    return text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "") // strip accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export default definePlugin({
    name: "Slugify",
    description: "Adds a /slug slash command that converts text into a URL-friendly slug (shown only to you).",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "slug",
            description: "Convert text into a URL-friendly slug.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "text",
                    description: "The text to slugify.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const text = findOption(opts, "text", "");
                const slug = slugify(text) || "(empty)";

                sendBotMessage(ctx.channel.id, {
                    content: `\`${slug}\``
                });
            }
        }
    ]
});
