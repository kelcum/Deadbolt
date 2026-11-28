/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { humanFriendlyJoin } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Clickable, GuildStore, IconUtils, IdleStore, MessageStore, Modal, moment, NavigationRouter, openModal, ReadStateStore, UserStore, WindowStore } from "@webpack/common";

const cl = classNameFactory("vc-away-");

interface Entry {
    channelId: string;
    mentions: number;
    replies: number;
    lastId?: string;
}

interface RawMessage {
    id: string;
    author: { id: string; };
    mentions: { id: string; }[];
    referenced_message?: { author: { id: string; }; } | null;
}

const settings = definePluginSettings({
    awayMinutes: {
        type: OptionType.SLIDER,
        description: "Show a summary when you come back after being away from Discord for this many minutes.",
        markers: [5, 10, 15, 30, 60, 120],
        default: 15
    },
    onLaunch: {
        type: OptionType.BOOLEAN,
        description: "Also show a summary of your unread mentions and DMs when Discord starts.",
        default: true
    },
    includeReplies: {
        type: OptionType.BOOLEAN,
        description: "Count replies to your messages even when they don't ping you.",
        default: true
    }
});

let awaySince: number | undefined;
let launched = false;
let baseline = new Map<string, number>();
const replies = new Map<string, number>();
const latest = new Map<string, string>();

function mentionCounts() {
    return new Map(ReadStateStore.getMentionChannelIds().map(id => [id, ReadStateStore.getMentionCount(id)]));
}

function leave(since: number) {
    awaySince = since;
    baseline = since ? mentionCounts() : new Map();
    replies.clear();
    latest.clear();
}

function check() {
    const away = !WindowStore.isFocused() || IdleStore.isIdle();
    if (awaySince === undefined) {
        if (away) leave((IdleStore.isIdle() && IdleStore.getIdleSince()) || Date.now());
        return;
    }
    if (away) return;
    const since = awaySince;
    awaySince = undefined;
    if (!since || Date.now() - since >= settings.store.awayMinutes * 60_000) summarize(since);
}

function plural(count: number, word: string, many = `${word}s`) {
    return `${count} ${count === 1 ? word : many}`;
}

function nameOf(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "Unknown chat";
    if (channel.isDM()) {
        const user = UserStore.getUser(channel.getRecipientId() ?? "");
        return user?.globalName ?? user?.username ?? "Direct message";
    }
    if (channel.isGroupDM()) return channel.name || "Group DM";
    return `#${channel.name} in ${GuildStore.getGuild(channel.guild_id)?.name ?? "a server"}`;
}

function iconOf(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (channel?.isDM()) {
        const user = UserStore.getUser(channel.getRecipientId() ?? "");
        if (user) return IconUtils.getUserAvatarURL(user, false, 40);
    }
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined;
    return (guild && IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon ?? undefined, size: 40 })) || IconUtils.getDefaultAvatarURL(channelId);
}

function countText({ channelId, mentions, replies }: Entry) {
    const parts: string[] = [];
    if (mentions) parts.push(ChannelStore.getChannel(channelId)?.isPrivate() ? plural(mentions, "new message") : plural(mentions, "mention"));
    if (replies) parts.push(plural(replies, "reply", "replies"));
    return humanFriendlyJoin(parts);
}

function jump({ channelId, lastId }: Entry) {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id || "@me";
    NavigationRouter.transitionTo(`/channels/${guildId}/${channelId}${lastId ? `/${lastId}` : ""}`);
}

function SummaryModal({ modalProps, entries, since }: { modalProps: RenderModalProps; entries: Entry[]; since: number; }) {
    return (
        <Modal
            {...modalProps}
            size="md"
            title="While you were away"
            subtitle={since ? `Mentions, DMs and replies since you left ${moment(since).fromNow()}.` : "Your unread mentions and DMs from before Discord started."}
            actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}
        >
            <div className={cl("list")}>
                {entries.map(entry => {
                    const text = entry.lastId && MessageStore.getMessage(entry.channelId, entry.lastId)?.content;
                    return (
                        <Clickable key={entry.channelId} className={cl("row")} onClick={() => { modalProps.onClose(); jump(entry); }}>
                            <img className={cl("icon")} src={iconOf(entry.channelId)} alt="" />
                            <div className={cl("body")}>
                                <div className={cl("meta")}>
                                    <span className={cl("name")}>{nameOf(entry.channelId)}</span>
                                    <span className={cl("count")}>{countText(entry)}</span>
                                </div>
                                {text && <div className={cl("text")}>{text}</div>}
                            </div>
                        </Clickable>
                    );
                })}
            </div>
        </Modal>
    );
}

function summarize(since: number) {
    const entries = new Map<string, Entry>();
    for (const [channelId, count] of mentionCounts()) {
        const mentions = count - (baseline.get(channelId) ?? 0);
        if (mentions > 0) entries.set(channelId, { channelId, mentions, replies: 0, lastId: latest.get(channelId) });
    }
    for (const [channelId, count] of replies) {
        if (!ReadStateStore.hasUnread(channelId)) continue;
        entries.set(channelId, { channelId, mentions: entries.get(channelId)?.mentions ?? 0, replies: count, lastId: latest.get(channelId) });
    }
    const list = [...entries.values()].filter(e => ChannelStore.getChannel(e.channelId)).sort((a, b) => b.mentions + b.replies - a.mentions - a.replies);
    if (!list.length) return;

    const dms = list.filter(e => ChannelStore.getChannel(e.channelId)?.isPrivate());
    const servers = list.filter(e => e.mentions && !ChannelStore.getChannel(e.channelId)?.isPrivate());
    const replyCount = list.reduce((sum, e) => sum + e.replies, 0);
    const parts: string[] = [];
    if (dms.length) parts.push(`${plural(dms.reduce((sum, e) => sum + e.mentions, 0), "DM")} in ${plural(dms.length, "chat")}`);
    if (servers.length) parts.push(`${plural(servers.reduce((sum, e) => sum + e.mentions, 0), "mention")} in ${plural(servers.length, "channel")}`);
    if (replyCount) parts.push(plural(replyCount, "reply", "replies"));

    showNotification({
        title: "While you were away",
        body: `${humanFriendlyJoin(parts)}. Click to see them.`,
        onClick: () => openModal(props => <SummaryModal modalProps={props} entries={list} since={since} />)
    });
}

export default definePlugin({
    name: "WhileYouWereAway",
    description: "When you come back to Discord, sums up the mentions, DMs and replies you got while you were gone.",
    tags: ["Notifications", "Chat"],
    authors: [Devs.K3],
    settings,

    flux: {
        WINDOW_FOCUS: check,
        IDLE: check,
        POST_CONNECTION_OPEN() {
            if (launched) return;
            launched = true;
            if (settings.store.onLaunch) leave(0);
            check();
        },
        MESSAGE_CREATE({ channelId, message, optimistic }: { channelId: string; message: RawMessage; optimistic?: boolean; }) {
            const me = UserStore.getCurrentUser().id;
            if (awaySince === undefined || optimistic || message.author.id === me) return;
            const isPrivate = ChannelStore.getChannel(channelId)?.isPrivate();
            const mentioned = message.mentions.some(u => u.id === me);
            const reply = message.referenced_message?.author.id === me;
            if (isPrivate || mentioned || reply) latest.set(channelId, message.id);
            if (reply && !mentioned && !isPrivate && settings.store.includeReplies) replies.set(channelId, (replies.get(channelId) ?? 0) + 1);
        }
    },

    stop() {
        awaySince = undefined;
        replies.clear();
        latest.clear();
    }
});
