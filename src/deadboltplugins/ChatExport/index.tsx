/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { isTruthy } from "@utils/guards";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { saveFile } from "@utils/web";
import type { Channel, Message, MessageJSON } from "@vencord/discord-types";
import { ChannelStore, Constants, GuildMemberStore, Menu, MessageStore, moment, RestAPI, showToast, UserStore } from "@webpack/common";

const logger = new Logger("ChatExport");
const PAGE = 100;

const settings = definePluginSettings({
    olderMessages: {
        type: OptionType.SLIDER,
        description: "How many older messages to load before exporting, on top of the ones already loaded. Loads 100 at a time with a pause between, like scrolling up.",
        markers: [0, 250, 500, 1000, 2000],
        default: 500,
        stickToMarkers: true
    },
    timestamps: {
        type: OptionType.BOOLEAN,
        description: "Put the date and time in front of each message in text and HTML exports.",
        default: true
    }
});

interface Row {
    id: string;
    time: string;
    edited: string | null;
    authorId: string;
    author: string;
    content: string;
    replyTo: string | null;
    attachments: { filename: string; url: string; }[];
    embeds: { title?: string; description?: string; url?: string; }[];
}

type Format = "txt" | "html" | "json";

let run = 0;

function nameOf(userId: string, guildId: string | null | undefined) {
    const user = UserStore.getUser(userId);
    if (!user) return null;
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || user.globalName || user.username;
}

function plainContent(content: string, guildId: string | null | undefined) {
    return content
        .replace(/<@!?(\d+)>/g, (m, id: string) => {
            const name = nameOf(id, guildId);
            return name ? `@${name}` : m;
        })
        .replace(/<#(\d+)>/g, (m, id: string) => {
            const channel = ChannelStore.getChannel(id);
            return channel ? `#${channel.name}` : m;
        })
        .replace(/<a?(:\w+:)\d+>/g, "$1");
}

function fromStore(m: Message, guildId: string | null | undefined): Row {
    return {
        id: m.id,
        time: new Date(m.timestamp).toISOString(),
        edited: m.editedTimestamp ? new Date(m.editedTimestamp).toISOString() : null,
        authorId: m.author.id,
        author: nameOf(m.author.id, guildId) ?? m.author.username,
        content: m.content,
        replyTo: m.messageReference?.message_id ?? null,
        attachments: m.attachments.map(a => ({ filename: a.filename, url: a.url })),
        embeds: m.embeds.map(e => ({ title: e.rawTitle, description: e.rawDescription, url: e.url }))
    };
}

function fromApi(m: MessageJSON, guildId: string | null | undefined): Row {
    return {
        id: m.id,
        time: m.timestamp,
        edited: m.edited_timestamp ?? null,
        authorId: m.author.id,
        author: nameOf(m.author.id, guildId) ?? m.author.username,
        content: m.content,
        replyTo: m.message_reference?.message_id ?? null,
        attachments: m.attachments.map(a => ({ filename: a.filename, url: a.url })),
        embeds: m.embeds.map(e => ({ title: e.title, description: e.description, url: e.url }))
    };
}

async function collect(channel: Channel, token: number) {
    const rows = new Map<string, Row>();
    MessageStore.getMessages(channel.id).forEach(m => { rows.set(m.id, fromStore(m, channel.guild_id)); });

    const wanted = settings.store.olderMessages;
    if (wanted > 0) showToast({ text: `Loading up to ${wanted} older messages, this takes a few seconds.` });

    let before = rows.size ? [...rows.keys()].reduce((a, b) => (BigInt(a) < BigInt(b) ? a : b)) : undefined;
    for (let loaded = 0; loaded < wanted;) {
        const limit = Math.min(PAGE, wanted - loaded);
        if (loaded) await sleep(1000);
        if (token !== run) return null;
        const res = await RestAPI.get({
            url: Constants.Endpoints.MESSAGES(channel.id),
            query: { limit, ...(before && { before }) },
            retries: 2
        });
        if (token !== run) return null;
        const page: MessageJSON[] = res.body;
        for (const m of page) rows.set(m.id, fromApi(m, channel.guild_id));
        loaded += page.length;
        if (page.length < limit) break;
        before = page[page.length - 1].id;
    }

    return [...rows.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

function chatName(channel: Channel) {
    if (channel.name) return channel.name;
    const id = channel.getRecipientId();
    return (id && UserStore.getUser(id)?.username) || channel.id;
}

function toText(rows: Row[], channel: Channel) {
    const { timestamps } = settings.store;
    return rows.map(r => {
        const prefix = timestamps ? `[${moment(r.time).format("L LT")}] ` : "";
        const lines = [`${prefix}${r.author}: ${plainContent(r.content, channel.guild_id)}`.trimEnd()];
        for (const e of r.embeds) {
            const text = [e.title, e.description, e.url].filter(Boolean).join(" | ");
            if (text) lines.push(`    ${text}`);
        }
        for (const a of r.attachments) lines.push(`    ${a.filename}: ${a.url}`);
        return lines.join("\n");
    }).join("\n");
}

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c] ?? c);

function toHtml(rows: Row[], channel: Channel) {
    const { timestamps } = settings.store;
    const title = esc(chatName(channel));
    const body = rows.map(r => {
        const parts = [
            `<div class="head"><b>${esc(r.author)}</b>${timestamps ? ` <time datetime="${r.time}">${esc(moment(r.time).format("L LT"))}</time>` : ""}${r.edited ? " <i>(edited)</i>" : ""}</div>`
        ];
        if (r.content) parts.push(`<div class="text">${esc(plainContent(r.content, channel.guild_id))}</div>`);
        for (const e of r.embeds) {
            const text = [e.title, e.description].filter(isTruthy).map(esc).join("<br>");
            if (text || e.url) parts.push(`<div class="embed">${text}${e.url ? `${text ? "<br>" : ""}<a href="${esc(e.url)}">${esc(e.url)}</a>` : ""}</div>`);
        }
        for (const a of r.attachments) parts.push(`<div class="file"><a href="${esc(a.url)}">${esc(a.filename)}</a></div>`);
        return `<div class="msg" id="m${r.id}">${parts.join("")}</div>`;
    }).join("\n");

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{margin:0;padding:24px;background:#313338;color:#dbdee1;font:15px/1.4 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}p.sub{color:#949ba4;margin:0 0 20px}
.msg{padding:6px 0;border-top:1px solid #3f4147}.head time,.head i{color:#949ba4;font-size:12px}
.text{white-space:pre-wrap;word-wrap:break-word}.embed{border-left:4px solid #4e5058;padding:4px 8px;margin:4px 0;background:#2b2d31}
a{color:#00a8fc}
</style></head><body>
<h1>${title}</h1><p class="sub">${rows.length} messages, exported ${esc(moment().format("LLL"))}</p>
${body}
</body></html>
`;
}

async function exportChat(channel: Channel, format: Format) {
    const token = ++run;
    const rows = await collect(channel, token).catch(e => {
        logger.error("Could not load messages", e);
        showToast({ text: "Couldn't load the older messages, try again in a bit.", variant: "critical" });
        return null;
    });
    if (!rows) return;
    if (!rows.length) {
        showToast({ text: "There are no messages to export here yet.", variant: "critical" });
        return;
    }

    const content = format === "json"
        ? JSON.stringify({ channel: { id: channel.id, guildId: channel.guild_id ?? null, name: chatName(channel) }, exportedAt: new Date().toISOString(), messages: rows }, null, 2)
        : format === "html" ? toHtml(rows, channel) : toText(rows, channel);
    const filename = `${chatName(channel).replace(/[^\w.-]+/g, "_")}-${moment().format("YYYY-MM-DD")}.${format}`;

    if (IS_DISCORD_DESKTOP) await DiscordNative.fileManager.saveWithDialog(new TextEncoder().encode(content), filename);
    else saveFile(new File([content], filename, { type: format === "html" ? "text/html" : format === "json" ? "application/json" : "text/plain" }));

    showToast({ text: rows.length === 1 ? "Exported 1 message." : `Exported ${rows.length} messages.`, variant: "success" });
}

const canExport = (channel: Channel) => !channel.isCategory() && !channel.isForumLikeChannel();

const addMenuItem: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || !canExport(channel)) return;
    children.push(
        <Menu.MenuItem id="vc-chat-export" label="Export Chat">
            <Menu.MenuItem id="vc-chat-export-txt" label="As Text" action={() => exportChat(channel, "txt")} />
            <Menu.MenuItem id="vc-chat-export-html" label="As HTML" action={() => exportChat(channel, "html")} />
            <Menu.MenuItem id="vc-chat-export-json" label="As JSON" action={() => exportChat(channel, "json")} />
        </Menu.MenuItem>
    );
};

const addDmMenuItem: NavContextMenuPatchCallback = (children, props: { channel?: Channel; }) => {
    if (props.channel?.isDM()) addMenuItem(children, props);
};

export default definePlugin({
    name: "ChatExport",
    description: "Right click a channel or DM and pick Export Chat to save its recent messages as a text, HTML or JSON file.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        "channel-context": addMenuItem,
        "thread-context": addMenuItem,
        "gdm-context": addMenuItem,
        "user-context": addDmMenuItem
    },

    stop() {
        run++;
    }
});
