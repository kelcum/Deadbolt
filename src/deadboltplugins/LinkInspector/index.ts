/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "LinkInspector",
    description: "Inspect an HTTP or HTTPS link locally without opening it or making a network request.",
    authors: [Devs.Zot],
    tags: ["Privacy", "Utility"],
    dependencies: ["CommandsAPI"],
    commands: [{
        name: "dblinkinspect",
        description: "Inspect the host, protocol and URL properties.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            { name: "url", description: "URL to inspect.", type: ApplicationCommandOptionType.STRING, required: true }
        ],
        async execute(opts, ctx) {
            const raw = findOption(opts, "url", "").trim();
            const reply = (content: string) => { sendBotMessage(ctx.channel.id, { content }); };
            if (!raw || raw.length > 4096) return reply("Enter a URL of up to 4096 characters.");
            try {
                const url = new URL(raw);
                if (url.protocol !== "http:" && url.protocol !== "https:") return reply("Only HTTP and HTTPS URLs are supported.");
                const host = url.hostname.replaceAll(".", "[.]");
                const flags = [];
                if (url.protocol === "http:") flags.push("Unencrypted HTTP");
                if (url.username || url.password) flags.push("Contains URL credentials");
                if (url.hostname.includes("xn--")) flags.push("Internationalized hostname");
                if (url.port) flags.push("Non-default port");
                if (url.search) flags.push("Contains query parameters");
                return reply("Host: " + host + "\nProtocol: " + url.protocol + "\nObservations: " + (flags.join(", ") || "None") + "\nThis is a structural check, not a malware or reputation scan.");
            } catch {
                return reply("Invalid URL.");
            }
        }
    }]
});
