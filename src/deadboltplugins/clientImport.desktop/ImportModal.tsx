/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { PlainSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { pluralize } from "@utils/misc";
import { relaunch } from "@utils/native";
import { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

import Plugins from "~plugins";

import type { ImportSource } from "./native";

export const Native = VencordNative.pluginHelpers.ClientImport as PluginNative<typeof import("./native")>;

const cl = classNameFactory("vc-client-import-");

interface ImportOptions {
    plugins: boolean;
    themes: boolean;
    quickCss: boolean;
}

interface ImportResult {
    plugins: number;
    enabled: number;
    missing: string[];
    themesCopied: number;
    themesSkipped: number;
    themeLinks: number;
    quickCss: boolean;
    backup: string | null;
}

const UNSAFE_KEYS = ["__proto__", "constructor", "prototype"];

function isSafe(obj: unknown): boolean {
    if (obj == null || typeof obj !== "object") return true;
    return Object.keys(obj).every(k => !UNSAFE_KEYS.includes(k) && isSafe((obj as any)[k]));
}

function mergeInto(target: any, source: any) {
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
            mergeInto(target[key], value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

function union(current: unknown, incoming: unknown) {
    const now = Array.isArray(current) ? current.filter(x => typeof x === "string") : [];
    const add = Array.isArray(incoming) ? incoming.filter(x => typeof x === "string" && !now.includes(x)) : [];
    return { list: [...now, ...add], added: add.length };
}

export async function runImport(source: ImportSource, opts: ImportOptions): Promise<ImportResult> {
    const data = await Native.readSource(source.id);
    const { settings } = data;
    if (settings && !isSafe(settings)) throw new Error(`${source.name}'s settings file looks broken, so nothing was imported.`);

    const result: ImportResult = { plugins: 0, enabled: 0, missing: [], themesCopied: 0, themesSkipped: 0, themeLinks: 0, quickCss: false, backup: null };

    if (opts.plugins && settings?.plugins && typeof settings.plugins === "object") {
        for (const [name, cfg] of Object.entries<any>(settings.plugins)) {
            if (!cfg || typeof cfg !== "object") continue;
            const plugin = Plugins[name];
            if (!plugin) {
                if (cfg.enabled) result.missing.push(name);
                continue;
            }
            const merged = mergeInto(PlainSettings.plugins[name] ??= { enabled: false }, cfg);
            if (plugin.required) merged.enabled = true;
            result.plugins++;
            if (merged.enabled) result.enabled++;
        }
    }

    if (opts.themes) {
        if (settings) {
            const links = union(PlainSettings.themeLinks, settings.themeLinks);
            PlainSettings.themeLinks = links.list;
            PlainSettings.enabledThemes = union(PlainSettings.enabledThemes, settings.enabledThemes).list;
            result.themeLinks = links.added;
        }
        const { copied, skipped } = await Native.copyThemes(source.id);
        result.themesCopied = copied.length;
        result.themesSkipped = skipped.length;
    }

    if (opts.quickCss && data.quickCss.trim()) {
        const current = await VencordNative.quickCss.get();
        if (current.trim() && current.trim() !== data.quickCss.trim()) result.backup = await Native.backupQuickCss(current);
        await VencordNative.quickCss.set(data.quickCss);
        PlainSettings.useQuickCss = true;
        result.quickCss = true;
    }

    await VencordNative.settings.set(PlainSettings);
    return result;
}

function describe(s: ImportSource) {
    if (s.themesOnly) return pluralize(s.themeFiles, "theme");
    const parts: string[] = [];
    if (s.enabledPlugins) parts.push(`${pluralize(s.enabledPlugins, "plugin")} on`);
    if (s.themeFiles || s.themeLinks) parts.push(pluralize(s.themeFiles + s.themeLinks, "theme"));
    if (s.quickCss) parts.push("QuickCSS");
    return parts.join(" · ");
}

function SourceList({ sources, selected, onSelect }: { sources: ImportSource[]; selected: string | null; onSelect(id: string): void; }) {
    return (
        <div className={cl("sources")} role="radiogroup" aria-label="Client mods found on this computer">
            {sources.map(s => (
                <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={s.id === selected}
                    className={cl("source", s.id === selected && "source-on")}
                    onClick={() => onSelect(s.id)}
                >
                    <span className={cl("radio")} />
                    <span className={cl("source-text")}>
                        <span className={cl("source-name")}>{s.name}</span>
                        <span className={cl("source-meta")}>
                            {describe(s)}
                            {s.lastUsed > 0 && ` · last changed ${new Date(s.lastUsed).toLocaleDateString()}`}
                        </span>
                        <span className={cl("source-path")}>{s.dir}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

function ResultView({ result, sourceName }: { result: ImportResult; sourceName: string; }) {
    const lines: string[] = [];
    if (result.plugins) lines.push(`${pluralize(result.plugins, "plugin")} set up the way you had them in ${sourceName} (${result.enabled} on).`);
    if (result.themesCopied || result.themeLinks) lines.push(`${pluralize(result.themesCopied + result.themeLinks, "theme")} added.`);
    if (result.themesSkipped) lines.push(`${pluralize(result.themesSkipped, "theme")} skipped because Deadbolt already has a file with the same name.`);
    if (result.quickCss) lines.push(result.backup ? "Your QuickCSS came over. Your old Deadbolt QuickCSS was saved next to it as a backup." : "Your QuickCSS came over.");
    if (!lines.length) lines.push("There was nothing new to bring over.");
    return (
        <div className={cl("result")}>
            <ul className={cl("result-list")}>
                {lines.map(l => <li key={l}>{l}</li>)}
            </ul>
            {result.missing.length > 0 && (
                <Paragraph className={cl("missing")}>
                    {pluralize(result.missing.length, "plugin")} you had on {result.missing.length === 1 ? "isn't" : "aren't"} in Deadbolt: {result.missing.slice(0, 12).join(", ")}{result.missing.length > 12 ? "…" : ""}
                </Paragraph>
            )}
            <Paragraph>Restart Discord to finish. Plugins only switch on after a restart.</Paragraph>
        </div>
    );
}

function ImportModal({ modalProps, initial, firstRun }: { modalProps: RenderModalProps; initial?: ImportSource[]; firstRun: boolean; }) {
    const [sources, setSources] = useState<ImportSource[] | null>(initial ?? null);
    const [selected, setSelected] = useState<string | null>(initial?.[0]?.id ?? null);
    const [opts, setOpts] = useState<ImportOptions>({ plugins: true, themes: true, quickCss: true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);

    useEffect(() => {
        if (sources) return;
        Native.findSources()
            .then(found => {
                setSources(found);
                setSelected(found[0]?.id ?? null);
            })
            .catch(e => {
                setSources([]);
                setError(String(e?.message ?? e));
            });
    }, []);

    const source = sources?.find(s => s.id === selected);
    const can = {
        plugins: !!source && !source.themesOnly && source.enabledPlugins > 0,
        themes: !!source && (source.themeFiles > 0 || source.themeLinks > 0),
        quickCss: !!source && source.quickCss,
    };
    const chosen = (Object.keys(can) as (keyof ImportOptions)[]).some(k => can[k] && opts[k]);

    async function start() {
        if (!source) return;
        setBusy(true);
        setError(null);
        try {
            setResult(await runImport(source, {
                plugins: can.plugins && opts.plugins,
                themes: can.themes && opts.themes,
                quickCss: can.quickCss && opts.quickCss,
            }));
        } catch (e: any) {
            setError(String(e?.message ?? e));
        } finally {
            setBusy(false);
        }
    }

    if (result && source) {
        return (
            <Modal
                {...modalProps}
                title="All moved over"
                subtitle={`Your ${source.name} setup is in Deadbolt now.`}
                actions={[
                    { text: "Later", variant: "secondary", onClick: modalProps.onClose },
                    { text: "Restart now", variant: "primary", onClick: relaunch },
                ]}
            >
                <ResultView result={result} sourceName={source.name} />
            </Modal>
        );
    }

    return (
        <Modal
            {...modalProps}
            title={firstRun ? "Bring over your old setup?" : "Import from another client mod"}
            subtitle="Moves your plugins and their settings, your themes and your QuickCSS into Deadbolt. Nothing in the other client gets changed."
            actions={[
                { text: firstRun ? "Not now" : "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Import", variant: "primary", onClick: start, loading: busy, disabled: busy || !source || !chosen },
            ]}
            notice={error ? { message: error, type: "critical" } : undefined}
        >
            {sources === null && <Paragraph>Looking for Vencord, Equicord, Vesktop, Equibop and BetterDiscord…</Paragraph>}
            {sources?.length === 0 && (
                <Paragraph>
                    Couldn't find Vencord, Equicord, Vesktop, Equibop or BetterDiscord on this computer. If you have a settings backup file instead, import it from Backup &amp; Restore.
                </Paragraph>
            )}
            {sources && sources.length > 0 && (
                <div className={cl("body")}>
                    {firstRun && <Paragraph>Found {sources.length === 1 ? `${sources[0].name} on this computer` : "other client mods on this computer"}. Pick the one you want to bring over.</Paragraph>}
                    <SourceList sources={sources} selected={selected} onSelect={setSelected} />
                    {source?.themesOnly && (
                        <Paragraph className={cl("note")}>BetterDiscord plugins don't work in Deadbolt, so only its themes come over. Many popular BetterDiscord plugins have a Deadbolt version you can switch on in Plugins.</Paragraph>
                    )}
                    <div className={cl("options")}>
                        <FormSwitch
                            title="Plugins and their settings"
                            description={can.plugins ? "Turns on the plugins you had on, with the same settings." : "Nothing to bring over here."}
                            value={can.plugins && opts.plugins}
                            disabled={!can.plugins}
                            onChange={v => setOpts({ ...opts, plugins: v })}
                        />
                        <FormSwitch
                            title="Themes"
                            description={can.themes ? "Copies your theme files and online theme links." : "Nothing to bring over here."}
                            value={can.themes && opts.themes}
                            disabled={!can.themes}
                            onChange={v => setOpts({ ...opts, themes: v })}
                        />
                        <FormSwitch
                            title="QuickCSS"
                            description={can.quickCss ? "Replaces Deadbolt's QuickCSS with yours. The current one is saved as a backup first." : "Nothing to bring over here."}
                            value={can.quickCss && opts.quickCss}
                            disabled={!can.quickCss}
                            onChange={v => setOpts({ ...opts, quickCss: v })}
                            hideBorder
                        />
                    </div>
                </div>
            )}
        </Modal>
    );
}

export function openImportModal(initial?: ImportSource[], firstRun = false) {
    openModal(modalProps => <ImportModal modalProps={modalProps} initial={initial} firstRun={firstRun} />);
}
