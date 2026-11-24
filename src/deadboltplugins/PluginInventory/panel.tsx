/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useState } from "@webpack/common";

function collect() {
    return Object.keys(plugins).sort((a, b) => a.localeCompare(b)).map(name => {
        const plugin = plugins[name];
        const enabled = isPluginEnabled(name);
        const missing = (plugin.dependencies ?? []).filter(dependency => !Object.hasOwn(plugins, dependency) || enabled && !isPluginEnabled(dependency));
        return { name, enabled, missing, restart: plugin.requiresRestart ?? Boolean(plugin.patches?.length) };
    });
}

const Inventory = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const [data, setData] = useState(collect);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [limit, setLimit] = useState(40);
    const [status, setStatus] = useState("");
    const rows = data.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "all" || filter === "enabled" && p.enabled || filter === "disabled" && !p.enabled || filter === "issues" && p.missing.length > 0));
    async function copy() {
        try {
            await copyToClipboard(rows.map(p => p.name + " [" + (p.enabled ? "enabled" : "disabled") + "]" + (p.missing.length ? " · dependency: " + p.missing.join(", ") : "")).join("\n"));
            setStatus("Copied " + rows.length + " plugins.");
        } catch {
            setStatus("Clipboard unavailable.");
        }
    }
    return <Modal {...modalProps} size="md" title="Plugin inventory" subtitle="Inspect installed plugins and declared dependencies."
        actions={[{ text: "Refresh", variant: "secondary", onClick: () => { setData(collect()); setLimit(40); } }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
                <input aria-label="Search plugins" placeholder="Search plugins" value={query} onChange={e => { setQuery(e.target.value); setLimit(40); }}
                    style={{ flex: 1, minWidth: 0, padding: 8, borderRadius: 6, color: "var(--text-default)", background: "var(--input-background, var(--background-base-lower))" }} />
                <select aria-label="Plugin filter" value={filter} onChange={e => { setFilter(e.target.value); setLimit(40); }}
                    style={{ padding: 8, borderRadius: 6, color: "var(--text-default)", background: "var(--input-background, var(--background-base-lower))" }}>
                    <option value="all">All</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="issues">Dependency issues</option>
                </select>
            </div>
            <Text size="xs" color="text-muted">{rows.length} matching plugins · {data.filter(p => p.enabled).length} enabled</Text>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {rows.slice(0, limit).map(p => <div key={p.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 4px", borderBottom: "1px solid var(--border-subtle, var(--background-modifier-accent))" }}>
                    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <Text size="sm" weight="semibold">{p.name}</Text>
                        {p.missing.length > 0 && <Text size="xs" color="text-danger">Dependency: {p.missing.join(", ")}</Text>}
                        {p.restart && <Text size="xs" color="text-muted">Restart normally required</Text>}
                    </div>
                    <Text size="xs" color={p.enabled ? "text-feedback-positive" : "text-muted"}>{p.enabled ? "Enabled" : "Disabled"}</Text>
                </div>)}
                {!rows.length && <Text size="sm" color="text-muted">No matching plugins.</Text>}
            </div>
            {limit < rows.length && <Button size="small" variant="secondary" onClick={() => setLimit(n => n + 40)}>Show more</Button>}
            <Button size="small" variant="secondary" onClick={() => void copy()}>Copy results</Button>
            {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        </div>
    </Modal>;
});

export function openInventory() {
    openModal(props => <Inventory modalProps={props} />);
}
