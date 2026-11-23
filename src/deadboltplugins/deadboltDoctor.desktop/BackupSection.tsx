/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { relaunch, showItemInFolder } from "@utils/native";
import { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, moment, openModal, showToast, useEffect, useState } from "@webpack/common";

import type { BackupPreview, SavedBackup } from "./backup";

const Native = VencordNative.pluginHelpers.DeadboltDoctor as PluginNative<typeof import("./native")>;
const cl = classNameFactory("vc-doctor-");

function FileList({ files }: { files: string[]; }) {
    const shown = files.slice(0, 12);
    return (
        <ul className={cl("files")}>
            {shown.map(f => <li key={f}>{f}</li>)}
            {files.length > shown.length && <li>and {files.length - shown.length} more</li>}
        </ul>
    );
}

function RestoreModal({ modalProps, data, preview }: { modalProps: RenderModalProps; data: Uint8Array; preview: BackupPreview; }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { settings, quickCss, userplugins, themes } = preview;
    const pluginChanges = userplugins ? userplugins.overwritten.length + userplugins.added.length : 0;
    const themeChanges = themes ? themes.overwritten.length + themes.added.length : 0;
    const nothing = !settings?.changed && !quickCss?.changed && !pluginChanges && !themeChanges;

    async function restore() {
        setBusy(true);
        setError(null);
        const res = await Native.restoreBackup(data);
        if ("safetyCopy" in res) {
            showToast({ text: "Backup restored. Restarting Discord.", variant: "success" });
            setTimeout(relaunch, 800);
            return;
        }
        setBusy(false);
        setError("error" in res ? res.error : `Your userplugins from the backup don't build, so nothing was restored.\n\n${res.buildError}`);
    }

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Restore backup"
            subtitle={preview.created ? `Made ${moment(preview.created).format("LLL")}` : undefined}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose, disabled: busy },
                { text: busy ? "Restoring…" : "Restore and restart", variant: "critical-primary", onClick: restore, loading: busy, disabled: busy || nothing }
            ]}
        >
            <div className={cl("panel")}>
                {nothing
                    ? <div className={cl("summary", "ok")}>This backup matches what you have now, there's nothing to restore.</div>
                    : <div className={cl("summary", "warn")}>These will be overwritten. Anything not listed stays as it is.</div>}
                <div className={cl("rows")}>
                    {settings && (
                        <div className={cl("row")}>
                            <span className={cl("dot", settings.changed ? "warn" : "ok")} />
                            <div>
                                <div className={cl("title")}>Settings</div>
                                <div className={cl("detail")}>
                                    {settings.changed
                                        ? `Replaced with the backup's. Enabled plugins go from ${settings.enabledNow} to ${settings.enabledAfter}.`
                                        : "Same as now."}
                                </div>
                            </div>
                        </div>
                    )}
                    {quickCss && (
                        <div className={cl("row")}>
                            <span className={cl("dot", quickCss.changed ? "warn" : "ok")} />
                            <div>
                                <div className={cl("title")}>QuickCSS</div>
                                <div className={cl("detail")}>
                                    {quickCss.changed
                                        ? `Replaced with the backup's (${quickCss.linesNow} lines now, ${quickCss.linesAfter} after).`
                                        : "Same as now."}
                                </div>
                            </div>
                        </div>
                    )}
                    {themes && (
                        <div className={cl("row")}>
                            <span className={cl("dot", themeChanges ? "warn" : "ok")} />
                            <div>
                                <div className={cl("title")}>Themes</div>
                                <div className={cl("detail")}>
                                    {themeChanges
                                        ? `${themes.unchanged} files already match. Themes that aren't in the backup are kept.`
                                        : "Same as now."}
                                </div>
                                {themes.overwritten.length > 0 && (
                                    <>
                                        <div className={cl("detail")}>Overwritten:</div>
                                        <FileList files={themes.overwritten} />
                                    </>
                                )}
                                {themes.added.length > 0 && (
                                    <>
                                        <div className={cl("detail")}>Added:</div>
                                        <FileList files={themes.added} />
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    {userplugins && (
                        <div className={cl("row")}>
                            <span className={cl("dot", pluginChanges ? "warn" : "ok")} />
                            <div>
                                <div className={cl("title")}>Userplugins</div>
                                <div className={cl("detail")}>
                                    {pluginChanges
                                        ? `${userplugins.unchanged} files already match. Deadbolt rebuilds after restoring, and puts them back if the build fails. Files that aren't in the backup are kept.`
                                        : "Same as now."}
                                </div>
                                {userplugins.overwritten.length > 0 && (
                                    <>
                                        <div className={cl("detail")}>Overwritten:</div>
                                        <FileList files={userplugins.overwritten} />
                                    </>
                                )}
                                {userplugins.added.length > 0 && (
                                    <>
                                        <div className={cl("detail")}>Added:</div>
                                        <FileList files={userplugins.added} />
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                    {preview.userpluginsSkipped && (
                        <div className={cl("row")}>
                            <span className={cl("dot", "warn")} />
                            <div>
                                <div className={cl("title")}>Userplugins</div>
                                <div className={cl("detail")}>Skipped, this Deadbolt isn't built from source.</div>
                            </div>
                        </div>
                    )}
                </div>
                {!nothing && <Paragraph>A copy of your current setup is saved to your Deadbolt folder first, so you can go back.</Paragraph>}
                {error && <pre className={cl("output")}>{error}</pre>}
            </div>
        </Modal>
    );
}

export function BackupSection() {
    const [busy, setBusy] = useState<string | null>(null);
    const [saved, setSaved] = useState<SavedBackup[]>([]);

    useEffect(() => {
        Native.listBackups().then(setSaved);
    }, []);

    async function openRestore(data: Uint8Array) {
        const preview = await Native.inspectBackup(data);
        setBusy(null);
        if ("error" in preview) return showToast({ text: preview.error, variant: "critical" });
        openModal(props => <RestoreModal modalProps={props} data={data} preview={preview} />);
    }

    async function restoreSaved(b: SavedBackup) {
        setBusy(b.name);
        const data = await Native.readSavedBackup(b.name);
        if (data) return openRestore(data);
        setBusy(null);
        showToast({ text: "That backup can't be read anymore.", variant: "critical" });
    }

    async function exportZip() {
        setBusy("export");
        const data = await Native.exportBackup();
        setBusy(null);
        DiscordNative.fileManager.saveWithDialog(data, `deadbolt-backup-${moment().format("YYYY-MM-DD")}.zip`);
    }

    async function pickRestore() {
        const [file] = await DiscordNative.fileManager.openFiles({
            filters: [{ name: "Deadbolt backup", extensions: ["zip"] }, { name: "all", extensions: ["*"] }]
        });
        if (!file) return;
        setBusy("restore");
        await openRestore(file.data);
    }

    return (
        <div className={cl("backup")}>
            <div className={cl("title")}>Backup</div>
            <div className={cl("detail")}>Your settings, QuickCSS, themes and userplugins in one zip. Restoring shows what changes before anything is touched.</div>
            <div className={cl("actions")}>
                <Button size="small" variant="secondary" disabled={!!busy} onClick={exportZip}>
                    {busy === "export" ? "Exporting…" : "Export backup"}
                </Button>
                <Button size="small" variant="secondary" disabled={!!busy} onClick={pickRestore}>
                    {busy === "restore" ? "Reading…" : "Restore from backup"}
                </Button>
                {saved.length > 0 && (
                    <Button size="small" variant="secondary" onClick={() => showItemInFolder(saved[0].path)}>Open backups folder</Button>
                )}
            </div>
            {saved.length > 0 && (
                <div className={cl("rows")}>
                    {saved.slice(0, 8).map(b => (
                        <div key={b.name} className={cl("row", "saved")}>
                            <div>
                                <div className={cl("title")}>{moment(b.created).format("LLL")}</div>
                                <div className={cl("detail")}>{b.auto ? "Automatic" : "Saved before a restore"}, {(b.size / 1024).toFixed(0)} KB</div>
                            </div>
                            <Button size="small" variant="secondary" disabled={!!busy} onClick={() => restoreSaved(b)}>
                                {busy === b.name ? "Reading…" : "Restore"}
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
