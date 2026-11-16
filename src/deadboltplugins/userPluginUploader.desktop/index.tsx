/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Alerts, DraftType, UploadAttachmentStore, UploadManager } from "@webpack/common";

import { Native, openPluginManager, setPluginEnabled, sharePlugin } from "./PluginManager";

async function findPlugin(query: string) {
    const res = await Native.listUserPlugins();
    if ("error" in res) return res;
    const q = query.trim().toLowerCase();
    const match = res.plugins.find(p => p.folder.toLowerCase() === q || p.pluginName?.toLowerCase() === q);
    if (match) return { plugin: match };
    const names = res.plugins.map(p => p.pluginName ?? p.folder).join(", ");
    return { error: `There's no user plugin called ${query}.${names ? ` You have: ${names}` : ""}` };
}

const pluginNameOption = {
    name: "name",
    description: "The plugin's name or its folder in src/userplugins.",
    type: ApplicationCommandOptionType.STRING,
    required: true
};

function reloadAlert(title: string, body: string) {
    Alerts.show({
        title,
        body,
        confirmText: "Reload now",
        cancelText: "Later",
        onConfirm: () => location.reload()
    });
}

export default definePlugin({
    name: "UserPluginUploader",
    description: "Manage your own plugins from Discord: /addplugin saves an uploaded plugin and rebuilds Deadbolt, /myplugins edits, switches, shares and removes them.",
    dependencies: ["CommandsAPI"],
    tags: ["Developers", "Commands"],
    authors: [Devs.K3],
    settingsAboutComponent: () => (
        <Button onClick={() => openPluginManager()}>Open your plugins</Button>
    ),
    commands: [
        {
            name: "addplugin",
            description: "Add a plugin to your userplugins folder from a file.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "name",
                    description: "Name of the folder the plugin gets saved in.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "file",
                    description: "The plugin code. Any text file works, it gets saved as .ts or .tsx.",
                    type: ApplicationCommandOptionType.ATTACHMENT,
                    required: true
                },
                {
                    name: "replace",
                    description: "Overwrite a plugin folder that already has this name.",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            async execute(args, ctx) {
                const name = findOption(args, "name", "");
                const code = await UploadAttachmentStore.getUpload(ctx.channel.id, "file", DraftType.SlashCommand).item.file.text();
                UploadManager.clearAll(ctx.channel.id, DraftType.SlashCommand);

                sendBotMessage(ctx.channel.id, { content: `Saving **${name}** and rebuilding Deadbolt, this can take a moment.` });
                const res = await Native.addUserPlugin(name, code, findOption(args, "replace", false));
                if ("error" in res) return void sendBotMessage(ctx.channel.id, { content: res.error });

                Settings.plugins[res.pluginName] = { ...Settings.plugins[res.pluginName], enabled: true };
                reloadAlert("Plugin added", `${res.pluginName} was saved to src/userplugins/${name}/${res.entry} and turned on. Reload Discord to start using it.`);
            }
        },
        {
            name: "myplugins",
            description: "Open your plugins: edit, switch on or off, share or remove them.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                openPluginManager(ctx.channel);
            }
        },
        {
            name: "toggleplugin",
            description: "Switch one of your plugins on or off.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [pluginNameOption],
            async execute(args, ctx) {
                const found = await findPlugin(findOption(args, "name", ""));
                if ("error" in found) return void sendBotMessage(ctx.channel.id, { content: found.error });
                const { pluginName } = found.plugin;
                if (!pluginName) return void sendBotMessage(ctx.channel.id, { content: `Couldn't read the plugin name in ${found.plugin.folder}, so it can't be switched.` });

                const on = !isPluginEnabled(pluginName);
                const result = setPluginEnabled(pluginName, on);
                if (result === "failed") return void sendBotMessage(ctx.channel.id, { content: `Couldn't ${on ? "start" : "stop"} ${pluginName}.` });
                if (result === "reload") return reloadAlert(`${pluginName} ${on ? "on" : "off"}`, `${pluginName} is switched ${on ? "on" : "off"}. Reload Discord to finish.`);
                sendBotMessage(ctx.channel.id, { content: `${pluginName} is ${on ? "on" : "off"} now.` });
            }
        },
        {
            name: "shareplugin",
            description: "Put one of your plugins' files into this chat's message box so you can send it.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [pluginNameOption],
            async execute(args, ctx) {
                const found = await findPlugin(findOption(args, "name", ""));
                if ("error" in found) return void sendBotMessage(ctx.channel.id, { content: found.error });
                await sharePlugin(found.plugin, ctx.channel);
            }
        }
    ]
});
