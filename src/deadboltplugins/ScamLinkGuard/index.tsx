/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";

const cl = classNameFactory("vc-scamlinkguard-");

const settings = definePluginSettings({
    lookalikes: {
        type: OptionType.BOOLEAN,
        description: "Warn about domains that imitate Discord, Steam and other big sites.",
        default: true
    },
    giftBait: {
        type: OptionType.BOOLEAN,
        description: "Warn about fake Nitro, Steam gift and login pages.",
        default: true
    },
    punycode: {
        type: OptionType.BOOLEAN,
        description: "Warn about domains that sneak in lookalike letters from other alphabets.",
        default: true
    },
    maskedLinks: {
        type: OptionType.BOOLEAN,
        description: "Warn when a link's text shows one site but it really goes to another.",
        default: true
    },
    trustedDomains: {
        type: OptionType.STRING,
        description: "Domains you trust and never want a warning for, separated by commas.",
        default: ""
    }
});

const DISCORD = ["discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.gift", "discord.new", "discord.media", "discord.dev", "discord.co", "discordstatus.com", "dis.gd", "discord.design", "discordmerch.com", "discord.store"];
const STEAM = ["steamcommunity.com", "steampowered.com", "steamstatic.com", "steamusercontent.com", "steamgames.com", "steamdeck.com", "steamchina.com", "s.team"];

const BRANDS = [
    { name: "discord", domains: DISCORD, strict: true },
    { name: "discordapp", domains: DISCORD, strict: true },
    { name: "steamcommunity", domains: STEAM, strict: true },
    { name: "steampowered", domains: STEAM, strict: true },
    { name: "steam", domains: STEAM, strict: false },
    { name: "epicgames", domains: ["epicgames.com", "unrealengine.com", "fortnite.com"], strict: false },
    { name: "roblox", domains: ["roblox.com", "rbxcdn.com"], strict: false },
    { name: "paypal", domains: ["paypal.com", "paypal.me", "paypalobjects.com"], strict: false },
    { name: "github", domains: ["github.com", "github.io", "githubusercontent.com", "github.dev", "github.blog", "githubassets.com"], strict: false },
    { name: "twitch", domains: ["twitch.tv"], strict: false },
    { name: "spotify", domains: ["spotify.com", "spotify.link", "spotifycdn.com", "scdn.co"], strict: false },
    { name: "youtube", domains: ["youtube.com", "youtu.be", "youtube-nocookie.com", "ytimg.com"], strict: false },
    { name: "instagram", domains: ["instagram.com", "cdninstagram.com"], strict: false },
    { name: "minecraft", domains: ["minecraft.net"], strict: false }
];

const DEFAULT_TRUSTED = ["discords.com", "discord.me", "discord.bio", "steamgifts.com", "steamtrades.com"];
const OFFICIAL = [...new Set(BRANDS.flatMap(b => b.domains))];
const SCAM_TARGETS = ["discord", "steam"];
const BAIT_RE = /gift|nitro|free|claim|promo|giveaway|airdrop|login|verify|auth|skins/;
const TWO_PART_SUFFIX = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

const CONFUSABLES: Record<string, string> = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "к": "k", "м": "m", "т": "t", "ɡ": "g", "ո": "n", "ս": "u",
    "α": "a", "ο": "o", "ν": "v", "ι": "i", "κ": "k", "τ": "t", "ρ": "p", "ε": "e", "ı": "i", "ɩ": "i"
};
const LEET: Record<string, string> = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", l: "i", "|": "i", "!": "i" };

function decodePunycode(label: string) {
    if (!label.startsWith("xn--")) return label;
    const input = label.slice(4);
    const basic = Math.max(input.lastIndexOf("-"), 0);
    const out = [...input.slice(0, basic)].map(c => c.codePointAt(0) ?? 0);
    let n = 128, i = 0, bias = 72, first = true;
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
        const oldI = i;
        for (let w = 1, k = 36; ; k += 36) {
            if (idx >= input.length) return label;
            const c = input.charCodeAt(idx++);
            const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : c >= 65 && c <= 90 ? c - 65 : 36;
            if (digit >= 36) return label;
            i += digit * w;
            const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
            if (digit < t) break;
            w *= 36 - t;
        }
        const len = out.length + 1;
        let delta = first ? Math.floor((i - oldI) / 700) : Math.floor((i - oldI) / 2);
        first = false;
        delta += Math.floor(delta / len);
        let k = 0;
        for (; delta > 455; k += 36) delta = Math.floor(delta / 35);
        bias = k + Math.floor(36 * delta / (delta + 38));
        n += Math.floor(i / len);
        i %= len;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}

function skeleton(s: string) {
    return [...s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()]
        .map(c => CONFUSABLES[c] ?? c)
        .join("")
        .replace(/rn/g, "m")
        .replace(/vv/g, "w")
        .replace(/cl/g, "d")
        .replace(/./g, c => LEET[c] ?? c);
}

function distance(a: string, b: string) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++)
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[b.length];
}

function registrable(host: string) {
    const labels = host.split(".");
    const size = labels.length >= 3 && labels.at(-1)?.length === 2 && TWO_PART_SUFFIX.has(labels[labels.length - 2]) ? 3 : 2;
    return { domain: labels.slice(-size).join("."), label: labels[Math.max(labels.length - size, 0)] };
}

function displayHost(host: string) {
    const decoded = host.split(".").map(decodePunycode).join(".");
    return decoded === host ? host : `${decoded} (${host})`;
}

const matchesDomain = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

function checkUrl(url: URL, trusted: string[]): string | null {
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || [...OFFICIAL, ...DEFAULT_TRUSTED, ...trusted].some(d => matchesDomain(host, d))) return null;

    const { lookalikes, giftBait, punycode } = settings.store;
    const decoded = host.split(".").map(decodePunycode).join(".");
    const { label } = registrable(decoded);
    const labelSkeleton = skeleton(label);

    const fake = OFFICIAL.find(d => decoded.includes(d + ".") || decoded.includes(d + "-"));
    if (lookalikes && fake) return `pretends to be ${fake} but is a different site.`;

    if (giftBait) {
        const target = SCAM_TARGETS.find(t => labelSkeleton.includes(t));
        if (target && BAIT_RE.test(label)) return `is a fake ${target === "steam" ? "Steam" : "Discord"} gift or login page.`;
        if (/nitro/i.test(url.pathname)) return "offers Nitro but isn't Discord. Real Nitro gifts only come from discord.gift or discord.com.";
    }

    if (lookalikes) {
        for (const brand of BRANDS) {
            const brandSkeleton = skeleton(brand.name);
            const limit = brand.name.length >= 10 ? 2 : brand.name.length >= 6 ? 1 : 0;
            const hit = [labelSkeleton, ...labelSkeleton.split("-")].some(token =>
                token === brandSkeleton
                    ? brand.strict || label !== brand.name
                    : limit > 0 && distance(token, brandSkeleton) <= limit
            );
            if (hit) return `looks like ${brand.domains[0]} but isn't.`;
        }
    }

    if (punycode && decoded !== host) {
        const chars = [...label];
        if (chars.some(c => c in CONFUSABLES) && chars.every(c => c in CONFUSABLES || /[\x00-\x7f]/.test(c)))
            return "mixes in lookalike letters from another alphabet.";
    }

    return null;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const MASKED_RE = /\[([^\]]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/g;
const DOMAIN_RE = /(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})/iu;

function scan(content: string) {
    const trusted = settings.store.trustedDomains.split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
    const warnings = new Map<string, string>();

    if (settings.store.maskedLinks) {
        for (const [, text, href] of content.matchAll(MASKED_RE)) {
            const shown = DOMAIN_RE.exec(text)?.[1];
            const target = URL.parse(href);
            if (!shown || !target || !URL.canParse(`https://${shown}`)) continue;
            const shownHost = new URL(`https://${shown}`).hostname;
            if (registrable(shownHost).domain !== registrable(target.hostname).domain && !trusted.some(d => matchesDomain(target.hostname, d)))
                warnings.set(displayHost(target.hostname), `is hidden behind link text that says ${shown}.`);
        }
    }

    for (const [raw] of content.matchAll(URL_RE)) {
        const url = URL.parse(raw.replace(/[).,!?;:*_~]+$/, ""));
        if (!url) continue;
        const host = displayHost(url.hostname);
        const reason = warnings.has(host) ? null : checkUrl(url, trusted);
        if (reason) warnings.set(host, reason);
    }

    return [...warnings];
}

function ScamWarning({ message }: { message: Message; }) {
    const warnings = scan(message.content);
    if (!warnings.length) return null;

    return (
        <div className={cl("warning")}>
            <div className={cl("title")}>Possible scam link. Think twice before clicking.</div>
            {warnings.map(([host, reason]) => (
                <div key={host}>
                    <span className={cl("host")}>{host}</span> {reason}
                </div>
            ))}
        </div>
    );
}

const SafeScamWarning = ErrorBoundary.wrap(ScamWarning, { noop: true });

export default definePlugin({
    name: "ScamLinkGuard",
    description: "Warns you under a message when a link imitates Discord, Steam or another big site, offers fake Nitro, hides behind misleading link text or uses lookalike letters.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    enabledByDefault: true,
    settings,

    renderMessageAccessory: props => props.isMessageSnapshot ? null : <SafeScamWarning message={props.message} />
});
