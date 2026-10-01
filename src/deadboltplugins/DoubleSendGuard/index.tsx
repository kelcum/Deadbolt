/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessagePreSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts } from "@webpack/common";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Warn before sending the exact same message twice in a row in the same channel",
        default: true
    },
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

// Last thing actually sent per channel, so we can tell "you just sent this"
// apart from "you're saying the same thing again an hour later".
const lastSentByChannel = new Map<string, LastSent>();

// `${channelId}:${content}` the user already got warned about once. Sending
// the identical content again while it's armed means they meant it.
const armed = new Set<string>();
const ARM_WINDOW_MS = 15_000;

function onSend(channelId: string, messageObj: { content: string; }) {
    if (!settings.store.enabled) return;

    const content = messageObj.content.trim();
    if (!content) return;

    const key = `${channelId}:${content}`;
    if (armed.has(key)) {
        armed.delete(key);
        lastSentByChannel.set(channelId, { content, at: Date.now() });
        return;
    }

    const last = lastSentByChannel.get(channelId);
    const windowMs = Math.max(1, settings.store.windowSeconds) * 1000;

    if (last && last.content === content && Date.now() - last.at < windowMs) {
        armed.add(key);
        setTimeout(() => armed.delete(key), ARM_WINDOW_MS);

        Alerts.show({
            title: "Send it again?",
            body: <p>You just sent this exact message in this channel. Press send again if that's what you meant.</p>,
            confirmText: "Got it"
        });

        return { cancel: true };
    }

    lastSentByChannel.set(channelId, { content, at: Date.now() });
}

export default definePlugin({
    name: "DoubleSendGuard",
    description: "Warns when you're about to send the exact same message twice in a row in the same channel - catches an accidental double-send from lag or a stray extra Enter.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    settings,

    start() {
        addMessagePreSendListener(onSend);
    },
    stop() {
        removeMessagePreSendListener(onSend);
        lastSentByChannel.clear();
        armed.clear();
    }
});
