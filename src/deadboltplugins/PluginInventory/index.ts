/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

import { openInventory } from "./panel";

export default definePlugin({
    name: "PluginInventory",
    description: "Search installed plugins and see which are enabled.",
    authors: [Devs.Zot],
    tags: ["Developers", "Utility"],
    dependencies: ["CommandsAPI"],
    toolboxActions: { "Plugin inventory": openInventory },
    commands: [{
        name: "dbpluginlist",
        description: "List, filter or copy installed plugin names.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "filter", description: "Filter by plugin name.", type: ApplicationCommandOptionType.STRING },
            { name: "state", description: "Filter by enabled state.", type: ApplicationCommandOptionType.STRING, choices: [{ name: "all", label: "all", value: "all" }, { name: "enabled", label: "enabled", value: "enabled" }, { name: "disabled", label: "disabled", value: "disabled" }] },
            { name: "page", description: "Page number.", type: ApplicationCommandOptionType.INTEGER },
            { name: "copy", description: "Copy the complete filtered list.", type: ApplicationCommandOptionType.BOOLEAN }
        ],
        async execute(opts, ctx) {
            const query = findOption(opts, "filter", "").trim().toLowerCase();
            const state = findOption<string>(opts, "state", "all");
            const entries = Object.keys(plugins).filter(name => name.toLowerCase().includes(query)).map(name => ({ name, enabled: isPluginEnabled(name) })).filter(p => state === "all" || (state === "enabled" ? p.enabled : !p.enabled)).sort((a, b) => a.name.localeCompare(b.name));
            const lines = entries.map(p => p.name + " [" + (p.enabled ? "enabled" : "disabled") + "]");
            if (findOption(opts, "copy", false)) {
                await copyToClipboard(lines.join("\n"));
                sendBotMessage(ctx.channel.id, { content: "Copied " + lines.length + " plugin names and enabled states. No settings were changed." });
                return;
            }
            const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
            sendBotMessage(ctx.channel.id, { content: "Matching plugins: " + lines.length + "\n" + (lines.slice((page - 1) * 20, page * 20).join("\n") || "No results on this page.") });
        }
    }]
});
