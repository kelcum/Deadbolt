/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { TextButton } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { zustandCreate } from "@webpack/common";

const CHARS_PER_LINE = 120;
const KEYS = ["lines"] as const;

const settings = definePluginSettings({
    lines: {
        type: OptionType.SLIDER,
        description: "How many lines a message can have before it gets collapsed.",
        markers: [5, 10, 15, 20, 30, 40],
        default: 15,
        onChange: setLines
    }
});

interface ExpandedStore {
    <T>(selector: (state: { expanded: Set<string>; }) => T): T;
    getState(): { expanded: Set<string>; };
    setState(state: { expanded: Set<string>; }): void;
}

const useExpanded: ExpandedStore = proxyLazy(() => zustandCreate(() => ({ expanded: new Set<string>() })));

function setLines(lines: number) {
    document.documentElement.style.setProperty("--vc-collapse-long-messages-lines", String(lines));
}

function isLong(content: string, lines: number) {
    let total = 0;
    for (const line of content.split("\n")) {
        total += Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
        if (total > lines) return true;
    }
    return false;
}

function toggle(id: string) {
    const expanded = new Set(useExpanded.getState().expanded);
    if (!expanded.delete(id)) expanded.add(id);
    useExpanded.setState({ expanded });
}

const Toggle = ErrorBoundary.wrap(({ message }: { message: Message; }) => {
    const { lines } = settings.use(KEYS);
    const expanded = useExpanded(s => s.expanded.has(message.id));
    if (!message.content || !isLong(message.content, lines)) return null;

    return (
        <TextButton variant="link" className="vc-collapse-long-messages-toggle" onClick={() => toggle(message.id)}>
            {expanded ? "Show less" : "Show more"}
        </TextButton>
    );
}, { noop: true });

export default definePlugin({
    name: "CollapseLongMessages",
    description: "Folds very long messages down to a few lines with a Show more button, so walls of text don't take over the chat.",
    tags: ["Chat", "Appearance"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: ".SEND_FAILED,",
            replacement: {
                match: /(?<=\]:(\i)\.isUnsupported.{0,50}?,)(?=children:\[)/,
                replace: "...$self.useCollapseProps($1),"
            }
        }
    ],

    useCollapseProps(message: Message) {
        const { lines } = settings.use(KEYS);
        const expanded = useExpanded(s => s.expanded.has(message.id));
        return !expanded && message.content && isLong(message.content, lines) ? { "data-vc-collapse-long-messages": "" } : {};
    },

    renderMessageAccessory: ({ message }) => <Toggle message={message} />,

    start() {
        setLines(settings.store.lines);
    },

    stop() {
        document.documentElement.style.removeProperty("--vc-collapse-long-messages-lines");
    }
});
