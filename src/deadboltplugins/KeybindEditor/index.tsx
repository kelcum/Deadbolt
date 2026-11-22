/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Text } from "@components/Text";
import { Devs, IS_MAC } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { humanFriendlyJoin } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findLazy } from "@webpack";
import { SettingsRouter, TextInput, useEffect, useState } from "@webpack/common";

const cl = classNameFactory("vc-keybindeditor-");

interface Shortcut {
    binds: string[];
    comboKeysBindGlobal?: boolean;
    action?: unknown;
}

interface Registrar {
    combokeys: { callbacks: Record<string, unknown>; };
    disable(): void;
    enable(): void;
}

interface Action {
    id: string;
    label: string;
    run(): void;
}

const layout: Record<string, Shortcut> = findLazy(m => m.SERVER_NEXT?.binds && m.TOGGLE_CHANNEL_PINS?.binds);
const registrar: Registrar = findByPropsLazy("setLayout", "enableTemp", "checkDupes");

const defaults: Record<string, string[]> = {};
let recording = false;

const KEYS: ("discord" | "deadbolt")[] = ["discord", "deadbolt"];
const MODIFIERS = ["ctrl", "meta", "alt", "shift"];
const ALIASES: Record<string, string> = { mod: IS_MAC ? "meta" : "ctrl", cmd: "meta", command: "meta", option: "alt", return: "enter", escape: "esc", plus: "=", minus: "-" };
const PRETTY: Record<string, string> = { ctrl: "Ctrl", meta: IS_MAC ? "Cmd" : "Win", alt: IS_MAC ? "Option" : "Alt", shift: "Shift", esc: "Esc", enter: "Enter", pageup: "Page Up", pagedown: "Page Down", del: "Delete", ins: "Insert" };
const CODES: Record<string, string> = {
    Escape: "esc", Enter: "enter", NumpadEnter: "enter", Space: "space", Tab: "tab", Backspace: "backspace",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", PageUp: "pageup", PageDown: "pagedown",
    Home: "home", End: "end", Insert: "ins", Delete: "del", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`"
};

const settings = definePluginSettings({
    editor: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(Editor, { noop: true })
    }
}).withPrivateSettings<{
    discord?: Record<string, string[]>;
    deadbolt?: Record<string, string>;
}>();

function comboOf(e: KeyboardEvent) {
    const key = CODES[e.code] ?? e.code.match(/^(?:Key|Digit|Numpad)(\w)$/)?.[1].toLowerCase() ?? (/^F\d+$/.test(e.code) ? e.code.toLowerCase() : undefined);
    if (!key) return;
    return [e.ctrlKey && "ctrl", e.metaKey && "meta", e.altKey && "alt", e.shiftKey && "shift", key].filter(Boolean).join("+");
}

function normalize(bind: string) {
    const parts = bind.split("+").map(p => ALIASES[p] ?? p);
    return [...MODIFIERS.filter(m => parts.includes(m)), ...parts.filter(p => !MODIFIERS.includes(p))].join("+");
}

function pretty(bind: string) {
    return normalize(bind).split("+").map(p => PRETTY[p] ?? p.charAt(0).toUpperCase() + p.slice(1)).join("+");
}

function nameOf(key: string) {
    const words = key.toLowerCase().replaceAll("_", " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function editable() {
    return Object.keys(layout).filter(k => layout[k].comboKeysBindGlobal && typeof layout[k].action === "function" && k !== "JUMP_TO_GUILD");
}

function deadboltActions() {
    const list: Action[] = [
        { id: "Deadbolt:Settings", label: "Open Deadbolt settings", run: () => SettingsRouter.openUserSettings("equicord_main_panel") },
        { id: "Deadbolt:Plugins", label: "Open plugins", run: () => SettingsRouter.openUserSettings("equicord_plugins_panel") },
        { id: "Deadbolt:QuickCSS", label: "Edit QuickCSS", run: () => VencordNative.quickCss.openEditor() }
    ];
    for (const p of Object.values(plugins)) {
        if (!p.toolboxActions || typeof p.toolboxActions === "function" || !isPluginEnabled(p.name)) continue;
        for (const [label, run] of Object.entries(p.toolboxActions)) list.push({ id: `${p.name}:${label}`, label: `${p.name}: ${label}`, run });
    }
    return list;
}

function rebind() {
    if (!Object.keys(registrar.combokeys.callbacks).length) return;
    registrar.disable();
    registrar.enable();
}

function apply() {
    const discord = settings.store.discord ?? {};
    for (const k of editable()) {
        defaults[k] ??= layout[k].binds;
        layout[k].binds = discord[k] ?? defaults[k];
    }
    rebind();
}

function setDiscord(key: string, binds?: string[]) {
    const next = { ...settings.store.discord };
    if (binds) next[key] = binds;
    else delete next[key];
    settings.store.discord = next;
    apply();
}

function setDeadbolt(id: string, combo?: string) {
    const next = { ...settings.store.deadbolt };
    if (combo) next[id] = combo;
    else delete next[id];
    settings.store.deadbolt = next;
}

function isTyping(target: EventTarget | null) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable;
}

function onKeyDown(e: KeyboardEvent) {
    if (recording || e.repeat) return;
    const combo = comboOf(e);
    if (!combo || isTyping(e.target) && !/^(ctrl|meta|alt)\+|^f\d+$/.test(combo)) return;
    const id = Object.keys(settings.store.deadbolt ?? {}).find(k => settings.store.deadbolt?.[k] === combo);
    const action = id && deadboltActions().find(a => a.id === id);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action.run();
}

interface RowProps {
    label: string;
    binds: string[];
    conflicts: string[];
    changed: boolean;
    onSet(combo: string): void;
    onClear(): void;
    onReset(): void;
}

function Row({ label, binds, conflicts, changed, onSet, onClear, onReset }: RowProps) {
    const [listening, setListening] = useState(false);

    useEffect(() => {
        if (!listening) return;
        recording = true;
        function onKey(e: KeyboardEvent) {
            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            setListening(false);
            const combo = comboOf(e);
            if (combo && combo !== "esc") onSet(combo);
        }
        window.addEventListener("keydown", onKey, true);
        return () => {
            recording = false;
            window.removeEventListener("keydown", onKey, true);
        };
    }, [listening]);

    return (
        <div className={cl("row")}>
            <div className={cl("info")}>
                <Text size="md" weight="medium">{label}</Text>
                <Text size="sm" color={listening ? "text-brand" : "text-muted"}>
                    {listening ? "Press the new shortcut, or Esc to cancel." : binds.map(pretty).join(", ") || "No shortcut"}
                </Text>
                {conflicts.length > 0 && <Text size="sm" color="text-feedback-warning">Also used by {humanFriendlyJoin(conflicts)}.</Text>}
            </div>
            <Button size="small" onClick={() => setListening(true)}>Change</Button>
            <Button size="small" variant="secondary" disabled={!binds.length} onClick={onClear}>Remove</Button>
            <Button size="small" variant="secondary" disabled={!changed} onClick={onReset}>Reset</Button>
        </div>
    );
}

function Editor() {
    const { discord = {}, deadbolt = {} } = settings.use(KEYS);
    const [query, setQuery] = useState("");

    const discordRows = editable().map(k => ({ id: k, label: nameOf(k), binds: (discord[k] ?? defaults[k] ?? layout[k].binds).map(normalize) }));
    const deadboltRows = deadboltActions().map(a => ({ id: a.id, label: a.label, binds: deadbolt[a.id] ? [deadbolt[a.id]] : [] }));
    const fixed = Object.keys(layout).filter(k => k !== "TEXTAREA_FOCUS" && !discordRows.some(r => r.id === k)).map(k => ({ id: k, label: nameOf(k), binds: layout[k].binds.map(normalize) }));

    const users = new Map<string, string[]>();
    for (const r of [...discordRows, ...deadboltRows, ...fixed]) for (const b of r.binds) users.set(b, [...users.get(b) ?? [], r.label]);
    const conflictsOf = (label: string, binds: string[]) => [...new Set(binds.flatMap(b => users.get(b) ?? []))].filter(l => l !== label);

    const match = (label: string) => label.toLowerCase().includes(query.toLowerCase());

    return (
        <div className={cl("root")}>
            <TextInput value={query} onChange={setQuery} placeholder="Search shortcuts" />
            <Heading className={cl("heading")}>Deadbolt actions</Heading>
            {deadboltRows.filter(r => match(r.label)).map(r => (
                <Row
                    key={r.id}
                    label={r.label}
                    binds={r.binds}
                    conflicts={conflictsOf(r.label, r.binds)}
                    changed={r.binds.length > 0}
                    onSet={combo => setDeadbolt(r.id, combo)}
                    onClear={() => setDeadbolt(r.id)}
                    onReset={() => setDeadbolt(r.id)}
                />
            ))}
            <Heading className={cl("heading")}>Discord shortcuts</Heading>
            {discordRows.filter(r => match(r.label)).map(r => (
                <Row
                    key={r.id}
                    label={r.label}
                    binds={r.binds}
                    conflicts={conflictsOf(r.label, r.binds)}
                    changed={r.id in discord}
                    onSet={combo => setDiscord(r.id, [combo])}
                    onClear={() => setDiscord(r.id, [])}
                    onReset={() => setDiscord(r.id)}
                />
            ))}
        </div>
    );
}

export default definePlugin({
    name: "KeybindEditor",
    description: "Change the keys for Discord's own shortcuts and give Deadbolt actions keys of their own, with a warning when two share the same keys.",
    tags: ["Shortcuts", "Utility"],
    authors: [Devs.K3],
    settings,

    start() {
        apply();
        window.addEventListener("keydown", onKeyDown, true);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        for (const [k, binds] of Object.entries(defaults)) layout[k].binds = binds;
        rebind();
    }
});
