/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { ApplicationStreamingStore, ChannelStore, Menu } from "@webpack/common";

const settings = definePluginSettings({
    allDMs: {
        type: OptionType.BOOLEAN,
        description: "Blur every DM and group DM, not only the ones you picked.",
        default: false,
        onChange: refresh
    },
    onlyWhileSharing: {
        type: OptionType.BOOLEAN,
        description: "Only blur while you share your screen. Turn this off to keep them blurred all the time.",
        default: true,
        onChange: refresh
    },
    strength: {
        type: OptionType.SLIDER,
        description: "How strong the blur is.",
        markers: [4, 8, 12, 16, 24],
        default: 12,
        onChange: refresh
    },
    channels: {
        type: OptionType.CUSTOM,
        description: "Channels and DMs to blur.",
        default: [] as string[],
        hidden: true
    }
});

let style: HTMLStyleElement | undefined;

function refresh() {
    const { allDMs, onlyWhileSharing, strength, channels } = settings.store;
    const sharing = !onlyWhileSharing || ApplicationStreamingStore.getCurrentUserActiveStream() != null;
    const ids = !sharing ? [] : allDMs ? [...new Set([...channels, ...Object.keys(ChannelStore.getMutablePrivateChannels())])] : channels;
    const selectors = ids.filter(id => /^\d+$/.test(id)).flatMap(id => [`[data-list-item-id$="___${id}"]`, `[id^="chat-messages-${id}-"]`]);
    if (!selectors.length) {
        style?.remove();
        style = undefined;
        return;
    }
    const css = `:is(${selectors.join(",")}) { filter: blur(${strength}px); }`;
    if (style?.textContent === css) return;
    style ??= document.head.appendChild(document.createElement("style"));
    style.textContent = css;
}

function toggle(id: string) {
    const { channels } = settings.store;
    settings.store.channels = channels.includes(id) ? channels.filter(c => c !== id) : [...channels, id];
    refresh();
}

function menuItem(id: string) {
    return (
        <Menu.MenuItem
            id="vc-screenshare-blur"
            label={settings.store.channels.includes(id) ? "Stop Blurring While Sharing" : "Blur While Sharing"}
            action={() => toggle(id)}
        />
    );
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (channel) children.push(menuItem(channel.id));
};

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    const id = user && ChannelStore.getDMFromUserId(user.id);
    if (id) children.push(menuItem(id));
};

export default definePlugin({
    name: "ScreenshareBlur",
    description: "Blurs the channels and DMs you pick, names and messages included, while you share your screen.",
    tags: ["Privacy", "Voice"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        "channel-context": channelContext,
        "thread-context": channelContext,
        "gdm-context": channelContext,
        "user-context": userContext
    },

    start() {
        ApplicationStreamingStore.addChangeListener(refresh);
        ChannelStore.addChangeListener(refresh);
        refresh();
    },

    stop() {
        ApplicationStreamingStore.removeChangeListener(refresh);
        ChannelStore.removeChangeListener(refresh);
        style?.remove();
        style = undefined;
    }
});
