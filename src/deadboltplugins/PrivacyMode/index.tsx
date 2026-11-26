/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

const settings = definePluginSettings({
    maskMessages: { type: OptionType.BOOLEAN, description: "Hide message bodies and attachments in the main chat.", default: true, onChange: refresh },
    maskLists: { type: OptionType.BOOLEAN, description: "Hide server, channel, friend and member lists.", default: true, onChange: refresh },
    maskProfiles: { type: OptionType.BOOLEAN, description: "Hide visible avatars, profile names and popouts.", default: true, onChange: refresh }
});
let active = false;
let curtain: HTMLDialogElement | undefined;
const listeners = new Set<(value: boolean) => void>();
const classes = ["db-privacy", "db-privacy-messages", "db-privacy-lists", "db-privacy-profiles"];

function refresh() {
    const root = document.documentElement;
    root.classList.toggle(classes[0], active);
    root.classList.toggle(classes[1], active && settings.store.maskMessages);
    root.classList.toggle(classes[2], active && settings.store.maskLists);
    root.classList.toggle(classes[3], active && settings.store.maskProfiles);
}

function toggle() {
    active = !active;
    refresh();
    for (const listener of listeners) listener(active);
    showToast({ text: active ? "Privacy masking on. Check your shared window before streaming." : "Privacy masking off." });
}

function toggleCurtain() {
    if (curtain) {
        curtain.close();
        curtain.remove();
        curtain = undefined;
        return;
    }
    curtain = document.createElement("dialog");
    curtain.className = "db-privacy-curtain";
    curtain.setAttribute("aria-label", "Privacy curtain");
    curtain.addEventListener("cancel", event => event.preventDefault());
    const notice = document.createElement("p");
    notice.textContent = "Privacy curtain active. Press Ctrl/⌘ + Shift + F12 to reveal.";
    const reveal = document.createElement("button");
    reveal.textContent = "Reveal Discord";
    reveal.onclick = toggleCurtain;
    curtain.append(notice, reveal);
    document.body.appendChild(curtain);
    curtain.showModal();
}

function keydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.repeat) return;
    if (event.code === "F12") {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleCurtain();
    }
}

function EyeIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>;
}

function Header() {
    const [enabled, setEnabled] = useState(active);
    const options = settings.use(["maskMessages", "maskLists", "maskProfiles"]);
    useEffect(() => { listeners.add(setEnabled); return () => { listeners.delete(setEnabled); }; }, []);
    useEffect(refresh, [options.maskMessages, options.maskLists, options.maskProfiles]);
    return <HeaderBarButton icon={EyeIcon} tooltip={enabled ? "Turn privacy masking off" : "Turn privacy masking on"} selected={enabled} onClick={toggle} onContextMenu={event => { event.preventDefault(); toggleCurtain(); }} />;
}

export default definePlugin({
    name: "PrivacyMode",
    description: "Mask sensitive Discord content while sharing your screen, or cover the entire window with a privacy curtain.",
    authors: [Devs.Zot],
    tags: ["Privacy", "Utility"],
    settings,
    headerBarButton: { icon: EyeIcon, render: Header },
    toolboxActions: { "Toggle privacy masking": toggle, "Toggle privacy curtain": toggleCurtain },
    settingsAboutComponent: () => <div style={{ display: "flex", gap: 8 }}><Button size="small" onClick={toggle}>Toggle masking</Button><Button size="small" variant="secondary" onClick={toggleCurtain}>Privacy curtain</Button></div>,
    start() { window.addEventListener("keydown", keydown, true); },
    stop() {
        active = false;
        refresh();
        for (const listener of listeners) listener(false);
        curtain?.close();
        curtain?.remove();
        curtain = undefined;
        window.removeEventListener("keydown", keydown, true);
    }
});
