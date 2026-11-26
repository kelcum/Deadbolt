/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { clamp } from "@utils/zotExpansion";

let style: HTMLStyleElement | undefined;
const settings = definePluginSettings({ duration: { type: OptionType.SLIDER, description: "Transition duration (milliseconds).", markers: [100, 160, 220, 300], default: 160, onChange: refresh }, dialogs: { type: OptionType.BOOLEAN, default: true, description: "Animate dialogs when opened.", onChange: refresh }, menus: { type: OptionType.BOOLEAN, default: true, description: "Animate context menus when opened.", onChange: refresh } });
function refresh() {
    style?.remove(); style = undefined;
    const selectors = [settings.store.dialogs ? '[role="dialog"]:not(.db-privacy-curtain)' : "", settings.store.menus ? '[role="menu"]' : ""].filter(Boolean);
    if (!selectors.length) return;
    const duration = clamp(settings.store.duration, 80, 400, 160);
    style = document.createElement("style");
    style.textContent = `@keyframes db-zot-in { from { opacity: .5; translate: 0 4px; } to { opacity: 1; translate: 0 0; } } @media (prefers-reduced-motion: no-preference) { ${selectors.map(s => `html:not(.db-performance):not(.db-privacy) ${s}`).join(",")} { animation: db-zot-in ${duration}ms ease-out; } }`;
    document.head.appendChild(style);
}
export default definePlugin({ name: "BetterAnimations", description: "Add adjustable dialog and context menu entrance transitions while respecting reduced motion and PerformanceMode.", authors: [Devs.Zot], tags: ["Appearance", "Accessibility"], settings, start: refresh, stop() { style?.remove(); style = undefined; } });
