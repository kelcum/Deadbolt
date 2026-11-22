/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, MediaEngineStore, VoiceActions } from "@webpack/common";

const settings = definePluginSettings({
    deafen: {
        type: OptionType.BOOLEAN,
        description: "Also deafen you when you join.",
        default: false
    },
    onSwitch: {
        type: OptionType.BOOLEAN,
        description: "Also mute you when you move from one voice channel to another.",
        default: false
    },
    calls: {
        type: OptionType.BOOLEAN,
        description: "Also mute you when you join a DM or group call.",
        default: true
    }
});

function applyMute() {
    const { deafen } = settings.store;
    if (deafen && !MediaEngineStore.isSelfDeaf()) VoiceActions.toggleSelfDeaf();
    else if (!MediaEngineStore.isSelfMute()) VoiceActions.toggleSelfMute();
}

export default definePlugin({
    name: "JoinMuted",
    description: "Mutes your mic whenever you join a voice channel or call, so you choose when people can hear you.",
    authors: [Devs.K3],
    settings,

    flux: {
        VOICE_CHANNEL_SELECT({ channelId, currentVoiceChannelId }: { channelId: string | null; currentVoiceChannelId: string | null; }) {
            if (!channelId || channelId === currentVoiceChannelId) return;
            if (currentVoiceChannelId && !settings.store.onSwitch) return;
            if (!settings.store.calls && ChannelStore.getChannel(channelId)?.isPrivate()) return;
            setTimeout(applyMute, 0);
        }
    }
});
