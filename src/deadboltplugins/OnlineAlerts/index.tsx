/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { openPrivateChannel } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { IconUtils, Menu, PresenceStore, RelationshipStore, UserStore } from "@webpack/common";

interface PresenceUpdate {
    user: { id: string; };
    status: string;
    activities?: { type: number; name: string; }[];
}

interface Seen {
    online: boolean;
    games: string[];
}

const COOLDOWN = 5 * 60_000;

const settings = definePluginSettings({
    watchedUsers: {
        type: OptionType.STRING,
        description: "User IDs to watch, separated by commas. You can also right click someone to add them.",
        default: ""
    },
    allFriends: {
        type: OptionType.BOOLEAN,
        description: "Watch all your friends.",
        default: false
    },
    onlineAlerts: {
        type: OptionType.BOOLEAN,
        description: "Alert when a watched person comes online.",
        default: true
    },
    gameAlerts: {
        type: OptionType.BOOLEAN,
        description: "Alert when a watched person starts playing a game.",
        default: true
    },
    games: {
        type: OptionType.STRING,
        description: "Only alert for these games, separated by commas. Leave empty for any game.",
        default: ""
    }
});

const seen = new Map<string, Seen>();
const lastAlert = new Map<string, number>();

const watchedIds = () => settings.store.watchedUsers.split(/[\s,]+/).filter(Boolean);

const isWatched = (id: string) => watchedIds().includes(id) || (settings.store.allFriends && RelationshipStore.isFriend(id));

const gamesOf = (activities: PresenceUpdate["activities"]) => (activities ?? []).filter(a => a.type === 0).map(a => a.name);

function alert(id: string, body: string) {
    const user = UserStore.getUser(id);
    if (!user) return;
    showNotification({
        title: user.globalName ?? user.username,
        body,
        icon: IconUtils.getUserAvatarURL(user, false, 128),
        onClick: () => openPrivateChannel(id)
    });
}

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.bot || user.id === UserStore.getCurrentUser().id) return;
    const ids = watchedIds();
    const watched = ids.includes(user.id);
    children.push(
        <Menu.MenuCheckboxItem
            id="vc-online-alerts-watch"
            label="Online Alerts"
            checked={watched}
            action={() => {
                settings.store.watchedUsers = (watched ? ids.filter(id => id !== user.id) : [...ids, user.id]).join(", ");
            }}
        />
    );
};

export default definePlugin({
    name: "OnlineAlerts",
    description: "Notifies you when people you pick come online or start playing a game.",
    tags: ["Notifications", "Friends"],
    authors: [Devs.K3],
    settings,
    contextMenus: {
        "user-context": userContext
    },
    flux: {
        PRESENCE_UPDATES({ updates }: { updates: PresenceUpdate[]; }) {
            for (const { user, status, activities } of updates) {
                if (!isWatched(user.id)) continue;
                const now: Seen = { online: status !== "offline", games: gamesOf(activities) };
                const before = seen.get(user.id);
                seen.set(user.id, now);
                if (!before) continue;

                if (settings.store.onlineAlerts && now.online && !before.online) {
                    const last = lastAlert.get(user.id) ?? 0;
                    if (Date.now() - last > COOLDOWN) {
                        lastAlert.set(user.id, Date.now());
                        alert(user.id, "Just came online.");
                    }
                }

                if (!settings.store.gameAlerts) continue;
                const wanted = settings.store.games.split(",").map(g => g.trim().toLowerCase()).filter(Boolean);
                const started = now.games.find(g => !before.games.includes(g) && (!wanted.length || wanted.includes(g.toLowerCase())));
                if (started) alert(user.id, `Started playing ${started}.`);
            }
        }
    },
    start() {
        for (const id of [...watchedIds(), ...(settings.store.allFriends ? RelationshipStore.getFriendIDs() : [])]) {
            seen.set(id, { online: PresenceStore.getStatus(id) !== "offline", games: gamesOf(PresenceStore.getActivities(id)) });
        }
    },
    stop() {
        seen.clear();
        lastAlert.clear();
    }
});
