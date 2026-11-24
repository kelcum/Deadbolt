/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
let timer: ReturnType<typeof setTimeout> | undefined;
let end = 0;

function cancel() {
    clearTimeout(timer);
    timer = undefined;
    end = 0;
}

export default definePlugin({
    name: "FocusTimer",
    description: "Start a local focus or break timer without modifying Discord notifications or status.",
    authors: [Devs.Zot],
    tags: ["Utility", "Notifications"],
    dependencies: ["CommandsAPI"],
    stop() { cancel(); },
    commands: [{
        name: "dbfocus",
        description: "Start, inspect or cancel a focus timer.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "action", description: "Choose an action.", type: ApplicationCommandOptionType.STRING, required: true, choices: [{ name: "start", label: "start", value: "start" }, { name: "status", label: "status", value: "status" }, { name: "cancel", label: "cancel", value: "cancel" }] },
            { name: "minutes", description: "Timer length in minutes.", type: ApplicationCommandOptionType.INTEGER }
        ],
        async execute(opts, ctx) {
            const action = findOption<string>(opts, "action", "status");
            const reply = (content: string) => { sendBotMessage(ctx.channel.id, { content }); };
            if (action === "cancel") {
                cancel();
                return reply("Focus timer cancelled.");
            }
            if (action === "status") return reply(timer === undefined ? "No active focus timer." : "Focus timer ends <t:" + Math.floor(end / 1000) + ":R>.");
            const minutes = Number(findOption(opts, "minutes", 25));
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return reply("Choose 1 to 240 minutes.");
            cancel();
            end = Date.now() + minutes * 60_000;
            timer = setTimeout(() => {
                cancel();
                void showNotification({ title: "Focus timer", body: "Your timer is complete.", noPersist: true }).catch(() => {});
            }, minutes * 60_000);
            return reply("Focus timer started for " + minutes + " minutes.");
        }
    }]
});
