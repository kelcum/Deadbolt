/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin, { PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.UpdateRollback as PluginNative<typeof import("./native")> | undefined;
const Panel = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof Native>["status"]>> | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(true);
    const [restart, setRestart] = useState(false);
    useEffect(() => {
        let active = true;
        if (!Native) { setBusy(false); return; }
        Native.status().then(result => { if (active) setStatus(result); }).catch(() => { if (active) setMessage("Could not inspect checkpoint."); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, []);
    async function run(restore: boolean) {
        if (!Native || busy) return;
        setBusy(true);
        try { const result = await (restore ? Native.rollback() : Native.checkpoint()); setMessage(result.message); setStatus(await Native.status()); if (restore && result.ok) setRestart(true); }
        catch { setMessage("Could not finish the operation."); } finally { setBusy(false); }
    }
    return <Modal {...modalProps} title="Update rollback" size="md" subtitle="One previous desktop build, with integrity checks. Your settings and saved data are not changed." actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Text size="sm">{status?.backup ? `Checkpoint: ${new Date(status.backup.created).toLocaleString()} · ${(status.backup.bytes / 1048576).toFixed(1)} MiB · ${status.backup.files} files` : busy ? "Checking build…" : "No valid build checkpoint."}</Text>
            <Button disabled={busy || !status?.supported || restart} size="small" variant="secondary" onClick={() => void run(false)}>Save current build checkpoint</Button>
            <Button disabled={busy || !status?.backup || restart} size="small" variant="dangerSecondary" onClick={() => void run(true)}>Restore previous build</Button>
            {restart && <Button size="small" onClick={relaunch}>Restart Discord</Button>}
            {!status?.supported && !busy && <Text size="xs" color="text-muted">Rollback supports unpacked Discord desktop builds, not standalone ASAR installations.</Text>}
            <Text size="xs" color="text-muted" role="status">{message}</Text>
        </div>
    </Modal>;
});
export function openRollback() { openModal(props => <Panel modalProps={props} />); }
export default definePlugin({ name: "UpdateRollback", description: "Keep and restore one previous desktop build without resetting settings or Git history.", authors: [Devs.Zot], tags: ["Utility"], toolboxActions: { "Update rollback": openRollback }, settingsAboutComponent: () => <Button size="small" onClick={openRollback}>Open build rollback</Button> });
