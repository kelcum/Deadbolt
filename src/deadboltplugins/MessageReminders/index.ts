/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

import { messageMenu } from "./menu";

interface Reminder {
    id: string;
    text: string;
    due: number;
    notified: boolean;
}

let timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let checking = false;

async function checkReminders() {
    if (checking || timer === undefined) return;
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    const run = generation;
    const key = "zot:MessageReminders:" + userId;
    checking = true;
    try {
        const entries = await DataStore.get<Reminder[]>(key) ?? [];
        const now = Date.now();
        if (!entries.some(entry => !entry.notified && entry.due <= now) || run !== generation || UserStore.getCurrentUser()?.id !== userId) return;
        const due = entries.filter(entry => !entry.notified && entry.due <= now);
        if (!due.length || run !== generation || UserStore.getCurrentUser()?.id !== userId) return;
        await showNotification({ title: "Message reminders", body: due.length + " reminder(s) due. Open /dbreminder list to view them.", noPersist: true });
        if (run !== generation || UserStore.getCurrentUser()?.id !== userId) return;
        const notifiedIds = new Set(due.map(entry => entry.id));
        await DataStore.update<Reminder[]>(key, old => (old ?? []).map(entry =>
            notifiedIds.has(entry.id) ? { ...entry, notified: true } : entry
        ));
    } catch {
        // Storage or notification failures must not interrupt Discord. Due reminders remain in the list.
    } finally {
        checking = false;
    }
}

export default definePlugin({
    name: "MessageReminders",
    description: "Set local reminders for messages or tasks. Reminders are checked while Deadbolt is running.",
    authors: [Devs.Zot],
    tags: ["Notifications", "Organisation"],
    dependencies: ["CommandsAPI"],
    contextMenus: { message: messageMenu },
    start() {
        if (timer !== undefined) return;
        generation++;
        timer = setInterval(checkReminders, 30_000);
        void checkReminders();
    },
    stop() {
        generation++;
        clearInterval(timer);
        timer = undefined;
    },
    commands: [{
        name: "dbreminder",
        description: "Add, list or remove local reminders.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "add", label: "add", value: "add" }, { name: "list", label: "list", value: "list" }, { name: "remove", label: "remove", value: "remove" }] },
            { name: "text", description: "Reminder text or a message link.", type: ApplicationCommandOptionType.STRING },
            { name: "minutes", description: "Minutes until the reminder is due.", type: ApplicationCommandOptionType.INTEGER },
            { name: "id", description: "Reminder ID to remove.", type: ApplicationCommandOptionType.STRING },
            { name: "page", description: "Page number for listing reminders.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            const reply = (content: string) => {
                if (UserStore.getCurrentUser()?.id === userId) sendBotMessage(ctx.channel.id, { content });
            };
            const key = "zot:MessageReminders:" + userId;
            const action = findOption(opts, "action", "list");
            if (action === "list") {
                const entries = (await DataStore.get<Reminder[]>(key) ?? []).slice().sort((a, b) => a.due - b.due);
                const page = Math.max(1, Math.min(10, Math.trunc(Number(findOption(opts, "page", 1))) || 1));
                const lines = entries.slice((page - 1) * 5, page * 5).map(entry => entry.id + " | " + (entry.due <= Date.now() ? "Due" : "Pending") + " | <t:" + Math.floor(entry.due / 1000) + ":R> | " + entry.text);
                return reply(lines.length ? lines.join("\n") + "\nPage " + page + " of " + Math.ceil(entries.length / 5) : "No reminders on this page.");
            }
            if (action === "add") {
                const text = findOption(opts, "text", "").trim();
                const minutes = Number(findOption(opts, "minutes", 0));
                if (!text || text.length > 200 || !Number.isInteger(minutes) || minutes < 1 || minutes > 525600) return reply("Enter reminder text (up to 200 characters) and 1 to 525600 minutes.");
                const id = crypto.randomUUID().slice(0, 12);
                let saved = false;
                await DataStore.update<Reminder[]>(key, old => {
                    const entries = old ?? [];
                    if (entries.length >= 50) return entries;
                    saved = true;
                    return [...entries, { id, text, due: Date.now() + minutes * 60_000, notified: false }];
                });
                return reply(saved ? "Reminder saved: " + id : "Reminder limit reached. Remove an old reminder first.");
            }
            if (action === "remove") {
                const id = findOption(opts, "id", "").trim();
                if (!id) return reply("Enter the reminder ID from your list.");
                await DataStore.update<Reminder[]>(key, old => (old ?? []).filter(entry => entry.id !== id));
                return reply("Reminder removed if present.");
            }
        }
    }]
});
