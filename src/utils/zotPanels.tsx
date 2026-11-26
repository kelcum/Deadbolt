/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton } from "@api/ChatButtons";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import type { Channel, Message, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Menu, Modal, openModal, PermissionsBits, PermissionStore, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

export const row = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } as const;
export const column = { display: "flex", flexDirection: "column", gap: 10 } as const;
export const field = { color: "var(--text-default)", background: "var(--input-background, var(--background-base-lower))", border: "1px solid var(--border-subtle, var(--background-modifier-accent))", padding: 8, borderRadius: 6, minWidth: 0 } as const;
export const list = { ...column, maxHeight: 360, overflowY: "auto" } as const;
export const owner = () => UserStore.getCurrentUser()?.id;
export const owns = (id: string) => owner() === id;
export function accessible(channel: Channel | undefined) {
    return !!channel && (channel.guild_id ? PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel) : channel.isPrivate());
}
export function currentChannel() { return ChannelStore.getChannel(SelectedChannelStore.getChannelId()); }
export function canAttach(channel: Channel | undefined) {
    return !!channel && accessible(channel) && (!channel.guild_id || PermissionStore.can(PermissionsBits.ATTACH_FILES, channel));
}
export function showPanel(title: string, Body: ComponentType<{ userId: string; close(): void; }>, size = "md") {
    const userId = owner();
    if (!userId) return;
    const Panel = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
        const account = useStateFromStores([UserStore], owner);
        return <Modal {...modalProps} title={title} size={size}>{account === userId ? <Body userId={userId} close={modalProps.onClose} /> : <Text size="sm">Account changed. Reopen this panel.</Text>}</Modal>;
    });
    openModal(props => <Panel modalProps={props} />);
}
export function Icon({ width = 24, height = 24 }: { width?: number | string; height?: number | string; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5" strokeLinecap="round"/></svg>;
}
export function chatButton(title: string, open: () => void) {
    return { icon: Icon, render: ({ isMainChat }: { isMainChat: boolean; }) => isMainChat ? <ChatBarButton tooltip={title} onClick={open}><Icon /></ChatBarButton> : null };
}
export function launchButton(title: string, open: () => void) { return () => <Button size="small" onClick={open}>{title}</Button>; }
export function messageAction(id: string, label: string, action: (message: Message) => void, predicate: (message: Message) => boolean = () => true): NavContextMenuPatchCallback {
    return (children, { message }: { message?: Message; }) => {
        if (!message || !predicate(message) || !accessible(ChannelStore.getChannel(message.channel_id))) return;
        children.push(<Menu.MenuItem id={`db-${id}`} label={label} action={() => action(message)} />);
    };
}
export function Status({ children }: { children: ReactNode; }) { return <Text size="xs" color="text-muted" role="status">{children}</Text>; }
