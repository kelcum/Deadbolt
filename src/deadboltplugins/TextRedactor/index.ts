/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "TextRedactor",
    description: "Copy text with common sensitive strings masked before sharing.",
    authors: [Devs.Zot],
    tags: ["Privacy", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbredact",
        description: "Mask selected text patterns and copy the result.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "text", description: "Text to redact.", type: ApplicationCommandOptionType.STRING, required: true },
            { name: "emails", description: "Mask email addresses.", type: ApplicationCommandOptionType.BOOLEAN },
            { name: "links", description: "Mask HTTP and HTTPS links.", type: ApplicationCommandOptionType.BOOLEAN },
            { name: "ids", description: "Mask long numeric identifiers.", type: ApplicationCommandOptionType.BOOLEAN }
        ],
        async execute(opts, ctx) {
            let text = findOption<string>(opts, "text", "");
            if (!text || text.length > 4000) {
                sendBotMessage(ctx.channel.id, { content: "Enter 1 to 4000 characters." });
                return;
            }
            if (findOption(opts, "emails", true)) text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
            if (findOption(opts, "links", true)) text = text.replace(/https?:\/\/[^\s<>]+/gi, "[link]");
            if (findOption(opts, "ids", true)) text = text.replace(/\b\d{17,20}\b/g, "[id]");
            await copyToClipboard(text);
            sendBotMessage(ctx.channel.id, { content: "Redacted text copied. Review the result manually before sharing." });
        }
    }]
});
