/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, Modal, openModal, PermissionsBits, PermissionStore, UserStore, useState, useStateFromStores } from "@webpack/common";

const Details = ErrorBoundary.wrap(({ channelId, userId, modalProps }: { channelId: string; userId: string; modalProps: RenderModalProps; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [status, setStatus] = useState("");
    const channel = ChannelStore.getChannel(channelId);
    const available = account === userId && channel && (!channel.guild_id || PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel));
    const rows: [string, string][] = [];
    if (available) {
        const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined;
        const created = /^\d{17,20}$/.test(channel.id) ? new Date(Number((BigInt(channel.id) >> 22n) + 1420070400000n)).toLocaleString() : "Unknown";
        rows.push(["Name", channel.name || "Direct message"], ["Channel ID", channel.id], ["Created", created]);
        if (guild) rows.push(["Server", guild.name], ["Age restricted", channel.nsfw ? "Yes" : "No"]);
        if (channel.guild_id && channel.topic) rows.push(["Topic", channel.topic]);
    }
    async function copy() {
        if (UserStore.getCurrentUser()?.id !== userId || !available) return;
        try {
            await copyToClipboard(rows.map(([name, value]) => name + ": " + value).join("\n"));
            setStatus("Copied.");
        } catch {
            setStatus("Could not copy.");
        }
    }
    return <Modal {...modalProps} size="md" title="Channel details" actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {available ? <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map(([name, value]) => <div key={name} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0", overflowWrap: "anywhere" }}>
                <Text size="xs" color="text-muted">{name}</Text><Text size="sm" selectable>{value}</Text>
            </div>)}
            <Button size="small" variant="secondary" onClick={() => void copy()}>Copy details</Button>
            {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        </div> : <Text size="sm">Channel unavailable.</Text>}
    </Modal>;
});

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    const userId = UserStore.getCurrentUser()?.id;
    if (!channel || !userId || channel.guild_id && !PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return;
    children.push(<Menu.MenuItem id="db-channel-details" label="Channel details" action={() => openModal(props => <Details channelId={channel.id} userId={userId} modalProps={props} />)} />);
};

export default definePlugin({
    name: "ChannelDetails",
    description: "Right-click a channel to see its ID, creation date and topic.",
    authors: [Devs.Zot],
    tags: ["Utility", "Servers"],
    contextMenus: { "channel-context": channelMenu, "thread-context": channelMenu, "gdm-context": channelMenu }
});
