/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import type { MessageDecorationProps } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { useEffect } from "@webpack/common";

const MessageClasses = findCssClassesLazy("separator", "latin24CompactTimeStamp");
const subscribers = new Set<() => void>();
let tick: number | undefined;
let styleEl: HTMLStyleElement | undefined;
let running = false;

// Relative age formatter adapted from fagner's MessageTimestamps (GPL-3.0-or-later).
function relativeAge(ms: number): string {
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    const wk = Math.floor(day / 7);
    if (wk < 5) return `${wk}w ago`;
    const mo = Math.floor(day / 30);
    if (day < 365) return `${Math.min(11, mo)}mo ago`;
    return `${Math.floor(day / 365)}y ago`;
}

const settings = definePluginSettings({
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Show timestamps on grouped messages without hovering.",
        default: true,
        onChange: updateStyle
    },
    showRelativeAge: {
        type: OptionType.BOOLEAN,
        description: "Display the age of a message next to its author.",
        default: true
    }
});

function updateStyle() {
    if (!running) return;
    if (!settings.store.alwaysShow) {
        styleEl?.remove();
        styleEl = undefined;
        return;
    }
    let className: string;
    try {
        ({ latin24CompactTimeStamp: className } = MessageClasses);
    } catch {
        return;
    }
    if (!className || !/^[\w-]+$/.test(className)) return;
    if (!styleEl) {
        styleEl = document.createElement("style");
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = "." + className + " { opacity: 0.65 !important; }";
}

function RelativeAge({ message }: MessageDecorationProps) {
    const { showRelativeAge } = settings.use(["showRelativeAge"]);
    const update = useForceUpdater();
    useEffect(() => {
        if (!showRelativeAge) return;
        subscribers.add(update);
        return () => { subscribers.delete(update); };
    }, [showRelativeAge, update]);
    const ms = Number(message.timestamp);
    if (!showRelativeAge || !Number.isFinite(ms)) return null;
    return <span className="vc-mt-relative">{relativeAge(ms)}</span>;
}

export default definePlugin({
    name: "MessageTimestamps",
    description: "Shows grouped message timestamps and live relative message ages.",
    authors: [{ name: "fagner", id: 0n }, Devs.Zot],
    tags: ["Chat", "Appearance"],
    settings,
    renderMessageDecoration: RelativeAge,
    start() {
        running = true;
        updateStyle();
        tick = window.setInterval(() => subscribers.forEach(fn => fn()), 60_000);
    },
    stop() {
        running = false;
        styleEl?.remove();
        styleEl = undefined;
        window.clearInterval(tick);
        tick = undefined;
        subscribers.clear();
    }
});
