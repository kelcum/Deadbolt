/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

interface Entry {
    name: string;
    text: string;
}

export default definePlugin({
    name: "QuickNotes",
    description: "Keep a local notebook with named entries.",
    authors: [Devs.Zot],
    tags: ["Utility", "Organisation"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbnote",
        description: "Manage locally saved notes.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "list", label: "list", value: "list" }, { name: "save", label: "save", value: "save" }, { name: "read", label: "read", value: "read" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "name", description: "Name of the note.", type: ApplicationCommandOptionType.STRING },
            { name: "text", description: "Text to save.", type: ApplicationCommandOptionType.STRING }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            const reply = (content: string) => {
                if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content });
            };
            const key = "zot:QuickNotes:" + userId;
            const action = findOption(opts, "action", "list");
            const name = findOption(opts, "name", "").trim();
            if (action === "list") {
                const entries = await DataStore.get<Entry[]>(key) ?? [];
                return reply(entries.length ? entries.map(entry => entry.name).join("\n") : "No saved notes.");
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
                return reply(saved ? "Saved locally: " + name : "Limit reached. Remove a saved note first.");
            }
            if (action === "remove") {
                let removed = false;
                await DataStore.update<Entry[]>(key, old => {
                    const entries = old ?? [];
                    removed = entries.some(entry => entry.name === name);
                    return entries.filter(entry => entry.name !== name);
                });
                return reply(removed ? "Removed: " + name : "No note with that name.");
            }
            if (action === "read") {
                const entry = (await DataStore.get<Entry[]>(key) ?? []).find(entry => entry.name === name);
                if (!entry) return reply("No note with that name.");
                if (UserStore.getCurrentUser()?.id !== userId) return;
                return reply(entry.text);
            }
        }
    }]
});
