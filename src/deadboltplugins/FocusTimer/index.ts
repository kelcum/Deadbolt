/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

import { openFocusTimer, renderFocusButton, TimerIcon } from "./panel";

let timer: ReturnType<typeof setTimeout> | undefined;
let end = 0;
let owner: string | undefined;
let running = false;

function cancel() {
    clearTimeout(timer);
    timer = undefined;
    end = 0;
    owner = undefined;
}

function startTimer(userId: string, minutes: number) {
    if (!running) return;
    cancel();
    owner = userId;
    end = Date.now() + minutes * 60_000;
    timer = setTimeout(() => {
        const notify = UserStore.getCurrentUser()?.id === userId;
        cancel();
        if (!notify) return;
        void showNotification({ title: "Focus timer", body: "Your timer is complete.", noPersist: true }).catch(() => {});
    }, minutes * 60_000);
}

function remaining() {
    return owner === UserStore.getCurrentUser()?.id && timer !== undefined ? Math.max(0, end - Date.now()) : 0;
}

function openPanel() {
    const account = UserStore.getCurrentUser()?.id;
    if (!account) return;
    const owns = () => UserStore.getCurrentUser()?.id === account;
    openFocusTimer(() => owns() ? remaining() : 0, minutes => {
        if (owns()) startTimer(account, minutes);
    }, () => {
        if (owns() && owner === account) cancel();
    });
}

export default definePlugin({
    name: "FocusTimer",
    description: "Set a timer for studying, working or taking a break.",
    authors: [Devs.Zot],
    tags: ["Utility", "Notifications"],
    dependencies: ["CommandsAPI"],
    headerBarButton: { icon: TimerIcon, render: () => renderFocusButton(openPanel) },
    toolboxActions: { "Focus timer": openPanel },
    start() { running = true; },
    stop() { running = false; cancel(); },
    flux: { LOGOUT() { cancel(); } },
    commands: [{
        name: "dbfocus",
        description: "Start, inspect or cancel a focus timer.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "start", label: "start", value: "start" }, { name: "status", label: "status", value: "status" }, { name: "cancel", label: "cancel", value: "cancel" }] },
            { name: "minutes", description: "Timer length in minutes.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const userId = UserStore.getCurrentUser()?.id;
            if (!userId) return;
            if (owner && owner !== userId) cancel();
            const action = findOption<string>(opts, "action", "status");
            const reply = (content: string) => { sendBotMessage(ctx.channel.id, { content }); };
            if (action === "cancel") {
                cancel();
                return reply("Focus timer cancelled.");
            }
            if (action === "status") return reply(timer === undefined ? "No active focus timer." : "Focus timer ends <t:" + Math.floor(end / 1000) + ":R>.");
            const minutes = Number(findOption(opts, "minutes", 25));
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return reply("Choose 1 to 240 minutes.");
            startTimer(userId, minutes);
            return reply("Focus timer started for " + minutes + " minutes.");
        }
    }]
});
