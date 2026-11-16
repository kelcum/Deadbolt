/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { isPluginEnabled, pluginRequiresRestart, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { classNameFactory } from "@utils/css";
import { PluginNative } from "@utils/types";
import { Channel, RenderModalProps } from "@vencord/discord-types";
import { Alerts, ChannelStore, DraftType, Modal, openModal, SelectedChannelStore, showToast, UploadHandler, useEffect, useRef, useState } from "@webpack/common";
import type { ChangeEvent, KeyboardEvent } from "react";

import Plugins from "~plugins";

import type { UserPluginInfo } from "./native";

export const Native = VencordNative.pluginHelpers.UserPluginUploader as PluginNative<typeof import("./native")>;

const cl = classNameFactory("vc-plugin-manager-");

type ToggleResult = "live" | "reload" | "failed";

function setStoredEnabled(pluginName: string, enabled: boolean) {
    Settings.plugins[pluginName] = { ...Settings.plugins[pluginName], enabled };
}

export function setPluginEnabled(pluginName: string, enabled: boolean): ToggleResult {
    const plugin = Plugins[pluginName];
    if (!plugin) {
        setStoredEnabled(pluginName, enabled);
        return "reload";
    }

    if (enabled) {
        const { restartNeeded, failures } = startDependenciesRecursive(plugin);
        if (failures.length) return "failed";
        if (restartNeeded) {
            setStoredEnabled(pluginName, true);
            return "reload";
        }
    }

    if (pluginRequiresRestart(plugin)) {
        setStoredEnabled(pluginName, enabled);
        return "reload";
    }

    if (!enabled && !plugin.started) {
        setStoredEnabled(pluginName, false);
        return "live";
    }

    if (!(enabled ? startPlugin(plugin) : stopPlugin(plugin))) {
        setStoredEnabled(pluginName, false);
        return "failed";
    }

    setStoredEnabled(pluginName, enabled);
    return "live";
}

function currentChannel(): Channel | undefined {
    const id = SelectedChannelStore.getChannelId();
    return id ? ChannelStore.getChannel(id) : undefined;
}

export async function sharePlugin(info: UserPluginInfo, channel = currentChannel()) {
    if (!channel) {
        showToast({ text: "Open a chat first, the files go into its message box.", variant: "critical" });
        return false;
    }
    const res = await Native.readUserPluginFiles(info.folder);
    if ("error" in res) {
        showToast({ text: res.error, variant: "critical" });
        return false;
    }
    if (!res.files.length) {
        showToast({ text: `${info.folder} has no text files to share.`, variant: "critical" });
        return false;
    }
    const files = res.files.map(f => new File([f.content], f.name, { type: "text/plain" }));
    await UploadHandler.promptToUpload(files, channel, DraftType.ChannelMessage);
    const extra = res.skipped ? ` (${res.skipped} big or binary file${res.skipped === 1 ? "" : "s"} left out)` : "";
    showToast({ text: `${info.pluginName ?? info.folder} is in your message box${extra}. Press Enter to send it.`, variant: "success" });
    return true;
}

function EditModal({ modalProps, info, onSaved }: { modalProps: RenderModalProps; info: UserPluginInfo; onSaved(pluginName: string): void; }) {
    const [code, setCode] = useState<string | null>(null);
    const [original, setOriginal] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        Native.readUserPlugin(info.folder).then(res => {
            if ("error" in res) return setError(res.error);
            setCode(res.code);
            setOriginal(res.code);
        });
    }, []);

    async function save() {
        if (code === null) return;
        setBusy(true);
        setError(null);
        const res = await Native.saveUserPlugin(info.folder, code);
        setBusy(false);
        if ("error" in res) return setError(res.error);

        const wasEnabled = info.pluginName ? isPluginEnabled(info.pluginName) : true;
        if (info.pluginName && info.pluginName !== res.pluginName) setStoredEnabled(info.pluginName, false);
        setStoredEnabled(res.pluginName, wasEnabled);
        setOriginal(code);
        onSaved(res.pluginName);
        modalProps.onClose();
    }

    function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (code !== null && code !== original && !busy) save();
            return;
        }
        if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        const el = e.currentTarget;
        const { selectionStart: start, selectionEnd: end, value } = el;
        setCode(value.slice(0, start) + "    " + value.slice(end));
        requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 4;
        });
    }

    const changed = code !== null && code !== original;

    return (
        <Modal
            {...modalProps}
            size="xl"
            title={`Edit ${info.pluginName ?? info.folder}`}
            subtitle={`src/userplugins/${info.isFile ? info.entry : `${info.folder}/${info.entry}`}`}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: busy ? "Rebuilding…" : "Save and rebuild", variant: "primary", onClick: save, loading: busy, disabled: !changed || busy }
            ]}
        >
            <div className={cl("editor")}>
                {code === null && !error && <Paragraph>Loading…</Paragraph>}
                {code !== null && (
                    <textarea
                        className={cl("code")}
                        value={code}
                        onChange={e => setCode(e.currentTarget.value)}
                        onKeyDown={onKeyDown}
                        spellCheck={false}
                        disabled={busy}
                    />
                )}
                {error && <pre className={cl("error")}>{error}</pre>}
                <div className={cl("hint")}>Tab indents, Ctrl+S saves. If the build fails, your plugin goes back to how it was.</div>
            </div>
        </Modal>
    );
}

function PluginRow({ info, onChanged, onReloadNeeded, channel }: { info: UserPluginInfo; onChanged(): void; onReloadNeeded(): void; channel?: Channel; }) {
    const [enabled, setEnabled] = useState(() => (info.pluginName ? isPluginEnabled(info.pluginName) : false));
    const [busy, setBusy] = useState<string | null>(null);

    function toggle(on: boolean) {
        if (!info.pluginName) return;
        const result = setPluginEnabled(info.pluginName, on);
        if (result === "failed") {
            showToast({ text: `Couldn't ${on ? "start" : "stop"} ${info.pluginName}.`, variant: "critical" });
            setEnabled(info.pluginName ? isPluginEnabled(info.pluginName) : false);
            return;
        }
        setEnabled(on);
        if (result === "reload") onReloadNeeded();
    }

    function edit() {
        openModal(props => (
            <EditModal
                modalProps={props}
                info={info}
                onSaved={name => {
                    showToast({ text: `${name} saved and rebuilt.`, variant: "success" });
                    onReloadNeeded();
                    onChanged();
                }}
            />
        ));
    }

    function remove() {
        Alerts.show({
            title: `Remove ${info.pluginName ?? info.folder}?`,
            body: "Its folder moves to removed-userplugins in your Deadbolt folder, so you can bring it back from there. Deadbolt rebuilds without it.",
            confirmText: "Remove",
            cancelText: "Cancel",
            onConfirm: async () => {
                setBusy("remove");
                if (info.pluginName && isPluginEnabled(info.pluginName)) setPluginEnabled(info.pluginName, false);
                const res = await Native.removeUserPlugin(info.folder);
                setBusy(null);
                if ("error" in res) {
                    showToast({ text: res.error.split("\n")[0], variant: "critical" });
                    return;
                }
                showToast({ text: `Removed. It's in ${res.movedTo} if you want it back.`, variant: "success" });
                onReloadNeeded();
                onChanged();
            }
        });
    }

    async function share() {
        setBusy("share");
        await sharePlugin(info, channel ?? currentChannel());
        setBusy(null);
    }

    return (
        <div className={cl("row")}>
            <div className={cl("info")}>
                <div className={cl("name")}>{info.pluginName ?? info.folder}</div>
                <div className={cl("meta")}>
                    {info.isFile ? info.entry : info.folder}
                    {info.files.length > 1 && ` · ${info.files.length} files`}
                    {!info.pluginName && " · couldn't read its name, so it can't be switched here"}
                </div>
            </div>
            <div className={cl("actions")}>
                <Button size="small" variant="secondary" onClick={edit} disabled={!!busy}>Edit</Button>
                <Button size="small" variant="secondary" onClick={share} disabled={!!busy}>{busy === "share" ? "Sharing…" : "Share"}</Button>
                <Button size="small" variant="dangerSecondary" onClick={remove} disabled={!!busy}>{busy === "remove" ? "Removing…" : "Remove"}</Button>
                <Switch checked={enabled} onChange={toggle} disabled={!info.pluginName || !!busy} />
            </div>
        </div>
    );
}

export async function addFromCode(folderHint: string, code: string): Promise<string | null> {
    const pluginName = /definePlugin\(\{\s*(["'])?name\1:\s*(["'`])(.+?)\2/.exec(code)?.[3];
    const folder = (pluginName ?? folderHint).replace(/[^\w-]/g, "").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "MyPlugin";
    const res = await Native.addUserPlugin(folder, code, false);
    if ("error" in res) {
        Alerts.show({ title: "Couldn't add that plugin", body: res.error, confirmText: "OK" });
        return null;
    }
    setStoredEnabled(res.pluginName, true);
    return res.pluginName;
}

function PluginManagerModal({ modalProps, channel }: { modalProps: RenderModalProps; channel?: Channel; }) {
    const [plugins, setPlugins] = useState<UserPluginInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reloadNeeded, setReloadNeeded] = useState(false);
    const [adding, setAdding] = useState(false);
    const [filter, setFilter] = useState("");
    const fileInput = useRef<HTMLInputElement>(null);

    function load() {
        Native.listUserPlugins().then(res => {
            if ("error" in res) return setError(res.error);
            setPlugins(res.plugins);
        });
    }

    useEffect(load, []);

    async function onFile(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setAdding(true);
        const name = await addFromCode(file.name.replace(/\.[^.]+$/, ""), await file.text());
        setAdding(false);
        if (!name) return;
        showToast({ text: `${name} added and turned on.`, variant: "success" });
        setReloadNeeded(true);
        load();
    }

    const query = filter.trim().toLowerCase();
    const shown = plugins?.filter(p => !query || (p.pluginName ?? "").toLowerCase().includes(query) || p.folder.toLowerCase().includes(query));

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Your plugins"
            subtitle="Everything in src/userplugins. Switches apply right away when the plugin allows it."
            actions={[
                { text: "Close", variant: "secondary", onClick: modalProps.onClose },
                { text: adding ? "Adding…" : "Add from file", variant: reloadNeeded ? "secondary" : "primary", onClick: () => fileInput.current?.click(), loading: adding, disabled: adding },
                ...(reloadNeeded ? [{ text: "Reload Discord", variant: "primary", onClick: () => location.reload() }] : [])
            ]}
        >
            <div className={cl("body")}>
                <input ref={fileInput} type="file" accept=".ts,.tsx,.js,.jsx,.txt" style={{ display: "none" }} onChange={onFile} />
                {error && <pre className={cl("error")}>{error}</pre>}
                {!error && plugins === null && <Paragraph>Looking through your userplugins…</Paragraph>}
                {plugins && plugins.length > 6 && (
                    <input className={cl("filter")} placeholder="Filter" value={filter} onChange={e => setFilter(e.currentTarget.value)} />
                )}
                {plugins?.length === 0 && <Paragraph>No user plugins yet. Add one from a file, or use /addplugin in any chat.</Paragraph>}
                {shown?.map(p => (
                    <PluginRow
                        key={p.folder}
                        info={p}
                        channel={channel}
                        onChanged={load}
                        onReloadNeeded={() => setReloadNeeded(true)}
                    />
                ))}
            </div>
        </Modal>
    );
}

export function openPluginManager(channel?: Channel) {
    openModal(props => <PluginManagerModal modalProps={props} channel={channel} />);
}
