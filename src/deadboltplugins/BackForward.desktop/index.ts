/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { NavigationRouter } from "@webpack/common";

const settings = definePluginSettings({
    mouseButtons: {
        type: OptionType.BOOLEAN,
        description: "Use the back and forward side buttons on your mouse.",
        default: true
    },
    altArrows: {
        type: OptionType.BOOLEAN,
        description: "Use Alt+Left and Alt+Right. Skipped while you're typing in a box that has text in it.",
        default: true
    }
});

function hasText(target: EventTarget | null) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target.value !== "";
    return target instanceof HTMLElement && target.isContentEditable && target.textContent !== "";
}

function onMouseUp(e: MouseEvent) {
    if (!settings.store.mouseButtons || (e.button !== 3 && e.button !== 4)) return;
    e.preventDefault();
    if (e.button === 3) NavigationRouter.back();
    else NavigationRouter.forward();
}

function onKeyDown(e: KeyboardEvent) {
    if (!settings.store.altArrows || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (hasText(e.target)) return;
    e.preventDefault();
    if (e.key === "ArrowLeft") NavigationRouter.back();
    else NavigationRouter.forward();
}

export default definePlugin({
    name: "BackForward",
    description: "Go back and forward through the channels you visited with your mouse side buttons or Alt+Left and Alt+Right.",
    tags: ["Utility"],
    authors: [Devs.K3],
    settings,

    start() {
        window.addEventListener("mouseup", onMouseUp, true);
        window.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        window.removeEventListener("mouseup", onMouseUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
    }
});
