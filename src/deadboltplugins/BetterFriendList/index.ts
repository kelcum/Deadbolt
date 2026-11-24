/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { PresenceStore, RelationshipStore, UserStore } from "@webpack/common";

export default definePlugin({
    name: "BetterFriendList",
    description: "Search and filter friends by name and visible status with /dbfriendsearch.",
    authors: [Devs.Zot],
    tags: ["Friends", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbfriendsearch",
        description: "Find friends by username, display name or status.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "query", description: "Username or display name.", type: ApplicationCommandOptionType.STRING },
            { name: "status", description: "Filter by visible status.", type: ApplicationCommandOptionType.STRING, choices: [{ name: "all", label: "all", value: "all" }, { name: "online", label: "online", value: "online" }, { name: "idle", label: "idle", value: "idle" }, { name: "dnd", label: "dnd", value: "dnd" }, { name: "offline", label: "offline", value: "offline" }] }
        ],
        execute(opts, ctx) {
            const query = findOption(opts, "query", "").trim().toLowerCase();
            const filter = findOption(opts, "status", "all");
            const matches = RelationshipStore.getFriendIDs().flatMap(id => {
                const user = UserStore.getUser(id);
                if (!user) return [];
                const name = user.globalName ?? user.username;
                const status = PresenceStore.getStatus(id);
                if (filter !== "all" && filter !== status) return [];
                if (!name.toLowerCase().includes(query) && !user.username.toLowerCase().includes(query)) return [];
                return [{ name, username: user.username, status }];
            }).sort((a, b) => a.name.localeCompare(b.name));
            const lines = matches.slice(0, 15).map(friend => friend.name.slice(0, 40) + " (@" + friend.username.slice(0, 40) + ") · " + friend.status);
            sendBotMessage(ctx.channel.id, { content: matches.length ? lines.join("\n") + "\nShowing " + lines.length + " of " + matches.length + " matches." : "No matching friends in your current cache." });
        }
    }]
});
