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

const settings = definePluginSettings({
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

export default definePlugin({
    name: "DeadboltLoading",
    description: "Rebrands Discord's loading screen with Deadbolt-themed quotes and a brushed-chrome sheen.",
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
        } catch (e) {
            new Logger("DeadboltLoading").error("Failed to mutate quotes", e);
        }
    }
});
