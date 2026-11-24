/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { humanFriendlyJoin } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Alerts } from "@webpack/common";

const TokenModule = findByPropsLazy("getToken", "hideToken");

const settings = definePluginSettings({
    discordTokens: {
        type: OptionType.BOOLEAN,
        description: "Catch your own token and anything shaped like a Discord account or bot token.",
        default: true
    },
    privateKeys: {
        type: OptionType.BOOLEAN,
        description: "Catch SSH, PGP and other private key blocks.",
        default: true
    },
    apiKeys: {
        type: OptionType.BOOLEAN,
        description: "Catch common API keys such as GitHub, AWS, Stripe, OpenAI, Anthropic, Google and Slack.",
        default: true
    },
    passwords: {
        type: OptionType.BOOLEAN,
        description: "Catch lines like password: something or pwd=something.",
        default: true
    },
    checkEdits: {
        type: OptionType.BOOLEAN,
        description: "Also check messages when you edit them.",
        default: true
    }
});

const TOKEN_RE = /[\w-]{23,28}\.[\w-]{6}\.[\w-]{27,40}/g;
const MFA_TOKEN_RE = /\bmfa\.[\w-]{80,}/;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;
const API_KEY_RES = [
    /\bgh[pousr]_[A-Za-z0-9]{36}\b/,
    /\bgithub_pat_\w{60,}/,
    /\bglpat-[\w-]{20}\b/,
    /\bnpm_[A-Za-z0-9]{36}\b/,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    /\bxox[abprs]-[\w-]{10,}/,
    /\b[sr]k_live_[A-Za-z0-9]{20,}/,
    /\bsk-ant-[\w-]{30,}/,
    /\bsk-(?:proj-)?[\w-]{40,}/,
    /\bAIza[\w-]{35}\b/
];
const PASSWORD_RE = /\b(?:password|passwd|passwort|pwd)\s*[:=]\s*\S{4,}/i;

const CONFIRM_WINDOW_MS = 15_000;
const armed = new Set<string>();

function looksLikeDiscordToken(content: string) {
    const own = TokenModule.getToken();
    if (own && content.includes(own)) return true;
    if (MFA_TOKEN_RE.test(content)) return true;
    for (const [match] of content.matchAll(TOKEN_RE)) {
        try {
            if (/^\d{17,20}$/.test(atob(match.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")))) return true;
        } catch {
            continue;
        }
    }
    return false;
}

function findSecrets(content: string) {
    const { discordTokens, privateKeys, apiKeys, passwords } = settings.store;
    const found: string[] = [];
    if (discordTokens && looksLikeDiscordToken(content)) found.push("a Discord token");
    if (privateKeys && PRIVATE_KEY_RE.test(content)) found.push("a private key");
    if (apiKeys && API_KEY_RES.some(re => re.test(content))) found.push("an API key");
    if (passwords && PASSWORD_RE.test(content)) found.push("a password");
    return found;
}

function guard(channelId: string, content: string) {
    const found = findSecrets(content);
    if (!found.length) return;

    const key = `${channelId}:${content}`;
    if (armed.has(key)) {
        armed.delete(key);
        return;
    }

    armed.add(key);
    setTimeout(() => armed.delete(key), CONFIRM_WINDOW_MS);

    Alerts.show({
        title: "This looks like a secret",
        body: (
            <p>
                Your message seems to contain {humanFriendlyJoin(found)}. Anyone who reads it could use that to get into your accounts, so it was not sent.
                <br />
                If it's safe, press send again within 15 seconds to send it anyway.
            </p>
        ),
        confirmText: "Got it"
    });

    return { cancel: true };
}

export default definePlugin({
    name: "TokenGuard",
    description: "Stops a message from sending when it contains your Discord token, a private key, an API key or a password, unless you press send again.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    enabledByDefault: true,
    settings,

    onBeforeMessageSend(channelId, messageObj) {
        return guard(channelId, messageObj.content);
    },

    onBeforeMessageEdit(channelId, _messageId, messageObj) {
        if (settings.store.checkEdits) return guard(channelId, messageObj.content);
    },

    stop() {
        armed.clear();
    }
});
