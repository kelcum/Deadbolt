/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs, IS_MAC } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getGuildAcronym } from "@utils/discord";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ChannelRouter, ChannelStore, closeModal, GuildStore, IconUtils, openModal, RelationshipStore, SelectedChannelStore, showToast, UserStore, zustandCreate } from "@webpack/common";

const cl = classNameFactory("vc-recentchannels-");
const STORE_KEY = "RecentChannels_history";
const VISIBLE_ROWS = 9;

interface Cycle {
    ids: string[];
    index: number;
}

interface CycleStore {
    <T>(selector: (state: Cycle) => T): T;
    getState(): Cycle;
    setState(state: Cycle): void;
}

const useCycle: CycleStore = proxyLazy(() => zustandCreate(() => ({ ids: [], index: -1 })));

let history: string[] = [];
let modalKey: string | null = null;

const settings = definePluginSettings({
    historySize: {
        type: OptionType.SLIDER,
        description: "How many recent channels to remember.",
        markers: makeRange(10, 50, 10),
        stickToMarkers: true,
        default: 20
    },
    clear: {
        type: OptionType.COMPONENT,
        component: () => (
            <Button
                variant="dangerPrimary"
                onClick={() => {
                    history = [];
                    void DataStore.set(STORE_KEY, history);
                    showToast({ text: "Recent channels cleared.", variant: "success" });
                }}
            >
                Clear recent channels
            </Button>
        )
    }
});

function remember(channelId: string | null) {
    if (!channelId || !ChannelStore.getChannel(channelId)) return;
    history = [channelId, ...history.filter(id => id !== channelId)].slice(0, settings.store.historySize);
    void DataStore.set(STORE_KEY, history);
}

function describe(channel: Channel) {
    if (channel.isDM()) {
        const user = UserStore.getUser(channel.recipients[0]);
        if (!user) return { name: "Direct Message", place: "", icon: undefined, acronym: "@" };
        return {
            name: RelationshipStore.getNickname(user.id) ?? user.globalName ?? user.username,
            place: "Direct Message",
            icon: IconUtils.getUserAvatarURL(user, false, 64),
            acronym: user.username.slice(0, 2)
        };
    }
    if (channel.isGroupDM()) {
        const name = channel.name || channel.recipients.map(id => UserStore.getUser(id)?.username).filter(Boolean).join(", ");
        return { name, place: "Group DM", icon: IconUtils.getChannelIconURL({ id: channel.id, icon: channel.icon, size: 64 }), acronym: name.slice(0, 2) };
    }
    const guild = GuildStore.getGuild(channel.guild_id);
    const parent = channel.isThread() ? ChannelStore.getChannel(channel.parent_id) : null;
    return {
        name: (channel.isThread() ? "" : "#") + channel.name,
        place: [guild?.name, parent && "#" + parent.name].filter(Boolean).join(" › "),
        icon: guild && IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }),
        acronym: guild ? getGuildAcronym(guild) : "#"
    };
}

function Row({ id, active }: { id: string; active: boolean; }) {
    const channel = ChannelStore.getChannel(id);
    if (!channel) return null;
    const { name, place, icon, acronym } = describe(channel);
    return (
        <div className={cl("row", { active })}>
            {icon ? <img className={cl("icon")} src={icon} alt="" /> : <div className={cl("icon")}>{acronym}</div>}
            <div className={cl("text")}>
                <div className={cl("name")}>{name}</div>
                {place && <div className={cl("place")}>{place}</div>}
            </div>
        </div>
    );
}

const Overlay = ErrorBoundary.wrap(() => {
    const { ids, index } = useCycle(s => s);
    const start = Math.max(0, Math.min(index - Math.floor(VISIBLE_ROWS / 2), ids.length - VISIBLE_ROWS));
    return (
        <div className={cl("overlay")}>
            <div className={cl("list")}>
                {ids.slice(start, start + VISIBLE_ROWS).map((id, i) => <Row key={id} id={id} active={start + i === index} />)}
            </div>
        </div>
    );
}, { noop: true });

function step(direction: 1 | -1) {
    let { ids, index } = useCycle.getState();
    if (index < 0) {
        const current = SelectedChannelStore.getChannelId();
        ids = [current, ...history.filter(id => id !== current)].filter(id => id && ChannelStore.getChannel(id));
        if (ids.length < 2) return;
        index = 0;
        modalKey = openModal(() => <Overlay />);
    }
    useCycle.setState({ ids, index: (index + direction + ids.length) % ids.length });
}

function finish(go: boolean) {
    const { ids, index } = useCycle.getState();
    if (index < 0) return;
    useCycle.setState({ ids: [], index: -1 });
    if (modalKey) closeModal(modalKey);
    modalKey = null;
    if (go && index > 0) ChannelRouter.transitionToChannel(ids[index]);
}

function onKeyDown(e: KeyboardEvent) {
    const held = IS_MAC ? e.metaKey : e.ctrlKey;
    if (e.key === "Escape" && useCycle.getState().index >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
        return;
    }
    if (e.key !== "Tab" || !held || e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    step(e.shiftKey ? -1 : 1);
}

function onKeyUp(e: KeyboardEvent) {
    if (e.key === (IS_MAC ? "Meta" : "Control")) finish(true);
}

function onBlur() {
    finish(false);
}

export default definePlugin({
    name: "RecentChannels",
    description: "Hold Ctrl and press Tab to flip through the channels, threads and DMs you visited last, most recent first, and let go to open one.",
    tags: ["Organisation", "Utility"],
    authors: [Devs.K3],
    settings,

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            remember(channelId);
        }
    },

    async start() {
        const saved = await DataStore.get<string[]>(STORE_KEY) ?? [];
        history = [...history, ...saved.filter(id => !history.includes(id))].slice(0, settings.store.historySize);
        remember(SelectedChannelStore.getChannelId());
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", onBlur);
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("blur", onBlur);
        finish(false);
    }
});
