/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, Menu, MessageStore, moment, showToast, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    shiftClick: {
        type: OptionType.BOOLEAN,
        description: "Shift click a message to start the range, then shift click another to copy it.",
        default: true
    },
    timestamps: {
        type: OptionType.BOOLEAN,
        description: "Put the date and time in front of each message.",
        default: true
    },
    attachments: {
        type: OptionType.BOOLEAN,
        description: "List attachment links under the message they came with.",
        default: true
    }
});

let start: { channelId: string; id: string; } | null = null;

function nameOf(userId: string, guildId: string | null | undefined) {
    const user = UserStore.getUser(userId);
    if (!user) return null;
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || user.globalName || user.username;
}

function plainContent(content: string, guildId: string | null | undefined) {
    return content
        .replace(/<@!?(\d+)>/g, (m, id: string) => {
            const name = nameOf(id, guildId);
            return name ? `@${name}` : m;
        })
        .replace(/<#(\d+)>/g, (m, id: string) => {
            const channel = ChannelStore.getChannel(id);
            return channel ? `#${channel.name}` : m;
        })
        .replace(/<a?(:\w+:)\d+>/g, "$1");
}

function formatMessage(message: Message, guildId: string | null | undefined) {
    const { timestamps, attachments } = settings.store;
    const name = nameOf(message.author.id, guildId) ?? message.author.username;
    const prefix = timestamps ? `[${moment(message.timestamp).format("L LT")}] ` : "";
    const lines = [`${prefix}${name}: ${plainContent(message.content, guildId)}`.trimEnd()];
    if (attachments) for (const file of message.attachments) lines.push(`    ${file.filename}: ${file.url}`);
    return lines.join("\n");
}

function setStart(message: Message) {
    start = { channelId: message.channel_id, id: message.id };
    showToast({ text: "Range start set. Now pick the last message to copy." });
}

function copyRange(channel: Channel, endId: string) {
    if (!start) return;
    const [from, to] = [BigInt(start.id), BigInt(endId)].sort((a, b) => (a < b ? -1 : 1));
    const picked: Message[] = [];
    MessageStore.getMessages(channel.id).forEach(message => {
        const id = BigInt(message.id);
        if (id >= from && id <= to) picked.push(message);
    });
    start = null;

    if (picked[0]?.id !== String(from) || picked.at(-1)?.id !== String(to)) {
        showToast({ text: "The start message isn't loaded anymore, pick the range again.", variant: "critical" });
        return;
    }

    copyWithToast(
        picked.map(m => formatMessage(m, channel.guild_id)).join("\n"),
        picked.length === 1 ? "Copied 1 message." : `Copied ${picked.length} messages.`
    );
}

const messageContextMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return;
    const pending = start?.channelId === message.channel_id && start.id !== message.id;

    children.push(
        pending
            ? <Menu.MenuGroup>
                <Menu.MenuItem id="vc-copy-range-end" label="Copy Range To Here" action={() => copyRange(channel, message.id)} />
                <Menu.MenuItem id="vc-copy-range-cancel" label="Cancel Copy Range" action={() => { start = null; }} />
            </Menu.MenuGroup>
            : <Menu.MenuItem id="vc-copy-range-start" label="Start Copy Range Here" action={() => setStart(message)} />
    );
};

export default definePlugin({
    name: "CopyMessageRange",
    description: "Shift click two messages, or use the right click menu, to copy everything between them as a plain text transcript.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        message: messageContextMenu
    },

    onMessageClick(message, channel, event) {
        if (!settings.store.shiftClick || !event.shiftKey || event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.target instanceof Element && event.target.closest("a, button, img, video, [role='button'], [contenteditable='true']")) return;

        window.getSelection()?.removeAllRanges();
        if (start?.channelId === channel.id && start.id !== message.id) copyRange(channel, message.id);
        else setStart(message);
    },

    stop() {
        start = null;
    }
});
