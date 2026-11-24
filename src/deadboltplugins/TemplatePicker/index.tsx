/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import ErrorBoundary from "@components/ErrorBoundary";
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
    const matches = entries?.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) || e.text.toLowerCase().includes(query.toLowerCase()));
    return <Modal {...modalProps} size="md" title="Message templates" subtitle="Insert text into your current draft or copy it. Nothing is sent automatically."
        actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account === userId ? <div style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text-normal)" }}>
            <input aria-label="Search templates" placeholder="Search templates" value={query} onChange={e => setQuery(e.target.value)} style={{ padding: 10, borderRadius: 6, color: "var(--text-normal)", background: "var(--background-tertiary)" }} />
            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {!entries && <p>Loading templates…</p>}
                {matches?.length === 0 && <p>No matching templates. Save one using MessageTemplates.</p>}
                {matches?.map(e => <div key={e.name} style={{ padding: 12, borderRadius: 8, background: "var(--background-secondary)", overflowWrap: "anywhere" }}>
                    <strong>{e.name}</strong>
                    <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{e.text}</p>
                    <div style={{ display: "flex", gap: 16 }}>
                        <button type="button" style={{ color: "var(--text-link)", cursor: "pointer" }} onClick={() => insert(e.text)}>Insert into draft</button>
                        <button type="button" style={{ color: "var(--text-link)", cursor: "pointer" }} onClick={() => void copy(e.text)}>Copy</button>
                    </div>
                </div>)}
            </div>
            <div role="status">{status}</div>
        </div> : <p>Account changed. Close and reopen the picker.</p>}
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
    description: "Browse and search saved message templates from the chat bar, then insert or copy them without sending.",
    authors: [Devs.Zot],
    tags: ["Chat", "Utility"],
    chatBarButton: {
        icon: PickerIcon,
        render: PickerButton
    }
});
