/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType } from "@utils/types";
import { ComponentDispatch, ContextMenuApi, DraftStore, DraftType, Menu, moment, zustandCreate } from "@webpack/common";

const STORE_KEY = "DraftHistory_versions";

const settings = definePluginSettings({
    maxVersions: {
        type: OptionType.NUMBER,
        description: "How many earlier versions to keep for each chat.",
        default: 10,
        isValid: (value: number) => value >= 1 || "Keep at least one version."
    },
    minLength: {
        type: OptionType.NUMBER,
        description: "Shortest draft, in characters, that is worth keeping.",
        default: 15,
        isValid: (value: number) => value >= 1 || "Use at least one character."
    },
    keepDays: {
        type: OptionType.NUMBER,
        description: "Forget versions older than this many days.",
        default: 7,
        isValid: (value: number) => value >= 1 || "Keep versions for at least one day."
    }
});

interface Version {
    text: string;
    at: number;
}

type Versions = Record<string, Version[]>;

interface HistoryStore {
    <T>(selector: (state: { versions: Versions; }) => T): T;
    getState(): { versions: Versions; };
    setState(state: { versions: Versions; }): void;
}

const useHistory: HistoryStore = proxyLazy(() => zustandCreate(() => ({ versions: {} })));

const lastDraft = new Map<string, string>();
const lastSent = new Map<string, string>();

function prune(versions: Versions) {
    const { maxVersions, keepDays } = settings.store;
    const cutoff = Date.now() - keepDays * 86_400_000;
    const pruned: Versions = {};
    for (const [channelId, list] of Object.entries(versions)) {
        const kept = list.filter(v => v.at > cutoff).slice(0, maxVersions);
        if (kept.length) pruned[channelId] = kept;
    }
    return pruned;
}

function setVersions(versions: Versions) {
    useHistory.setState({ versions });
    DataStore.set(STORE_KEY, versions);
}

function remember(channelId: string, text: string) {
    if (text.trim().length < settings.store.minLength) return;
    const { versions } = useHistory.getState();
    const list = (versions[channelId] ?? []).filter(v => v.text !== text);
    setVersions(prune({ ...versions, [channelId]: [{ text, at: Date.now() }, ...list] }));
}

function onDraftChange(channelId: string, draft: string) {
    const previous = lastDraft.get(channelId) ?? "";
    lastDraft.set(channelId, draft);
    if (previous.length - draft.length < settings.store.minLength) return;
    if (lastSent.get(channelId) === previous.trim()) {
        lastSent.delete(channelId);
        return;
    }
    remember(channelId, previous);
}

function restore(channelId: string, text: string) {
    remember(channelId, DraftStore.getDraft(channelId, DraftType.ChannelMessage));
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
    insertTextIntoChatInputBox(text);
}

function preview(text: string) {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

function HistoryMenu({ channelId }: { channelId: string; }) {
    const versions = useHistory(s => s.versions[channelId] ?? []);
    return (
        <Menu.Menu navId="vc-draft-history" onClose={ContextMenuApi.closeContextMenu} aria-label="Draft history">
            <Menu.MenuGroup label="Earlier drafts">
                {versions.map(v => (
                    <Menu.MenuItem
                        key={v.at}
                        id={`vc-draft-history-${v.at}`}
                        label={`${preview(v.text)} (${moment(v.at).fromNow()})`}
                        action={() => restore(channelId, v.text)}
                    />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="vc-draft-history-clear"
                label="Clear history for this chat"
                color="danger"
                action={() => {
                    const { [channelId]: _, ...rest } = useHistory.getState().versions;
                    setVersions(rest);
                }}
            />
        </Menu.Menu>
    );
}

function HistoryIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z" />
        </svg>
    );
}

const HistoryButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    const count = useHistory(s => s.versions[channel.id]?.length ?? 0);
    if (!isMainChat || !count) return null;
    return (
        <ChatBarButton
            tooltip={count === 1 ? "1 earlier draft" : `${count} earlier drafts`}
            onClick={e => ContextMenuApi.openContextMenu(e, () => <HistoryMenu channelId={channel.id} />)}
        >
            <HistoryIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "DraftHistory",
    description: "Keeps earlier versions of each chat's draft, so text lost to a stray clear or a select all and delete can be brought back from the chat bar.",
    tags: ["Utility", "Chat"],
    authors: [Devs.K3],
    settings,

    chatBarButton: {
        icon: HistoryIcon,
        render: HistoryButton
    },

    flux: {
        DRAFT_SAVE({ channelId, draft, draftType }: { channelId: string; draft: string; draftType: number; }) {
            if (draftType === DraftType.ChannelMessage) onDraftChange(channelId, draft);
        },
        DRAFT_CLEAR({ channelId, draftType }: { channelId: string; draftType: number; }) {
            if (draftType === DraftType.ChannelMessage) onDraftChange(channelId, "");
        }
    },

    onBeforeMessageSend(channelId, { content }) {
        lastSent.set(channelId, content.trim());
    },

    async start() {
        for (const { channelId, draft } of DraftStore.getRecentlyEditedDrafts(DraftType.ChannelMessage)) lastDraft.set(channelId, draft);
        useHistory.setState({ versions: prune(await DataStore.get<Versions>(STORE_KEY) ?? {}) });
    },

    stop() {
        lastDraft.clear();
        lastSent.clear();
    }
});
