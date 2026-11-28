/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { defaultAudioNames, playAudio, PreprocessAudioData } from "@api/AudioPlayer";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import type { Channel, Guild, User } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildStore, Menu, showToast, UserStore } from "@webpack/common";

type Scope = "user" | "channel" | "guild";

const cl = classNameFactory("vc-sound-per-source-");
const FILES_KEY = "SoundPerSource_files";
const MAX_FILE_BYTES = 1024 * 1024;
const MATCH_WINDOW_MS = 1500;
const NOTIFICATION_SOUND = /(?:^|_)(?:message|mention)\d$/;
const RULE_KEYS: "rules"[] = ["rules"];

const SOUNDS = [
    ["message1", "Message"],
    ["message2", "Reply"],
    ["message3", "Direct Message"],
    ["mention1", "Role Mention"],
    ["mention2", "Everyone Mention"],
    ["mention3", "Here Mention"],
    ["bit_message1", "Bit"],
    ["bop_message1", "Bop"],
    ["ducky_message1", "Ducky"],
    ["lofi_message1", "Lofi"],
    ["asmr_message1", "ASMR"],
    ["ddr-up", "Arrow Up"],
    ["ddr-down", "Arrow Down"],
    ["success", "Success"],
    ["highfive_clap", "Clap"]
] as const;

const SCOPE_LABELS: Record<Scope, string> = { user: "Person", channel: "Channel", guild: "Server" };

let files: Record<string, string> = {};
let lastMessage: { userId: string; channelId: string; guildId?: string; time: number; } | undefined;

function soundLabel(sound: string) {
    if (sound === "silent") return "Silent";
    if (sound === "file") return "Custom File";
    return SOUNDS.find(([id]) => id === sound)?.[1] ?? sound;
}

function sourceName(key: string) {
    const [scope, id] = key.split(":") as [Scope, string];
    if (scope === "user") {
        const user = UserStore.getUser(id);
        return user ? user.globalName ?? user.username : id;
    }
    if (scope === "channel") {
        const channel = ChannelStore.getChannel(id);
        if (!channel) return id;
        if (channel.name) return `#${channel.name}`;
        if (!channel.isDM()) return "Group DM";
        const recipient = UserStore.getUser(channel.recipients[0]);
        return recipient ? recipient.globalName ?? recipient.username : id;
    }
    return GuildStore.getGuild(id)?.name ?? id;
}

function preview(sound: string, key: string) {
    if (sound === "silent") return;
    playAudio(sound === "file" ? files[key] : sound);
}

async function removeFile(key: string) {
    if (!(key in files)) return;
    const { [key]: _, ...rest } = files;
    files = rest;
    await DataStore.set(FILES_KEY, files);
}

async function setRule(key: string, sound: string | undefined) {
    const { [key]: _, ...rules } = settings.store.rules;
    if (sound) rules[key] = sound;
    settings.store.rules = rules;
    if (sound !== "file") await removeFile(key);
    if (sound && settings.store.previewOnPick) preview(sound, key);
}

async function pickFile(key: string) {
    const file = await chooseFile("audio/*");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
        showToast({ text: "That sound is too big. Pick a file under 1 MB.", variant: "critical" });
        return;
    }
    const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
    files = { ...files, [key]: dataUri };
    await DataStore.set(FILES_KEY, files);
    await setRule(key, "file");
    showToast({ text: `${file.name} will play for ${sourceName(key)}.` });
}

function soundMenu(key: string, label: string) {
    const current = settings.store.rules[key];
    const available = new Set(defaultAudioNames());
    const group = "vc-sound-per-source";
    return (
        <Menu.MenuGroup>
            <Menu.MenuItem id={group} label={label}>
                <Menu.MenuRadioItem id={`${group}-default`} group={group} label="Discord Default" checked={!current} action={() => setRule(key, undefined)} />
                <Menu.MenuRadioItem id={`${group}-silent`} group={group} label="Silent" checked={current === "silent"} action={() => setRule(key, "silent")} />
                <Menu.MenuSeparator />
                {SOUNDS.filter(([id]) => available.has(id)).map(([id, name]) => (
                    <Menu.MenuRadioItem key={id} id={`${group}-${id}`} group={group} label={name} checked={current === id} action={() => setRule(key, id)} />
                ))}
                <Menu.MenuSeparator />
                <Menu.MenuRadioItem id={`${group}-file`} group={group} label="Custom File..." checked={current === "file"} action={() => pickFile(key)} />
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
}

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    children.push(soundMenu(`user:${user.id}`, "Notification Sound"));
};

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || channel.isGuildVocal() || channel.isCategory()) return;
    children.push(soundMenu(`channel:${channel.id}`, "Notification Sound Here"));
};

const guildContext: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(soundMenu(`guild:${guild.id}`, "Notification Sound in Server"));
};

function interceptor(action: { type: string; channelId?: string; guildId?: string; optimistic?: boolean; message?: { author?: { id: string; }; }; }) {
    if (action.type !== "MESSAGE_CREATE" || action.optimistic || !action.channelId || !action.message?.author) return false;
    lastMessage = { userId: action.message.author.id, channelId: action.channelId, guildId: action.guildId, time: Date.now() };
    return false;
}

function findRule() {
    if (!lastMessage || Date.now() - lastMessage.time > MATCH_WINDOW_MS) return;
    const { userId, channelId, guildId } = lastMessage;
    const { rules } = settings.store;
    const channel = ChannelStore.getChannel(channelId);
    const keys = [`user:${userId}`, `channel:${channelId}`, channel?.parent_id && `channel:${channel.parent_id}`, `guild:${guildId ?? channel?.guild_id}`];
    const key = keys.find(k => k && rules[k]);
    return key ? { key, sound: rules[key] } : undefined;
}

function RuleList() {
    const { rules } = settings.use(RULE_KEYS);
    const entries = Object.entries(rules);
    if (!entries.length) return <Paragraph>No sounds set yet. Right click a person, channel or server and pick Notification Sound.</Paragraph>;
    return (
        <div className={cl("list")}>
            {entries.map(([key, sound]) => (
                <div key={key} className={cl("row")}>
                    <Paragraph className={cl("name")}>{SCOPE_LABELS[key.split(":")[0] as Scope]}: {sourceName(key)} plays {soundLabel(sound)}</Paragraph>
                    {sound !== "silent" && <Button size="small" variant="secondary" onClick={() => preview(sound, key)}>Play</Button>}
                    <Button size="small" variant="dangerSecondary" onClick={() => setRule(key, undefined)}>Remove</Button>
                </div>
            ))}
        </div>
    );
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.CUSTOM,
        description: "Sounds picked per person, channel and server",
        default: {} as Record<string, string>,
        hidden: true
    },
    previewOnPick: {
        type: OptionType.BOOLEAN,
        description: "Play the sound once when you pick it.",
        default: true
    },
    list: {
        type: OptionType.COMPONENT,
        description: "Sounds you picked.",
        component: RuleList
    }
});

export default definePlugin({
    name: "SoundPerSource",
    description: "Plays a different notification sound for the people, channels and servers you pick. Right click one and choose Notification Sound.",
    tags: ["Notifications"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        "user-context": userContext,
        "channel-context": channelContext,
        "thread-context": channelContext,
        "gdm-context": channelContext,
        "guild-context": guildContext
    },

    audioProcessor(data: PreprocessAudioData) {
        if (!NOTIFICATION_SOUND.test(data.audio)) return;
        const rule = findRule();
        if (!rule) return;
        lastMessage = undefined;
        if (rule.sound === "silent") data.volume = 0;
        else if (rule.sound === "file") {
            if (files[rule.key]) data.audio = files[rule.key];
        } else data.audio = rule.sound;
    },

    async start() {
        files = await DataStore.get<Record<string, string>>(FILES_KEY) ?? {};
        FluxDispatcher.addInterceptor(interceptor);
    },

    stop() {
        const index = FluxDispatcher._interceptors.indexOf(interceptor);
        if (index !== -1) FluxDispatcher._interceptors.splice(index, 1);
        lastMessage = undefined;
    }
});
