/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Channel, RenderModalProps, User } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, Modal, moment, NavigationRouter, openModal, RestAPI, SelectedChannelStore, useEffect, useState } from "@webpack/common";

const cl = classNameFactory("vc-searchuserhere-");
const logger = new Logger("SearchUserHere");
const PAGE_SIZE = 25;

interface Scope {
    id: string;
    label: string;
    guildId?: string;
    channelId?: string;
}

interface SearchMessage {
    id: string;
    channel_id: string;
    content: string;
    timestamp: string;
    author: { id: string; };
    attachments: { filename: string; }[];
    embeds: unknown[];
}

interface Results {
    messages: SearchMessage[];
    total: number;
    loading: boolean;
    done: boolean;
    error: string | null;
}

function nameOf(user: User) {
    return user.globalName || user.username;
}

function searchable(channel: Channel | undefined): channel is Channel {
    return !!channel && !channel.isCategory() && !channel.isDirectory() && !channel.isForumLikeChannel();
}

function scopesFor(user: User, channel: Channel | undefined, guildId: string | undefined): Scope[] {
    const here = searchable(channel) ? channel : undefined;
    if (here && !here.guild_id) return [{ id: "chat", label: "In this chat", channelId: here.id }];
    const scopes: Scope[] = [];
    if (here) scopes.push({ id: "channel", label: `In #${here.name}`, guildId: here.guild_id, channelId: here.id });
    const guild = GuildStore.getGuild(here?.guild_id ?? guildId ?? "");
    if (guild) scopes.push({ id: "server", label: `In ${guild.name}`, guildId: guild.id });
    if (scopes.length) return scopes;
    const dm = ChannelStore.getDMFromUserId(user.id);
    return dm ? [{ id: "dm", label: "In your DMs", channelId: dm }] : [];
}

async function search(user: User, scope: Scope, before: string | undefined) {
    const res = await RestAPI.get({
        url: scope.guildId ? `/guilds/${scope.guildId}/messages/search` : `/channels/${scope.channelId}/messages/search`,
        query: {
            author_id: user.id,
            ...(scope.guildId && scope.channelId && { channel_id: scope.channelId }),
            include_nsfw: true,
            sort_by: "timestamp",
            sort_order: "desc",
            ...(before && { max_id: before })
        }
    });

    if (res.status === 202) return null;

    return {
        messages: (res.body.messages as SearchMessage[][]).flat().filter(m => m.author.id === user.id),
        total: res.body.total_results as number
    };
}

function preview(m: SearchMessage) {
    if (m.content) return m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content;
    if (m.attachments.length) return m.attachments.map(a => a.filename).join(", ");
    return m.embeds.length ? "Embed" : "Empty message";
}

function SearchModal({ modalProps, user, scope }: { modalProps: RenderModalProps; user: User; scope: Scope; }) {
    const [state, setState] = useState<Results>({ messages: [], total: 0, loading: false, done: false, error: null });

    async function load() {
        if (state.loading || state.done) return;
        setState(s => ({ ...s, loading: true, error: null }));
        try {
            const result = await search(user, scope, state.messages.at(-1)?.id);
            if (!result) return setState(s => ({ ...s, loading: false, error: "Discord is still indexing this chat. Try again in a few seconds." }));
            setState(s => {
                const seen = new Set(s.messages.map(m => m.id));
                const fresh = result.messages.filter(m => !seen.has(m.id));
                return { messages: [...s.messages, ...fresh], total: result.total, loading: false, done: result.messages.length < PAGE_SIZE || !fresh.length, error: null };
            });
        } catch (e) {
            logger.error("Search failed", e);
            setState(s => ({ ...s, loading: false, error: "Couldn't search right now. Try again in a moment." }));
        }
    }

    useEffect(() => {
        load();
    }, []);

    const jump = (m: SearchMessage) => {
        modalProps.onClose();
        NavigationRouter.transitionTo(`/channels/${scope.guildId ?? "@me"}/${m.channel_id}/${m.id}`);
    };

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={`Messages from ${nameOf(user)}`}
            subtitle={state.total ? `${scope.label} · ${state.total.toLocaleString()} found` : scope.label}
        >
            <div className={cl("list")}>
                {state.messages.map(m => (
                    <div key={m.id} className={cl("row")}>
                        <div className={cl("body")}>
                            <Paragraph size="xs" className={cl("meta")}>
                                {scope.channelId ? "" : `#${ChannelStore.getChannel(m.channel_id)?.name ?? "unknown"} · `}{moment(m.timestamp).format("lll")}
                            </Paragraph>
                            <Paragraph size="sm" className={cl("text")}>{preview(m)}</Paragraph>
                        </div>
                        <Button size="min" variant="secondary" onClick={() => jump(m)}>Jump</Button>
                    </div>
                ))}
                {state.done && !state.messages.length && <Paragraph className={cl("empty")}>{nameOf(user)} hasn't sent anything here that search can find.</Paragraph>}
                {state.error && <Paragraph className={cl("empty")}>{state.error}</Paragraph>}
                {!state.done && (
                    <div className={cl("more")}>
                        <Button variant="secondary" disabled={state.loading} onClick={load}>
                            {state.loading ? "Searching..." : state.error ? "Try again" : "Load more"}
                        </Button>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function open(user: User, scope: Scope) {
    openModal(props => <SearchModal modalProps={props} user={user} scope={scope} />);
}

const userContext: NavContextMenuPatchCallback = (children, { user, channel, guildId }: { user?: User; channel?: Channel; guildId?: string; }) => {
    if (!user) return;
    const scopes = scopesFor(user, channel ?? ChannelStore.getChannel(SelectedChannelStore.getChannelId()), guildId);
    if (!scopes.length) return;
    children.push(scopes.length === 1
        ? <Menu.MenuItem id="vc-search-user-here" label="Search Their Messages" action={() => open(user, scopes[0])} />
        : (
            <Menu.MenuItem id="vc-search-user-here" label="Search Their Messages">
                {scopes.map(s => <Menu.MenuItem key={s.id} id={`vc-search-user-here-${s.id}`} label={s.label} action={() => open(user, s)} />)}
            </Menu.MenuItem>
        ));
};

export default definePlugin({
    name: "SearchUserHere",
    description: "Right click someone to list the messages they sent in this channel, server or DM, and jump to any of them.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],

    contextMenus: {
        "user-context": userContext
    }
});
