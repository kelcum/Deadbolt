/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { isPluginEnabled, plugins } from "@api/PluginManager";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

interface Snapshot {
    enabled: number;
    installed: number;
    heap: string;
    cores: number;
    online: boolean;
    delay: number | null;
}

function collect(delay: number | null = null): Snapshot {
    const { memory } = performance as Performance & { memory?: { usedJSHeapSize: number; }; };
    const names = Object.keys(plugins);
    return {
        enabled: names.filter(isPluginEnabled).length,
        installed: names.length,
        heap: memory && Number.isFinite(memory.usedJSHeapSize) ? Math.round(memory.usedJSHeapSize / 1048576) + " MB" : "Unavailable",
        cores: navigator.hardwareConcurrency,
        online: navigator.onLine,
        delay
    };
}

function MeterIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3 18a9 9 0 1 1 18 0H3Z" strokeLinejoin="round" /><path d="m12 14 4-5" strokeLinecap="round" /><circle cx="12" cy="14" r="1.5" />
    </svg>;
}

const Dashboard = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const [data, setData] = useState(collect);
    const [revision, setRevision] = useState(0);
    const [status, setStatus] = useState("");
    useEffect(() => {
        const start = performance.now();
        const timer = window.setTimeout(() => setData(collect(Math.max(0, Math.round(performance.now() - start - 100)))), 100);
        return () => window.clearTimeout(timer);
    }, [revision]);
    const rows: [string, string][] = [
        ["Enabled plugins", data.enabled + " / " + data.installed],
        ["JavaScript heap", data.heap],
        ["Logical CPU cores", String(data.cores || "Unavailable")],
        ["Network indicator", data.online ? "Online" : "Offline"],
        ["Timer delay", data.delay === null ? "Measuring…" : data.delay + " ms"]
    ];
    async function copy() {
        try {
            await copyToClipboard(rows.map(([label, value]) => label + ": " + value).join("\n"));
            setStatus("Copied.");
        } catch {
            setStatus("Clipboard unavailable.");
        }
    }
    return <Modal {...modalProps} size="md" title="Performance" subtitle="A local snapshot of client diagnostics."
        actions={[{ text: "Refresh", variant: "secondary", onClick: () => setRevision(n => n + 1) }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map(([label, value]) => <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <Text size="sm" color="text-muted">{label}</Text><Text size="sm" weight="semibold">{value}</Text>
            </div>)}
            <Text size="xs" color="text-muted">Heap is not total process memory. Timer delay is a single responsiveness sample, not CPU usage or network latency.</Text>
            <Button variant="secondary" size="small" onClick={() => void copy()}>Copy diagnostics</Button>
            {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        </div>
    </Modal>;
});

export default definePlugin({
    name: "PerformanceDashboard",
    description: "View local memory, plugin counts and a lightweight responsiveness sample on demand.",
    authors: [Devs.Zot],
    tags: ["Utility", "Developers"],
    headerBarButton: {
        icon: MeterIcon,
        render: () => <HeaderBarButton icon={MeterIcon} tooltip="Performance" onClick={() => openModal(props => <Dashboard modalProps={props} />)} />
    }
});
