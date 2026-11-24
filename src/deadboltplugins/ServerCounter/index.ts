/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { GuildStore } from "@webpack/common";

export default definePlugin({
    name: "ServerCounter",
    description: "Show the number of joined servers with /dbservers.",
    authors: [Devs.Zot],
    tags: ["Servers", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbservers",
        description: "Show the number of joined servers.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_opts, ctx) {
            sendBotMessage(ctx.channel.id, { content: "Joined servers: " + GuildStore.getGuildCount() });
        }
    }]
});
