/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { openImageModal } from "@utils/discord";
import { proxyLazy } from "@utils/lazy";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { FluxDispatcher, IconUtils, Menu, moment, Tooltip, UserStore, zustandCreate } from "@webpack/common";

const STORE_KEY = "ProfileHistory_changes";
const cl = classNameFactory("vc-profile-history-");
const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");

const settings = definePluginSettings({
    trackAvatars: {
        type: OptionType.BOOLEAN,
        description: "Also keep the avatars people had before.",
        default: true
    },
    maxPerUser: {
        type: OptionType.NUMBER,
        description: "How many changes to keep for each person.",
        default: 20,
        isValid: (value: number) => value >= 1 || "Keep at least one change."
    }
});

const FIELDS = {
    username: "Username",
    globalName: "Display name",
    avatar: "Avatar"
} as const;

type Field = keyof typeof FIELDS;

interface Change {
    field: Field;
    from: string | null;
    to: string | null;
    at: number;
}

type Changes = Record<string, Change[]>;

interface HistoryStore {
    <T>(selector: (state: { changes: Changes; }) => T): T;
    getState(): { changes: Changes; };
    setState(state: { changes: Changes; }): void;
}

const useHistory: HistoryStore = proxyLazy(() => zustandCreate(() => ({ changes: {} })));

interface RawUser {
    id: string;
    username?: string;
    global_name?: string | null;
    globalName?: string | null;
    avatar?: string | null;
}

interface RawMessage {
    author?: RawUser;
    webhook_id?: string;
}

interface Action {
    type: string;
    message?: RawMessage;
    messages?: RawMessage[];
    updates?: { user?: RawUser; }[];
    user?: RawUser;
    relationship?: { user?: RawUser; };
    chunks?: { members: { user?: RawUser; }[]; }[];
}

function authorOf(message: RawMessage | undefined) {
    return message?.webhook_id ? undefined : message?.author;
}

function usersIn(action: Action): (RawUser | undefined)[] {
    switch (action.type) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            return [authorOf(action.message)];
        case "LOAD_MESSAGES_SUCCESS":
            return action.messages?.map(authorOf) ?? [];
        case "PRESENCE_UPDATES":
            return action.updates?.map(u => u.user) ?? [];
        case "GUILD_MEMBERS_CHUNK_BATCH":
            return action.chunks?.flatMap(c => c.members.map(m => m.user)) ?? [];
        case "RELATIONSHIP_ADD":
            return [action.relationship?.user];
        case "GUILD_MEMBER_ADD":
        case "GUILD_MEMBER_UPDATE":
        case "USER_UPDATE":
        case "USER_PROFILE_FETCH_SUCCESS":
            return [action.user];
        default:
            return [];
    }
}

function setChanges(changes: Changes) {
    useHistory.setState({ changes });
    DataStore.set(STORE_KEY, changes);
}

function detect(user: User, raw: RawUser) {
    const found: Change[] = [];
    const at = Date.now();
    if (raw.username !== undefined && raw.username !== user.username)
        found.push({ field: "username", from: user.username, to: raw.username, at });
    const globalName = raw.global_name !== undefined ? raw.global_name : raw.globalName;
    if (globalName !== undefined && (globalName ?? null) !== (user.globalName ?? null))
        found.push({ field: "globalName", from: user.globalName ?? null, to: globalName ?? null, at });
    if (settings.store.trackAvatars && raw.avatar !== undefined && raw.avatar !== user.avatar)
        found.push({ field: "avatar", from: IconUtils.getUserAvatarURL(user, true, 512), to: raw.avatar, at });
    return found;
}

function interceptor(action: Action) {
    let { changes } = useHistory.getState();
    let dirty = false;
    for (const raw of usersIn(action)) {
        if (!raw?.id) continue;
        const user = UserStore.getUser(raw.id);
        if (!user) continue;
        for (const change of detect(user, raw)) {
            const list = changes[raw.id] ?? [];
            if (list.find(c => c.field === change.field)?.to === change.to) continue;
            changes = { ...changes, [raw.id]: [change, ...list].slice(0, settings.store.maxPerUser) };
            dirty = true;
        }
    }
    if (dirty) setChanges(changes);
    return false;
}

function describe({ field, from }: Change) {
    if (from === null) return "Had no display name";
    return field === "username" ? `Username was @${from}` : `${FIELDS[field]} was ${from}`;
}

const HistorySection = ErrorBoundary.wrap(({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) => {
    const changes = useHistory(s => s.changes[userId]);
    if (!changes) return null;
    const names = changes.filter(c => c.field !== "avatar");
    const avatars = changes.filter(c => c.field === "avatar");

    return (
        <Section
            heading="Profile History"
            headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
            headingColor={isSideBar ? "text-strong" : "text-default"}
            className={cl("section")}
        >
            <div className={cl("list")}>
                {names.map(c => (
                    <Text key={`${c.field}-${c.at}`} size="sm" selectable>
                        {describe(c)}{" "}
                        <Text tag="span" size="sm" color="text-muted">{moment(c.at).fromNow()}</Text>
                    </Text>
                ))}
            </div>
            {avatars.length > 0 && (
                <div className={cl("avatars")}>
                    {avatars.map(c => (
                        <Tooltip key={c.at} text={`Changed ${moment(c.at).fromNow()}`}>
                            {props => (
                                <img
                                    {...props}
                                    className={cl("avatar")}
                                    src={c.from ?? undefined}
                                    alt="Earlier avatar"
                                    onClick={() => c.from && openImageModal({ url: c.from, width: 512, height: 512 })}
                                />
                            )}
                        </Tooltip>
                    ))}
                </div>
            )}
        </Section>
    );
}, { noop: true });

const userContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || !useHistory.getState().changes[user.id]) return;
    children.push(
        <Menu.MenuItem
            id="vc-profile-history-clear"
            label="Clear Profile History"
            action={() => {
                const { [user.id]: _, ...rest } = useHistory.getState().changes;
                setChanges(rest);
            }}
        />
    );
};

export default definePlugin({
    name: "ProfileHistory",
    description: "Remembers the usernames, display names and avatars people had before, as your client sees them change, and lists them in their profile.",
    tags: ["Utility", "Friends"],
    authors: [Devs.K3],
    settings,

    renderProfileSection: {
        render: HistorySection,
        priority: 0
    },

    contextMenus: {
        "user-context": userContext
    },

    async start() {
        useHistory.setState({ changes: await DataStore.get<Changes>(STORE_KEY) ?? {} });
        FluxDispatcher.addInterceptor(interceptor);
    },

    stop() {
        const index = FluxDispatcher._interceptors.indexOf(interceptor);
        if (index !== -1) FluxDispatcher._interceptors.splice(index, 1);
    }
});
