/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, UserStore, useState, useStateFromStores } from "@webpack/common";

interface EventEntry { time: number; label: string; }
let events: EventEntry[] = [];
let owner: string | undefined;

function record(label: string) {
    const account = UserStore.getCurrentUser()?.id;
    if (account !== owner) {
        events = [];
        owner = account;
    }
    if (account) events = [{ time: Date.now(), label }, ...events].slice(0, 20);
}

function snapshot(userId: string) {
    return owner === userId ? events.slice() : [];
}

function MonitorIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M2 12h5l3-7 4 14 3-7h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

const MonitorModal = ErrorBoundary.wrap(({ modalProps, userId }: { modalProps: RenderModalProps; userId: string; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [rows, setRows] = useState(() => snapshot(userId));
    const [online, setOnline] = useState(navigator.onLine);
    function refresh() {
        if (UserStore.getCurrentUser()?.id !== userId) return;
        setRows(snapshot(userId));
        setOnline(navigator.onLine);
    }
    return <Modal {...modalProps} size="md" title="Connection monitor" subtitle="Local network status and recent Discord events."
        actions={[{ text: "Refresh", variant: "secondary", onClick: refresh }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text weight="semibold" size="sm">Network</Text>
                <Text weight="semibold" size="sm" color={online ? "text-feedback-positive" : "text-danger"}>{online ? "● Online" : "● Offline"}</Text>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text size="sm" color="text-muted">Last Discord event</Text>
                <Text size="sm">{rows[0]?.label ?? "Not observed"}</Text>
            </div>
            <Text size="xs" weight="semibold" color="text-muted">EVENT HISTORY</Text>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
                {!rows.length && <Text size="sm" color="text-muted">No events recorded yet.</Text>}
                {rows.map((entry, i) => <div key={entry.time + "-" + i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border-subtle, var(--background-modifier-accent))" }}>
                    <Text size="sm">{entry.label}</Text>
                    <Text size="xs" color="text-muted">{new Date(entry.time).toLocaleTimeString()}</Text>
                </div>)}
            </div>
            <Text size="xs" color="text-muted">Session only. Network status does not confirm Discord reachability.</Text>
        </div> : <Text size="sm">Account changed. Reopen the monitor.</Text>}
    </Modal>;
});

export default definePlugin({
    name: "ConnectionMonitor",
    description: "Inspect local Discord connection events and the browser network indicator from a toolbar panel.",
    authors: [Devs.Zot],
    tags: ["Utility", "Developers"],
    headerBarButton: {
        icon: MonitorIcon,
        render: () => <HeaderBarButton icon={MonitorIcon} tooltip="Connection monitor" onClick={() => {
            const userId = UserStore.getCurrentUser()?.id;
            if (userId) openModal(props => <MonitorModal modalProps={props} userId={userId} />);
        }} />
    },
    flux: {
        CONNECTION_OPEN() { record("Connection opened"); },
        CONNECTION_CLOSED() { record("Connection closed"); },
        CONNECTION_INTERRUPTED() { record("Connection interrupted"); },
        LOGOUT() { events = []; owner = undefined; }
    },
    stop() {
        events = [];
        owner = undefined;
    }
});
