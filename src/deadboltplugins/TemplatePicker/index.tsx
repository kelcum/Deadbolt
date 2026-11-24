/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, SelectedChannelStore, useEffect, UserStore, useState, useStateFromStores } from "@webpack/common";

interface Template { name: string; text: string; }

function PickerIcon() {
    return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" strokeLinecap="round" />
    </svg>;
}

const PickerModal = ErrorBoundary.wrap(({ modalProps, channelId, userId }: { modalProps: RenderModalProps; channelId: string; userId: string; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [entries, setEntries] = useState<Template[] | null>(null);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState("");
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        DataStore.get<Template[]>("zot:MessageTemplates:" + userId).then(data => {
            if (active && UserStore.getCurrentUser()?.id === userId) setEntries(data ?? []);
        }).catch(() => { if (active) setStatus("Could not read saved templates."); });
        return () => { active = false; };
    }, [userId]);
    function insert(text: string) {
        if (UserStore.getCurrentUser()?.id !== userId || SelectedChannelStore.getChannelId() !== channelId) {
            setStatus("Your account or channel changed. Reopen the picker.");
            return;
        }
        modalProps.onClose();
        insertTextIntoChatInputBox(text);
    }
    async function copy(text: string) {
        if (UserStore.getCurrentUser()?.id !== userId) return;
        try { await copyToClipboard(text); setStatus("Copied."); }
        catch { setStatus("Clipboard access failed."); }
    }
    async function save() {
        if (UserStore.getCurrentUser()?.id !== userId || busy) return;
        const title = name.trim();
        if (!/^[a-zA-Z0-9 _-]{1,32}$/.test(title) || !draft.trim() || draft.length > 1500) {
            setStatus("Enter a title (1–32 characters) and a message (1–1500 characters).");
            return;
        }
        setBusy(true);
        try {
            const key = "zot:MessageTemplates:" + userId;
            let saved = false;
            await DataStore.update<Template[]>(key, old => {
                const list = old ?? [];
                if (list.length >= 40 && !list.some(e => e.name === title)) return list;
                saved = true;
                return [...list.filter(e => e.name !== title), { name: title, text: draft }];
            });
            if (UserStore.getCurrentUser()?.id !== userId) return;
            if (!saved) {
                setStatus("Template limit reached.");
                return;
            }
            const list = await DataStore.get<Template[]>(key);
            if (UserStore.getCurrentUser()?.id !== userId) return;
            setEntries(list ?? []);
            setEditing(false);
            setName("");
            setDraft("");
            setQuery("");
            setStatus("Saved.");
        } catch {
            setStatus("Could not save template.");
        } finally {
            setBusy(false);
        }
    }

    const matches = entries?.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) || e.text.toLowerCase().includes(query.toLowerCase()));
    return <Modal {...modalProps} size="md" title="Message templates" subtitle="Save messages you use often. Select Insert to add one to your draft."
        actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div className="zot-template-picker">
            <div className="zot-template-tools">
                <input aria-label="Search templates" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />
                <Button size="small" onClick={() => { setName(""); setDraft(""); setStatus(""); setEditing(true); }}>New template</Button>
            </div>
            {editing && <div className="zot-template-editor">
                <input aria-label="Template name" placeholder="Title" maxLength={32} value={name} onChange={e => setName(e.target.value)} />
                <textarea aria-label="Template message" placeholder="Message to reuse" maxLength={1500} rows={3} value={draft} onChange={e => setDraft(e.target.value)} />
                <div className="zot-template-tools">
                    <Button size="small" disabled={busy} onClick={() => void save()}>Save</Button>
                    <Button size="small" variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                </div>
            </div>}
            <div className="zot-template-list">
                {!entries && <Text size="sm" color="text-muted" className="zot-template-empty">Loading…</Text>}
                {matches?.length === 0 && <Text size="sm" color="text-muted" className="zot-template-empty">{entries?.length ? "No matching templates." : "No templates yet. Create one to get started."}</Text>}
                {matches?.map(e => <div key={e.name} className="zot-template-row">
                    <div className="zot-template-body"><Text size="sm" weight="semibold">{e.name}</Text><Text size="sm" color="text-muted" lineClamp={2}>{e.text}</Text></div>
                    <Button size="xs" onClick={() => insert(e.text)}>Insert</Button>
                    <Button size="xs" variant="secondary" onClick={() => void copy(e.text)}>Copy</Button>
                    <Button size="xs" variant="none" onClick={() => { setName(e.name); setDraft(e.text); setEditing(true); }}>Edit</Button>
                </div>)}
            </div>
            {status && <Text size="xs" color="text-muted" role="status">{status}</Text>}
        </div> : <Text size="sm">Account changed. Reopen the picker.</Text>}
    </Modal>;
});

const PickerButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    if (!isMainChat) return null;
    return <ChatBarButton tooltip="Message templates" onClick={() => {
        const userId = UserStore.getCurrentUser()?.id;
        if (userId) openModal(props => <PickerModal modalProps={props} channelId={channel.id} userId={userId} />);
    }}><PickerIcon /></ChatBarButton>;
};

export default definePlugin({
    name: "TemplatePicker",
    description: "Save and insert messages you use often.",
    authors: [Devs.Zot],
    tags: ["Chat", "Utility"],
    chatBarButton: {
        icon: PickerIcon,
        render: PickerButton
    }
});
