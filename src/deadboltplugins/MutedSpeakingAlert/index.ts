/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { MediaEngineStore, VoiceActions, WindowStore } from "@webpack/common";

const settings = definePluginSettings({
    onlyInBackground: {
        type: OptionType.BOOLEAN,
        description: "Only alert while Discord is in the background, since Discord already shows a small tooltip when its window is open.",
        default: true
    },
    sound: {
        type: OptionType.BOOLEAN,
        description: "Play a sound when you talk while muted.",
        default: true
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Volume of the alert sound.",
        markers: [0, 25, 50, 75, 100],
        default: 50
    },
    notification: {
        type: OptionType.BOOLEAN,
        description: "Show a notification you can click to unmute.",
        default: true
    },
    cooldown: {
        type: OptionType.SLIDER,
        description: "Seconds to wait before alerting again.",
        markers: [5, 15, 30, 60, 120],
        default: 30
    }
});

let wasSpeaking = false;
let lastAlert = 0;

function onMediaEngineChange() {
    const speaking = MediaEngineStore.getSpeakingWhileMuted();
    const started = speaking && !wasSpeaking;
    wasSpeaking = speaking;

    const { onlyInBackground, sound, volume, notification, cooldown } = settings.store;
    if (!started || !MediaEngineStore.isSelfMute() || MediaEngineStore.isSelfDeaf()) return;
    if (onlyInBackground && WindowStore.isFocused()) return;
    if (Date.now() - lastAlert < cooldown * 1000) return;
    lastAlert = Date.now();

    if (sound) playAudio("mute", { volume });
    if (notification) showNotification({
        title: "You're muted",
        body: "You started talking while muted. Click to unmute.",
        noPersist: true,
        onClick() {
            if (MediaEngineStore.isSelfMute()) VoiceActions.toggleSelfMute();
        }
    });
}

export default definePlugin({
    name: "MutedSpeakingAlert",
    description: "Plays a sound and shows a notification when you talk while muted in voice, even when Discord is in the background.",
    tags: ["Voice", "Notifications"],
    authors: [Devs.K3],
    dependencies: ["AudioPlayerAPI"],
    settings,

    start() {
        MediaEngineStore.addChangeListener(onMediaEngineChange);
    },

    stop() {
        MediaEngineStore.removeChangeListener(onMediaEngineChange);
        wasSpeaking = false;
        lastAlert = 0;
    }
});
