/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Icon } from "@utils/zotPanels";

const settings = definePluginSettings({ active: { type: OptionType.BOOLEAN, default: true, description: "Reduce decorative visual effects.", onChange: refresh }, reduceMotion: { type: OptionType.BOOLEAN, default: true, description: "Reduce animation and transitions.", onChange: refresh }, reduceEffects: { type: OptionType.BOOLEAN, default: true, description: "Remove decorative blur, profile effects and shadows.", onChange: refresh } });
function refresh() {
    const root = document.documentElement;
    root.classList.toggle("db-performance", settings.store.active);
    root.classList.toggle("db-performance-motion", settings.store.active && settings.store.reduceMotion);
    root.classList.toggle("db-performance-effects", settings.store.active && settings.store.reduceEffects);
}
function toggle() { settings.store.active = !settings.store.active; refresh(); }
function Header() { const { active } = settings.use(["active"]); return <HeaderBarButton icon={Icon} tooltip={active ? "Turn performance mode off" : "Turn performance mode on"} selected={active} onClick={toggle}/>; }
export default definePlugin({ name: "PerformanceMode", description: "Toggle reduced decorative animation and expensive visual effects without disabling calls, media or message handling.", authors: [Devs.Zot], tags: ["Accessibility", "Appearance", "Utility"], settings, headerBarButton: { icon: Icon, render: Header }, toolboxActions: { "Toggle performance mode": toggle }, start: refresh, stop() { document.documentElement.classList.remove("db-performance", "db-performance-motion", "db-performance-effects"); } });
