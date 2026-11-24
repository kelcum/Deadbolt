/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { GuildMemberStore, GuildRoleStore, GuildStore, Menu, Modal, openModal, SelectedGuildStore, showToast, UserStore, useState, useStateFromStores } from "@webpack/common";

const RolePanel = ErrorBoundary.wrap(({ guildId, userId, modalProps }: { guildId: string; userId: string; modalProps: RenderModalProps; }) => {
    const current = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const guild = GuildStore.getGuild(guildId);
    const [roleId, setRoleId] = useState("");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(30);
    const [revision, setRevision] = useState(0);
    // Read local stores only, on modal render. No guild member requests.
    const roles = current === userId && guild ? GuildRoleStore.getSortedRoles(guildId) : [];
    const selected = roles.find(role => role.id === roleId);
    const members = selected ? GuildMemberStore.getMembers(guildId).filter(member => selected.id === guildId || member.roles.includes(selected.id)) : [];
    const term = query.trim().toLowerCase();
    const roleRows = roles.filter(role => role.name.toLowerCase().includes(term) || role.id === term);
    const memberRows = members.map(member => {
        const user = UserStore.getUser(member.userId);
        return { id: member.userId, name: member.nick || user?.globalName || user?.username || "Unknown user" };
    }).filter(member => member.name.toLowerCase().includes(term) || member.id === term);
    function reset(id: string) {
        setRoleId(id);
        setQuery("");
        setLimit(30);
    }
    return <Modal {...modalProps} size="md" title="Role explorer" subtitle={guild && current === userId ? guild.name : "Server unavailable"}
        actions={[{ text: "Refresh", variant: "secondary", onClick: () => setRevision(n => n + 1) }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {current === userId && guild ? <div key={revision} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selected && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button size="xs" variant="secondary" onClick={() => reset("")}>Back</Button>
                <Text weight="semibold" size="sm">{selected.name}</Text>
            </div>}
            <input aria-label={selected ? "Search members" : "Search roles"} placeholder={selected ? "Search members" : "Search roles"} value={query}
                onChange={e => { setQuery(e.target.value); setLimit(30); }}
                style={{ padding: 10, borderRadius: 6, color: "var(--text-default)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))" }} />
            <Text size="xs" color="text-muted">{selected ? memberRows.length + " matching cached members. This is not a full server member list." : roleRows.length + " matching roles"}</Text>
            <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {selected ? memberRows.slice(0, limit).map(member => <div key={member.id} style={{ padding: 8, borderBottom: "1px solid var(--border-subtle, var(--background-modifier-accent))" }}>
                    <Text size="sm" weight="semibold">{member.name}</Text>
                    <Text size="xs" color="text-muted" selectable>{member.id}</Text>
                </div>) : roleRows.slice(0, limit).map(role => <Button key={role.id} variant="secondary" size="small" onClick={() => reset(role.id)} style={{ justifyContent: "flex-start", minHeight: 34 }}>
                    {role.name}
                </Button>)}
                {!(selected ? memberRows.length : roleRows.length) && <Text size="sm" color="text-muted">No results.</Text>}
            </div>
            {limit < (selected ? memberRows.length : roleRows.length) && <Button variant="secondary" size="small" onClick={() => setLimit(n => n + 30)}>Show more</Button>}
        </div> : <Text size="sm">Account or server changed. Reopen the role explorer.</Text>}
    </Modal>;
});

export function openRoleExplorer(guildId = SelectedGuildStore.getGuildId()) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!guildId || !userId || !GuildStore.getGuild(guildId)) {
        showToast({ text: "Open a server first.", variant: "critical" });
        return;
    }
    openModal(props => <RolePanel guildId={guildId} userId={userId} modalProps={props} />);
}

export const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (guild) children.push(<Menu.MenuItem id="db-role-explorer" label="Browse roles" action={() => openRoleExplorer(guild.id)} />);
};
