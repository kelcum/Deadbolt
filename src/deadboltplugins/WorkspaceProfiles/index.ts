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

interface Workspace { name: string; link: string; }

export default definePlugin({
    name: "WorkspaceProfiles",
    description: "Save named channel workspaces and reopen their links without changing client settings.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbworkspace",
        description: "Save, list, open or remove named workspaces.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "save", label: "save", value: "save" }, { name: "list", label: "list", value: "list" }, { name: "open", label: "open", value: "open" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "name", description: "Workspace name.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "List page.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            const reply = (content: string) => { if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content }); };
            if (!userId) return;
            const key = "zot:WorkspaceProfiles:" + userId;
            const action = findOption<string>(opts, "action", "list");
            const name = findOption(opts, "name", "").trim();
            if (action === "list") {
                const entries = await DataStore.get<Workspace[]>(key) ?? [];
                const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
                return reply(entries.slice((page - 1) * 20, page * 20).map(e => e.name).join("\n") || "No workspaces on this page.");
            }
            if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(name)) return reply("Use a name of 1 to 32 letters, numbers, spaces, underscores or dashes.");
            if (action === "save") {
                const channel = ctx.channel;
                const link = "https://discord.com/channels/" + (channel.guild_id || "@me") + "/" + channel.id;
                if (!/^https:\/\/discord\.com\/channels\/(@me|\d{17,20})\/\d{17,20}$/.test(link)) return reply("Open a channel first.");
                let saved = false;
                await DataStore.update<Workspace[]>(key, old => {
                    const entries = old ?? [];
                    if (entries.length >= 50 && !entries.some(e => e.name === name)) return entries;
                    saved = true;
                    return [...entries.filter(e => e.name !== name), { name, link }];
                });
                return reply(saved ? "Workspace saved: " + name : "Workspace limit reached.");
            }
            if (action === "remove") {
                await DataStore.update<Workspace[]>(key, old => (old ?? []).filter(e => e.name !== name));
                return reply("Workspace removed if present.");
            }
            if (action === "open") {
                const entry = (await DataStore.get<Workspace[]>(key) ?? []).find(e => e.name === name);
                return reply(entry?.link ?? "No workspace with that name.");
            }
        }
    }]
});
