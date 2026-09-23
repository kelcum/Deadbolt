/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./deadboltLoading.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const deadboltQuotes = [
    "Deadbolt engaged.",
    "Locking every door...",
    "Every fugitive thinks they're the exception. None of them are.",
    "Chrome polished. Bolt thrown.",
    "Reinforcing the hinges...",
    "No handshake without a key.",
    "Sealing the vault...",
    "Silver on the outside, steel underneath.",
    "Turning the tumblers...",
    "Loading the good stuff — hold tight.",
    "Deadbolt: quiet, cold, and locked down.",
    "Sharpening the edges...",
    "Bolts aligned. Almost there.",
    "You're behind the lock now.",
    "Warming up the chrome...",
];

// Same 256x256 chrome crest used for the badge/plugin icons/app icon.
const DEADBOLT_CREST = "data:image/png;base64,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";

const settings = definePluginSettings({
    replaceScreen: {
        description: "Fully cover Discord's connecting screen with an animated Deadbolt splash",
        type: OptionType.BOOLEAN,
        default: true
    },
    keepDiscordQuotes: {
        description: "Also keep Discord's own loading quotes in the rotation",
        type: OptionType.BOOLEAN,
        default: false
    },
    replaceEvents: {
        description: "Also apply during Discord's special event loading screens (e.g. Halloween)",
        type: OptionType.BOOLEAN,
        default: true
    },
    extraQuotes: {
        description: "Your own extra loading quotes, one per line",
        type: OptionType.STRING,
        default: "",
        multiline: true
    },
});

const logger = new Logger("DeadboltLoading");

let overlayEl: HTMLDivElement | null = null;
let hideTimer: number | undefined;
let removalObserver: MutationObserver | undefined;

function escapeHtml(str: string) {
    return str.replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]!));
}

function pickQuote() {
    const extra = settings.store.extraQuotes.split("\n").map(q => q.trim()).filter(Boolean);
    const pool = deadboltQuotes.concat(extra);
    return pool[Math.floor(Math.random() * pool.length)] ?? "Deadbolt engaged.";
}

function connectingScreenStillUp() {
    return !!document.querySelector('[class*="loadingText_"], [class*="eventLoadingText_"]');
}

function hideDeadboltOverlay() {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
    removalObserver?.disconnect();
    removalObserver = undefined;

    if (overlayEl) {
        const el = overlayEl;
        overlayEl = null;
        el.classList.add("deadbolt-splash-out");
        window.setTimeout(() => el.remove(), 450);
    }
}

function showDeadboltOverlay() {
    if (!settings.store.replaceScreen) return;
    if (overlayEl || !document.body) return;

    const el = document.createElement("div");
    el.className = "deadbolt-splash-overlay";
    el.innerHTML =
        '<div class="deadbolt-splash-crest"><img src="' + DEADBOLT_CREST + '" alt="" draggable="false" /></div>' +
        '<div class="deadbolt-splash-word">DEADBOLT</div>' +
        '<div class="deadbolt-splash-tip">' +
        '<span class="deadbolt-splash-tip-label">Did you know</span>' +
        '<span class="deadbolt-splash-tip-text">' + escapeHtml(pickQuote()) + "</span>" +
        "</div>";

    document.body.appendChild(el);
    overlayEl = el;

    // Safety net: never let the splash outlive the actual connecting screen
    // by more than a few seconds, even if we fail to detect its removal.
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideDeadboltOverlay, 20000);

    try {
        removalObserver?.disconnect();
        removalObserver = new MutationObserver(() => {
            if (!connectingScreenStillUp()) hideDeadboltOverlay();
        });
        removalObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
        logger.error("Failed to watch for connecting-screen removal", e);
    }
}

export default definePlugin({
    name: "DeadboltLoading",
    description: "Replaces Discord's connecting screen with a full, animated Deadbolt splash (crest + Deadbolt-themed quotes).",
    tags: ["Appearance", "Deadbolt", "Customisation"],
    authors: [Devs.K3],
    enabledByDefault: true,

    settings,

    patches: [
        {
            find: "#{intl::LOADING_DID_YOU_KNOW}",
            replacement: [
                {
                    match: /_loadingText.+?(?=(\i)\[.{0,10}\.random)/,
                    replace: "$&$self.mutateQuotes($1),"
                },
                {
                    match: /_eventLoadingText.+?(?=(\i)\[.{0,10}\.random)/,
                    replace: "$&$self.mutateQuotes($1),",
                    predicate: () => settings.store.replaceEvents
                }
            ]
        },
    ],

    mutateQuotes(quotes: string[]) {
        try {
            if (!settings.store.keepDiscordQuotes)
                quotes.length = 0;

            quotes.push(...deadboltQuotes);

            const extra = settings.store.extraQuotes
                .split("\n")
                .map(q => q.trim())
                .filter(Boolean);
            quotes.push(...extra);

            if (!quotes.length)
                quotes.push("Deadbolt engaged.");

            // This function only ever runs while Discord's own connecting
            // screen is being rendered, so it's the reliable trigger point
            // for painting our full-screen splash over it.
            showDeadboltOverlay();
        } catch (e) {
            logger.error("Failed to mutate quotes", e);
        }
    },

    stop() {
        hideDeadboltOverlay();
    }
});
