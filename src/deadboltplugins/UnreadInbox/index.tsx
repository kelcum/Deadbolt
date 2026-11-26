/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, MessageStore, Modal, NavigationRouter, openModal, PermissionsBits, PermissionStore, ReadStateStore, RelationshipStore, UserGuildSettingsStore, UserStore, useState, useStateFromStores } from "@webpack/common";

interface InboxEntry {
    id: string;
    guildId: string;
    label: string;
    group: string;
    mentions: number;
    unread: boolean;
    waiting: boolean;
    priority: boolean;
}

const settings = definePluginSettings({ priorities: { type: OptionType.CUSTOM, default: [] as { owner: string; channel: string; }[], hidden: true, description: "Priority channels" } });

function isPriority(user: string, id: string) { return settings.store.priorities.some(p => p.owner === user && p.channel === id); }
function togglePriority(user: string, id: string) {
    if (UserStore.getCurrentUser()?.id !== user) return;
    const old = settings.store.priorities;
    if (isPriority(user, id)) settings.store.priorities = old.filter(p => !(p.owner === user && p.channel === id));
    else if (old.length < 250) settings.store.priorities = [...old, { owner: user, channel: id }];
}
const priorityMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    const owner = UserStore.getCurrentUser()?.id;
    if (!owner || !channel || channel.isCategory() || channel.isDirectory()) return;
    children.push(<Menu.MenuItem id="db-inbox-priority" label={isPriority(owner, channel.id) ? "Remove inbox priority" : "Prioritize in inbox"} action={() => togglePriority(owner, channel.id)} />);
};
function getInbox(): InboxEntry[] {
    const owner = UserStore.getCurrentUser()?.id;
    if (!owner) return [];
    const ids = new Set<string>(ReadStateStore.getMentionChannelIds());
    for (const state of ReadStateStore.getAllReadStates(true).slice(0, 10000)) ids.add(state.channelId);
    for (const channel of ChannelStore.getSortedPrivateChannels().slice(0, 500)) if (channel.isDM()) ids.add(channel.id);
    for (const p of settings.store.priorities) if (p.owner === owner) ids.add(p.channel);
    const rows: InboxEntry[] = [];
    for (const id of ids) {
        const channel = ChannelStore.getChannel(id);
        if (!channel) continue;
        const unread = ReadStateStore.hasUnread(id) || ReadStateStore.getMentionCount(id) > 0;
        const priority = isPriority(owner, id);
        const last = channel.isDM() ? MessageStore.getLastMessage(id) : undefined;
        const waiting = !!last && (last.type === 0 || last.type === 19) && !(last as typeof last & { deleted?: boolean; }).deleted && last.author.id !== owner && !last.author.bot && !channel.isMessageRequest && !channel.isSpam && !RelationshipStore.isBlocked(last.author.id) && !UserGuildSettingsStore.isChannelMuted(null, id);
        if (!unread && !waiting && !priority) continue;
        if (channel.guild_id && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) continue;
        if (!channel.guild_id && !channel.isPrivate()) continue;
        const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
        const recipientId = channel.isDM() ? channel.getRecipientId() : undefined;
        const recipient = recipientId ? UserStore.getUser(recipientId) : null;
        rows.push({
            id, guildId: channel.guild_id || "@me",
            label: channel.name || recipient?.username || (channel.guild_id ? "Channel" : "Direct message"),
            group: guild?.name || (channel.guild_id ? "Server" : "Direct messages"),
            mentions: ReadStateStore.getMentionCount(id), unread, waiting, priority
        });
    }
    return rows.sort((a, b) => Number(b.priority) - Number(a.priority) || b.mentions - a.mentions || a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

function InboxIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 4h16l2 11v5H2v-5L4 4Z" strokeLinejoin="round" /><path d="M2 15h6l2 3h4l2-3h6" strokeLinejoin="round" />
    </svg>;
}

const InboxModal = ErrorBoundary.wrap(({ modalProps, userId }: { modalProps: RenderModalProps; userId: string; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [rows, setRows] = useState(() => account === userId ? getInbox() : []);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [limit, setLimit] = useState(50);
    const filtered = rows.filter(row => (filter === "all" ? row.unread : filter === "mentions" ? row.mentions > 0 : filter === "dms" ? row.unread && row.guildId === "@me" : filter === "priority" ? row.priority : row.waiting) && (row.group + " " + row.label).toLowerCase().includes(query.toLowerCase()));
    function refresh() {
        if (UserStore.getCurrentUser()?.id === userId) {
            setRows(getInbox());
            setLimit(50);
        }
    }
    function jump(row: InboxEntry) {
        if (UserStore.getCurrentUser()?.id !== userId) return;
        const channel = ChannelStore.getChannel(row.id);
        if (!channel || (channel.guild_id && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel))) {
            refresh();
            return;
        }
        modalProps.onClose();
        NavigationRouter.transitionTo("/channels/" + (channel.guild_id || "@me") + "/" + channel.id);
    }
    return <Modal {...modalProps} size="md" title="Smart inbox" subtitle="Unread channels, priority conversations and cached DMs awaiting a reply."
        actions={[{ text: "Refresh", variant: "secondary", onClick: refresh }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text-default)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Filter channels" placeholder="Search channels or servers" value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} style={{ flex: 1, padding: 10, borderRadius: 6, color: "var(--text-normal)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))" }} />
                <select aria-label="Unread category" value={filter} onChange={e => { setFilter(e.target.value); setLimit(50); }} style={{ color: "var(--text-normal)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))", borderRadius: 6 }}>
                    <option value="all">All unread</option><option value="mentions">Mentions</option><option value="dms">Unread DMs</option><option value="priority">Priority</option><option value="waiting">Reply needed (cached)</option>
                </select>
            </div>
            <Text size="xs" color="text-muted">{filtered.length} matching conversations in cache</Text>
            <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.slice(0, limit).map(row => <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, borderBottom: "1px solid var(--border-subtle, var(--background-modifier-accent))" }}><button type="button" onClick={() => jump(row)} style={{ flex: 1, textAlign: "left", minWidth: 0, color: "var(--text-normal)", cursor: "pointer" }}>
                    <Text size="sm" weight="semibold">{row.label}</Text>
                    <Text size="xs" color="text-muted">{row.group}{row.priority ? " · Priority" : ""}{row.waiting ? " · Reply needed" : ""}{row.mentions ? " · " + row.mentions + " mentions" : ""}</Text>
                </button><Button size="xs" variant="secondary" onClick={() => { togglePriority(userId, row.id); refresh(); }}>{row.priority ? "Unpin" : "Priority"}</Button></div>)}
                {!filtered.length && <Text size="sm" color="text-muted">No matching conversations.</Text>}
            </div>
            {limit < filtered.length && <Button size="small" variant="secondary" onClick={() => setLimit(n => n + 50)}>Show more</Button>}
        </div> : <p>Account changed. Reopen the inbox.</p>}
    </Modal>;
});

export default definePlugin({
    name: "UnreadInbox",
    description: "Smart inbox for unread channels, mentions, priority conversations and DMs whose last cached message is from someone else.",
    settings,
    contextMenus: { "channel-context": priorityMenu, "thread-context": priorityMenu, "gdm-context": priorityMenu },
    authors: [Devs.Zot],
    tags: ["Organisation", "Notifications"],
    headerBarButton: {
        icon: InboxIcon,
        render: () => <HeaderBarButton icon={InboxIcon} tooltip="Smart inbox" onClick={() => {
            const userId = UserStore.getCurrentUser()?.id;
            if (userId) openModal(props => <InboxModal modalProps={props} userId={userId} />);
        }} />
    }
});
