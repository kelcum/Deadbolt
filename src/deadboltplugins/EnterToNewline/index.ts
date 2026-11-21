/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";

const settings = definePluginSettings({
    dms: {
        type: OptionType.BOOLEAN,
        description: "Use Enter for a new line in direct messages.",
        default: true
    },
    groupDms: {
        type: OptionType.BOOLEAN,
        description: "Use Enter for a new line in group chats.",
        default: true
    },
    servers: {
        type: OptionType.BOOLEAN,
        description: "Use Enter for a new line in server channels.",
        default: true
    },
    threads: {
        type: OptionType.BOOLEAN,
        description: "Use Enter for a new line in threads and forum posts.",
        default: true
    },
    edits: {
        type: OptionType.BOOLEAN,
        description: "Also use Enter for a new line while editing a message, so Ctrl+Enter saves.",
        default: false
    }
});

interface ChatInputType {
    analyticsName?: string;
    submit?: { disableEnterToSubmit?: boolean; };
}

export default definePlugin({
    name: "EnterToNewline",
    description: "Makes Enter start a new line and Ctrl+Enter send, with a switch for each kind of channel.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: "submit?.disableEnterToSubmit??!1",
            replacement: {
                match: /(?<=disableEnterToSubmit:)(\i)\.submit\?\.disableEnterToSubmit\?\?!1/,
                replace: "$self.shouldDisableEnter(this.props.channel,$1)"
            }
        }
    ],

    shouldDisableEnter(channel: Channel | undefined, type: ChatInputType) {
        if (type.submit?.disableEnterToSubmit) return true;
        if (!channel) return false;
        const { dms, groupDms, servers, threads, edits } = settings.store;
        if (type.analyticsName === "edit" && !edits) return false;
        if (channel.isDM()) return dms;
        if (channel.isGroupDM()) return groupDms;
        if (channel.isThread()) return threads;
        return servers;
    }
});
