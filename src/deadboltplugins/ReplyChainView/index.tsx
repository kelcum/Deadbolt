/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { LogIcon } from "@components/Icons";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, RenderModalProps } from "@vencord/discord-types";
import { MessageReferenceType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, Constants, MessageActions, MessageStore, Modal, openModal, ReferencedMessageStore, RestAPI, useStateFromStores } from "@webpack/common";
import type { ComponentType } from "react";

const cl = classNameFactory("vc-replychain-");
const logger = new Logger("ReplyChainView");
const ChannelMessage = findComponentByCodeLazy("isFirstMessageInForumPost", "trackAnnouncementViews") as ComponentType<Record<string, unknown>>;
const MessageDisplayCompact = getUserSettingLazy<boolean>("textAndImages", "messageDisplayCompact");

const settings = definePluginSettings({
    maxDepth: {
        type: OptionType.SLIDER,
        description: "How many earlier messages to follow up the chain at most.",
        markers: [5, 10, 25, 50, 100],
        default: 25
    },
    showReplies: {
        type: OptionType.BOOLEAN,
        description: "Also show the loaded replies that came after the message.",
        default: true
    }
});

type Reference = NonNullable<Message["messageReference"]>;

const isReply = (ref: Message["messageReference"]): ref is Reference => ref != null && ref.type !== MessageReferenceType.FORWARD;

async function getMessage(ref: Reference): Promise<Message | undefined> {
    const cached = MessageStore.getMessage(ref.channel_id, ref.message_id) ?? ReferencedMessageStore.getMessageByReference(ref)?.message;
    if (cached) return cached;

    const res = await RestAPI.get({
        url: Constants.Endpoints.MESSAGES(ref.channel_id),
        query: { limit: 1, around: ref.message_id },
        retries: 2
    }).catch(e => logger.warn("Could not fetch a message in the chain", e));
    const raw = res?.body?.[0];
    if (raw?.id !== ref.message_id) return;

    return MessageStore.getMessages(ref.channel_id).receiveMessage(raw).get(ref.message_id);
}

async function getAncestors(message: Message) {
    const list: Message[] = [];
    let ref = message.messageReference;
    while (isReply(ref) && list.length < settings.store.maxDepth) {
        const parent = await getMessage(ref);
        if (!parent) return { list, broken: true };
        list.unshift(parent);
        ref = parent.messageReference;
    }
    return { list, broken: false };
}

function getLoadedReplies(message: Message) {
    const ids = new Set([message.id]);
    return MessageStore.getMessages(message.channel_id)._array.filter(m => {
        if (!isReply(m.messageReference) || !ids.has(m.messageReference.message_id)) return false;
        ids.add(m.id);
        return true;
    });
}

const sameMessages = (a: Message[], b: Message[]) => a.length === b.length && a.every((m, i) => m === b[i]);

function ChainEntry({ message, current, onJump }: { message: Message; current?: boolean; onJump(message: Message): void; }) {
    return (
        <div className={cl("entry", { current })}>
            <ChannelMessage
                id={`vc-replychain-${message.id}`}
                message={message}
                channel={ChannelStore.getChannel(message.channel_id)}
                subscribeToComponentDispatch={false}
                compact={MessageDisplayCompact?.getSetting()}
            />
            <Button size="small" variant="secondary" className={cl("jump")} onClick={() => onJump(message)}>Jump</Button>
        </div>
    );
}

function ChainModal({ modalProps, message }: { modalProps: RenderModalProps; message: Message; }) {
    const [ancestors, , pending] = useAwaiter(() => getAncestors(message), { fallbackValue: { list: [], broken: false } });
    const replies = useStateFromStores(
        [MessageStore],
        () => settings.store.showReplies ? getLoadedReplies(message) : [],
        [message],
        sameMessages
    );

    const jump = (m: Message) => {
        modalProps.onClose();
        MessageActions.jumpToMessage({ channelId: m.channel_id, messageId: m.id, flash: true, jumpType: "INSTANT" });
    };

    return (
        <Modal {...modalProps} title="Reply chain" size="lg">
            {pending && <Text size="sm" color="text-muted" className={cl("note")}>Loading earlier messages...</Text>}
            {ancestors.broken && <Text size="sm" color="text-muted" className={cl("note")}>The chain starts with a message that was deleted or can't be loaded.</Text>}
            {ancestors.list.map(m => <ChainEntry key={m.id} message={m} onJump={jump} />)}
            <ChainEntry message={message} current onJump={jump} />
            {replies.length > 0 && <Text size="xs" weight="semibold" color="text-muted" className={classes(cl("note"), cl("divider"))}>Replies</Text>}
            {replies.map(m => <ChainEntry key={m.id} message={m} onJump={jump} />)}
        </Modal>
    );
}

export default definePlugin({
    name: "ReplyChainView",
    description: "Shows a message's whole reply chain, from the first message down to its replies, in one window.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    messagePopoverButton: {
        icon: LogIcon,
        render(message) {
            if (!isReply(message.messageReference) && !getLoadedReplies(message).length) return null;
            return {
                label: "View Reply Chain",
                icon: LogIcon,
                onClick: () => openModal(props => (
                    <ErrorBoundary>
                        <ChainModal modalProps={props} message={message} />
                    </ErrorBoundary>
                ))
            };
        }
    }
});
