/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, Menu, MessageStore, MessageTypeSets, PermissionsBits, PermissionStore } from "@webpack/common";

const settings = definePluginSettings({
    useKey: {
        type: OptionType.BOOLEAN,
        description: "Reply with the selected text quoted when you press Q.",
        default: true
    },
    mention: {
        type: OptionType.BOOLEAN,
        description: "Ping the author in the reply.",
        default: true
    }
});

const MESSAGE_ID = /^chat-messages-(\d+)-(\d+)$/;

function messageOf(node: Node | null) {
    const el = node instanceof Element ? node : node?.parentElement;
    const match = el?.closest("[id^='chat-messages-']")?.id.match(MESSAGE_ID);
    return match ? MessageStore.getMessage(match[1], match[2]) : undefined;
}

function selectedQuote() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text) return null;
    const message = messageOf(selection.anchorNode);
    if (!message || message !== messageOf(selection.focusNode)) return null;
    return { message, text };
}

function replyWithQuote(message: Message, text: string) {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel || !MessageTypeSets.REPLYABLE.has(message.type)) return false;
    if (channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)) return false;

    FluxDispatcher.dispatch({
        type: "CREATE_PENDING_REPLY",
        channel,
        message,
        shouldMention: settings.store.mention,
        showMentionToggle: !channel.isPrivate()
    });
    window.getSelection()?.removeAllRanges();
    setTimeout(() => insertTextIntoChatInputBox(text.split("\n").map(line => `> ${line}`).join("\n") + "\n"), 0);
    return true;
}

function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.useKey || e.key.toLowerCase() !== "q" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, textarea, select"))) return;
    const quote = selectedQuote();
    if (quote && replyWithQuote(quote.message, quote.text)) e.preventDefault();
}

const messageContextMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const quote = selectedQuote();
    if (!quote || quote.message.id !== message.id) return;
    children.push(
        <Menu.MenuItem
            id="vc-reply-with-quote"
            label="Reply With Quote"
            action={() => replyWithQuote(quote.message, quote.text)}
        />
    );
};

export default definePlugin({
    name: "ReplyWithQuote",
    description: "Select part of a message and press Q, or right click it, to reply quoting just that part.",
    tags: ["Chat"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        message: messageContextMenu
    },

    start() {
        document.addEventListener("keydown", onKeyDown);
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown);
    }
});
