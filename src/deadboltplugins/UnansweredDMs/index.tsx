/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Clickable, IconUtils, MessageStore, Modal, moment, NavigationRouter, openModal, RelationshipStore, SnowflakeUtils, UserGuildSettingsStore, UserStore, zustandCreate } from "@webpack/common";

const cl = classNameFactory("vc-unanswered-");
const STORE_KEY = "UnansweredDMs_pending";

interface Waiting {
    messageId: string;
    authorId: string;
    dismissed?: true;
}

type Pending = Record<string, Waiting>;

interface PendingStore {
    <T>(selector: (state: { pending: Pending; }) => T): T;
    getState(): { pending: Pending; };
    setState(state: { pending: Pending; }): void;
}

interface RawMessage {
    id: string;
    channel_id: string;
    type: number;
    author: { id: string; bot?: boolean; };
}

const usePending: PendingStore = proxyLazy(() => zustandCreate(() => ({ pending: {} })));

const SETTING_KEYS: ("includeGroups" | "includeMuted")[] = ["includeGroups", "includeMuted"];

const settings = definePluginSettings({
    includeGroups: {
        type: OptionType.BOOLEAN,
        description: "Also list group DMs where someone else spoke last.",
        default: false
    },
    includeMuted: {
        type: OptionType.BOOLEAN,
        description: "Also list DMs you have muted.",
        default: false
    },
    remindAfterHours: {
        type: OptionType.SLIDER,
        description: "Send a reminder once a DM has waited this many hours for your reply. 0 turns reminders off.",
        markers: [0, 1, 4, 12, 24, 48],
        default: 0
    }
});

const reminded = new Set<string>();
let reminderTimer: ReturnType<typeof setInterval> | undefined;

function setPending(pending: Pending) {
    usePending.setState({ pending });
    DataStore.set(STORE_KEY, pending);
}

function record(channelId: string, message: RawMessage) {
    const { pending } = usePending.getState();
    if (message.author.id === UserStore.getCurrentUser().id) {
        if (pending[channelId]) forget(channelId);
        return;
    }
    if (message.author.bot || (message.type !== 0 && message.type !== 19)) return;
    if (pending[channelId]?.messageId === message.id) return;
    setPending({ ...pending, [channelId]: { messageId: message.id, authorId: message.author.id } });
}

function counts(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || channel.isMessageRequest || channel.isSpam) return false;
    if (!channel.isDM() && !(settings.store.includeGroups && channel.isGroupDM())) return false;
    if (channel.isDM() && RelationshipStore.isBlocked(channel.getRecipientId() ?? "")) return false;
    return settings.store.includeMuted || !UserGuildSettingsStore.isChannelMuted(null, channelId);
}

function visible(pending: Pending) {
    return Object.entries(pending)
        .filter(([channelId, waiting]) => !waiting.dismissed && counts(channelId))
        .sort(([, a], [, b]) => SnowflakeUtils.extractTimestamp(a.messageId) - SnowflakeUtils.extractTimestamp(b.messageId));
}

function nameOf(channelId: string, authorId: string) {
    const channel = ChannelStore.getChannel(channelId);
    const user = UserStore.getUser(authorId);
    const author = user?.globalName ?? user?.username ?? "Someone";
    return channel?.isGroupDM() ? `${author} in ${channel.name || "a group DM"}` : author;
}

function jump(channelId: string, messageId: string) {
    NavigationRouter.transitionTo(`/channels/@me/${channelId}/${messageId}`);
}

function forget(channelId: string) {
    const pending = { ...usePending.getState().pending };
    delete pending[channelId];
    reminded.delete(channelId);
    setPending(pending);
}

function dismiss(channelIds: string[]) {
    const { pending } = usePending.getState();
    const next = { ...pending };
    for (const id of channelIds) next[id] = { ...pending[id], dismissed: true };
    setPending(next);
}

function Row({ channelId, waiting, onJump }: { channelId: string; waiting: Waiting; onJump(): void; }) {
    const user = UserStore.getUser(waiting.authorId);
    const avatar = user ? IconUtils.getUserAvatarURL(user, false, 40) : IconUtils.getDefaultAvatarURL(waiting.authorId);
    const text = MessageStore.getMessage(channelId, waiting.messageId)?.content;
    const at = SnowflakeUtils.extractTimestamp(waiting.messageId);

    return (
        <div className={cl("row")}>
            <Clickable className={cl("main")} onClick={onJump}>
                <img className={cl("avatar")} src={avatar} alt="" />
                <div className={cl("body")}>
                    <div className={cl("meta")}>
                        <span className={cl("name")}>{nameOf(channelId, waiting.authorId)}</span>
                        <span className={cl("time")}>waiting {moment(at).fromNow(true)}</span>
                    </div>
                    {text && <div className={cl("text")}>{text}</div>}
                </div>
            </Clickable>
            <Button variant="secondary" size="small" onClick={() => dismiss([channelId])}>Dismiss</Button>
        </div>
    );
}

function PendingModal({ modalProps }: { modalProps: RenderModalProps; }) {
    settings.use(SETTING_KEYS);
    const rows = visible(usePending(s => s.pending));

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Unanswered DMs"
            subtitle="DMs where the other person spoke last and you haven't replied yet, oldest first. Replying removes them, and dismissed ones come back if they message again."
            actions={[
                { text: "Dismiss all", variant: "secondary", disabled: !rows.length, onClick: () => dismiss(rows.map(([channelId]) => channelId)) },
                { text: "Close", variant: "primary", onClick: modalProps.onClose }
            ]}
        >
            {rows.length
                ? <div className={cl("list")}>{rows.map(([channelId, waiting]) => (
                    <Row key={channelId} channelId={channelId} waiting={waiting} onJump={() => { modalProps.onClose(); jump(channelId, waiting.messageId); }} />
                ))}</div>
                : <Paragraph className={cl("empty")}>You're all caught up. DMs show up here when someone messages you and you haven't replied.</Paragraph>}
        </Modal>
    );
}

function InboxIcon({ width, height }: { width?: number; height?: number; }) {
    settings.use(SETTING_KEYS);
    const waiting = visible(usePending(s => s.pending)).length > 0;

    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
            {waiting && <circle className={cl("dot")} cx="20" cy="4" r="4" />}
        </svg>
    );
}

function PendingButton() {
    settings.use(SETTING_KEYS);
    const count = visible(usePending(s => s.pending)).length;
    return <HeaderBarButton icon={InboxIcon} tooltip={count ? `Unanswered DMs (${count})` : "Unanswered DMs"} onClick={() => openModal(props => <PendingModal modalProps={props} />)} />;
}

function remind() {
    const hours = settings.store.remindAfterHours;
    if (!hours) return;
    const cutoff = Date.now() - hours * 3_600_000;
    for (const [channelId, waiting] of visible(usePending.getState().pending)) {
        if (reminded.has(channelId) || SnowflakeUtils.extractTimestamp(waiting.messageId) > cutoff) continue;
        reminded.add(channelId);
        const user = UserStore.getUser(waiting.authorId);
        showNotification({
            title: "Still waiting on your reply",
            body: `${nameOf(channelId, waiting.authorId)} messaged you ${moment(SnowflakeUtils.extractTimestamp(waiting.messageId)).fromNow()}.`,
            icon: user ? IconUtils.getUserAvatarURL(user, false, 128) : undefined,
            onClick: () => jump(channelId, waiting.messageId)
        });
    }
}

export default definePlugin({
    name: "UnansweredDMs",
    description: "Keeps track of DMs where someone is still waiting on your reply, with an optional reminder.",
    tags: ["Chat", "Friends", "Utility"],
    authors: [Devs.K3],
    settings,

    headerBarButton: {
        icon: InboxIcon,
        render: PendingButton
    },

    flux: {
        MESSAGE_CREATE({ channelId, message }: { channelId: string; message: RawMessage; }) {
            if (ChannelStore.getChannel(channelId)?.isPrivate()) record(channelId, message);
        },
        MESSAGE_DELETE({ channelId, id }: { channelId: string; id: string; }) {
            if (usePending.getState().pending[channelId]?.messageId === id) forget(channelId);
        },
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: { channelId: string; messages: RawMessage[]; }) {
            const channel = ChannelStore.getChannel(channelId);
            const newest = messages.find(m => m.id === channel?.lastMessageId);
            if (channel?.isPrivate() && newest) record(channelId, newest);
        },
        CHANNEL_DELETE({ channel }: { channel: { id: string; }; }) {
            if (usePending.getState().pending[channel.id]) forget(channel.id);
        }
    },

    async start() {
        usePending.setState({ pending: await DataStore.get<Pending>(STORE_KEY) ?? {} });
        reminderTimer = setInterval(remind, 60_000);
    },

    stop() {
        if (reminderTimer !== undefined) {
            clearInterval(reminderTimer);
            reminderTimer = undefined;
        }
        reminded.clear();
        usePending.setState({ pending: {} });
    }
});
