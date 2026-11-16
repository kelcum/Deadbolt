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
import { findByPropsLazy } from "@webpack";
import { ChannelStore, createRoot, MessageStore, SelectedChannelStore, showToast, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const cl = classNameFactory("vc-quickfind-");
const Jumper = findByPropsLazy("jumpToMessage");
const History = findByPropsLazy("fetchMessages", "sendMessage");

const settings = definePluginSettings({
    keybind: {
        type: OptionType.SELECT,
        description: "Shortcut that opens QuickFind",
        options: [
            { label: "Ctrl+Shift+F", value: "ctrl+shift+f", default: true },
            { label: "Ctrl+Alt+F", value: "ctrl+alt+f" },
            { label: "Alt+F", value: "alt+f" }
        ]
    },
    searchEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Also match link previews, bot embeds and attachment file names",
        default: true
    },
    searchAuthors: {
        type: OptionType.BOOLEAN,
        description: "Also match the sender's name",
        default: false
    }
});

const seenByChannel = new Map<string, Map<string, Message>>();
const MAX_SEEN_PER_CHANNEL = 20_000;
const MAX_LISTED = 60;

function remember(channelId: string) {
    const store = MessageStore.getMessages(channelId);
    if (!store) return;
    let seen = seenByChannel.get(channelId);
    if (!seen) seenByChannel.set(channelId, seen = new Map());
    const add = (m: Message) => {
        if (m?.id) seen!.set(m.id, m);
    };
    store._before?._messages?.forEach(add);
    store._array?.forEach(add);
    store._after?._messages?.forEach(add);
    if (seen.size > MAX_SEEN_PER_CHANNEL) {
        const sorted = [...seen.values()].sort(byNewest);
        seenByChannel.set(channelId, new Map(sorted.slice(0, MAX_SEEN_PER_CHANNEL).map(m => [m.id, m])));
    }
}

function byNewest(a: Message, b: Message) {
    return a.id.length !== b.id.length ? b.id.length - a.id.length : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

function textOf(m: Message) {
    const parts = [m.content ?? ""];
    if (settings.store.searchEmbeds) {
        for (const e of (m.embeds ?? []) as any[]) {
            parts.push(e.rawTitle ?? e.title ?? "", e.rawDescription ?? e.description ?? "", e.author?.name ?? "", e.footer?.text ?? "");
            for (const f of e.fields ?? []) parts.push(f.rawName ?? f.name ?? "", f.rawValue ?? f.value ?? "");
        }
        for (const a of m.attachments ?? []) parts.push(a.filename ?? "");
    }
    if (settings.store.searchAuthors) {
        const author = m.author as any;
        parts.push(author?.globalName ?? "", author?.username ?? "");
    }
    return parts.join("\n");
}

function snippet(text: string, query: string, caseSensitive: boolean) {
    const flat = text.replace(/\s+/g, " ");
    const at = caseSensitive ? flat.indexOf(query) : flat.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return { before: flat.slice(0, 90), match: "", after: "" };
    const start = Math.max(0, at - 40);
    return {
        before: (start > 0 ? "…" : "") + flat.slice(start, at),
        match: flat.slice(at, at + query.length),
        after: flat.slice(at + query.length, at + query.length + 60)
    };
}

function when(m: Message) {
    const t = new Date(m.timestamp as any);
    if (isNaN(t.getTime())) return "";
    const today = new Date();
    return t.toDateString() === today.toDateString()
        ? t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: t.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function jump(m: Message) {
    Jumper.jumpToMessage({ channelId: m.channel_id, messageId: m.id, flash: true, jumpType: "INSTANT" });
}

function holdFocus(el: HTMLInputElement | null, ms = 800) {
    if (!el) return;
    const until = Date.now() + ms;
    const pull = (e: FocusEvent) => {
        if (Date.now() > until) return document.removeEventListener("focusin", pull, true);
        if (host && e.target instanceof Node && !host.contains(e.target)) setTimeout(() => el.focus(), 0);
    };
    document.addEventListener("focusin", pull, true);
    setTimeout(() => document.removeEventListener("focusin", pull, true), ms);
    el.focus();
}

function useChannelId() {
    const [id, setId] = useState(() => SelectedChannelStore.getChannelId());
    useEffect(() => {
        const update = () => setId(SelectedChannelStore.getChannelId());
        SelectedChannelStore.addChangeListener(update);
        return () => SelectedChannelStore.removeChangeListener(update);
    }, []);
    return id;
}

function QuickFindBar({ onClose }: { onClose(): void; }) {
    const channelId = useChannelId();
    const [query, setQuery] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [index, setIndex] = useState(0);
    const [version, setVersion] = useState(0);
    const [loading, setLoading] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    const jumpedOnce = useRef(false);

    useEffect(() => {
        input.current?.focus();
        input.current?.select();
    }, [channelId]);

    useEffect(() => {
        if (!channelId) return;
        remember(channelId);
        setVersion(v => v + 1);
        const update = () => {
            remember(channelId);
            setVersion(v => v + 1);
        };
        MessageStore.addChangeListener(update);
        return () => MessageStore.removeChangeListener(update);
    }, [channelId]);

    const results = useMemo(() => {
        const q = query.trim();
        if (!channelId || !q) return [];
        const needle = caseSensitive ? q : q.toLowerCase();
        const seen = [...(seenByChannel.get(channelId)?.values() ?? [])].sort(byNewest);
        return seen.filter(m => {
            const text = textOf(m);
            return (caseSensitive ? text : text.toLowerCase()).includes(needle);
        });
    }, [channelId, query, caseSensitive, version]);

    useEffect(() => {
        setIndex(0);
        jumpedOnce.current = false;
    }, [query, caseSensitive, channelId]);

    const total = seenByChannel.get(channelId ?? "")?.size ?? 0;
    const store = channelId ? MessageStore.getMessages(channelId) : null;
    const canLoadOlder = !!store && (store.hasMoreBefore || !store.hasFetched);
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;

    function go(to: number) {
        if (!results.length) return;
        const next = (to + results.length) % results.length;
        setIndex(next);
        jumpedOnce.current = true;
        jump(results[next]);
        holdFocus(input.current);
    }

    async function loadOlder() {
        if (!channelId || loading) return;
        const seen = [...(seenByChannel.get(channelId)?.values() ?? [])].sort(byNewest);
        const oldest = seen[seen.length - 1];
        setLoading(true);
        try {
            await History.fetchMessages({ channelId, before: oldest?.id, limit: 100 });
            remember(channelId);
            setVersion(v => v + 1);
        } catch {
            showToast({ text: "Couldn't load older messages right now.", variant: "critical" });
        } finally {
            setLoading(false);
        }
    }

    function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) go(index - 1);
            else go(jumpedOnce.current ? index + 1 : index);
        }
    }

    const q = query.trim();
    const listed = results.slice(0, MAX_LISTED);

    return (
        <div className={cl("panel")} onKeyDown={e => e.stopPropagation()}>
            <div className={cl("bar")}>
                <input
                    ref={input}
                    className={cl("input")}
                    placeholder={channel ? `Find in ${channel.name ? (channel.guild_id ? "#" : "") + channel.name : "this chat"}` : "Open a chat to search it"}
                    value={query}
                    onChange={e => setQuery(e.currentTarget.value)}
                    onKeyDown={onKeyDown}
                    disabled={!channelId}
                    spellCheck={false}
                />
                <span className={cl("count")}>{q ? (results.length ? `${index + 1}/${results.length}` : "0") : ""}</span>
                <button className={cl("btn", caseSensitive && "on")} title="Match case" onClick={() => setCaseSensitive(c => !c)}>Aa</button>
                <button className={cl("btn")} title="Newer match (Shift+Enter)" disabled={!results.length} onClick={() => go(index - 1)}>↑</button>
                <button className={cl("btn")} title="Older match (Enter)" disabled={!results.length} onClick={() => go(index + 1)}>↓</button>
                <button className={cl("btn")} title="Close (Esc)" onClick={onClose}>✕</button>
            </div>
            {q && (
                <div className={cl("results")}>
                    {listed.map((m, i) => {
                        const s = snippet(textOf(m), q, caseSensitive);
                        const author = m.author as any;
                        return (
                            <button
                                key={m.id}
                                className={cl("result", i === index && "active")}
                                onClick={() => go(i)}
                            >
                                <div className={cl("meta")}>
                                    <span className={cl("author")}>{author?.globalName ?? author?.username ?? "Unknown"}</span>
                                    <span className={cl("time")}>{when(m)}</span>
                                </div>
                                <div className={cl("text")}>
                                    {s.before}<mark>{s.match}</mark>{s.after}
                                </div>
                            </button>
                        );
                    })}
                    {results.length > MAX_LISTED && <div className={cl("note")}>{results.length - MAX_LISTED} more, use ↓ to step through them</div>}
                    {!results.length && <div className={cl("note")}>No matches in the {total} messages loaded here.</div>}
                    <div className={cl("footer")}>
                        <span>Searching {total} loaded message{total === 1 ? "" : "s"}, offline</span>
                        {canLoadOlder && (
                            <button className={cl("link")} disabled={loading} onClick={loadOlder}>
                                {loading ? "Loading…" : "Load 100 older"}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function placeHost() {
    if (!host) return;
    const chat = document.querySelector("[class*=chatContent]") ?? document.querySelector("main");
    const rect = chat?.getBoundingClientRect();
    if (rect && rect.width > 300) {
        host.style.top = `${Math.round(rect.top) + 10}px`;
        host.style.right = `${Math.round(window.innerWidth - rect.right) + 16}px`;
    } else {
        host.style.top = "60px";
        host.style.right = "24px";
    }
}

function close() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
    window.removeEventListener("resize", placeHost);
}

function open() {
    if (host) {
        host.querySelector("input")?.focus();
        (host.querySelector("input") as HTMLInputElement | null)?.select();
        return;
    }
    host = document.createElement("div");
    host.className = cl("host");
    document.body.appendChild(host);
    placeHost();
    window.addEventListener("resize", placeHost);
    root = createRoot(host);
    root.render(
        <ErrorBoundary onError={() => setTimeout(close)}>
            <QuickFindBar onClose={close} />
        </ErrorBoundary>
    );
}

function matchesKeybind(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== "f") return false;
    switch (settings.store.keybind) {
        case "ctrl+alt+f": return (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey;
        case "alt+f": return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        default: return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    }
}

function onKeyDown(e: KeyboardEvent) {
    if (host && e.key === "Escape" && (host.contains(document.activeElement) || document.activeElement === document.body)) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
    }
    if (!matchesKeybind(e)) return;
    e.preventDefault();
    e.stopPropagation();
    open();
}

export default definePlugin({
    name: "QuickFind",
    description: "Find text in the open chat instantly, offline: Ctrl+Shift+F searches every message Discord has loaded there, works in DMs and jumps straight to each match.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    enabledByDefault: true,
    settings,
    start() {
        document.addEventListener("keydown", onKeyDown, true);
    },
    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        close();
        seenByChannel.clear();
    }
});
