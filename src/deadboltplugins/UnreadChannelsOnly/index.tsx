/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Channel, Guild } from "@vencord/discord-types";
import { FluxDispatcher, Menu } from "@webpack/common";

const settings = definePluginSettings({}).withPrivateSettings<{
    guilds?: string[];
}>();

let active = new Set<string>();

function toggle(guildId: string) {
    if (!active.delete(guildId)) active.add(guildId);
    settings.store.guilds = [...active];
    FluxDispatcher.dispatch({ type: "USER_GUILD_SETTINGS_FULL_UPDATE", userGuildSettings: [] });
}

const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    const item = (
        <Menu.MenuCheckboxItem
            id="vc-unread-channels-only"
            label="Show Unread Channels Only"
            checked={active.has(guild.id)}
            action={() => toggle(guild.id)}
        />
    );
    const group = findGroupChildrenByChildId("hide-muted-channels", children);
    if (group) group.splice(group.findIndex(c => c?.props?.id === "hide-muted-channels") + 1, 0, item);
    else children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "UnreadChannelsOnly",
    description: "Adds Show Unread Channels Only to a server's menu, which hides every channel without new messages in that server until you turn it off.",
    tags: ["Servers", "Organisation"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: '"placeholder-channel-id"',
            replacement: {
                match: /(?<=(\i)=[^;]{0,40}?\i\(this\.record,.{0,5},\i\.hideMutedChannels\);)/,
                replace: "$1=$1||$self.isHidden(this.record);"
            }
        }
    ],

    contextMenus: {
        "guild-header-popout": guildMenu,
        "guild-context": guildMenu
    },

    isHidden(channel: Channel) {
        return active.has(channel.guild_id);
    },

    start() {
        active = new Set(settings.store.guilds);
    }
});
