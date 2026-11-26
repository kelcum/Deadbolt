/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { column, field, launchButton, list, owner, owns, row, showPanel, Status } from "@utils/zotPanels";
import type { Channel, Guild, Message, User } from "@vencord/discord-types";
import { Menu, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

interface Alias { name: string; kind: string; id: string; }
let cachedOwner: string | undefined;
let aliases: Alias[] = [];
let revision = 0;
const listeners = new Set<() => void>();
function reset() { revision++; cachedOwner = undefined; aliases = []; listeners.forEach(f => f()); }
async function refresh() {
    const id = owner(); const request = ++revision;
    if (id !== cachedOwner) { cachedOwner = id; aliases = []; listeners.forEach(f => f()); }
    if (!id) return;
    const next = await DataStore.get<Alias[]>(`zot:LocalAliases:${id}`);
    if (owns(id) && request === revision) { aliases = next ?? []; listeners.forEach(f => f()); }
}
function AliasBadge({ message }: { message: Message; }) {
    const id = useStateFromStores([UserStore], owner);
    const [, setRevision] = useState(0);
    useEffect(() => { const update = () => setRevision(x => x + 1); listeners.add(update); return () => { listeners.delete(update); }; }, []);
    if (!id || cachedOwner !== id) return null;
    const entry = aliases.find(a => a.kind === "user" && a.id === message.author.id);
    return entry ? <span className="db-local-alias" title="Private local alias" style={{ fontSize: 11, padding: "1px 5px", border: "1px solid var(--border-subtle)", borderRadius: 4, color: "var(--text-muted)" }}>Alias: {entry.name}</span> : null;
}
function openEditor(kind = "user", objectId = "") {
    showPanel("Local customization", ({ userId }) => {
        const [items, setItems] = useState<Alias[]>([]);
        const [type, setType] = useState(kind);
        const [id, setId] = useState(objectId);
        const [name, setName] = useState("");
        const [status, setStatus] = useState("");
        const [busy, setBusy] = useState(true);
        useEffect(() => { let active = true; DataStore.get<Alias[]>(`zot:LocalAliases:${userId}`).then(v => { if (active) { setItems(v ?? []); const old = v?.find(a => a.kind === kind && a.id === objectId); if (old) setName(old.name); } }, () => { if (active) setStatus("Could not load aliases."); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [userId]);
        async function update(change: (old: Alias[]) => Alias[]) {
            if (!owns(userId) || busy) return;
            setBusy(true);
            try { const key = `zot:LocalAliases:${userId}`; await DataStore.update<Alias[]>(key, old => change(old ?? [])); if (owns(userId)) { setItems(await DataStore.get<Alias[]>(key) ?? []); await refresh(); setStatus("Local aliases updated."); } }
            catch (e) { setStatus(e instanceof Error ? e.message : "Could not update aliases."); } finally { setBusy(false); }
        }
        function save() {
            const value = name.trim();
            if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(value) || !/^\d{17,20}$/.test(id)) { setStatus("Use a Discord ID and a 1–32 character alias containing letters, numbers, spaces, underscores or dashes."); return; }
            void update(old => { const rest = old.filter(x => !(x.id === id && x.kind === type)); if (rest.length >= 100 || rest.some(a => a.name === value)) throw new Error("Alias limit reached or that alias already exists."); return [...rest, { name: value, kind: type, id }]; });
        }
        return <div style={column}><Text size="sm">Edit private aliases from LocalAliases. User aliases appear alongside their real message names. Server and channel aliases are searchable labels; Discord identities and icons are not changed.</Text><div style={row}><select style={field} aria-label="Object type" value={type} onChange={e => setType(e.target.value)}>{["user", "server", "channel"].map(k => <option key={k}>{k}</option>)}</select><input style={{ ...field, flex: 1 }} aria-label="Discord ID" value={id} maxLength={20} onChange={e => setId(e.target.value)} /></div><div style={row}><input aria-label="Local alias" style={{ ...field, flex: 1 }} value={name} maxLength={32} onChange={e => setName(e.target.value)} placeholder="Local alias"/><Button disabled={busy} onClick={save}>Save alias</Button></div><div style={list}>{items.map(a => <div key={a.name} style={{ ...row, justifyContent: "space-between" }}><Text size="sm">{a.name} · {a.kind}</Text><div style={row}><Button size="xs" variant="secondary" onClick={() => { setType(a.kind); setId(a.id); setName(a.name); }}>Edit</Button><Button size="xs" variant="secondary" disabled={busy} onClick={() => void update(old => old.filter(x => x.name !== a.name))}>Remove</Button></div></div>)}</div><Status>{busy ? "Working…" : status}</Status></div>;
    });
}
const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => { if (user) children.push(<Menu.MenuItem id="db-alias-user" label="Edit local alias" action={() => openEditor("user", user.id)}/>); };
const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => { if (channel) children.push(<Menu.MenuItem id="db-alias-channel" label="Edit local alias" action={() => openEditor("channel", channel.id)}/>); };
const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => { if (guild) children.push(<Menu.MenuItem id="db-alias-server" label="Edit local alias" action={() => openEditor("server", guild.id)}/>); };
function open() { openEditor(); }
function reload() { void refresh().catch(() => {}); }
export default definePlugin({ name: "LocalCustomization", description: "Manage existing private aliases visually and show user aliases beside message names.", authors: [Devs.Zot], tags: ["Customisation", "Organisation"], contextMenus: { "user-context": userMenu, "guild-context": guildMenu, "channel-context": channelMenu, "thread-context": channelMenu, "gdm-context": channelMenu }, renderMessageDecoration: ({ message }) => <AliasBadge message={message}/>, toolboxActions: { "Local customization": open, "Refresh local aliases": reload }, settingsAboutComponent: launchButton("Manage local aliases", open), start: reload, flux: { CONNECTION_OPEN: reload, LOGOUT: reset }, stop: reset });
