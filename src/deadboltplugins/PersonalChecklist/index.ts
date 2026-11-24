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

interface Task { id: string; text: string; done: boolean; }

export default definePlugin({
    name: "PersonalChecklist",
    description: "Keep a local account-scoped checklist with completion and removal controls.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbchecklist",
        description: "Add, list, toggle or remove checklist items.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "add", label: "add", value: "add" }, { name: "list", label: "list", value: "list" }, { name: "toggle", label: "toggle", value: "toggle" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "text", description: "Task description.", type: ApplicationCommandOptionType.STRING },
            { name: "id", description: "Task ID.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "List page.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            const reply = (content: string) => { if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content }); };
            if (!userId) return;
            const key = "zot:PersonalChecklist:" + userId;
            const action = findOption<string>(opts, "action", "list");
            if (action === "list") {
                const entries = await DataStore.get<Task[]>(key) ?? [];
                const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
                return reply(entries.slice((page - 1) * 8, page * 8).map(e => (e.done ? "Done" : "Open") + " · " + e.id + " · " + e.text).join("\n") || "No checklist items on this page.");
            }
            if (action === "add") {
                const text = findOption(opts, "text", "").trim();
                if (!text || text.length > 150) return reply("Enter a task of 1 to 150 characters.");
                const id = crypto.randomUUID().slice(0, 12);
                let saved = false;
                await DataStore.update<Task[]>(key, old => {
                    const entries = old ?? [];
                    if (entries.length >= 100) return entries;
                    saved = true;
                    return [...entries, { id, text, done: false }];
                });
                return reply(saved ? "Task added: " + id : "Checklist limit reached.");
            }
            const id = findOption(opts, "id", "").trim();
            if (!id) return reply("Enter the task ID from your list.");
            if (action === "toggle" || action === "remove") {
                let found = false;
                await DataStore.update<Task[]>(key, old => {
                    const entries = old ?? [];
                    found = entries.some(e => e.id === id);
                    return action === "remove" ? entries.filter(e => e.id !== id) : entries.map(e => e.id === id ? { ...e, done: !e.done } : e);
                });
                return reply(found ? "Checklist updated." : "Task not found.");
            }
        }
    }]
});
