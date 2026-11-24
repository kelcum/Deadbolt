/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildRoleStore, UserStore } from "@webpack/common";

import { guildMenu, openRoleExplorer } from "./panel";

export default definePlugin({
    name: "RoleExplorer",
    description: "Browse roles and members already loaded in the current server cache.",
    authors: [Devs.Zot],
    tags: ["Roles", "Servers"],
    dependencies: ["CommandsAPI"],
    contextMenus: { "guild-context": guildMenu, "guild-header-popout": guildMenu },
    toolboxActions: { "Browse roles": openRoleExplorer },
    commands: [{
        name: "dbroles",
        description: "Find roles or cached members of a role.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "query", description: "Role name or ID.", type: ApplicationCommandOptionType.STRING },
            { name: "members", description: "List cached members of an exact role.", type: ApplicationCommandOptionType.BOOLEAN },
            { name: "page", description: "Page number.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const reply = (content: string) => { sendBotMessage(ctx.channel.id, { content }); };
            const guildId = ctx.channel.guild_id;
            if (!guildId) return reply("Open a server channel first.");
            const query = findOption(opts, "query", "").trim().toLowerCase();
            const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
            const roles = GuildRoleStore.getSortedRoles(guildId);
            if (findOption(opts, "members", false)) {
                const exact = roles.filter(role => role.id === query || role.name.toLowerCase() === query);
                if (exact.length !== 1) return reply("Enter an exact, unambiguous role name or ID.");
                const role = exact[0];
                const members = GuildMemberStore.getMembers(guildId).filter(member => role.id === guildId || member.roles.includes(role.id));
                const lines = members.slice((page - 1) * 15, page * 15).map(member => {
                    const user = UserStore.getUser(member.userId);
                    return (member.nick || user?.globalName || user?.username || "Unknown user").slice(0, 50) + " · " + member.userId;
                });
                return reply("Cached members: " + members.length + " (not a complete server count)\n" + (lines.join("\n") || "No results on this page."));
            }
            const matches = roles.filter(role => !query || role.id === query || role.name.toLowerCase().includes(query));
            const lines = matches.slice((page - 1) * 15, page * 15).map(role => role.name.slice(0, 60) + " · " + role.id);
            return reply("Matching roles: " + matches.length + "\n" + (lines.join("\n") || "No results on this page."));
        }
    }]
});
