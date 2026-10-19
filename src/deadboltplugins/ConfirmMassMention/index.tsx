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

const CONFIRM_WINDOW_MS = 15_000;

const MENTION_RE = /(?:^|[^\w@])@(everyone|here)\b/;

const armed = new Set<string>();

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Confirm before sending a message containing @everyone or @here",
        default: true
    }
});

function onSend(channelId: string, messageObj: { content: string; }) {
    if (!settings.store.enabled) return;

    const { content } = messageObj;
    const match = MENTION_RE.exec(content);
    if (!match) return;

    const key = `${channelId}:${content}`;
    if (armed.has(key)) {
        armed.delete(key);
        return;
    }

    armed.add(key);
    setTimeout(() => armed.delete(key), CONFIRM_WINDOW_MS);

    Alerts.show({
        title: `Send @${match[1]}?`,
        body: (
            <p>
                This message will ping <b>@{match[1]}</b> — everyone {match[1] === "here" ? "currently online in" : "in"} this channel will be notified.
                <br />
                Press send again within 15 seconds if that's what you meant.
            </p>
        ),
        confirmText: "Got it"
    });

    return { cancel: true };
}

export default definePlugin({
    name: "ConfirmMassMention",
    description: "Asks for confirmation before sending a message that pings @everyone or @here, so a typo or fat-finger doesn't blast the whole channel.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    settings,

    start() {
        addMessagePreSendListener(onSend);
    },
    stop() {
        removeMessagePreSendListener(onSend);
        armed.clear();
    }
});
