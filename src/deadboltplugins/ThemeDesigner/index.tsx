/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { clamp, contrastRatio, hexColor } from "@utils/zotExpansion";
import { column, launchButton, row, showPanel } from "@utils/zotPanels";
import { useState } from "@webpack/common";

interface Palette { accent: string; base: string; panel: string; text: string; scale: number; font?: "default" | "system" | "mono"; }
const presets: Record<string, Palette> = {
    Graphite: { accent: "#5865f2", base: "#202124", panel: "#161719", text: "#e8e9ed", scale: 100 },
    Midnight: { accent: "#8b9dff", base: "#171d2c", panel: "#101521", text: "#e0e8ff", scale: 100 },
    Paper: { accent: "#3559cc", base: "#f5f5f8", panel: "#e6e8ee", text: "#20232c", scale: 100 }
};
let style: HTMLStyleElement | undefined;
const settings = definePluginSettings({ palette: { type: OptionType.CUSTOM, description: "Theme palette", default: presets.Graphite, hidden: true }, apply: { type: OptionType.BOOLEAN, default: false, description: "Use the saved visual palette", onChange: refresh } });
function validated(palette: Palette): Palette {
    return { accent: hexColor(palette.accent, presets.Graphite.accent), base: hexColor(palette.base, presets.Graphite.base), panel: hexColor(palette.panel, presets.Graphite.panel), text: hexColor(palette.text, presets.Graphite.text), scale: clamp(palette.scale, 85, 120, 100), font: palette.font === "system" || palette.font === "mono" ? palette.font : "default" };
}
function refresh() {
    style?.remove(); style = undefined;
    if (!settings.store.apply) return;
    const p = validated(settings.store.palette);
    style = document.createElement("style");
    const font = p.font === "system" ? "--font-primary: system-ui, sans-serif; --font-display: system-ui, sans-serif;" : p.font === "mono" ? "--font-primary: ui-monospace, monospace; --font-display: ui-monospace, monospace;" : "";
    style.textContent = `:root .theme-dark,:root .theme-light,html.theme-dark,html.theme-light { --background-primary: ${p.base}; --background-secondary: ${p.panel}; --background-tertiary: ${p.panel}; --background-base-lowest: ${p.panel}; --background-base-lower: ${p.panel}; --background-base-low: ${p.base}; --background-surface-high: ${p.base}; --text-normal: ${p.text}; --text-default: ${p.text}; --text-strong: ${p.text}; --header-primary: ${p.text}; --brand-500: ${p.accent}; --brand-560: ${p.accent}; --font-size-16: ${16 * p.scale / 100}px; ${font} }`;
    document.head.appendChild(style);
}
function Panel() {
    const [palette, setPalette] = useState(() => validated(settings.store.palette));
    const [enabled, setEnabled] = useState(settings.store.apply);
    const contrast = Math.min(contrastRatio(palette.text, palette.base), contrastRatio(palette.text, palette.panel));
    return <div style={column}>
        <Text size="sm">Adjust the palette without writing CSS. Preview the colors below, then apply. Other themes may override these variables.</Text>
        <div style={row}>{Object.entries(presets).map(([name, p]) => <Button key={name} size="small" variant="secondary" onClick={() => setPalette(p)}>{name}</Button>)}</div>
        {(["accent", "base", "panel", "text"] as const).map(key => <label key={key} style={row}>{key}<input type="color" value={palette[key]} onChange={e => setPalette(p => ({ ...p, [key]: e.target.value }))}/>{palette[key]}</label>)}
        <label>Font <select aria-label="Font family" value={palette.font ?? "default"} onChange={e => setPalette(p => ({ ...p, font: e.target.value as Palette["font"] }))}><option value="default">Discord default</option><option value="system">System</option><option value="mono">Monospace</option></select></label>
        <label>Text scale <input type="range" min={85} max={120} value={palette.scale} onChange={e => setPalette(p => ({ ...p, scale: Number(e.target.value) }))}/> {palette.scale}%</label>
        <div style={{ background: palette.base, color: palette.text, padding: 14, borderRadius: 8, fontSize: 16 * palette.scale / 100 }}><div style={{ background: palette.panel, padding: 10, borderRadius: 6 }}>Example channel · Preview</div><p style={{ padding: "12px 0" }}>This is how a message might appear.</p><span style={{ background: palette.accent, color: "white", padding: 6, borderRadius: 4 }}>Accent color</span></div>
        <Text size="xs" color={contrast < 4.5 ? "text-danger" : "text-muted"}>Text contrast: {contrast.toFixed(1)}:1{contrast < 4.5 ? " · Increase contrast to apply." : ""}</Text>
        <div style={row}><Button disabled={contrast < 4.5} onClick={() => { settings.store.palette = validated(palette); settings.store.apply = true; refresh(); setEnabled(true); }}>Apply palette</Button><Button variant="secondary" disabled={!enabled} onClick={() => { settings.store.apply = false; refresh(); setEnabled(false); }}>Restore normal theme</Button></div>
    </div>;
}
function open() { showPanel("Theme designer", Panel); }
export default definePlugin({ name: "ThemeDesigner", description: "Build and apply a local color palette with a visual preview and restore option.", authors: [Devs.Zot], tags: ["Appearance", "Customisation"], settings, start: refresh, stop() { style?.remove(); style = undefined; }, toolboxActions: { "Theme designer": open }, settingsAboutComponent: launchButton("Open theme designer", open) });
