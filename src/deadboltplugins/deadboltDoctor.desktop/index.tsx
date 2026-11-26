/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { showNotice } from "@api/Notices";
import { leaveSafeMode, safeMode, safeModeReason } from "@api/SafeMode";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { relaunch, showItemInFolder } from "@utils/native";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useState } from "@webpack/common";
import { failedPatchPlugins, getBuildNumber } from "@webpack/patcher";

import { PluginMeta } from "~plugins";

import { openRecovery } from "../SafeMode.desktop";
import { openRollback } from "../UpdateRollback.desktop";
import { BackupSection } from "./BackupSection";
import type { Health, Level, VersionState } from "./native";

const Native = VencordNative.pluginHelpers.DeadboltDoctor as PluginNative<typeof import("./native")>;
const cl = classNameFactory("vc-doctor-");
const logger = new Logger("DeadboltDoctor");

const BREAKAGE_URL = "https://api.xan.gripe/v1/breakage";
const BREAKAGE_KEY = "DeadboltDoctor_BreakageReported";

const settings = definePluginSettings({
    breakageAlerts: {
        type: OptionType.BOOLEAN,
        description: "When a Discord update breaks plugins, tell the Deadbolt team so a fix can start right away. Only the plugin names and Discord's build number are sent.",
        default: false
    },
    autoBackup: {
        type: OptionType.BOOLEAN,
        description: "Save a backup of your settings, QuickCSS, themes and userplugins once a day, only when something changed.",
        default: true
    },
    keepBackups: {
        type: OptionType.SLIDER,
        description: "How many automatic backups to keep.",
        markers: [3, 7, 14, 30],
        default: 7,
        disabled: () => !settings.store.autoBackup
    }
});

const STATE_LABEL: Record<VersionState["state"], string> = {
    "injected": "Deadbolt is in",
    "other-patcher": "points at a different Deadbolt build",
    "vanilla": "no Deadbolt, plain Discord",
    "broken": "half patched, Discord may not start from it"
};

interface Row {
    level: Level;
    title: string;
    detail: string;
}

function short(sha: string | null | undefined) {
    return sha ? sha.slice(0, 9) : "unknown";
}

function since(iso: string) {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return "";
    const hours = Math.round((Date.now() - t.getTime()) / 36e5);
    return hours < 1 ? "just now" : hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
}

const ALERT_TEXT: Record<string, string> = {
    "conflict": "Equicord's latest changes conflict with Deadbolt's and need a manual merge",
    "merge": "merging Equicord's latest changes keeps failing",
    "merge-build": "Equicord's latest changes broke the build, so they were rolled back",
    "dirty-tree": "the Deadbolt folder has uncommitted changes, so updates are paused",
    "unpushed": "local commits aren't pushed yet, so updates are paused",
    "push": "pushing to GitHub keeps failing",
    "fetch": "GitHub can't be reached",
    "build": "the last build failed, Discord is on the last one that worked",
    "branding": "re-applying Deadbolt to Discord failed",
    "guard": "the 10-minute guard couldn't re-apply Deadbolt",
    "error": "the updater hit an error"
};

function needsInject(h: Health) {
    return h.versions.some(v => v.state !== "injected" && (v.newest || v.running));
}

function rowsFor(h: Health): Row[] {
    const rows: Row[] = [];

    if (safeMode?.active) {
        rows.push({ level: "bad", title: "Safe mode", detail: safeModeReason() });
    }

    if (h.platform !== "win32") {
        rows.push({ level: "ok", title: "Running with Deadbolt", detail: "Version checks below are Windows only for now." });
    }

    for (const v of h.versions) {
        const tags = [v.running && "running now", v.newest && !v.running && "starts next time"].filter(Boolean).join(", ");
        const level: Level = v.state === "injected" ? "ok" : v.newest || v.running ? "bad" : "warn";
        rows.push({ level, title: `Discord ${v.name.slice(4)}${tags ? ` (${tags})` : ""}`, detail: STATE_LABEL[v.state] });
    }

    if (h.updateInstalling) {
        rows.push({ level: "warn", title: "Discord is downloading an update", detail: "Deadbolt gets added to it as soon as it's unpacked." });
    }

    if (h.built) {
        const match = h.built.sha && h.built.sha === h.built.head;
        rows.push({
            level: match ? "ok" : "warn",
            title: "Build",
            detail: match
                ? `built from ${short(h.built.sha)}, same as your checkout`
                : h.built.sha
                    ? `built from ${short(h.built.sha)}, your checkout is at ${short(h.built.head)}. The updater rebuilds on its next run.`
                    : `your checkout is at ${short(h.built.head)}. The updater records the build on its next run.`
        });
    }

    for (const t of h.tasks ?? []) {
        rows.push({
            level: t.registered ? "ok" : "bad",
            title: t.name,
            detail: t.registered ? "scheduled" : "not registered, Repair everything sets it up again"
        });
    }

    for (const a of h.alerts) {
        rows.push({ level: "warn", title: "Updater", detail: `${ALERT_TEXT[a.key] ?? a.key}${a.since ? ` (for ${since(a.since)})` : ""}` });
    }

    return rows;
}

function HealthPanel() {
    const [health, setHealth] = useState<Health | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [output, setOutput] = useState<string | null>(null);
    const [restart, setRestart] = useState(false);

    function load() {
        Native.getHealth().then(setHealth).catch(e => setOutput(String(e?.message ?? e)));
    }

    useEffect(load, []);

    async function inject() {
        setBusy("inject");
        const { fixed, failed } = await Native.injectAll();
        setBusy(null);
        if (fixed.length) {
            setRestart(true);
            showToast({ text: `Deadbolt added to Discord ${fixed.map(v => v.slice(4)).join(", ")}.`, variant: "success" });
        }
        if (failed.length) setOutput(`Couldn't fix ${failed.join(", ")}. Try Repair everything, or reinstall Deadbolt.`);
        if (!fixed.length && !failed.length) showToast({ text: "Every Discord version already has Deadbolt.", variant: "success" });
        load();
    }

    async function repair() {
        setBusy("repair");
        setOutput("Repairing, this can take a minute if it has to rebuild…");
        const res = await Native.runRepairScript();
        setBusy(null);
        setOutput(res ? res.output || `Finished with code ${res.code}.` : "Repair everything needs a Windows source install.");
        if (res?.code === 0) setRestart(true);
        load();
    }

    async function update() {
        setBusy("update");
        const ok = await Native.startUpdateTask();
        setBusy(null);
        showToast(ok
            ? { text: "Update started in the background. Check the log in a minute.", variant: "success" }
            : { text: "Couldn't start the Deadbolt Auto-Update task.", variant: "critical" });
    }

    if (!health) return <Paragraph>{output ?? "Checking…"}</Paragraph>;

    const rows = rowsFor(health);
    const worst: Level = rows.some(r => r.level === "bad") ? "bad" : rows.some(r => r.level === "warn") ? "warn" : "ok";

    return (
        <div className={cl("panel")}>
            <div className={cl("summary", worst)}>
                {worst === "ok" ? "Everything looks good." : worst === "warn" ? "Working, with something worth a look." : "Deadbolt needs fixing."}
            </div>
            <div className={cl("rows")}>
                {rows.map((r, i) => (
                    <div key={i} className={cl("row")}>
                        <span className={cl("dot", r.level)} />
                        <div>
                            <div className={cl("title")}>{r.title}</div>
                            <div className={cl("detail")}>{r.detail}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div className={cl("actions")}>
                {safeMode?.active && (
                    <Button size="small" variant="primary" onClick={leaveSafeMode}>Turn everything back on</Button>
                )}
                <Button size="small" variant="secondary" onClick={openRecovery}>Safe mode recovery</Button>
                <Button size="small" variant="secondary" onClick={openRollback}>Update rollback</Button>
                {health.versions.length > 0 && (
                    <Button size="small" variant={needsInject(health) ? "primary" : "secondary"} disabled={!!busy} onClick={inject}>
                        {busy === "inject" ? "Injecting…" : "Re-inject now"}
                    </Button>
                )}
                {health.sourceInstall && health.platform === "win32" && (
                    <Button size="small" variant="secondary" disabled={!!busy} onClick={repair}>
                        {busy === "repair" ? "Repairing…" : "Repair everything"}
                    </Button>
                )}
                {health.tasks?.some(t => t.name === "Deadbolt Auto-Update" && t.registered) && (
                    <Button size="small" variant="secondary" disabled={!!busy} onClick={update}>Update now</Button>
                )}
                {health.logPath && (
                    <Button size="small" variant="secondary" onClick={() => showItemInFolder(health.logPath!)}>Open updater log</Button>
                )}
                <Button size="small" variant="secondary" disabled={!!busy} onClick={load}>Check again</Button>
                {restart && <Button size="small" variant="positive" onClick={relaunch}>Restart Discord</Button>}
            </div>
            {output && <pre className={cl("output")}>{output}</pre>}
        </div>
    );
}

function HealthModal({ modalProps }: { modalProps: RenderModalProps; }) {
    return (
        <Modal
            {...modalProps}
            size="md"
            title="Deadbolt health"
            subtitle="Whether Deadbolt survived Discord's updates, and one click to put it back."
            actions={[{ text: "Close", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <HealthPanel />
            <BackupSection />
        </Modal>
    );
}

export function openHealth() {
    openModal(props => <HealthModal modalProps={props} />);
}

let checkTimer: ReturnType<typeof setTimeout> | undefined;
let breakageTimer: ReturnType<typeof setInterval> | undefined;
let backupTimer: ReturnType<typeof setInterval> | undefined;

function autoBackup() {
    if (settings.store.autoBackup) Native.autoBackup(settings.store.keepBackups).catch(e => logger.warn("Couldn't save the automatic backup", e));
}

async function reportBreakage() {
    const build = getBuildNumber();
    const plugins = [...failedPatchPlugins].filter(p => !PluginMeta[p]?.userPlugin).sort();
    if (!settings.store.breakageAlerts || build === -1 || !plugins.length) return;
    const sent = await DataStore.get<{ build: number; plugins: string[]; }>(BREAKAGE_KEY);
    if (sent?.build === build && plugins.every(p => sent.plugins.includes(p))) return;
    const res = await fetch(BREAKAGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ build, plugins })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await DataStore.set(BREAKAGE_KEY, { build, plugins });
}

async function startupCheck() {
    const h = await Native.getHealth().catch(() => null);
    if (!h || h.updateInstalling) return;
    const next = h.versions.find(v => v.newest && !v.running && v.state !== "injected");
    if (!next) return;
    showNotice(`Discord installed ${next.name.slice(4)} without Deadbolt in it, so your next restart would be plain Discord.`, "Fix now", async () => {
        const { fixed } = await Native.injectAll();
        showToast(fixed.length
            ? { text: "Fixed. Deadbolt is in the new Discord version.", variant: "success" }
            : { text: "Couldn't fix it automatically. Open Deadbolt health in DeadboltDoctor's settings.", variant: "critical" });
    });
}

export default definePlugin({
    name: "DeadboltDoctor",
    description: "Shows whether Deadbolt survived Discord's updates and fixes it in one click: re-inject, repair, update, a heads-up when a new Discord version is missing Deadbolt, and daily backups you can restore in one click.",
    tags: ["Utility"],
    authors: [Devs.K3],
    enabledByDefault: true,
    settings,
    dependencies: ["CommandsAPI"],
    settingsAboutComponent: () => <><HealthPanel /><BackupSection /></>,
    toolboxActions: {
        "Deadbolt health"() {
            openHealth();
        }
    },
    commands: [
        {
            name: "deadbolt",
            description: "Check that Deadbolt survived Discord's updates, and fix it in one click.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute() {
                openHealth();
            }
        }
    ],
    start() {
        checkTimer = setTimeout(() => {
            startupCheck();
            autoBackup();
        }, 20_000);
        backupTimer = setInterval(autoBackup, 36e5);
        breakageTimer = setInterval(() => reportBreakage().catch(e => logger.warn("Couldn't send the breakage report", e)), 120_000);
    },
    stop() {
        clearTimeout(checkTimer);
        clearInterval(breakageTimer);
        clearInterval(backupTimer);
    }
});
