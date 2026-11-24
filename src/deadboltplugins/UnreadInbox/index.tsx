/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Modal, NavigationRouter, openModal, PermissionsBits, PermissionStore, ReadStateStore, UserStore, useState, useStateFromStores } from "@webpack/common";

interface InboxEntry {
    id: string;
    guildId: string;
    label: string;
    group: string;
    mentions: number;
}

function getInbox(): InboxEntry[] {
    const ids = new Set<string>(ReadStateStore.getMentionChannelIds());
    for (const state of ReadStateStore.getAllReadStates(true).slice(0, 10000)) ids.add(state.channelId);
    const rows: InboxEntry[] = [];
    for (const id of ids) {
        const channel = ChannelStore.getChannel(id);
        if (!channel || (!ReadStateStore.hasUnread(id) && !ReadStateStore.getMentionCount(id))) continue;
        if (channel.guild_id && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) continue;
        if (!channel.guild_id && !channel.isPrivate()) continue;
        const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
        const recipientId = channel.isDM() ? channel.getRecipientId() : undefined;
        const recipient = recipientId ? UserStore.getUser(recipientId) : null;
        rows.push({
            id, guildId: channel.guild_id || "@me",
            label: channel.name || recipient?.username || (channel.guild_id ? "Channel" : "Direct message"),
            group: guild?.name || (channel.guild_id ? "Server" : "Direct messages"),
            mentions: ReadStateStore.getMentionCount(id)
        });
    }
    return rows.sort((a, b) => b.mentions - a.mentions || a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
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
    const filtered = rows.filter(row => (filter === "all" || (filter === "mentions" ? row.mentions > 0 : row.guildId === "@me")) && (row.group + " " + row.label).toLowerCase().includes(query.toLowerCase()));
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
    return <Modal {...modalProps} size="md" title="Unread inbox" subtitle="Unread channels and mentions. Select a channel to open it."
        actions={[{ text: "Refresh", variant: "secondary", onClick: refresh }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text-default)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Filter channels" placeholder="Search channels or servers" value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} style={{ flex: 1, padding: 10, borderRadius: 6, color: "var(--text-normal)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))" }} />
                <select aria-label="Unread category" value={filter} onChange={e => { setFilter(e.target.value); setLimit(50); }} style={{ color: "var(--text-normal)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))", borderRadius: 6 }}>
                    <option value="all">All unread</option><option value="mentions">Mentions</option><option value="dms">DMs</option>
                </select>
            </div>
            <Text size="xs" color="text-muted">{filtered.length} unread channels in cache</Text>
            <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.slice(0, limit).map(row => <button type="button" key={row.id} onClick={() => jump(row)} style={{ padding: 10, textAlign: "left", borderRadius: 8, color: "var(--text-normal)", borderBottom: "1px solid var(--border-subtle, var(--background-modifier-accent))", cursor: "pointer" }}>
                    <Text size="sm" weight="semibold">{row.label}</Text>
                    <Text size="xs" color="text-muted">{row.group}{row.mentions ? " · " + row.mentions + " mentions" : ""}</Text>
                </button>)}
                {!filtered.length && <Text size="sm" color="text-muted">No matching unread channels.</Text>}
            </div>
            {limit < filtered.length && <Button size="small" variant="secondary" onClick={() => setLimit(n => n + 50)}>Show more</Button>}
        </div> : <p>Account changed. Reopen the inbox.</p>}
    </Modal>;
});

export default definePlugin({
    name: "UnreadInbox",
    description: "Adds a searchable toolbar inbox for cached unread channels, direct messages and mentions.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Notifications"],
    headerBarButton: {
        icon: InboxIcon,
        render: () => <HeaderBarButton icon={InboxIcon} tooltip="Unread inbox" onClick={() => {
            const userId = UserStore.getCurrentUser()?.id;
            if (userId) openModal(props => <InboxModal modalProps={props} userId={userId} />);
        }} />
    }
});
