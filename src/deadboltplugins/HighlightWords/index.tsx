/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { ColorPicker, UserStore } from "@webpack/common";
import type { CSSProperties } from "react";

interface AstNode {
    type: string;
    content?: unknown;
}

interface ColorSettingProps {
    setValue(value: number): void;
}

const cl = classNameFactory("vc-highlightwords-");

const SKIPPED = new Set(["inlineCode", "codeBlock", "link", "url", "autolink", "mention", "roleMention", "channelMention"]);

function ColorSetting({ setValue }: ColorSettingProps) {
    return (
        <ColorPicker
            color={settings.store.color}
            onChange={(color: number) => setValue(color)}
            showEyeDropper={false}
        />
    );
}

const settings = definePluginSettings({
    words: {
        type: OptionType.STRING,
        description: "Words or names to highlight in chat, separated by commas.",
        default: ""
    },
    myName: {
        type: OptionType.BOOLEAN,
        description: "Also highlight your own username and display name when people write them without pinging you.",
        default: true
    },
    wholeWords: {
        type: OptionType.BOOLEAN,
        description: "Only highlight whole words, so cat does not light up inside category.",
        default: true
    },
    caseSensitive: {
        type: OptionType.BOOLEAN,
        description: "Match upper and lower case exactly.",
        default: false
    },
    color: {
        type: OptionType.COMPONENT,
        description: "Highlight color.",
        default: 0xf0b232,
        component: ColorSetting
    }
});

let cachedKey = "";
let cachedRegex: RegExp | null = null;

function getRegex() {
    const { words, myName, wholeWords, caseSensitive } = settings.store;
    const list = words.split(",").map(w => w.trim()).filter(Boolean);
    if (myName) {
        const { username, globalName } = UserStore.getCurrentUser();
        list.push(username);
        if (globalName) list.push(globalName);
    }
    const key = [list.join("\n"), wholeWords, caseSensitive].join("\0");
    if (key === cachedKey) return cachedRegex;

    cachedKey = key;
    if (!list.length) return cachedRegex = null;
    const source = [...new Set(list)].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    cachedRegex = new RegExp(wholeWords ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source, caseSensitive ? "gu" : "giu");
    return cachedRegex;
}

function splitText(text: string, regex: RegExp, color: string): AstNode[] {
    const nodes: AstNode[] = [];
    let last = 0;
    for (const match of text.matchAll(regex)) {
        if (match.index > last) nodes.push({ type: "text", content: text.slice(last, match.index) });
        nodes.push({
            type: "highlight",
            content: (
                <span key={`vc-hw-${nodes.length}-${match.index}`} className={cl("word")} style={{ "--vc-highlightwords-color": color } as CSSProperties}>
                    {match[0]}
                </span>
            )
        });
        last = match.index + match[0].length;
    }
    if (!nodes.length) return [{ type: "text", content: text }];
    if (last < text.length) nodes.push({ type: "text", content: text.slice(last) });
    return nodes;
}

function walk(nodes: AstNode[], regex: RegExp, color: string): AstNode[] {
    return nodes.flatMap(node => {
        if (SKIPPED.has(node.type)) return [node];
        if (node.type === "text" && typeof node.content === "string") return splitText(node.content, regex, color);
        if (Array.isArray(node.content)) return [{ ...node, content: walk(node.content, regex, color) }];
        return [node];
    });
}

export default definePlugin({
    name: "HighlightWords",
    description: "Colors words or names you pick wherever they show up in chat, without pinging or notifying you.",
    tags: ["Chat", "Appearance"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: "!1,hideSimpleEmbedContent",
            replacement: {
                match: /(?<=null!=\i&&\(\i=\i\(\i,\i\)\),)\i(?=}\);return{hasSpoilerEmbeds:)/,
                replace: "$self.highlight($&)"
            }
        }
    ],

    highlight(ast: AstNode[]) {
        const regex = getRegex();
        if (!regex) return ast;
        return walk(ast, regex, `#${settings.store.color.toString(16).padStart(6, "0")}`);
    }
});
