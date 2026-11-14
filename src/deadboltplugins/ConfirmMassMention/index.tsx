/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Alerts } from "@webpack/common";

const CONFIRM_WINDOW_MS = 15_000;

const MENTION_RE = /(?:^|[^\w@])@(everyone|here)\b/;

const armed = new Set<string>();

function onSend(channelId: string, messageObj: { content: string; }) {
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

    onBeforeMessageSend: onSend,

    stop() {
        armed.clear();
    }
});
