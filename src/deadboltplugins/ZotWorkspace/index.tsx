/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { HeaderBarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, NavigationRouter, openModal, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

interface Entry { name: string; text: string; }
interface Task { id: string; text: string; done: boolean; }
interface Bookmark { link: string; folder: string; }
interface Workspace { name: string; link: string; }
interface Reminder { id: string; text: string; due: number; notified: boolean; }
interface Snapshot {
    notes: Entry[];
    tasks: Task[];
    templates: Entry[];
    pins: Bookmark[];
    workspaces: Workspace[];
    reminders: Reminder[];
}
type Tab = keyof Snapshot;
const tabs: { id: Tab; label: string; }[] = [
    { id: "notes", label: "Notes" }, { id: "tasks", label: "Tasks" },
    { id: "templates", label: "Templates" }, { id: "pins", label: "Bookmarks" },
    { id: "workspaces", label: "Workspaces" }, { id: "reminders", label: "Reminders" }
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
    useEffect(() => {
        let active = true;
        async function load() {
            try {
                const [notes, tasks, templates, pins, workspaces, reminders] = await Promise.all([
                    DataStore.get<Entry[]>(keyFor("QuickNotes", userId)),
                    DataStore.get<Task[]>(keyFor("PersonalChecklist", userId)),
                    DataStore.get<Entry[]>(keyFor("MessageTemplates", userId)),
                    DataStore.get<Bookmark[]>(keyFor("PersonalPins", userId)),
                    DataStore.get<Workspace[]>(keyFor("WorkspaceProfiles", userId)),
                    DataStore.get<Reminder[]>(keyFor("MessageReminders", userId))
                ]);
                if (active && owns(userId)) setData({
                    notes: notes ?? [], tasks: tasks ?? [], templates: templates ?? [],
                    pins: pins ?? [], workspaces: workspaces ?? [], reminders: reminders ?? []
                });
            } catch {
                if (active) setStatus("Could not read local workspace data.");
            }
        }
        void load();
        return () => { active = false; };
    }, [userId, revision]);

    async function mutate(action: () => Promise<unknown>, success: string) {
        if (!owns(userId) || busy) return;
        setBusy(true);
        setStatus("");
        try {
            await action();
            if (owns(userId)) {
                setStatus(success);
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
        }), "Note saved.");
    }

    function addTask() {
        const text = task.trim();
        if (!text || text.length > 150) return;
        void mutate(() => DataStore.update<Task[]>(keyFor("PersonalChecklist", userId), old => {
            const entries = old ?? [];
            if (entries.length >= 100) throw new Error("Task limit");
            return [...entries, { id: crypto.randomUUID().slice(0, 12), text, done: false }];
        }), "Task added.");
        setTask("");
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
        <div className="zot-workspace-tabs" aria-label="Workspace sections">
            {tabs.map(item => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setQuery(""); setStatus(""); }}>
                {item.label} {data ? "(" + data[item.id].length + ")" : ""}
            </button>)}
        </div>
        <div className="zot-workspace-tools">
            <input aria-label="Filter workspace items" placeholder="Search this section" value={query} onChange={e => setQuery(e.target.value)} />
            <button type="button" onClick={() => setRevision(n => n + 1)}>Refresh</button>
        </div>
        {tab === "notes" && <div className="zot-workspace-editor">
            <input aria-label="Note name" placeholder="Note name" maxLength={32} value={name} onChange={e => setName(e.target.value)} />
            <textarea aria-label="Note text" placeholder="Write a note..." maxLength={1500} rows={4} value={draft} onChange={e => setDraft(e.target.value)} />
            <button type="button" disabled={busy} onClick={saveNote}>Save note</button>
        </div>}
        {tab === "tasks" && <div className="zot-workspace-tools">
            <input aria-label="New task" placeholder="New task" maxLength={150} value={task} onChange={e => setTask(e.target.value)} />
            <button type="button" disabled={busy || !task.trim()} onClick={addTask}>Add</button>
        </div>}
        <div className="zot-workspace-list">
            {!data && <p>Loading local workspace…</p>}
            {data && !data[tab].length && <p>No saved items in this section.</p>}
            {tab === "notes" && data?.notes.filter(e => matches(e.name, e.text)).map(e => <div className="zot-workspace-item" key={e.name}>
                <strong>{e.name}</strong><div className="zot-workspace-preview">{e.text}</div>
                <div className="zot-workspace-tools"><button type="button" onClick={() => { setName(e.name); setDraft(e.text); }}>Edit</button><button type="button" onClick={() => void copy(e.text)}>Copy</button></div>
            </div>)}
            {tab === "tasks" && data?.tasks.filter(e => matches(e.text)).map(e => <label className="zot-workspace-item zot-workspace-check" key={e.id}>
                <input type="checkbox" disabled={busy} checked={e.done} onChange={() => void mutate(() => DataStore.update<Task[]>(keyFor("PersonalChecklist", userId), old => (old ?? []).map(t => t.id === e.id ? { ...t, done: !t.done } : t)), "Task updated.")} />
                <span>{e.text}</span>
            </label>)}
            {tab === "templates" && data?.templates.filter(e => matches(e.name, e.text)).map(e => <div className="zot-workspace-item" key={e.name}>
                <strong>{e.name}</strong><div className="zot-workspace-preview">{e.text}</div><button type="button" onClick={() => void copy(e.text)}>Copy template</button>
            </div>)}
            {tab === "pins" && data?.pins.filter(e => matches(e.folder, e.link)).map(e => <div className="zot-workspace-item" key={e.link}>
                <strong>{e.folder}</strong><div>{e.link}</div><button type="button" onClick={() => go(e.link)}>Open message</button>
            </div>)}
            {tab === "workspaces" && data?.workspaces.filter(e => matches(e.name, e.link)).map(e => <div className="zot-workspace-item" key={e.name}>
                <strong>{e.name}</strong><button type="button" onClick={() => go(e.link)}>Open channel</button>
            </div>)}
            {tab === "reminders" && data?.reminders.filter(e => matches(e.text)).map(e => <div className="zot-workspace-item" key={e.id}>
                <strong>{e.text}</strong><div>{new Date(e.due).toLocaleString()} · {e.notified ? "Notified" : "Pending"}</div>
            </div>)}
        </div>
        <div role="status" className="zot-workspace-status">{status}</div>
    </div>;
}

const WorkspaceModal = ErrorBoundary.wrap(({ modalProps }: { modalProps: RenderModalProps; }) => {
    const userId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    return <Modal {...modalProps} size="md" title="Deadbolt Workspace" subtitle="Your local notes, tasks, templates, bookmarks and reminders."
        actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {userId ? <WorkspacePanel key={userId} userId={userId} modalProps={modalProps} /> : <p>Sign in to use your workspace.</p>}
    </Modal>;
});

export default definePlugin({
    name: "ZotWorkspace",
    description: "Adds a workspace dashboard for your existing Zot notes, checklists, templates, bookmarks and reminders.",
    authors: [Devs.Zot],
    tags: ["Organisation", "Utility"],
    headerBarButton: {
        icon: WorkspaceIcon,
        render: () => <HeaderBarButton icon={WorkspaceIcon} tooltip="Deadbolt Workspace" onClick={() => openModal(props => <WorkspaceModal modalProps={props} />)} />
    }
});
