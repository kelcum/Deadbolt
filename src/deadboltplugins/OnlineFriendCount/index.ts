/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { PresenceStore, RelationshipStore } from "@webpack/common";

export default definePlugin({
    name: "OnlineFriendCount",
    description: "Show the number of friends with visible online, idle or do not disturb status.",
    authors: [Devs.Zot],
    tags: ["Friends", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbfriends",
        description: "Show friend counts by visible status.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_opts, ctx) {
            const ids = RelationshipStore.getFriendIDs();
            const statuses = ids.map(id => PresenceStore.getStatus(id));
            const online = statuses.filter(status => status === "online").length;
            const idle = statuses.filter(status => status === "idle").length;
            const dnd = statuses.filter(status => status === "dnd").length;
            sendBotMessage(ctx.channel.id, {
                content: "Friends: " + ids.length + "\nOnline: " + online + "\nIdle: " + idle + "\nDo not disturb: " + dnd + "\nOffline or unknown: " + (ids.length - online - idle - dnd)
            });
        }
    }]
});
