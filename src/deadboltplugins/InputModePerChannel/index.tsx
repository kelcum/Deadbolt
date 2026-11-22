/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Guild, VoiceMode } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, MediaEngineStore, Menu, SelectedChannelStore } from "@webpack/common";

const MODES = [
    { label: "Voice Activity", value: "VOICE_ACTIVITY" },
    { label: "Push to Talk", value: "PUSH_TO_TALK" }
] as const;

const settings = definePluginSettings({
    callMode: {
        type: OptionType.SELECT,
        description: "Input mode for calls in DMs and group chats.",
        options: [
            { label: "Leave as is", value: "", default: true },
            ...MODES
        ]
    }
}).withPrivateSettings<{
    rules?: Record<string, VoiceMode>;
    previous?: VoiceMode;
    applied?: VoiceMode;
}>();

function setMode(mode: VoiceMode) {
    FluxDispatcher.dispatch({ type: "AUDIO_SET_MODE", context: "default", mode, options: MediaEngineStore.getModeOptions() });
}

function targetFor(channel: Channel | undefined): VoiceMode | undefined {
    if (!channel) return;
    const rules = settings.store.rules ?? {};
    if (channel.guild_id) return rules[channel.id] ?? rules[channel.guild_id];
    return settings.store.callMode || undefined;
}

function apply(channelId: string | null | undefined) {
    const target = targetFor(channelId ? ChannelStore.getChannel(channelId) : undefined);
    const current = MediaEngineStore.getMode();
    const { previous, applied } = settings.store;

    if (target) {
        if (!applied) settings.store.previous = current;
        settings.store.applied = target;
        if (current !== target) setMode(target);
    } else if (applied) {
        if (previous && current === applied && previous !== current) setMode(previous);
        settings.store.previous = undefined;
        settings.store.applied = undefined;
    }
}

function setRule(id: string, mode: VoiceMode | undefined) {
    const rules = { ...settings.store.rules };
    if (mode) rules[id] = mode;
    else delete rules[id];
    settings.store.rules = rules;
    apply(SelectedChannelStore.getVoiceChannelId());
}

function inputModeMenu(id: string, label: string) {
    const current = settings.store.rules?.[id];
    return (
        <Menu.MenuItem id="vc-input-mode-per-channel" label={label}>
            <Menu.MenuRadioItem
                id="vc-input-mode-per-channel-default"
                group="vc-input-mode-per-channel"
                label="Use My Default"
                checked={!current}
                action={() => setRule(id, undefined)}
            />
            {MODES.map(m => (
                <Menu.MenuRadioItem
                    key={m.value}
                    id={`vc-input-mode-per-channel-${m.value}`}
                    group="vc-input-mode-per-channel"
                    label={m.label}
                    checked={current === m.value}
                    action={() => setRule(id, m.value)}
                />
            ))}
        </Menu.MenuItem>
    );
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel?.isGuildVocal()) return;
    children.push(<Menu.MenuGroup>{inputModeMenu(channel.id, "Input Mode Here")}</Menu.MenuGroup>);
};

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(<Menu.MenuGroup>{inputModeMenu(guild.id, "Input Mode in Server")}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "InputModePerChannel",
    description: "Switches between push to talk and voice activity on its own when you join a voice channel, server or call you picked a mode for. Right click a voice channel or server to choose.",
    tags: ["Voice"],
    authors: [Devs.K3],
    settings,
    contextMenus: {
        "channel-context": channelContext,
        "guild-context": guildContext
    },
    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            apply(channelId);
        }
    },
    start() {
        apply(SelectedChannelStore.getVoiceChannelId());
    },
    stop() {
        apply(null);
    }
});
