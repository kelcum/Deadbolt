/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, ReporterTestable, StartAt } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

import { type Credential, createCredential, verifyPassword } from "./password";
import { readCredential, writeCredential } from "./storage";

const logger = new Logger("AppLock");
const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show a lock button in the top bar.",
        default: true
    },
    lockOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Ask for your password whenever Discord opens or reloads.",
        default: true
    }
});

let dialog: HTMLDialogElement | undefined;
let running = false;
let generation = 0;

function unlock() {
    generation++;
    const current = dialog;
    dialog = undefined;
    if (!current) return;
    current.close();
    current.remove();
}

function lock(record: Credential) {
    if (!running || dialog) return;
    try {
        if (!globalThis.crypto?.subtle || typeof HTMLDialogElement.prototype.showModal !== "function") return;
        const run = ++generation;
        const screen = document.createElement("dialog");
        screen.className = "db-app-lock";
        screen.setAttribute("aria-labelledby", "db-app-lock-title");
        screen.setAttribute("aria-modal", "true");

        const form = document.createElement("form");
        form.className = "db-app-lock-card";
        const title = document.createElement("h1");
        title.id = "db-app-lock-title";
        title.textContent = "Deadbolt";
        const caption = document.createElement("p");
        caption.textContent = "Enter your AppLock password to continue.";
        const password = document.createElement("input");
        password.type = "password";
        password.placeholder = "Password";
        password.setAttribute("aria-label", "AppLock password");
        password.autocomplete = "off";
        password.maxLength = 128;
        password.required = true;
        password.autofocus = true;
        const button = document.createElement("button");
        button.type = "submit";
        button.textContent = "Unlock";
        const status = document.createElement("p");
        status.className = "db-app-lock-status";
        status.setAttribute("role", "status");

        form.append(title, caption, password, button, status);
        screen.append(form);
        screen.addEventListener("cancel", event => event.preventDefault());
        screen.addEventListener("keydown", event => event.stopPropagation());
        screen.addEventListener("keyup", event => event.stopPropagation());
        let attempts = 0;
        let retryAt = 0;
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (button.disabled || run !== generation) return;
            if (Date.now() < retryAt) {
                status.textContent = "Wait a few seconds before trying again.";
                return;
            }
            const { value } = password;
            password.value = "";
            button.disabled = true;
            status.textContent = "Checking…";
            try {
                const valid = await verifyPassword(value, record);
                if (run !== generation || dialog !== screen) return;
                if (valid) {
                    unlock();
                    return;
                }
                attempts++;
                retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5));
                status.textContent = "Incorrect password. Try again shortly.";
            } catch {
                status.textContent = "Could not check the password. Restart Discord and try again.";
            } finally {
                button.disabled = false;
                if (screen.isConnected) password.focus();
            }
        });
        document.body.append(screen);
        dialog = screen;
        screen.showModal();
        password.focus();
    } catch (error) {
        unlock();
        logger.error("Could not open AppLock", error);
    }
}

function LockIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </svg>;
}

const PasswordSettings = ErrorBoundary.wrap(() => {
    const [configured, setConfigured] = useState(false);
    const [ready, setReady] = useState(false);
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        readCredential().then(record => {
            if (active) {
                setConfigured(Boolean(record));
                setReady(true);
            }
        }).catch(() => {
            if (active) setStatus("Could not read the local password database.");
        });
        return () => { active = false; };
    }, []);

    async function save(remove = false) {
        if (busy || !running || !ready) return;
        if (!remove && (password.length < 8 || password.length > 128 || password !== confirm)) {
            setStatus("Use at least 8 characters and enter matching passwords.");
            return;
        }
        setBusy(true);
        setStatus("");
        const run = generation;
        try {
            const existing = await readCredential();
            if (existing && !await verifyPassword(current, existing)) {
                setStatus("Current password is incorrect.");
                return;
            }
            if (!globalThis.crypto?.subtle) {
                setStatus("Password verification is not supported in this client.");
                return;
            }
            const next = remove ? null : await createCredential(password);
            if (!running || run !== generation) return;
            await writeCredential(next);
            setConfigured(Boolean(next));
            setStatus(next ? "Password saved on this device." : "Password removed.");
            setCurrent("");
            setPassword("");
            setConfirm("");
        } catch {
            setStatus("Could not save the local password.");
        } finally {
            setBusy(false);
        }
    }

    return <div className="db-app-lock-settings">
        <Text size="sm" weight="semibold">{configured ? "Change password" : "Set up AppLock"}</Text>
        <Text size="sm" color="text-muted">Use a separate password, not your Discord password. This is a local screen lock, not account security.</Text>
        {configured && <input type="password" aria-label="Current password" placeholder="Current password" autoComplete="off" maxLength={128} value={current} onChange={e => setCurrent(e.target.value)} />}
        <input type="password" aria-label="New password" placeholder="New password (8+ characters)" autoComplete="new-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
        <input type="password" aria-label="Confirm password" placeholder="Confirm password" autoComplete="new-password" maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} />
        <div className="db-app-lock-actions">
            <Button size="small" disabled={busy || !ready} onClick={() => void save()}>Save password</Button>
            {configured && <Button size="small" variant="secondary" disabled={busy} onClick={() => void manualLock()}>Lock now</Button>}
            {configured && <Button size="small" variant="dangerSecondary" disabled={busy || !current} onClick={() => void save(true)}>Remove password</Button>}
        </div>
        {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        <Text size="xs" color="text-muted">Forgot your password? Disable or uninstall Deadbolt to regain access. Use your device lock for real protection.</Text>
    </div>;
});

async function manualLock() {
    if (!running || dialog) return;
    const run = generation;
    try {
        const record = await readCredential();
        if (!running || run !== generation) return;
        if (!record) {
            showToast({ text: "Set a password in AppLock settings first.", variant: "critical" });
            return;
        }
        lock(record);
        if (!dialog) showToast({ text: "AppLock is unavailable on this client.", variant: "critical" });
    } catch {
        showToast({ text: "Could not read the local password database.", variant: "critical" });
    }
}

function LockButton() {
    const { showButton } = settings.use(["showButton"]);
    if (!showButton) return null;
    return <HeaderBarButton icon={LockIcon} tooltip="Lock Discord" onClick={() => void manualLock()} />;
}

export default definePlugin({
    name: "AppLock",
    description: "Lock Discord with a separate password.",
    authors: [Devs.Zot],
    tags: ["Privacy", "Utility"],
    settings,
    startAt: StartAt.DOMContentLoaded,
    reporterTestable: ReporterTestable.None,
    settingsAboutComponent: PasswordSettings,
    headerBarButton: { icon: LockIcon, render: LockButton },
    toolboxActions: { "Lock Discord": () => void manualLock() },
    start() {
        running = true;
        if (!settings.store.lockOnStartup) return;
        const run = generation;
        void readCredential().then(record => {
            if (record && running && run === generation && settings.store.lockOnStartup) lock(record);
        }).catch(error => logger.error("Could not read AppLock database", error));
    },
    stop() {
        running = false;
        unlock();
    }
});
