/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, showToast, UserStore } from "@webpack/common";

interface Bookmark { id: string; link: string; names: string[]; }

const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message?.attachments?.length || !/^\d{17,20}$/.test(message.id)) return;
    const userId = UserStore.getCurrentUser()?.id;
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!userId || !channel) return;
    const link = "https://discord.com/channels/" + (channel.guild_id || "@me") + "/" + channel.id + "/" + message.id;
    if (!/^https:\/\/discord\.com\/channels\/(@me|\d{17,20})\/\d{17,20}\/\d{17,20}$/.test(link)) return;
    const entry = { id: message.id, link, names: message.attachments.slice(0, 10).map(a => a.filename.slice(0, 100)) };
    children.push(<Menu.MenuItem id="vc-zot-attachment-bookmark" label="Bookmark Attachments" action={async () => {
        if (UserStore.getCurrentUser()?.id !== userId) return;
        try {
            let saved = false;
            await DataStore.update<Bookmark[]>("zot:AttachmentOrganizer:" + userId, old => {
                const entries = old ?? [];
                if (entries.length >= 100 && !entries.some(e => e.id === entry.id)) return entries;
                saved = true;
                return [entry, ...entries.filter(e => e.id !== entry.id)];
            });
            showToast({ text: saved ? "Attachment bookmark saved." : "Attachment bookmark limit reached." });
        } catch {
            showToast({ text: "Could not save attachment bookmark.", variant: "critical" });
        }
    }} />);
};

export default definePlugin({
    name: "AttachmentOrganizer",
    description: "Bookmark messages containing attachments and search their filenames without downloading or storing files.",
    authors: [Devs.Zot],
    tags: ["Media", "Organisation"],
    dependencies: ["CommandsAPI"],
    contextMenus: { message: messageMenu },
    commands: [{
        name: "dbattachments",
        description: "Search or remove your attachment bookmarks.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "list", label: "list", value: "list" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "query", description: "Filename filter or message ID.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "List page.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            const reply = (content: string) => { if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content }); };
            if (!userId) return;
            const key = "zot:AttachmentOrganizer:" + userId;
            const query = findOption(opts, "query", "").trim();
            if (findOption<string>(opts, "action", "list") === "remove") {
                if (!/^\d{17,20}$/.test(query)) return reply("Enter the message ID shown with a bookmark.");
                await DataStore.update<Bookmark[]>(key, old => (old ?? []).filter(e => e.id !== query));
                return reply("Attachment bookmark removed if present.");
            }
            const entries = (await DataStore.get<Bookmark[]>(key) ?? []).filter(e => !query || e.names.some(n => n.toLowerCase().includes(query.toLowerCase())) || e.id === query);
            const page = Math.max(1, Math.trunc(Number(findOption(opts, "page", 1))) || 1);
            const lines = entries.slice((page - 1) * 5, page * 5).map(e => e.names.join(", ").slice(0, 200) + "\n" + e.link + "\nID: " + e.id);
            return reply(lines.length ? lines.join("\n\n") : "No attachment bookmarks on this page.");
        }
    }]
});
