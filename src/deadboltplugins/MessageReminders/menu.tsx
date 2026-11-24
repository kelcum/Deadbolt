/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, showToast, UserStore } from "@webpack/common";

interface Reminder { id: string; text: string; due: number; notified: boolean; }

async function save(userId: string, link: string, minutes: number) {
    if (UserStore.getCurrentUser()?.id !== userId) return;
    try {
        let saved = false;
        await DataStore.update<Reminder[]>("zot:MessageReminders:" + userId, old => {
            const entries = old ?? [];
            if (entries.length >= 50) return entries;
            saved = true;
            return [...entries, { id: crypto.randomUUID().slice(0, 12), text: link, due: Date.now() + minutes * 60_000, notified: false }];
        });
        if (UserStore.getCurrentUser()?.id === userId) showToast({ text: saved ? "Reminder saved." : "Reminder limit reached.", variant: saved ? "success" : "critical" });
    } catch {
        showToast({ text: "Could not save reminder.", variant: "critical" });
    }
}

export const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!message || !/^\d{17,20}$/.test(message.id)) return;
    const userId = UserStore.getCurrentUser()?.id;
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!userId || !channel) return;
    const link = "https://discord.com/channels/" + (channel.guild_id || "@me") + "/" + channel.id + "/" + message.id;
    if (!/^https:\/\/discord\.com\/channels\/(@me|\d{17,20})\/\d{17,20}\/\d{17,20}$/.test(link)) return;
    children.push(<Menu.MenuItem id="db-remind-message" label="Remind me">
        {[[15, "15 minutes"], [60, "1 hour"], [1440, "24 hours"]].map(([minutes, label]) =>
            <Menu.MenuItem key={minutes} id={"db-reminder-" + minutes} label={String(label)} action={() => void save(userId, link, Number(minutes))} />
        )}
    </Menu.MenuItem>);
};
