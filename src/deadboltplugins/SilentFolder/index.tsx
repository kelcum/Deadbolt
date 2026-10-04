/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, Menu, ReadStateStore, RestAPI, useEffect, useState } from "@webpack/common";

const GuildFolderStore = findByPropsLazy("getGuildFolders");
const NotificationUtils = findByPropsLazy("updateGuildNotificationSettings");
const DAY = 24 * 60 * 60 * 1000;

interface GuildFolder {
    guildIds: string[];
    folderId?: string | number;
    folderName?: string;
    folderColor?: number;
}

const listeners = new Set<() => void>();
let managedGuilds = new Set<string>();
let readTimer: ReturnType<typeof setInterval> | undefined;

function getFolders(): GuildFolder[] {
    return (GuildFolderStore.getGuildFolders?.() ?? []).filter((folder: GuildFolder) => folder.folderId != null && folder.guildIds?.length);
}

function folderId(folder: GuildFolder) {
    return String(folder.folderId);
}

function parseIds(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value !== "string" || !value || value === "none") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [value];
    }
}

function getSelectedIds(): string[] {
    const current = parseIds(settings.store.folders);
    if (current.length) return current;
    const legacy = parseIds((settings.store as any).folder);
    return legacy;
}

function saveSelectedIds(ids: string[]) {
    settings.store.folders = JSON.stringify([...new Set(ids.map(String))]);
}

function emitChange() {
    for (const listener of listeners) listener();
}

function setGuildMuted(guildId: string, muted: boolean) {
    NotificationUtils.updateGuildNotificationSettings(guildId, {
        muted,
        mute_config: muted ? { selected_time_window: -1, end_time: null } : null,
        suppress_everyone: muted,
        suppress_roles: muted,
    });
}

function getFolderById(id: string | number) {
    return getFolders().find(folder => folderId(folder) === String(id));
}

function isSelected(id: string | number) {
    return getSelectedIds().includes(String(id));
}

function setFolderSelected(id: string | number, selected: boolean) {
    const idString = String(id);
    if (!getFolderById(idString)) return;
    const ids = new Set(getSelectedIds());
    if (selected) ids.add(idString);
    else ids.delete(idString);
    saveSelectedIds([...ids]);
    syncSelectedFolders();
    if (selected) markFoldersRead([idString]);
}

function setAllFolders(selected: boolean) {
    const folders = getFolders();
    saveSelectedIds(selected ? folders.map(folderId) : []);
    syncSelectedFolders();
    if (selected) markFoldersRead(folders.map(folderId));
}

function getSelectedGuildIds() {
    const selected = new Set(getSelectedIds());
    const guilds = new Set<string>();
    for (const folder of getFolders()) {
        if (!selected.has(folderId(folder))) continue;
        for (const guildId of folder.guildIds) guilds.add(guildId);
    }
    return guilds;
}

function markMessageRead(channelId: string, messageId: string) {
    try {
        FluxDispatcher.dispatch({
            type: "MESSAGE_ACK",
            channelId,
            messageId,
            version: Date.now(),
            isExplicit: false,
        });
    } catch {
        return;
    }
}

function markFoldersRead(ids = getSelectedIds()) {
    const selected = new Set(ids.map(String));
    const guildIds = new Set<string>();
    for (const folder of getFolders()) {
        if (!selected.has(folderId(folder))) continue;
        for (const guildId of folder.guildIds) guildIds.add(guildId);
    }

    const channels = new Map<string, { channelId: string; messageId: string; readStateType: number; }>();
    for (const guildId of guildIds) {
        const guildChannels = Object.values(ChannelStore.getMutableGuildChannelsForGuild?.(guildId) ?? {});
        const threads = ChannelStore.getAllThreadsForGuild?.(guildId) ?? [];
        for (const channel of [...guildChannels, ...threads] as any[]) {
            if (!channel?.id) continue;
            const hasUnread = ReadStateStore.hasUnread(channel.id);
            const mentions = ReadStateStore.getMentionCount(channel.id);
            if (!hasUnread && mentions <= 0) continue;
            const messageId = ReadStateStore.lastMessageId(channel.id);
            if (messageId) channels.set(channel.id, { channelId: channel.id, messageId, readStateType: 0 });
        }
    }

    if (channels.size) {
        try {
            FluxDispatcher.dispatch({
                type: "BULK_ACK",
                context: "APP",
                channels: [...channels.values()],
            });
        } catch {
            for (const { channelId, messageId } of channels.values()) markMessageRead(channelId, messageId);
        }
    }

    for (const guildId of guildIds) {
        void RestAPI.post({ url: `/guilds/${guildId}/ack`, body: {} }).catch(() => undefined);
    }
}

function syncSelectedFolders() {
    const folders = getFolders();
    const selected = new Set(getSelectedIds());
    const existing = new Set(folders.map(folderId));
    const cleaned = [...selected].filter(id => existing.has(id));
    if (cleaned.length !== selected.size) saveSelectedIds(cleaned);

    const nextGuilds = new Set<string>();
    for (const folder of folders) {
        if (!cleaned.includes(folderId(folder))) continue;
        for (const guildId of folder.guildIds) nextGuilds.add(guildId);
    }

    for (const guildId of managedGuilds) if (!nextGuilds.has(guildId)) setGuildMuted(guildId, false);
    for (const guildId of nextGuilds) setGuildMuted(guildId, true);
    managedGuilds = nextGuilds;
    emitChange();
}

const css = `
.sf-wrap{display:flex;flex-direction:column;gap:10px}.sf-header{padding:2px 0 8px}.sf-title{font-size:15px;font-weight:700;color:var(--header-primary)}.sf-sub{margin-top:3px;font-size:12px;line-height:16px;color:var(--text-muted)}.sf-actions{display:flex;gap:6px;flex-wrap:wrap}.sf-btn{border:1px solid var(--background-modifier-accent);border-radius:6px;padding:6px 9px;background:transparent;color:var(--text-normal);font-size:12px;font-weight:600;cursor:pointer}.sf-btn:hover{background:var(--background-modifier-hover)}.sf-list{display:flex;flex-direction:column;border-top:1px solid var(--background-modifier-accent)}.sf-row{width:100%;display:flex;align-items:center;gap:10px;border:0;border-bottom:1px solid var(--background-modifier-accent);padding:10px 2px;background:transparent;color:var(--text-normal);cursor:pointer;text-align:left}.sf-row:hover{background:var(--background-modifier-hover)}.sf-info{min-width:0;flex:1}.sf-name{font-size:13px;font-weight:600;color:var(--header-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sf-meta{margin-top:2px;font-size:11px;color:var(--text-muted)}.sf-check{width:20px;height:20px;border:2px solid var(--interactive-normal);border-radius:5px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;transition:background-color .12s ease,border-color .12s ease}.sf-check.on{background:var(--brand-500);border-color:var(--brand-500)}.sf-check svg{width:14px;height:14px;display:block;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}.sf-empty{padding:16px 2px;color:var(--text-muted);font-size:12px}
`;

function FolderManager() {
    const [folders, setFolders] = useState(getFolders());
    const [selected, setSelected] = useState(() => new Set(getSelectedIds()));

    useEffect(() => {
        const refresh = () => {
            setFolders(getFolders());
            setSelected(new Set(getSelectedIds()));
        };
        listeners.add(refresh);
        refresh();
        return () => void listeners.delete(refresh);
    }, []);

    const toggle = (id: string) => setFolderSelected(id, !selected.has(id));

    return (
        <div className="sf-wrap">
            <style>{css}</style>
            <div className="sf-header">
                <div className="sf-title">Silent folders</div>
                <div className="sf-sub">Check a folder to mute it and keep its notification badges cleared.</div>
            </div>
            <div className="sf-actions">
                <button className="sf-btn" onClick={() => setAllFolders(true)}>Select all</button>
                <button className="sf-btn" onClick={() => setAllFolders(false)}>Clear all</button>
                <button className="sf-btn" onClick={() => markFoldersRead()}>Mark read</button>
            </div>
            <div className="sf-list">
                {folders.length ? folders.map(folder => {
                    const id = folderId(folder);
                    const active = selected.has(id);
                    return (
                        <button key={id} className="sf-row" aria-pressed={active} onClick={() => toggle(id)}>
                            <span className="sf-info">
                                <div className="sf-name">{folder.folderName || `Folder ${id}`}</div>
                                <div className="sf-meta">{folder.guildIds.length} server{folder.guildIds.length === 1 ? "" : "s"}</div>
                            </span>
                            <span className={`sf-check${active ? " on" : ""}`} aria-hidden="true">
                                {active && <svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></svg>}
                            </span>
                        </button>
                    );
                }) : <div className="sf-empty">No server folders found.</div>}
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    folders: {
        type: OptionType.COMPONENT,
        component: FolderManager,
        default: "[]",
    },
});

function patchFolderContext(children: any[], props: { folderId?: string | number; }) {
    if (props?.folderId == null) return;
    const id = String(props.folderId);
    const active = isSelected(id);
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="silent-folder-toggle"
                label={active ? "Unmute Folder" : "Mute Folder"}
                action={() => setFolderSelected(id, !active)}
            />
        </Menu.MenuGroup>
    );
}

export default definePlugin({
    name: "SilentFolder",
    description: "Mute multiple Discord folders and automatically clear their unread notification badges.",
    authors: [{ name: "Zot", id: 1531412914005606513n }],
    settings,
    contextMenus: {
        "guild-context": patchFolderContext,
    },
    start() {
        const legacy = getSelectedIds();
        saveSelectedIds(legacy);
        syncSelectedFolders();
        markFoldersRead();
        readTimer = setInterval(markFoldersRead, DAY);
    },
    stop() {
        if (readTimer) clearInterval(readTimer);
        readTimer = undefined;
    },
    flux: {
        MESSAGE_CREATE({ message }: any) {
            if (!message?.guild_id || !message?.channel_id || !message?.id) return;
            if (!getSelectedGuildIds().has(message.guild_id)) return;
            setTimeout(() => markMessageRead(message.channel_id, message.id), 0);
        },
        GUILD_FOLDER_UPDATE() {
            syncSelectedFolders();
        },
        GUILD_CREATE() {
            syncSelectedFolders();
        },
        GUILD_DELETE() {
            syncSelectedFolders();
        },
    },
});
