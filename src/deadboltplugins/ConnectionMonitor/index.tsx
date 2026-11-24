/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
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
    return <Modal {...modalProps} size="md" title="Connection monitor" subtitle="Observe local Discord connection events. This does not measure latency or make network requests."
        actions={[{ text: "Refresh", variant: "secondary", onClick: refresh }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div style={{ color: "var(--text-normal)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "var(--background-secondary)" }}>
                <strong>Network indicator: {online ? "Online" : "Offline"}</strong>
                <p>Latest Discord event: {rows[0]?.label ?? "None observed yet"}</p>
                <p style={{ color: "var(--text-muted)" }}>Online does not guarantee Discord is reachable.</p>
            </div>
            <strong>Recent connection events (session only)</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                {!rows.length && <p>No connection events recorded. The monitor records events only while enabled.</p>}
                {rows.map((entry, i) => <div key={entry.time + "-" + i} style={{ padding: 8, background: "var(--background-secondary)", borderRadius: 6 }}>
                    {new Date(entry.time).toLocaleTimeString()} · {entry.label}
                </div>)}
            </div>
        </div> : <p>Account changed. Reopen the monitor.</p>}
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
