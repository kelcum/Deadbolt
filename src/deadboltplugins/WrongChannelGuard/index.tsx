/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, ChannelStore, DraftStore, DraftType, SelectedChannelStore, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    windowSeconds: {
        type: OptionType.NUMBER,
        description: "How many seconds after opening a chat a send still gets checked.",
        default: 15
    },
    staleDrafts: {
        type: OptionType.BOOLEAN,
        description: "Warn when the message is an old draft that was already waiting in the chat you just opened.",
        default: true
    },
    typingElsewhere: {
        type: OptionType.BOOLEAN,
        description: "Warn when you were typing in another chat right before switching.",
        default: true
    }
});

const TYPING_LOOKBACK_MS = 30_000;
const CONFIRM_WINDOW_MS = 15_000;

let currentChannelId: string | null = null;
let arrivedAt = 0;
let arrivalDraft = "";
let typedBeforeArrival: { channelId: string; at: number; } | null = null;
let lastTyped: { channelId: string; at: number; } | null = null;
const armed = new Map<string, { expires: number; timer: ReturnType<typeof setTimeout>; }>();

function clearArmed() {
    for (const entry of armed.values()) clearTimeout(entry.timer);
    armed.clear();
}

function chatLabel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "another chat";
    if (channel.isDM()) {
        const user = UserStore.getUser(channel.getRecipientId() ?? "");
        return user ? `your DM with ${user.globalName ?? user.username}` : "a DM";
    }
    if (channel.isGroupDM()) return channel.name ? `the group chat ${channel.name}` : "a group chat";
    return `#${channel.name}`;
}

function arrive(channelId: string | null) {
    if (channelId === currentChannelId) return;
    currentChannelId = channelId;
    arrivedAt = Date.now();
    arrivalDraft = channelId ? DraftStore.getDraft(channelId, DraftType.ChannelMessage).trim() : "";
    typedBeforeArrival = lastTyped;
}

function reason(channelId: string, content: string) {
    if (channelId !== currentChannelId || Date.now() - arrivedAt > settings.store.windowSeconds * 1000) return null;

    const { staleDrafts, typingElsewhere } = settings.store;
    if (staleDrafts && arrivalDraft && content.includes(arrivalDraft))
        return "This message was already sitting in this chat's text box from earlier, so it may not be what you meant to send now.";

    if (typingElsewhere && typedBeforeArrival && typedBeforeArrival.channelId !== channelId && arrivedAt - typedBeforeArrival.at < TYPING_LOOKBACK_MS)
        return `You were typing in ${chatLabel(typedBeforeArrival.channelId)} a moment before switching here.`;

    return null;
}

export default definePlugin({
    name: "WrongChannelGuard",
    description: "Holds back a message sent right after switching chats when it looks meant for somewhere else, and sends it if you press send again.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    settings,

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            arrive(channelId);
        },
        DRAFT_SAVE({ channelId, draft, draftType }: { channelId: string; draft: string; draftType: number; }) {
            if (draftType === DraftType.ChannelMessage && draft.trim()) lastTyped = { channelId, at: Date.now() };
        }
    },

    onBeforeMessageSend(channelId, messageObj) {
        const content = messageObj.content.trim();
        if (!content) return;

        const why = reason(channelId, content);
        if (!why) return;

        const key = `${channelId}:${content}`;
        const prior = armed.get(key);
        if (prior) {
            clearTimeout(prior.timer);
            armed.delete(key);
            if (prior.expires > Date.now()) return;
        }

        if (armed.size >= 100) clearArmed();
        const timer = setTimeout(() => {
            if (armed.get(key)?.timer === timer) armed.delete(key);
        }, CONFIRM_WINDOW_MS);
        armed.set(key, { expires: Date.now() + CONFIRM_WINDOW_MS, timer });

        Alerts.show({
            title: "Right chat?",
            body: (
                <p>
                    You just switched to {chatLabel(channelId)}. {why}
                    <br />
                    If this is the right place, press send again within 15 seconds.
                </p>
            ),
            confirmText: "Got it"
        });

        return { cancel: true };
    },

    start() {
        currentChannelId = SelectedChannelStore.getChannelId();
        arrivedAt = 0;
    },

    stop() {
        currentChannelId = null;
        typedBeforeArrival = null;
        lastTyped = null;
        clearArmed();
    }
});
