/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton } from "@api/UserArea";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, ReporterTestable, StartAt } from "@utils/types";
import { useState } from "@webpack/common";

import { createCredential, parseCredential, STORAGE_KEY, verifyPassword } from "./password";

const logger = new Logger("AppLock");
const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show a lock button next to your microphone controls.",
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

function readCredential() {
    return parseCredential(localStorage.getItem(STORAGE_KEY));
}

function unlock() {
    generation++;
    const current = dialog;
    dialog = undefined;
    if (!current) return;
    current.close();
    current.remove();
}

function lock() {
    if (!running || dialog) return;
    try {
        const record = readCredential();
        if (!record || !crypto.subtle || typeof HTMLDialogElement.prototype.showModal !== "function") return;
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
            const value = password.value;
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

function LockIcon({ className }: { className?: string; }) {
    return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </svg>;
}

const PasswordSettings = ErrorBoundary.wrap(() => {
    const [configured, setConfigured] = useState(() => {
        try { return Boolean(readCredential()); }
        catch { return false; }
    });
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);

    async function save(remove = false) {
        if (busy || !running) return;
        if (!remove && (password.length < 8 || password.length > 128 || password !== confirm)) {
            setStatus("Use at least 8 characters and enter matching passwords.");
            return;
        }
        setBusy(true);
        setStatus("");
        const run = generation;
        try {
            const existing = readCredential();
            if (existing && !await verifyPassword(current, existing)) {
                setStatus("Current password is incorrect.");
                return;
            }
            const next = remove ? null : await createCredential(password);
            if (!running || run !== generation) return;
            if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            else localStorage.removeItem(STORAGE_KEY);
            setConfigured(Boolean(next));
            setStatus(next ? "Password saved on this device." : "Password removed.");
            setCurrent("");
            setPassword("");
            setConfirm("");
        } catch {
            setStatus("Password storage is unavailable on this client.");
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
            <Button size="small" disabled={busy} onClick={() => void save()}>Save password</Button>
            {configured && <Button size="small" variant="secondary" disabled={busy} onClick={() => lock()}>Lock now</Button>}
            {configured && <Button size="small" variant="dangerSecondary" disabled={busy || !current} onClick={() => void save(true)}>Remove password</Button>}
        </div>
        {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        <Text size="xs" color="text-muted">Forgot your password? Disable or uninstall Deadbolt to regain access. Use your device lock for real protection.</Text>
    </div>;
});

function LockButton() {
    const { showButton } = settings.use(["showButton"]);
    if (!showButton) return null;
    return <UserAreaButton icon={<LockIcon />} tooltipText="Lock Discord" aria-label="Lock Discord" role="button" onClick={() => lock()} />;
}

export default definePlugin({
    name: "AppLock",
    description: "Lock Discord with a separate password when you open it or click the lock button.",
    authors: [Devs.Zot],
    tags: ["Privacy", "Utility"],
    settings,
    startAt: StartAt.DOMContentLoaded,
    reporterTestable: ReporterTestable.None,
    settingsAboutComponent: PasswordSettings,
    userAreaButton: { icon: LockIcon, render: LockButton },
    toolboxActions: { "Lock Discord": lock },
    start() {
        running = true;
        if (settings.store.lockOnStartup) lock();
    },
    stop() {
        running = false;
        unlock();
    }
});
