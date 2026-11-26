/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { safeMode } from "@api/SafeMode";
import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { column, field, launchButton, list, owns, row, showPanel, Status } from "@utils/zotPanels";
import { useState } from "@webpack/common";
import { failedPatchPlugins, getBuildNumber } from "@webpack/patcher";

function collect() {
    return Object.values(plugins).filter(p => isPluginEnabled(p.name)).map(p => ({ name: p.name, patch: failedPatchPlugins.has(p.name), missing: (p.dependencies ?? []).filter(dep => !plugins[dep] || !isPluginEnabled(dep)) })).filter(p => p.patch || p.missing.length).sort((a, b) => a.name.localeCompare(b.name));
}
function Panel({ userId }: { userId: string; }) {
    const [issues, setIssues] = useState(collect);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const rows = issues.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
    return <div style={column}>
        <Text size="sm">Discord build {getBuildNumber()} · {safeMode?.active ? "Safe mode" : "Normal mode"}</Text>
        <Text size="xs" color="text-muted">Checks actual patch failures reported by the patcher and declared dependency state. It cannot detect all runtime conflicts.</Text>
        <div style={row}><input aria-label="Filter plugins" style={{ ...field, flex: 1 }} value={query} placeholder="Find plugin" onChange={e => setQuery(e.target.value)}/><Button size="small" variant="secondary" onClick={() => setIssues(collect())}>Refresh</Button></div>
        <div style={list}>{rows.map(p => <div key={p.name} style={column}><Text size="sm" weight="semibold">{p.name}</Text><Text size="xs" color="text-danger">{[p.patch ? "Patch failure" : "", p.missing.length ? `Missing dependencies: ${p.missing.join(", ")}` : ""].filter(Boolean).join(" · ")}</Text></div>)}</div>
        {!rows.length && <Text size="sm">{issues.length ? "No matching issues." : "No reported patch or dependency issues."}</Text>}
        <Button size="small" variant="secondary" onClick={() => { if (owns(userId)) void copyToClipboard(JSON.stringify({ build: getBuildNumber(), safeMode: !!safeMode?.active, issues }, null, 2)).then(() => setStatus("Diagnostics copied."), () => setStatus("Could not copy.")); }}>Copy diagnostics</Button><Status>{status}</Status>
    </div>;
}
function open() { showPanel("Plugin health", Panel); }
export default definePlugin({ name: "PluginHealth", description: "Inspect reported patch failures and missing dependencies and copy a minimal diagnostic report.", authors: [Devs.Zot], tags: ["Utility", "Developers"], toolboxActions: { "Plugin health": open }, settingsAboutComponent: launchButton("Open plugin health", open) });
