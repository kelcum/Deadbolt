/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, SelectedChannelStore, UserStore } from "@webpack/common";

interface Visit {
    channelId: string;
    guildId: string;
}

let accountId: string | undefined;
let visits: Visit[] = [];

function remember(channelId: string | null) {
    const current = UserStore.getCurrentUser()?.id;
    if (current !== accountId) {
        visits = [];
        accountId = current;
    }
    if (!current || !channelId) return;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;
    visits = [{ channelId, guildId: channel.guild_id ?? "@me" }, ...visits.filter(visit => visit.channelId !== channelId)].slice(0, 25);
}

export default definePlugin({
    name: "ChannelHistory",
    description: "Keep a temporary list of recently visited channels for the current session.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    dependencies: ["CommandsAPI"],
    start() {
        remember(SelectedChannelStore.getChannelId());
    },
    stop() {
        accountId = undefined;
        visits = [];
    },
    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            remember(channelId);
        }
    },
    commands: [{
        name: "dbhistory",
        description: "List or clear your recent channel history.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{ name: "clear", description: "Clear current session history.", type: ApplicationCommandOptionType.BOOLEAN }],
        execute(opts, ctx) {
            if (UserStore.getCurrentUser()?.id !== accountId) {
                accountId = undefined;
                visits = [];
            }
            if (findOption(opts, "clear", false)) {
                visits = [];
                sendBotMessage(ctx.channel.id, { content: "Channel history cleared." });
                return;
            }
            const lines = visits.slice(0, 15).map(visit => "https://discord.com/channels/" + visit.guildId + "/" + visit.channelId);
            sendBotMessage(ctx.channel.id, { content: lines.length ? lines.join("\n") : "No recent channels." });
        }
    }]
});
