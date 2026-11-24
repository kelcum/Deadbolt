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

export default definePlugin({
    name: "SessionRestore",
    description: "Save and restore your last selected channel on request, without automatic navigation.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbsession",
        description: "Show, save or clear your last channel.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "save", label: "save", value: "save" }, { name: "restore", label: "restore", value: "restore" }, { name: "clear", label: "clear", value: "clear" }] }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            const reply = (content: string) => { if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content }); };
            if (!userId) return;
            const key = "zot:SessionRestore:" + userId;
            const action = findOption<string>(opts, "action", "restore");
            if (action === "save") {
                const link = "https://discord.com/channels/" + (ctx.channel.guild_id || "@me") + "/" + ctx.channel.id;
                if (!/^https:\/\/discord\.com\/channels\/(@me|\d{17,20})\/\d{17,20}$/.test(link)) return reply("Open a channel first.");
                await DataStore.set(key, link);
                return reply("Session location saved.");
            }
            if (action === "clear") {
                await DataStore.del(key);
                return reply("Session location cleared.");
            }
            if (action === "restore") return reply(await DataStore.get<string>(key) ?? "No saved session location.");
        }
    }]
});
