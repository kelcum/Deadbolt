/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { proxyLazy } from "@utils/lazy";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { lodash, moment, PresenceStore, RelationshipStore, Tooltip, useStateFromStores, zustandCreate } from "@webpack/common";

const STORE_KEY = "LastSeen_times";
const REFRESH_MS = 60_000;

const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");

type Seen = Record<string, number>;

interface SeenStore {
    <T>(selector: (state: { seen: Seen; }) => T): T;
    getState(): { seen: Seen; };
    setState(state: { seen: Seen; }): void;
}

const useSeen: SeenStore = proxyLazy(() => zustandCreate(() => ({ seen: {} })));

const online = new Set<string>();

const save = proxyLazy(() => lodash.throttle(() => DataStore.set(STORE_KEY, useSeen.getState().seen), 30_000));

function sync() {
    const now = Date.now();
    const { seen } = useSeen.getState();
    let next: Seen | undefined;
    const friends = new Set(RelationshipStore.getFriendIDs());

    for (const id of friends) {
        const isOnline = PresenceStore.getStatus(id) !== "offline";
        const wasOnline = online.has(id);
        if (isOnline) online.add(id);
        else online.delete(id);
        if ((isOnline && now - (seen[id] ?? 0) > REFRESH_MS) || (wasOnline && !isOnline)) {
            next ??= { ...seen };
            next[id] = now;
        }
    }
    for (const id of online) if (!friends.has(id)) online.delete(id);

    if (!next) return;
    useSeen.setState({ seen: next });
    save();
}

const LastSeenSection = ErrorBoundary.wrap(({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) => {
    const status = useStateFromStores([PresenceStore, RelationshipStore], () => RelationshipStore.isFriend(userId) ? PresenceStore.getStatus(userId) : null, [userId]);
    const at = useSeen(s => s.seen[userId]);
    if (!status || (status === "offline" && !at)) return null;

    const isOnline = status !== "offline";
    return (
        <Section
            heading="Last Seen"
            headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
            headingColor={isSideBar ? "text-strong" : "text-default"}
        >
            {isOnline
                ? <Text size="sm">Online now</Text>
                : (
                    <Tooltip text={moment(at).format("LLLL")}>
                        {props => <Text {...props} size="sm">{moment(at).fromNow()}</Text>}
                    </Tooltip>
                )}
        </Section>
    );
}, { noop: true });

export default definePlugin({
    name: "LastSeen",
    description: "Shows on a friend's profile when they were last online, remembered on this device from what Discord shows while you are connected.",
    tags: ["Friends", "Utility"],
    authors: [Devs.K3],

    renderProfileSection: {
        render: LastSeenSection,
        priority: 0
    },

    async start() {
        useSeen.setState({ seen: await DataStore.get<Seen>(STORE_KEY) ?? {} });
        sync();
        PresenceStore.addChangeListener(sync);
        RelationshipStore.addChangeListener(sync);
    },

    stop() {
        PresenceStore.removeChangeListener(sync);
        RelationshipStore.removeChangeListener(sync);
        save.flush();
        online.clear();
    }
});
