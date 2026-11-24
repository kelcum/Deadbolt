/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "PluginCompatibility",
    description: "Inspect enabled plugin dependencies and restart requirements without changing any settings.",
    authors: [Devs.Zot],
    tags: ["Developers", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dbplugincheck",
        description: "Inspect plugin dependencies and runtime status.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "name", description: "Exact plugin name, or leave blank to check enabled plugins.", type: ApplicationCommandOptionType.STRING }
        ],
        execute(opts, ctx) {
            const query = findOption(opts, "name", "").trim().toLowerCase();
            const names = Object.keys(plugins);
            const matches = query ? names.filter(name => name.toLowerCase() === query) : names.filter(isPluginEnabled);
            if (!matches.length) {
                sendBotMessage(ctx.channel.id, { content: "No matching plugins." });
                return;
            }
            const issues: string[] = [];
            for (const name of matches) {
                const plugin = plugins[name];
                for (const dependency of plugin.dependencies ?? []) {
                    if (!Object.hasOwn(plugins, dependency)) issues.push(name + ": missing dependency " + dependency);
                    else if (isPluginEnabled(name) && !isPluginEnabled(dependency)) issues.push(name + ": disabled dependency " + dependency);
                }
                if (query) {
                    issues.push("Enabled: " + (isPluginEnabled(name) ? "yes" : "no"));
                    issues.push("Restart normally required: " + ((plugin.requiresRestart ?? Boolean(plugin.patches?.length)) ? "yes" : "no"));
                    issues.push("Declared dependencies: " + (plugin.dependencies?.join(", ") || "none"));
                }
            }
            const summary = "Checked " + matches.length + " plugin(s). Dependency inspection is not a live compatibility test.";
            const details = issues.join("\n").slice(0, 1700);
            sendBotMessage(ctx.channel.id, { content: summary + "\n" + (details || "No missing or disabled dependencies found.") });
        }
    }]
});
