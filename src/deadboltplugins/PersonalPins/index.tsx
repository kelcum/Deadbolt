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

interface Pin {
    link: string;
    folder: string;
}

const PIN_LINK = /^https:\/\/(?:discord\.com|ptb\.discord\.com|canary\.discord\.com)\/channels\/(@me|\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;

function canonicalLink(input: string) {
    const match = PIN_LINK.exec(input.trim());
    return match ? "https://discord.com/channels/" + match[1] + "/" + match[2] + "/" + match[3] : null;
}

async function savePin(key: string, link: string, folder: string) {
    let saved = false;
    await DataStore.update<Pin[]>(key, old => {
        const pins = old ?? [];
        if (pins.length >= 100 && !pins.some(pin => pin.link === link)) return pins;
        saved = true;
        return [{ link, folder }, ...pins.filter(pin => pin.link !== link)];
    });
    return saved;
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message || !/^\d{17,20}$/.test(message.id)) return;
    const channel = ChannelStore.getChannel(message.channel_id);
    const userId = UserStore.getCurrentUser()?.id;
    if (!channel || !userId) return;
    const link = canonicalLink("https://discord.com/channels/" + (channel.guild_id ?? "@me") + "/" + channel.id + "/" + message.id);
    if (!link) return;
    children.push(<Menu.MenuItem id="vc-zot-personal-pin" label="Save Personal Pin" action={async () => {
        if (UserStore.getCurrentUser()?.id !== userId) return;
        try {
            const saved = await savePin("zot:PersonalPins:" + userId, link, "General");
            showToast({ text: saved ? "Personal pin saved." : "Personal pin limit reached." });
        } catch {
            showToast({ text: "Could not save the personal pin.", variant: "critical" });
        }
    }} />);
};

export default definePlugin({
    name: "PersonalPins",
    description: "Save private message links in named folders without creating server pins or copying message contents.",
    authors: [Devs.Zot],
    tags: ["Chat", "Organisation"],
    dependencies: ["CommandsAPI"],
    contextMenus: { message: messageMenu },
    commands: [{
        name: "dbpins",
        description: "Manage personal message bookmarks.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "list", label: "list", value: "list" }, { name: "add", label: "add", value: "add" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "link", description: "Discord message link.", type: ApplicationCommandOptionType.STRING },
            { name: "folder", description: "Folder to save in or filter by.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "Page number for listing pins.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            const reply = (content: string) => {
                if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content });
            };
            const key = "zot:PersonalPins:" + userId;
            const action = findOption(opts, "action", "list");
            const folder = findOption(opts, "folder", "").trim();
            if (folder && !/^[a-zA-Z0-9 _-]{1,32}$/.test(folder)) return reply("Use a folder name of 1 to 32 letters, numbers, spaces, underscores or dashes.");
            if (action === "list") {
                const pins = (await DataStore.get<Pin[]>(key) ?? []).filter(pin => !folder || pin.folder === folder);
                const page = Math.max(1, Math.min(10, Math.trunc(Number(findOption(opts, "page", 1))) || 1));
                const lines = pins.slice((page - 1) * 10, page * 10).map(pin => pin.folder + ": " + pin.link);
                return reply(lines.length ? lines.join("\n") + "\nPage " + page + " of " + Math.ceil(pins.length / 10) : "No pins on this page.");
            }
            const link = canonicalLink(findOption(opts, "link", ""));
            if (!link) return reply("Enter a valid Discord message link.");
            if (action === "add") return reply(await savePin(key, link, folder || "General") ? "Personal pin saved." : "Personal pin limit reached.");
            if (action === "remove") {
                await DataStore.update<Pin[]>(key, old => (old ?? []).filter(pin => pin.link !== link));
                return reply("Personal pin removed if present.");
            }
        }
    }]
});
