/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildStore, Menu, Modal, openModal, PermissionsBits, PermissionStore, SelectedChannelStore, showToast, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

interface Saved { id: string; }
let recent: string[] = [];
let recentOwner: string | undefined;
const key = (id: string) => `zot:SplitChat:${id}`;
function currentOwner() {
    const id = UserStore.getCurrentUser()?.id;
    if (id !== recentOwner) { recentOwner = id; recent = []; }
    return id;
}
function available(id: string) {
    const channel = ChannelStore.getChannel(id);
    if (!channel || channel.isCategory() || channel.isDirectory() || channel.isGuildVocal()) return null;
    if (channel.guild_id) return PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) ? channel : null;
    // SidebarChat's existing DM action expects a recipient user ID, not a group DM ID.
    return channel.isDM() && channel.getRecipientId?.() ? channel : null;
}
function title(channel: Channel) {
    if (channel.guild_id) return `${GuildStore.getGuild(channel.guild_id)?.name ?? "Server"} · #${channel.name}`;
    const recipient = channel.getRecipientId?.();
    return recipient ? UserStore.getUser(recipient)?.username ?? "Direct message" : "Direct message";
}
function openSide(channelId: string, userId: string) {
    if (currentOwner() !== userId) return false;
    const channel = available(channelId);
    if (!channel || channelId === SelectedChannelStore.getChannelId()) return false;
    const id = channel.guild_id ? channel.id : channel.getRecipientId?.();
    if (!id) return false;
    // SidebarChat handles the actual native chat rendering and sending; only reuse its action.
    FluxDispatcher.dispatch({ type: "VC_SIDEBAR_CHAT_NEW", guildId: channel.guild_id || null, id } as Parameters<typeof FluxDispatcher.dispatch>[0]);
    return true;
}
async function pin(userId: string, channelId: string) {
    if (currentOwner() !== userId || !available(channelId)) return false;
    await DataStore.update<Saved[]>(key(userId), old => {
        const rows = old ?? [];
        if (rows.length >= 30 && !rows.some(r => r.id === channelId)) throw new Error("Split chat favorites are full.");
        return [{ id: channelId }, ...rows.filter(r => r.id !== channelId)];
    });
    return true;
}
function Icon({ width = 24, height = 24 }: { width?: number; height?: number; }) { return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 4v16M6 8h4M6 12h4M16 8h2M16 12h2"/></svg>; }
const Panel = ErrorBoundary.wrap(({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [favorites, setFavorites] = useState<Saved[]>([]);
    const [query, setQuery] = useState("");
    const [manual, setManual] = useState("");
    const [status, setStatus] = useState("");
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        DataStore.get<Saved[]>(key(userId)).then(rows => { if (active && currentOwner() === userId) setFavorites(rows ?? []); }).catch(() => { if (active) setStatus("Could not read favorites."); });
        return () => { active = false; };
    }, [userId, revision]);
    const selected = SelectedChannelStore.getChannelId();
    const ids = [...new Set([...favorites.map(r => r.id), ...recent])];
    const rows = ids.filter(id => id !== selected).map(available).filter((c): c is Channel => Boolean(c)).filter(c => title(c).toLowerCase().includes(query.toLowerCase()));
    function choose(id: string) {
        if (!openSide(id, userId)) return setStatus("Choose a different accessible server text channel or one-to-one DM.");
        modalProps.onClose();
    }
    async function addCurrent() { try { if (await pin(userId, selected)) { setRevision(n => n + 1); setStatus("Current chat saved to favorites."); } else setStatus("This channel is not supported."); } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save favorite."); } }
    async function remove(id: string) { try { if (currentOwner() !== userId) return; await DataStore.update<Saved[]>(key(userId), old => (old ?? []).filter(r => r.id !== id)); setRevision(n => n + 1); } catch { setStatus("Could not remove favorite."); } }
    return <Modal {...modalProps} title="Split chat" size="md" subtitle="Open a second conversation using SidebarChat. Main chat stays open." actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        {account !== userId ? <Text size="sm">Account changed.</Text> : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Button size="small" variant="secondary" onClick={() => void addCurrent()}>Save current chat for later</Button>
            <input aria-label="Search saved and recent chats" placeholder="Search saved and recent chats" value={query} onChange={e => setQuery(e.target.value)} />
            <div style={{ maxHeight: 340, overflowY: "auto" }}>{rows.map(c => <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 6 }}><Text size="sm" style={{ flex: 1 }}>{title(c)}</Text><Button size="small" onClick={() => choose(c.id)}>Open beside chat</Button>{favorites.some(r => r.id === c.id) && <Button size="small" variant="secondary" onClick={() => void remove(c.id)}>Unpin</Button>}</div>)}</div>
            {!rows.length && <Text size="xs" color="text-muted">Visit a few channels or right-click one to save it.</Text>}
            <div style={{ display: "flex", gap: 8 }}><input aria-label="Channel ID" placeholder="Or enter channel ID" value={manual} onChange={e => setManual(e.target.value.trim())} /><Button size="small" disabled={!/^\d{17,20}$/.test(manual)} onClick={() => choose(manual)}>Open</Button></div>
            <Text size="xs" role="status" color="text-muted">{status}</Text>
        </div>}
    </Modal>;
});
function open() { const userId = currentOwner(); if (userId) openModal(props => <Panel userId={userId} modalProps={props} />); }
const menu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    const userId = currentOwner();
    if (!userId || !channel || !available(channel.id)) return;
    children.push(<Menu.MenuItem id="db-split-pin" label="Save to Split Chat" action={async () => { try { if (await pin(userId, channel.id)) showToast({ text: "Split chat favorite saved." }); } catch { showToast({ text: "Could not save favorite.", variant: "critical" }); } }} />);
};
export default definePlugin({ name: "SplitChat", description: "Quickly open saved or recently visited conversations beside the main chat using the existing SidebarChat renderer.", authors: [Devs.Zot], tags: ["Chat", "Organisation"], dependencies: ["SidebarChat"],
    headerBarButton: { icon: Icon, render: () => <HeaderBarButton icon={Icon} tooltip="Split chat" onClick={open} /> }, toolboxActions: { "Open split chat": open }, settingsAboutComponent: () => <Button size="small" onClick={open}>Open split chat</Button>, contextMenus: { "channel-context": menu, "thread-context": menu },
    flux: { CHANNEL_SELECT({ channelId }: { channelId?: string; }) { if (!currentOwner() || !channelId || !available(channelId)) return; recent = [channelId, ...recent.filter(id => id !== channelId)].slice(0, 30); }, LOGOUT() { recent = []; recentOwner = undefined; } }, stop() { recent = []; recentOwner = undefined; }
});
