/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import { migratePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, NavigationRouter, openModal, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

interface Entry { name: string; text: string; }
interface Task { id: string; text: string; done: boolean; }
interface Bookmark { link: string; folder: string; }
interface Workspace { name: string; link: string; }
interface AttachmentBookmark { id: string; link: string; names: string[]; }
interface Reminder { id: string; text: string; due: number; notified: boolean; }
interface Snapshot {
    notes: Entry[];
    tasks: Task[];
    templates: Entry[];
    pins: Bookmark[];
    workspaces: Workspace[];
    reminders: Reminder[];
    attachments: AttachmentBookmark[];
}
type Tab = keyof Snapshot;
const tabs: { id: Tab; label: string; }[] = [
    { id: "notes", label: "Notes" }, { id: "tasks", label: "Tasks" },
    { id: "templates", label: "Templates" }, { id: "pins", label: "Bookmarks" },
    { id: "workspaces", label: "Workspaces" }, { id: "reminders", label: "Reminders" },
    { id: "attachments", label: "Attachments" }
];

function keyFor(feature: string, userId: string) {
    return "zot:" + feature + ":" + userId;
}

function owns(userId: string) {
    return UserStore.getCurrentUser()?.id === userId;
}

function WorkspaceIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 9v12M13 13h5M13 17h5" strokeLinecap="round" />
    </svg>;
}

function WorkspacePanel({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) {
    const [data, setData] = useState<Snapshot | null>(null);
    const [tab, setTab] = useState<Tab>("notes");
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState("");
    const [draft, setDraft] = useState("");
    const [task, setTask] = useState("");
    const [editing, setEditing] = useState(false);
    const [reminder, setReminder] = useState("");
    const [minutes, setMinutes] = useState("15");
    useEffect(() => {
        let active = true;
        async function load() {
            try {
                const [notes, tasks, templates, pins, workspaces, reminders, attachments] = await Promise.all([
                    DataStore.get<Entry[]>(keyFor("QuickNotes", userId)),
                    DataStore.get<Task[]>(keyFor("PersonalChecklist", userId)),
                    DataStore.get<Entry[]>(keyFor("MessageTemplates", userId)),
                    DataStore.get<Bookmark[]>(keyFor("PersonalPins", userId)),
                    DataStore.get<Workspace[]>(keyFor("WorkspaceProfiles", userId)),
                    DataStore.get<Reminder[]>(keyFor("MessageReminders", userId)),
                    DataStore.get<AttachmentBookmark[]>(keyFor("AttachmentOrganizer", userId))
                ]);
                if (active && owns(userId)) setData({
                    notes: notes ?? [], tasks: tasks ?? [], templates: templates ?? [],
                    pins: pins ?? [], workspaces: workspaces ?? [], reminders: reminders ?? [], attachments: attachments ?? []
                });
            } catch {
                if (active) setStatus("Could not read local workspace data.");
            }
        }
        void load();
        return () => { active = false; };
    }, [userId, revision]);

    async function mutate(action: () => Promise<unknown>, success: string, onSuccess?: () => void) {
        if (!owns(userId) || busy) return;
        setBusy(true);
        setStatus("");
        try {
            await action();
            if (owns(userId)) {
                setStatus(success);
                onSuccess?.();
                setRevision(n => n + 1);
            }
        } catch {
            if (owns(userId)) setStatus("Could not save the change.");
        } finally {
            setBusy(false);
        }
    }

    function saveNote() {
        const title = name.trim();
        if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(title) || !draft.trim() || draft.length > 1500) {
            setStatus("Use a valid 1–32 character name and 1–1500 characters of text.");
            return;
        }
        void mutate(() => DataStore.update<Entry[]>(keyFor("QuickNotes", userId), old => {
            const entries = old ?? [];
            if (entries.length >= 40 && !entries.some(e => e.name === title)) throw new Error("Note limit");
            return [...entries.filter(e => e.name !== title), { name: title, text: draft }];
        }), "Note saved.", () => { setEditing(false); setName(""); setDraft(""); });
    }

    function addTask() {
        const text = task.trim();
        if (!text || text.length > 150) return;
        void mutate(() => DataStore.update<Task[]>(keyFor("PersonalChecklist", userId), old => {
            const entries = old ?? [];
            if (entries.length >= 100) throw new Error("Task limit");
            return [...entries, { id: crypto.randomUUID().slice(0, 12), text, done: false }];
        }), "Task added.", () => setTask(current => current === task ? "" : current));
    }

    function addReminder() {
        const text = reminder.trim();
        const delay = Number(minutes);
        if (!text || text.length > 200 || !Number.isInteger(delay) || delay < 1 || delay > 525600) {
            setStatus("Enter reminder text and a valid number of minutes.");
            return;
        }
        void mutate(() => DataStore.update<Reminder[]>(keyFor("MessageReminders", userId), old => {
            const entries = old ?? [];
            if (entries.length >= 50) throw new Error("Reminder limit");
            return [...entries, { id: crypto.randomUUID().slice(0, 12), text, due: Date.now() + delay * 60_000, notified: false }];
        }), "Reminder saved. Enable MessageReminders to receive alerts.", () => setReminder(current => current === reminder ? "" : current));
    }

    function go(link: string) {
        if (!owns(userId)) return;
        const match = /^https:\/\/discord\.com(\/channels\/(?:@me|\d{17,20})\/\d{17,20}(?:\/\d{17,20})?)\/?$/.exec(link);
        if (!match) {
            setStatus("This saved link is invalid.");
            return;
        }
        modalProps.onClose();
        NavigationRouter.transitionTo(match[1]);
    }

    async function copy(text: string) {
        if (!owns(userId)) return;
        try {
            await copyToClipboard(text);
            if (owns(userId)) setStatus("Copied.");
        } catch {
            if (owns(userId)) setStatus("Clipboard access failed.");
        }
    }

    const matches = (...values: string[]) => values.some(value => value.toLowerCase().includes(query.trim().toLowerCase()));

    return <div className="zot-workspace">
        <div className="zot-workspace-tools">
            <select aria-label="Workspace section" value={tab} onChange={e => {
                setTab(e.target.value as Tab);
                setQuery("");
                setStatus("");
                setEditing(false);
            }}>
                {tabs.map(item => <option key={item.id} value={item.id}>{item.label}{data ? " (" + data[item.id].length + ")" : ""}</option>)}
            </select>
            <input aria-label="Search items" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        {tab === "notes" && !editing && <Button size="small" onClick={() => { setName(""); setDraft(""); setEditing(true); }}>New note</Button>}
        {tab === "notes" && editing && <div className="zot-workspace-editor">
            <input aria-label="Note name" placeholder="Title" maxLength={32} value={name} onChange={e => setName(e.target.value)} />
            <textarea aria-label="Note text" placeholder="Write a note…" maxLength={1500} rows={4} value={draft} onChange={e => setDraft(e.target.value)} />
            <div className="zot-workspace-actions">
                <Button size="small" disabled={busy} onClick={saveNote}>Save</Button>
                <Button size="small" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
            </div>
        </div>}
        {tab === "tasks" && <div className="zot-workspace-tools">
            <input aria-label="New task" placeholder="New task" maxLength={150} value={task} onChange={e => setTask(e.target.value)} />
            <Button size="small" disabled={busy || !task.trim()} onClick={addTask}>Add</Button>
        </div>}
        {tab === "reminders" && <div className="zot-workspace-editor">
            <input aria-label="Reminder" placeholder="Remind me to…" maxLength={200} value={reminder} onChange={e => setReminder(e.target.value)} />
            <div className="zot-workspace-tools">
                <input aria-label="Minutes until reminder" type="number" min={1} max={525600} value={minutes} onChange={e => setMinutes(e.target.value)} />
                <Text size="xs" color="text-muted">minutes</Text>
                <Button size="small" disabled={busy || !reminder.trim()} onClick={addReminder}>Add</Button>
            </div>
        </div>}
        <div className="zot-workspace-list">
            {!data && <Text size="sm" color="text-muted" className="zot-workspace-empty">Loading…</Text>}
            {data && !data[tab].length && <Text size="sm" color="text-muted" className="zot-workspace-empty">No saved items.</Text>}
            {tab === "notes" && data?.notes.filter(e => matches(e.name, e.text)).map(e => <div className="zot-workspace-item" key={e.name}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold">{e.name}</Text><Text size="sm" color="text-muted" lineClamp={2}>{e.text}</Text></div>
                <Button size="xs" variant="secondary" onClick={() => { setName(e.name); setDraft(e.text); setEditing(true); }}>Edit</Button>
                <Button size="xs" variant="secondary" onClick={() => void copy(e.text)}>Copy</Button>
            </div>)}
            {tab === "tasks" && data?.tasks.filter(e => matches(e.text)).map(e => <label className="zot-workspace-item" key={e.id}>
                <input type="checkbox" disabled={busy} checked={e.done} onChange={() => void mutate(() => DataStore.update<Task[]>(keyFor("PersonalChecklist", userId), old => (old ?? []).map(t => t.id === e.id ? { ...t, done: !t.done } : t)), "Task updated.")} />
                <Text tag="span" size="sm" color={e.done ? "text-muted" : "text-default"} className={e.done ? "zot-workspace-done" : undefined}>{e.text}</Text>
            </label>)}
            {tab === "templates" && data?.templates.filter(e => matches(e.name, e.text)).map(e => <div className="zot-workspace-item" key={e.name}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold">{e.name}</Text><Text size="sm" color="text-muted" lineClamp={2}>{e.text}</Text></div>
                <Button size="xs" variant="secondary" onClick={() => void copy(e.text)}>Copy</Button>
            </div>)}
            {tab === "pins" && data?.pins.filter(e => matches(e.folder, e.link)).map(e => <div className="zot-workspace-item" key={e.link}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold">{e.folder || "Bookmark"}</Text><Text size="xs" color="text-muted" lineClamp={1}>{e.link}</Text></div>
                <Button size="xs" variant="secondary" onClick={() => go(e.link)}>Open</Button>
            </div>)}
            {tab === "workspaces" && data?.workspaces.filter(e => matches(e.name, e.link)).map(e => <div className="zot-workspace-item" key={e.name}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold">{e.name}</Text></div><Button size="xs" variant="secondary" onClick={() => go(e.link)}>Open</Button>
            </div>)}
            {tab === "attachments" && data?.attachments.filter(e => matches(...e.names, e.link)).map(e => <div className="zot-workspace-item" key={e.id}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold" lineClamp={2}>{e.names.join(", ")}</Text><Text size="xs" color="text-muted">{e.names.length} attachment(s)</Text></div>
                <Button size="xs" variant="secondary" onClick={() => go(e.link)}>Open</Button>
            </div>)}
            {tab === "reminders" && data?.reminders.filter(e => matches(e.text)).map(e => <div className="zot-workspace-item" key={e.id}>
                <div className="zot-workspace-body"><Text size="sm" weight="semibold">{e.text}</Text><Text size="xs" color="text-muted">{new Date(e.due).toLocaleString()} · {e.notified ? "Notified" : "Pending"}</Text></div>
            </div>)}
        </div>
        {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        <div className="zot-workspace-footer"><Button size="xs" variant="none" onClick={() => setRevision(n => n + 1)}>Refresh</Button></div>
    </div>;
}

const WorkspaceModal = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    return <Modal {...modalProps} size="md" title="Workspace"
        actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {userId ? <WorkspacePanel key={userId} userId={userId} modalProps={modalProps} /> : <p>Sign in to use your workspace.</p>}
    </Modal>;
});

migratePluginSettings("Workspace", "ZotWorkspace");

export default definePlugin({
    name: "Workspace",
    description: "Manage notes, tasks, templates, bookmarks and reminders.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    headerBarButton: {
        icon: WorkspaceIcon,
        render: () => <HeaderBarButton icon={WorkspaceIcon} tooltip="Workspace" onClick={() => openModal(props => <WorkspaceModal modalProps={props} />)} />
    }
});
