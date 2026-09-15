/*
 * Wraithcord, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

function toWords(text: string): string[] {
    return text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function convert(style: string, text: string): string {
    const words = toWords(text);
    if (!words.length) return text;

    switch (style) {
        case "upper": return text.toUpperCase();
        case "lower": return text.toLowerCase();
        case "title": return words.map(capitalize).join(" ");
        case "sentence": {
            const s = words.join(" ").toLowerCase();
            return capitalize(s);
        }
        case "camel": return words.map((w, i) => i === 0 ? w.toLowerCase() : capitalize(w)).join("");
        case "pascal": return words.map(capitalize).join("");
        case "snake": return words.map(w => w.toLowerCase()).join("_");
        case "kebab": return words.map(w => w.toLowerCase()).join("-");
        default: return text;
    }
}

const STYLE_CHOICES = [
    { name: "UPPERCASE", value: "upper", label: "UPPERCASE" },
    { name: "lowercase", value: "lower", label: "lowercase" },
    { name: "Title Case", value: "title", label: "Title Case" },
    { name: "Sentence case", value: "sentence", label: "Sentence case" },
    { name: "camelCase", value: "camel", label: "camelCase" },
    { name: "PascalCase", value: "pascal", label: "PascalCase" },
    { name: "snake_case", value: "snake", label: "snake_case" },
    { name: "kebab-case", value: "kebab", label: "kebab-case" }
];

export default definePlugin({
    name: "CaseConvert",
    description: "Adds a /case slash command that converts text between UPPER/lower/Title/Sentence/camel/Pascal/snake/kebab case (shown only to you).",
    dependencies: ["CommandsAPI"],
    tags: ["Utility", "Commands"],
    authors: [Devs.K3],
    commands: [
        {
            name: "case",
            description: "Convert text to a different case style.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "style",
                    description: "The case style to convert to.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: STYLE_CHOICES
                },
                {
                    name: "text",
                    description: "The text to convert.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: (opts, ctx) => {
                const style = findOption(opts, "style", "lower");
                const text = findOption(opts, "text", "");

                sendBotMessage(ctx.channel.id, {
                    content: `\`${convert(style, text)}\``
                });
            }
        }
    ]
});
