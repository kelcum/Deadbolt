/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { AttachmentIcon, ImageIcon, LinkIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, RenderModalProps, User } from "@vencord/discord-types";
import { ChannelStore, Clickable, Humanize, MaskedLink, Menu, Modal, moment, NavigationRouter, openMediaModal, openModal, RestAPI, SelectedChannelStore, TabBar, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

const cl = classNameFactory("vc-sharedmedia-");
const logger = new Logger("SharedMedia");

const settings = definePluginSettings({
    toolbarButton: {
        type: OptionType.BOOLEAN,
        description: "Show a Shared Media button next to pins and the member list.",
        default: true
    },
    oldestFirst: {
        type: OptionType.BOOLEAN,
        description: "List the oldest items first instead of the newest.",
        default: false
    }
});

const TABS = {
    media: { label: "Media", has: ["image", "video"], empty: "No images or videos here yet." },
    files: { label: "Files", has: ["file"], empty: "No files here yet." },
    links: { label: "Links", has: ["link"], empty: "No links here yet." }
} as const;

type Tab = keyof typeof TABS;

interface SearchFile {
    url: string;
    proxy_url?: string;
    width?: number;
    height?: number;
}

interface SearchAttachment extends SearchFile {
    id: string;
    filename: string;
    size: number;
    content_type?: string;
}

interface SearchEmbed {
    type: string;
    url?: string;
    image?: SearchFile;
    thumbnail?: SearchFile;
    video?: SearchFile;
}

interface SearchMessage {
    id: string;
    content: string;
    timestamp: string;
    author: { id: string; username: string; global_name?: string | null; };
    attachments: SearchAttachment[];
    embeds: SearchEmbed[];
}

interface Item {
    key: string;
    message: SearchMessage;
}

interface MediaItem extends Item {
    type: "IMAGE" | "VIDEO";
    url: string;
    original: string;
    width: number;
    height: number;
    spoiler: boolean;
    animated: boolean;
}

interface FileItem extends Item {
    name: string;
    size: number;
    url: string;
}

interface LinkItem extends Item {
    url: string;
}

interface TabState {
    messages: SearchMessage[];
    total: number;
    loading: boolean;
    done: boolean;
    error: string | null;
}

const EMPTY_STATE: TabState = { messages: [], total: 0, loading: false, done: false, error: null };
const PAGE_SIZE = 25;
const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,:;!?]/g;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

function kindOf(a: SearchAttachment) {
    const type = a.content_type ?? "";
    if (type.startsWith("image/") || IMAGE_EXT.test(a.filename)) return "IMAGE";
    if (type.startsWith("video/") || VIDEO_EXT.test(a.filename)) return "VIDEO";
    return null;
}

function mediaOf(m: SearchMessage): MediaItem[] {
    const items: MediaItem[] = [];
    const push = (key: string, type: MediaItem["type"], file: SearchFile, spoiler: boolean, animated: boolean) => items.push({
        key: `${m.id}-${key}`,
        message: m,
        type,
        url: file.proxy_url ?? file.url,
        original: file.url,
        width: file.width ?? 1024,
        height: file.height ?? 1024,
        spoiler,
        animated
    });

    for (const a of m.attachments) {
        const kind = kindOf(a);
        if (kind) push(a.id, kind, a, a.filename.startsWith("SPOILER_"), /\.gif$/i.test(a.filename));
    }
    m.embeds.forEach((e, i) => {
        if (e.type === "gifv" && e.video) push(`e${i}`, "VIDEO", e.video, false, true);
        else if (e.type === "image" && e.thumbnail) push(`e${i}`, "IMAGE", e.thumbnail, false, false);
        else if (e.image) push(`e${i}`, "IMAGE", e.image, false, false);
    });
    return items;
}

function filesOf(m: SearchMessage): FileItem[] {
    return m.attachments
        .filter(a => !kindOf(a))
        .map(a => ({ key: `${m.id}-${a.id}`, message: m, name: a.filename, size: a.size, url: a.url }));
}

function linksOf(m: SearchMessage): LinkItem[] {
    return [...new Set(m.content.match(URL_RE) ?? [])].map(url => ({ key: `${m.id}-${url}`, message: m, url }));
}

function thumbOf(item: MediaItem) {
    if (item.url === item.original) return item.url;
    const url = new URL(item.url);
    url.searchParams.set("width", "320");
    url.searchParams.set("height", String(Math.round(320 * item.height / item.width)));
    url.searchParams.set("format", "webp");
    return url.toString();
}

function authorOf(m: SearchMessage) {
    return m.author.global_name || m.author.username;
}

function jumpTo(channel: Channel, m: SearchMessage, onClose: () => void) {
    onClose();
    NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${m.id}`);
}

async function search(channel: Channel, tab: Tab, before: string | undefined) {
    const res = await RestAPI.get({
        url: channel.guild_id ? `/guilds/${channel.guild_id}/messages/search` : `/channels/${channel.id}/messages/search`,
        query: {
            ...(channel.guild_id && { channel_id: channel.id }),
            has: TABS[tab].has,
            include_nsfw: true,
            sort_by: "timestamp",
            sort_order: settings.store.oldestFirst ? "asc" : "desc",
            ...(before && (settings.store.oldestFirst ? { min_id: before } : { max_id: before }))
        }
    });

    if (res.status === 202) return null;

    return { messages: (res.body.messages as SearchMessage[][]).flat(), total: res.body.total_results as number };
}

function MediaGrid({ items, channel, onClose }: { items: MediaItem[]; channel: Channel; onClose(): void; }) {
    const view = (index: number) => openMediaModal({
        items: items.map(({ type, url, original, width, height, animated }) => ({ type, url, original, width, height, animated })),
        startingIndex: index
    });

    return (
        <div className={cl("grid")}>
            {items.map((item, i) => (
                <div key={item.key} className={cl("tile")}>
                    <Clickable className={cl("thumb", { spoiler: item.spoiler })} onClick={() => view(i)} aria-label={`Open ${item.type === "VIDEO" ? "video" : "image"} from ${authorOf(item.message)}`}>
                        {item.type === "VIDEO"
                            ? <video src={item.url} preload="metadata" muted playsInline />
                            : <img src={thumbOf(item)} loading="lazy" alt="" />}
                        {item.type === "VIDEO" && <span className={cl("play")} />}
                    </Clickable>
                    <div className={cl("tile-footer")}>
                        <Paragraph size="xs" className={cl("tile-meta")}>{authorOf(item.message)} · {moment(item.message.timestamp).format("ll")}</Paragraph>
                        <Button size="min" variant="secondary" onClick={() => jumpTo(channel, item.message, onClose)}>Jump</Button>
                    </div>
                </div>
            ))}
        </div>
    );
}

function Row({ icon, title, meta, channel, message, onClose }: { icon: ReactNode; title: ReactNode; meta: string; channel: Channel; message: SearchMessage; onClose(): void; }) {
    return (
        <div className={cl("row")}>
            <span className={cl("row-icon")}>{icon}</span>
            <div className={cl("row-body")}>
                <div className={cl("row-title")}>{title}</div>
                <Paragraph size="xs" className={cl("row-meta")}>{meta}</Paragraph>
            </div>
            <Button size="min" variant="secondary" onClick={() => jumpTo(channel, message, onClose)}>Jump</Button>
        </div>
    );
}

function SharedMediaModal({ modalProps, channel }: { modalProps: RenderModalProps; channel: Channel; }) {
    const [tab, setTab] = useState<Tab>("media");
    const [states, setStates] = useState<Record<Tab, TabState>>({ media: EMPTY_STATE, files: EMPTY_STATE, links: EMPTY_STATE });
    const state = states[tab];

    const patch = (t: Tab, next: Partial<TabState>) => setStates(prev => ({ ...prev, [t]: { ...prev[t], ...next } }));

    async function load(t: Tab) {
        const current = states[t];
        if (current.loading || current.done) return;
        patch(t, { loading: true, error: null });
        try {
            const result = await search(channel, t, current.messages.at(-1)?.id);
            if (!result) return patch(t, { loading: false, error: "Discord is still indexing this chat. Try again in a few seconds." });
            setStates(prev => {
                const seen = new Set(prev[t].messages.map(m => m.id));
                const fresh = result.messages.filter(m => !seen.has(m.id));
                return { ...prev, [t]: { messages: [...prev[t].messages, ...fresh], total: result.total, loading: false, done: result.messages.length < PAGE_SIZE || !fresh.length, error: null } };
            });
        } catch (e) {
            logger.error("Search failed", e);
            patch(t, { loading: false, error: "Couldn't load this list. Try again in a moment." });
        }
    }

    useEffect(() => {
        if (!state.messages.length && !state.done && !state.error) load(tab);
    }, [tab]);

    const name = channel.isPrivate()
        ? channel.name || channel.recipients.map(id => UserStore.getUser(id)?.globalName ?? UserStore.getUser(id)?.username).join(", ")
        : `#${channel.name}`;

    let body: ReactNode;
    if (tab === "media") {
        const items = state.messages.flatMap(mediaOf);
        body = items.length ? <MediaGrid items={items} channel={channel} onClose={modalProps.onClose} /> : null;
    } else if (tab === "files") {
        const items = state.messages.flatMap(filesOf);
        body = items.length ? items.map(f => (
            <Row
                key={f.key}
                icon={<AttachmentIcon width={20} height={20} />}
                title={<MaskedLink href={f.url}>{f.name}</MaskedLink>}
                meta={`${Humanize.filesize(f.size)} · ${authorOf(f.message)} · ${moment(f.message.timestamp).format("ll")}`}
                channel={channel}
                message={f.message}
                onClose={modalProps.onClose}
            />
        )) : null;
    } else {
        const items = state.messages.flatMap(linksOf);
        body = items.length ? items.map(l => (
            <Row
                key={l.key}
                icon={<LinkIcon width={20} height={20} />}
                title={<MaskedLink href={l.url}>{l.url}</MaskedLink>}
                meta={`${authorOf(l.message)} · ${moment(l.message.timestamp).format("ll")}`}
                channel={channel}
                message={l.message}
                onClose={modalProps.onClose}
            />
        )) : null;
    }

    return (
        <Modal
            {...modalProps}
            size="xl"
            title={`Shared in ${name}`}
            subtitle={state.total ? `${state.total.toLocaleString()} messages with ${TABS[tab].label.toLowerCase()}` : undefined}
        >
            <TabBar type="top" look="brand" className={cl("tabs")} selectedItem={tab} onItemSelect={(t: Tab) => setTab(t)}>
                {Object.entries(TABS).map(([id, t]) => <TabBar.Item key={id} id={id} className={cl("tab")}>{t.label}</TabBar.Item>)}
            </TabBar>
            <div className={cl("content")}>
                {body}
                {!body && state.done && <Paragraph className={cl("empty")}>{TABS[tab].empty}</Paragraph>}
                {state.error && <Paragraph className={cl("empty")}>{state.error}</Paragraph>}
                {!state.done && (
                    <div className={cl("more")}>
                        <Button variant="secondary" disabled={state.loading} onClick={() => load(tab)}>
                            {state.loading ? "Loading..." : state.error ? "Try again" : "Load more"}
                        </Button>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function canSearch(channel: Channel | undefined): channel is Channel {
    return !!channel && !channel.isCategory() && !channel.isDirectory() && !channel.isForumLikeChannel();
}

function openSharedMedia(channel: Channel) {
    openModal(props => <SharedMediaModal modalProps={props} channel={channel} />);
}

const ToolbarButton = ErrorBoundary.wrap(() => {
    const { toolbarButton } = settings.use(["toolbarButton"]);
    const channel = useStateFromStores([SelectedChannelStore, ChannelStore], () => ChannelStore.getChannel(SelectedChannelStore.getChannelId()));
    if (!toolbarButton || !canSearch(channel)) return null;
    return <ChannelToolbarButton icon={ImageIcon} tooltip="Shared Media" onClick={() => openSharedMedia(channel)} />;
}, { noop: true });

function menuItem(channel: Channel) {
    return <Menu.MenuItem id="vc-shared-media" label="Shared Media" icon={ImageIcon} action={() => openSharedMedia(channel)} />;
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (canSearch(channel)) children.push(menuItem(channel));
};

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    const channel = user && ChannelStore.getChannel(ChannelStore.getDMFromUserId(user.id) ?? "");
    if (canSearch(channel)) children.push(menuItem(channel));
};

export default definePlugin({
    name: "SharedMedia",
    description: "Browse every image, video, file and link shared in a channel or DM, and flip through them with the arrow keys.",
    tags: ["Media", "Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    headerBarButton: {
        icon: ImageIcon,
        location: "channeltoolbar",
        priority: 20,
        render: () => <ToolbarButton />
    },

    contextMenus: {
        "channel-context": channelContext,
        "thread-context": channelContext,
        "gdm-context": channelContext,
        "user-context": userContext
    }
});
