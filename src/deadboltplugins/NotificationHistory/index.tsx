/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { ChannelStore, Clickable, GuildMemberStore, GuildStore, IconUtils, Modal, NavigationRouter, openModal, RelationshipStore, SelectedChannelStore, UserGuildSettingsStore, UserStore, WindowStore, zustandCreate } from "@webpack/common";

const cl = classNameFactory("vc-notifhistory-");

interface RawMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    content: string;
    author: { id: string; username: string; global_name?: string | null; };
    attachments?: unknown[];
    embeds?: unknown[];
    sticker_items?: unknown[];
    mentions?: { id: string; }[];
    mention_roles?: string[];
    mention_everyone?: boolean;
}

interface Entry {
    id: string;
    channelId: string;
    guildId?: string;
    authorId: string;
    authorName: string;
    text: string;
    at: number;
}

interface HistoryState {
    entries: Entry[];
    lastOpened: number;
}

interface HistoryStore {
    <T>(selector: (state: HistoryState) => T): T;
    getState(): HistoryState;
    setState(partial: Partial<HistoryState> | ((state: HistoryState) => Partial<HistoryState>)): void;
}

const useHistory: HistoryStore = proxyLazy(() => zustandCreate(() => ({ entries: [], lastOpened: Date.now() })));
const shouldNotify: (message: RawMessage, channelId: string) => boolean = findByCodeLazy(".SUPPRESS_NOTIFICATIONS))return!1");

const SETTING_KEYS: "showCount"[] = ["showCount"];

const settings = definePluginSettings({
    maxEntries: {
        type: OptionType.SLIDER,
        description: "How many notifications to keep. The oldest ones drop off first.",
        markers: [50, 100, 200, 500],
        default: 100
    },
    showCount: {
        type: OptionType.BOOLEAN,
        description: "Show a dot on the bell when notifications arrived since you last opened it.",
        default: true
    }
});

function isForMe(m: RawMessage, me: string) {
    const channel = ChannelStore.getChannel(m.channel_id);
    if (!channel || RelationshipStore.isBlocked(m.author.id)) return false;
    if (channel.isPrivate()) return !UserGuildSettingsStore.isChannelMuted(null, channel.id);
    if (m.mentions?.some(u => u.id === me)) return true;
    if (m.mention_everyone) return !UserGuildSettingsStore.isSuppressEveryoneEnabled(channel.guild_id);
    const roles = GuildMemberStore.getMember(channel.guild_id, me)?.roles ?? [];
    return !!m.mention_roles?.some(r => roles.includes(r)) && !UserGuildSettingsStore.isSuppressRolesEnabled(channel.guild_id);
}

function previewOf(m: RawMessage) {
    const text = m.content
        .replace(/<@!?(\d+)>/g, (_, id: string) => `@${UserStore.getUser(id)?.username ?? "someone"}`)
        .replace(/<#(\d+)>/g, (_, id: string) => `#${ChannelStore.getChannel(id)?.name ?? "channel"}`)
        .replace(/<@&\d+>/g, "@role")
        .replace(/<a?:(\w+):\d+>/g, ":$1:")
        .trim();
    if (text) return text.length > 300 ? `${text.slice(0, 300)}…` : text;
    if (m.attachments?.length) return "Sent an attachment.";
    if (m.sticker_items?.length) return "Sent a sticker.";
    if (m.embeds?.length) return "Sent an embed.";
    return "Sent a message.";
}

function placeOf(e: Entry) {
    const channel = ChannelStore.getChannel(e.channelId);
    if (!channel) return "Unknown channel";
    if (channel.isDM()) return "Direct message";
    if (channel.isGroupDM()) return channel.name || "Group DM";
    const guild = GuildStore.getGuild(e.guildId ?? channel.guild_id);
    return guild ? `#${channel.name} in ${guild.name}` : `#${channel.name}`;
}

function timeOf(at: number) {
    const t = new Date(at);
    return t.toDateString() === new Date().toDateString()
        ? t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : t.toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Row({ entry, isNew, onJump }: { entry: Entry; isNew: boolean; onJump(): void; }) {
    const user = UserStore.getUser(entry.authorId);
    const name = (entry.guildId && GuildMemberStore.getNick(entry.guildId, entry.authorId)) || user?.globalName || entry.authorName;
    const avatar = user ? user.getAvatarURL(entry.guildId, 40) : IconUtils.getDefaultAvatarURL(entry.authorId);

    return (
        <Clickable className={cl("row", { new: isNew })} onClick={onJump}>
            <img className={cl("avatar")} src={avatar} alt="" />
            <div className={cl("body")}>
                <div className={cl("meta")}>
                    <span className={cl("name")}>{name}</span>
                    <span className={cl("place")}>{placeOf(entry)}</span>
                    <span className={cl("time")}>{timeOf(entry.at)}</span>
                </div>
                <div className={cl("text")}>{entry.text}</div>
            </div>
        </Clickable>
    );
}

function HistoryModal({ modalProps, since }: { modalProps: RenderModalProps; since: number; }) {
    const entries = useHistory(s => s.entries);

    const jump = (e: Entry) => {
        modalProps.onClose();
        NavigationRouter.transitionTo(`/channels/${e.guildId ?? "@me"}/${e.channelId}/${e.id}`);
    };

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Notification history"
            subtitle="Your DMs, mentions and other notifications since Discord started, even on Do Not Disturb. Click one to jump to it."
            actions={[
                { text: "Clear", variant: "secondary", disabled: !entries.length, onClick: () => useHistory.setState({ entries: [] }) },
                { text: "Close", variant: "primary", onClick: modalProps.onClose }
            ]}
        >
            {entries.length
                ? <div className={cl("list")}>{entries.map(e => <Row key={e.id} entry={e} isNew={e.at > since} onJump={() => jump(e)} />)}</div>
                : <Paragraph className={cl("empty")}>No notifications yet. They show up here as Discord sends them.</Paragraph>}
        </Modal>
    );
}

function openHistory() {
    const since = useHistory.getState().lastOpened;
    useHistory.setState({ lastOpened: Date.now() });
    openModal(props => <HistoryModal modalProps={props} since={since} />);
}

function BellIcon({ width, height }: { width?: number; height?: number; }) {
    const { showCount } = settings.use(SETTING_KEYS);
    const unseen = useHistory(s => s.entries.some(e => e.at > s.lastOpened));

    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a6 6 0 0 0-6 6v3.6l-1.7 3.4A1 1 0 0 0 5.2 16.5h13.6a1 1 0 0 0 .9-1.5L18 11.6V8a6 6 0 0 0-6-6Zm-3 16a3 3 0 0 0 6 0H9Z" />
            {showCount && unseen && <circle className={cl("dot")} cx="19" cy="5" r="4" />}
        </svg>
    );
}

function HistoryButton() {
    const count = useHistory(s => s.entries.filter(e => e.at > s.lastOpened).length);
    return <HeaderBarButton icon={BellIcon} tooltip={count ? `Notification history (${count} new)` : "Notification history"} onClick={openHistory} />;
}

export default definePlugin({
    name: "NotificationHistory",
    description: "Keeps a list of the notifications Discord showed you, so you can catch up on what you missed and jump to any of them.",
    tags: ["Notifications", "Utility"],
    authors: [Devs.K3],
    settings,

    headerBarButton: {
        icon: BellIcon,
        render: HistoryButton
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic: boolean; }) {
            const me = UserStore.getCurrentUser().id;
            if (optimistic || message.author.id === me) return;
            if (WindowStore.isFocused() && SelectedChannelStore.getChannelId() === message.channel_id) return;
            if (!shouldNotify(message, message.channel_id) && !isForMe(message, me)) return;

            const entry: Entry = {
                id: message.id,
                channelId: message.channel_id,
                guildId: message.guild_id,
                authorId: message.author.id,
                authorName: message.author.global_name || message.author.username,
                text: previewOf(message),
                at: Date.now()
            };
            useHistory.setState(s => ({ entries: [entry, ...s.entries].slice(0, settings.store.maxEntries) }));
        },
        MESSAGE_DELETE({ id }: { id: string; }) {
            useHistory.setState(s => ({ entries: s.entries.filter(e => e.id !== id) }));
        }
    },

    stop() {
        useHistory.setState({ entries: [] });
    }
});
