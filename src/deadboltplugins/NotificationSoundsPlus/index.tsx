/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { column, launchButton, list, owner, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { Channel, Guild, User } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { ChannelStore, GuildStore, Menu, PresenceStore, RelationshipStore, UserGuildSettingsStore, UserStore, useState, WindowStore } from "@webpack/common";

interface RawMessage { id: string; channel_id: string; author: { id: string; }; guild_id?: string; }
type Scope = "user" | "channel" | "server";
interface Rule { owner: string; scope: Scope; id: string; tone: string; }
const tones: Record<string, number[]> = { Soft: [440, 554], Glass: [660, 880], Low: [260, 330] };
const settings = definePluginSettings({ rules: { type: OptionType.CUSTOM, description: "Chime rules", default: [] as Rule[], hidden: true }, volume: { type: OptionType.SLIDER, description: "Additional chime volume.", markers: [0, 10, 20, 40], default: 10 }, onlyUnfocused: { type: OptionType.BOOLEAN, description: "Play chimes only when Discord is not focused.", default: true } });
const shouldNotify: (message: RawMessage, channelId: string) => boolean = findByCodeLazy(".SUPPRESS_NOTIFICATIONS))return!1");
let audio: AudioContext | undefined;
let last = 0;
async function play(tone: string, preview = false) {
    const notes = tones[tone];
    if (!notes || settings.store.volume <= 0) return;
    try {
        const start = Date.now();
        const context = audio ??= new AudioContext();
        if (context.state === "suspended") { if (!preview) return; await context.resume(); }
        if (context !== audio || context.state !== "running" || Date.now() - start > 1000) return;
        notes.forEach((hz, index) => {
            const oscillator = context.createOscillator(), gain = context.createGain();
            const t = context.currentTime + index * 0.12;
            oscillator.frequency.value = hz; oscillator.type = "sine";
            gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(Math.min(0.08, settings.store.volume / 500), t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            oscillator.connect(gain).connect(context.destination); oscillator.start(t); oscillator.stop(t + 0.2); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        });
    } catch { /* Audio is optional. */ }
}
function setRule(userId: string, scope: Scope, id: string, tone: string) {
    if (!owns(userId) || !/^\d{17,20}$/.test(id)) return;
    const rules = settings.store.rules.filter(x => !(x.owner === userId && x.scope === scope && x.id === id));
    if (tone && Object.hasOwn(tones, tone) && rules.length < 200) rules.push({ owner: userId, scope, id, tone });
    settings.store.rules = rules;
}
function menu(scope: Scope, id: string) { const user = owner(); if (!user) return null; return <Menu.MenuItem id={`db-chime-${scope}`} label="Notification chime">{Object.keys(tones).map(t => <Menu.MenuItem key={t} id={`db-chime-${scope}-${t}`} label={t} action={() => setRule(user, scope, id, t)}/>)}<Menu.MenuItem id={`db-chime-${scope}-none`} label="Remove custom chime" action={() => setRule(user, scope, id, "")}/></Menu.MenuItem>; }
const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => { if (user) children.push(menu("user", user.id)); };
const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => { if (channel) children.push(menu("channel", channel.id)); };
const serverMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => { if (guild) children.push(menu("server", guild.id)); };
function Panel({ userId }: { userId: string; }) {
    const { rules } = settings.use(["rules"]);
    const [status, setStatus] = useState("");
    const matches = rules.filter(x => x.owner === userId);
    return <div style={column}><Text size="sm">Set a supplemental chime by right-clicking a user, channel or server. Discord's own notification sound remains unchanged.</Text><div style={row}>{Object.keys(tones).map(t => <Button key={t} size="small" variant="secondary" onClick={() => { void play(t, true); setStatus(`Previewing ${t}.`); }}>{t}</Button>)}</div><div style={list}>{matches.map(r => <div key={`${r.scope}-${r.id}`} style={{ ...row, justifyContent: "space-between" }}><Text size="sm">{r.scope === "user" ? UserStore.getUser(r.id)?.username : r.scope === "channel" ? ChannelStore.getChannel(r.id)?.name : GuildStore.getGuild(r.id)?.name || r.id} · {r.tone}</Text><Button size="xs" variant="secondary" onClick={() => setRule(userId, r.scope, r.id, "")}>Remove</Button></div>)}</div><Status>{status || "Chimes check mute, DND and supported local silence rules. Some hosts block audio until you interact with the window."}</Status></div>;
}
function open() { showPanel("Notification sounds plus", Panel); }
interface SilencePlugin { shouldSilence?(event: { message: RawMessage; channelId: string; guildId?: string; }): boolean; }
export default definePlugin({ name: "NotificationSoundsPlus", description: "Assign optional local notification chimes to users, channels and servers.", authors: [Devs.Zot], tags: ["Notifications"], settings, contextMenus: { "user-context": userMenu, "channel-context": channelMenu, "thread-context": channelMenu, "gdm-context": channelMenu, "guild-context": serverMenu }, toolboxActions: { "Notification chimes": open }, settingsAboutComponent: launchButton("Open notification chimes", open), flux: { MESSAGE_CREATE({ message, optimistic }: { message: RawMessage; optimistic?: boolean; }) {
    try {
        const me = owner(); if (!me || optimistic || !message?.author || me === message.author.id || Date.now() - last < 1500 || PresenceStore.getStatus(me) === "dnd" || RelationshipStore.isBlocked(message.author.id)) return;
        if (settings.store.onlyUnfocused && WindowStore.isFocused()) return;
        const c = ChannelStore.getChannel(message.channel_id); if (!c || UserGuildSettingsStore.isChannelMuted(c.guild_id || null, c.id) || c.guild_id && UserGuildSettingsStore.isMuted(c.guild_id)) return;
        if (!shouldNotify(message, c.id)) return;
        for (const name of ["QuietHours", "NotificationControl"]) { if (isPluginEnabled(name)) { const plugin = plugins[name] as (typeof plugins)[string] & SilencePlugin; if (!plugin.shouldSilence || plugin.shouldSilence({ message, channelId: c.id, guildId: c.guild_id })) return; } }
        if (isPluginEnabled("SilenceUsers") && String(Settings.plugins.SilenceUsers?.mutedUserIds ?? "").split(/[\s,]+/).includes(message.author.id)) return;
        const rules = settings.store.rules.filter(r => r.owner === me);
        const rule = rules.find(r => r.scope === "user" && r.id === message.author.id) ?? rules.find(r => r.scope === "channel" && r.id === c.id) ?? rules.find(r => r.scope === "server" && r.id === c.guild_id);
        if (rule) { last = Date.now(); void play(rule.tone); }
    } catch { /* Skip chime if notification state is unavailable. */ }
}, LOGOUT() { last = 0; } }, stop() { last = 0; void audio?.close().catch(() => {}); audio = undefined; } });
