/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Menu, RelationshipStore } from "@webpack/common";

interface MessageEvent {
    message: { author: { id: string; }; };
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

const isTime = (value: string) => TIME.test(value) || "Use 24 hour time, like 23:00.";

const settings = definePluginSettings({
    start: {
        type: OptionType.STRING,
        description: "When quiet hours start, in 24 hour time.",
        default: "23:00",
        isValid: isTime
    },
    end: {
        type: OptionType.STRING,
        description: "When quiet hours end, in 24 hour time.",
        default: "07:00",
        isValid: isTime
    },
    allowFriends: {
        type: OptionType.BOOLEAN,
        description: "Let messages from all your friends through.",
        default: false
    },
    allowedUsers: {
        type: OptionType.STRING,
        description: "User IDs that can still reach you, separated by commas. You can also right click someone to add them.",
        default: ""
    }
});

function toMinutes(value: string) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
}

function isQuietNow() {
    const start = toMinutes(settings.store.start);
    const end = toMinutes(settings.store.end);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

const allowedIds = () => settings.store.allowedUsers.split(/[\s,]+/).filter(Boolean);

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
    const ids = allowedIds();
    const allowed = ids.includes(user.id);
    children.push(
        <Menu.MenuCheckboxItem
            id="vc-quiet-hours-allow"
            label="Allow During Quiet Hours"
            checked={allowed}
            action={() => {
                settings.store.allowedUsers = (allowed ? ids.filter(id => id !== user.id) : [...ids, user.id]).join(", ");
            }}
        />
    );
};

export default definePlugin({
    name: "QuietHours",
    description: "Silences message notifications and their sounds on a daily schedule, while chosen people still get through.",
    tags: ["Notifications"],
    authors: [Devs.K3],
    settings,
    contextMenus: {
        "user-context": userContext
    },
    patches: [
        {
            find: '"NotificationStore"',
            replacement: {
                match: /(?<=MESSAGE_CREATE:)\i(?=[,}])/,
                replace: "$self.wrap($&)"
            }
        }
    ],
    shouldSilence({ message }: MessageEvent) {
        if (!isQuietNow()) return false;
        const { id } = message.author;
        return !allowedIds().includes(id) && !(settings.store.allowFriends && RelationshipStore.isFriend(id));
    },
    wrap(handler: (event: MessageEvent) => unknown) {
        return (event: MessageEvent) => this.shouldSilence(event) ? false : handler(event);
    }
});
