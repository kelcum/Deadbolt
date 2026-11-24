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

interface Alias { name: string; kind: string; id: string; }

export default definePlugin({
    name: "LocalAliases",
    description: "Save private searchable aliases for servers, channels and users without changing Discord names.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbalias",
        description: "Manage your personal lookup aliases.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "save", label: "save", value: "save" }, { name: "list", label: "list", value: "list" }, { name: "find", label: "find", value: "find" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "name", description: "Alias or search term.", type: ApplicationCommandOptionType.STRING },
            { name: "kind", description: "Object type.", type: ApplicationCommandOptionType.STRING, choices: [{ name: "server", label: "server", value: "server" }, { name: "channel", label: "channel", value: "channel" }, { name: "user", label: "user", value: "user" }] },
            { name: "id", description: "Discord object ID.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "List page.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            const reply = (content: string) => { if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content }); };
            if (!userId) return;
            const key = "zot:LocalAliases:" + userId;
            const action = findOption<string>(opts, "action", "list");
            const name = findOption(opts, "name", "").trim();
            if (action === "list" || action === "find") {
                const entries = (await DataStore.get<Alias[]>(key) ?? []).filter(e => !name || e.name.toLowerCase().includes(name.toLowerCase()));
                const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
                return reply(entries.slice((page - 1) * 15, page * 15).map(e => e.name + " · " + e.kind + " · " + e.id).join("\n") || "No matching aliases on this page.");
            }
            if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(name)) return reply("Use a name of 1 to 32 letters, numbers, spaces, underscores or dashes.");
            if (action === "remove") {
                await DataStore.update<Alias[]>(key, old => (old ?? []).filter(e => e.name !== name));
                return reply("Alias removed if present.");
            }
            if (action === "save") {
                const kind = findOption(opts, "kind", "");
                const id = findOption(opts, "id", "").trim();
                if (!["server", "channel", "user"].includes(kind) || !/^\d{17,20}$/.test(id)) return reply("Choose an object type and enter its Discord ID.");
                let saved = false;
                await DataStore.update<Alias[]>(key, old => {
                    const entries = old ?? [];
                    if (entries.length >= 100 && !entries.some(e => e.name === name)) return entries;
                    saved = true;
                    return [...entries.filter(e => e.name !== name), { name, kind, id }];
                });
                return reply(saved ? "Alias saved: " + name : "Alias limit reached.");
            }
        }
    }]
});
