/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import { column, launchButton, row, showPanel, Status } from "@utils/zotPanels";
import { useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StorageManager as PluginNative<typeof import("./native")>;
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;
function Panel() {
    const [report, setReport] = useState<Awaited<ReturnType<typeof Native.inspectCache>> | null>(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    async function run(clear = false) { if (busy) return; setBusy(true); try { if (clear) { const done = await Native.clearHttpCache(); setStatus(done ? "HTTP cache cleared." : "Cancelled."); } setReport(await Native.inspectCache()); } catch { setStatus("Cache inspection or cleanup failed."); } finally { setBusy(false); } }
    return <div style={column}><Text size="sm">Inspect known cache folders without opening user data. Only the current Electron session's HTTP cache can be cleared; other folders are read-only.</Text><div style={row}><Button size="small" disabled={busy} onClick={() => void run()}>Inspect storage</Button><Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => void run(true)}>Clear HTTP cache</Button></div>{report && <><Text size="sm" weight="semibold">Session HTTP cache: {mb(report.httpBytes)}</Text>{report.rows.map(r => <div style={{ ...row, justifyContent: "space-between" }} key={r.name}><Text size="sm">{r.name}</Text><Text size="sm">{mb(r.bytes)}</Text></div>)}<Status>{report.partial ? "Scan limit reached; estimates are partial." : "Folder sizes may overlap with the HTTP cache estimate."}</Status></>}<Status>{busy ? "Working…" : status}</Status></div>;
}
function open() { showPanel("Storage manager", Panel); }
export default definePlugin({ name: "StorageManager", description: "Inspect local cache usage and clear only the temporary HTTP cache with confirmation.", authors: [Devs.Zot], tags: ["Utility"], toolboxActions: { "Storage manager": open }, settingsAboutComponent: launchButton("Open storage manager", open) });
