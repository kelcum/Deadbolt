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
    name: "BetterFormatting",
    description: "Format text as Discord Markdown and copy it to the clipboard without sending.",
    authors: [Devs.Zot],
    tags: ["Chat", "Commands"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbformat",
        description: "Copy formatted Discord Markdown.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "style", description: "Formatting style.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "bold", label: "bold", value: "bold" }, { name: "italic", label: "italic", value: "italic" }, { name: "underline", label: "underline", value: "underline" }, { name: "strike", label: "strike", value: "strike" }, { name: "spoiler", label: "spoiler", value: "spoiler" }, { name: "quote", label: "quote", value: "quote" }, { name: "code", label: "code", value: "code" }] },
            { name: "text", description: "Text to format.", type: ApplicationCommandOptionType.STRING, required: true }
        ],
        async execute(opts, ctx) {
            const style = findOption<string>(opts, "style", "bold");
            const text = findOption(opts, "text", "");
            if (!text.trim() || text.length > 1800) {
                sendBotMessage(ctx.channel.id, { content: "Enter 1 to 1800 characters." });
                return;
            }
            const delimiters: Record<string, string> = { bold: "**", italic: "*", underline: "__", strike: "~~", spoiler: "||" };
            const delimiter = Object.hasOwn(delimiters, style) ? delimiters[style] : "";
            const formatted = style === "quote"
                ? text.split("\n").map(line => "> " + line).join("\n")
                : style === "code"
                    ? "```\n" + text.replaceAll("```", "``\u200b`") + "\n```"
                    : delimiter ? delimiter + text + delimiter : text;
            await copyToClipboard(formatted);
            sendBotMessage(ctx.channel.id, { content: "Formatted text copied to your clipboard." });
        }
    }]
});
