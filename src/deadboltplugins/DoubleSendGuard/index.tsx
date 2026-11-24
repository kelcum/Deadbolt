/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    windowSeconds: {
        type: OptionType.NUMBER,
        description: "How many seconds after a message counts as a possible accidental repeat",
        default: 10
    }
});

interface LastSent {
    content: string;
    at: number;
}

const lastSentByChannel = new Map<string, LastSent>();

const armed = new Map<string, { expires: number; timer: ReturnType<typeof setTimeout>; }>();
let accountId: string | undefined;

function reset() {
    lastSentByChannel.clear();
    for (const entry of armed.values()) clearTimeout(entry.timer);
    armed.clear();
}

function currentAccount() {
    const id = UserStore.getCurrentUser()?.id;
    if (id !== accountId) {
        reset();
        accountId = id;
    }
    return id;
}
const ARM_WINDOW_MS = 15_000;

function onSend(channelId: string, messageObj: { content: string; }) {
    if (!currentAccount()) return;
    const content = messageObj.content.trim();
    if (!content) return;

    const key = `${channelId}:${content}`;
    const prior = armed.get(key);
    if (prior) {
        clearTimeout(prior.timer);
        armed.delete(key);
        if (prior.expires > Date.now()) return;
    }

    const last = lastSentByChannel.get(channelId);
    const windowMs = Math.max(1, settings.store.windowSeconds) * 1000;

    if (last && last.content === content && Date.now() - last.at < windowMs) {
        if (armed.size >= 100) {
            for (const entry of armed.values()) clearTimeout(entry.timer);
            armed.clear();
        }
        const timer = setTimeout(() => {
            if (armed.get(key)?.timer === timer) armed.delete(key);
        }, ARM_WINDOW_MS);
        armed.set(key, { expires: Date.now() + ARM_WINDOW_MS, timer });

        Alerts.show({
            title: "Send it again?",
            body: <p>You just sent this exact message in this channel. Press send again if that's what you meant.</p>,
            confirmText: "Got it"
        });

        return { cancel: true };
    }

}

export default definePlugin({
    name: "DoubleSendGuard",
    description: "Warns when you're about to send the exact same message twice in a row in the same channel - catches an accidental double-send from lag or a stray extra Enter.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    settings,

    onBeforeMessageSend: onSend,

    flux: {
        MESSAGE_CREATE({ channelId, message, optimistic }: { channelId: string; message: { id: string; author: { id: string; }; content?: string; state?: string; }; optimistic?: boolean; }) {
            const id = currentAccount();
            if (!id || optimistic || message.author.id !== id || !/^\d{17,20}$/.test(message.id) || (message.state && message.state !== "SENT")) return;
            const content = message.content?.trim();
            if (!content) return;
            lastSentByChannel.delete(channelId);
            lastSentByChannel.set(channelId, { content, at: Date.now() });
            if (lastSentByChannel.size > 100) {
                const oldest = lastSentByChannel.keys().next().value;
                if (oldest !== undefined) lastSentByChannel.delete(oldest);
            }
        }
    },

    stop() {
        reset();
        accountId = undefined;
    }
});
