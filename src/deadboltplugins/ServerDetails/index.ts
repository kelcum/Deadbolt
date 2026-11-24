/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { GuildRoleStore, GuildStore } from "@webpack/common";

export default definePlugin({
    name: "ServerDetails",
    description: "Show a compact read-only summary of the current server and cached role count.",
    authors: [Devs.Zot],
    tags: ["Servers", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbserverdetails",
        description: "Show current server information from the local cache.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_opts, ctx) {
            const guildId = ctx.channel.guild_id;
            const guild = guildId && GuildStore.getGuild(guildId);
            if (!guild) {
                sendBotMessage(ctx.channel.id, { content: "Open a server channel first." });
                return;
            }
            const created = /^\d{17,20}$/.test(guildId) ? Number((BigInt(guildId) >> 22n) + 1420070400000n) : 0;
            const lines = ["Server: " + guild.name, "ID: " + guildId, "Cached roles: " + GuildRoleStore.getSortedRoles(guildId).length];
            if (created) lines.push("Created: <t:" + Math.floor(created / 1000) + ":D>");
            sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
        }
    }]
});
