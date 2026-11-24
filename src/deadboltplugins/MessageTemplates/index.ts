/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

interface Entry {
    name: string;
    text: string;
}

export default definePlugin({
    name: "MessageTemplates",
    description: "Save reusable messages and copy them to your clipboard on demand.",
    authors: [Devs.Zot],
    tags: ["Utility", "Organisation"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbtemplate",
        description: "Manage locally saved templates.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "list", label: "list", value: "list" }, { name: "save", label: "save", value: "save" }, { name: "copy", label: "copy", value: "copy" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "name", description: "Name of the template.", type: ApplicationCommandOptionType.STRING },
            { name: "text", description: "Text to save.", type: ApplicationCommandOptionType.STRING }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            const reply = (content: string) => {
                if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content });
            };
            const key = "zot:MessageTemplates:" + userId;
            const action = findOption(opts, "action", "list");
            const name = findOption(opts, "name", "").trim();
            if (action === "list") {
                const entries = await DataStore.get<Entry[]>(key) ?? [];
                return reply(entries.length ? entries.map(entry => entry.name).join("\n") : "No saved templates.");
            }
            if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(name)) return reply("Use a name of 1 to 32 letters, numbers, spaces, underscores or dashes.");
            if (action === "save") {
                const text = findOption(opts, "text", "");
                if (!text.trim() || text.length > 1500) return reply("Enter 1 to 1500 characters.");
                let saved = false;
                await DataStore.update<Entry[]>(key, old => {
                    const entries = old ?? [];
                    if (entries.length >= 40 && !entries.some(entry => entry.name === name)) return entries;
                    saved = true;
                    return [...entries.filter(entry => entry.name !== name), { name, text }];
                });
                return reply(saved ? "Saved locally: " + name : "Limit reached. Remove a saved template first.");
            }
            if (action === "remove") {
                let removed = false;
                await DataStore.update<Entry[]>(key, old => {
                    const entries = old ?? [];
                    removed = entries.some(entry => entry.name === name);
                    return entries.filter(entry => entry.name !== name);
                });
                return reply(removed ? "Removed: " + name : "No template with that name.");
            }
            if (action === "copy") {
                const entry = (await DataStore.get<Entry[]>(key) ?? []).find(entry => entry.name === name);
                if (!entry) return reply("No template with that name.");
                if (UserStore.getCurrentUser()?.id !== userId) return;
                await copyToClipboard(entry.text);
                return reply("Copied template: " + name);
            }
        }
    }]
});
