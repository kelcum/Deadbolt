/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Settings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { Alerts, DraftType, UploadAttachmentStore, UploadManager } from "@webpack/common";

const Native = VencordNative.pluginHelpers.UserPluginUploader as PluginNative<typeof import("./native")>;

export default definePlugin({
    name: "UserPluginUploader",
    description: "Adds a /addplugin command that saves an uploaded plugin file into your userplugins folder and rebuilds Deadbolt.",
    dependencies: ["CommandsAPI"],
    tags: ["Developers", "Commands"],
    authors: [Devs.K3],
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
                Alerts.show({
                    title: "Plugin added",
                    body: `${res.pluginName} was saved to src/userplugins/${name}/${res.entry} and turned on. Reload Discord to start using it.`,
                    confirmText: "Reload now",
                    cancelText: "Later",
                    onConfirm: () => location.reload()
                });
            }
        }
    ]
});
