/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./BadgeShare.css";

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { ownsRequestedBadge, RequestedBadgeEntry, requestedEntry } from "@plugins/_api/badges/requestedBadges";
import { classNameFactory } from "@utils/css";
import { useAwaiter } from "@utils/react";
import { humanFriendlyJoin } from "@utils/text";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, OAuth2AuthorizeModal, openModal, showToast, TextArea, UserStore, useState } from "@webpack/common";

import { BadgeName, BadgePreview } from "./BadgeDesigner";

const API = "https://api.xan.gripe/v1/badge-shares";
const AUTH_KEY = "Deadbolt_BadgeShareAuth";
const CLIENT_ID = "1543028384215474206";
const REDIRECT = "https://api.xan.gripe/v1/admin/auth/callback";
const NOTE_MAX = 200;
const WEEK = 7 * 86400000;

const cl = classNameFactory("vc-badge-share-");

type Status = "pending" | "accepted" | "declined" | "expired" | "revoked" | "gone";

interface Share {
    id: string;
    requester: string;
    owner: string;
    badge: string;
    badgeName: string;
    pair: string | null;
    pairName: string | null;
    note: string;
    status: Status;
    created: number;
    decided: number | null;
    delivered: boolean;
}

interface Mine {
    userId: string;
    sent: Share[];
    shared: Share[];
    optedOut: boolean;
}

interface Auth {
    token: string;
    expires: number;
}

const STATUS_TEXT: Record<Status, string> = {
    pending: "Pending",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    revoked: "Stopped sharing",
    gone: "Badge removed"
};

const nameOf = (id: string) => {
    const u = UserStore.getUser(id);
    return u ? u.globalName || u.username : id;
};

export const errorText = (e: unknown) =>
    e instanceof TypeError ? "Couldn't reach xan.gripe. Check your connection and try again." : e instanceof Error ? e.message : String(e);

async function savedToken() {
    const me = UserStore.getCurrentUser()?.id;
    const all = await DataStore.get<Record<string, Auth>>(AUTH_KEY);
    const auth = me ? all?.[me] : undefined;
    return auth && auth.expires > Date.now() + 60_000 ? auth.token : null;
}

async function forgetToken() {
    const me = UserStore.getCurrentUser()?.id;
    if (me) await DataStore.update<Record<string, Auth>>(AUTH_KEY, all => {
        const { [me]: _, ...rest } = all ?? {};
        return rest;
    });
}

async function startSession(location: string) {
    const token = new URLSearchParams(new URL(location).hash.slice(1)).get("access_token");
    if (!token) throw new Error("Discord didn't hand over a login. Try again.");
    const res = await fetch(`${API}/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Linking failed (${res.status}). Try again in a bit.`);
    if (body.userId !== UserStore.getCurrentUser()?.id) throw new Error("That login was for a different account.");
    await DataStore.update<Record<string, Auth>>(AUTH_KEY, all => ({ ...all, [body.userId]: { token: body.token, expires: body.expires } }));
    return body.token as string;
}

function linkAccount() {
    return new Promise<string>((resolve, reject) => {
        let answered = false;
        openModal(props => (
            <OAuth2AuthorizeModal
                {...props}
                scopes={["identify"]}
                responseType="token"
                redirectUri={REDIRECT}
                permissions={0n}
                clientId={CLIENT_ID}
                cancelCompletesFlow={false}
                callback={({ location }: { location: string; }) => {
                    answered = true;
                    startSession(location).then(resolve, reject);
                }}
            />
        ), { onCloseCallback: () => setTimeout(() => answered || reject(new Error("Linking was cancelled.")), 500) });
    });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await savedToken() ?? await linkAccount();
    const res = await fetch(API + path, {
        ...init,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` }
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) await forgetToken();
    if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}). Try again in a bit.`);
    return body;
}

const loadMine = async () => await savedToken() ? api<Mine>("") : null;

function badgesOf(share: Share) {
    return [share.badge, share.pair].map(id => id && requestedEntry(id)).filter((e): e is RequestedBadgeEntry => !!e);
}

function shareFor(mine: Mine | null, entry: RequestedBadgeEntry, ownerId: string) {
    return mine?.sent.find(s => s.owner === ownerId && (s.badge === entry.id || s.pair === entry.id) && s.created > Date.now() - WEEK);
}

function StatusPill({ status }: { status: Status; }) {
    return <span className={cl("status", `status-${status}`)}>{STATUS_TEXT[status]}</span>;
}

function statusLine(share: Share) {
    switch (share.status) {
        case "pending": return "They haven't answered yet. Requests that get no answer expire after 7 days.";
        case "accepted": return "It's on your profile now for everyone on Deadbolt.";
        case "declined": return "They said no this time. You can ask again in a week.";
        case "expired": return "They didn't answer in time.";
        case "revoked": return "They stopped sharing it with you.";
        case "gone": return "That badge isn't published anymore.";
    }
}

function pairOf(entry: RequestedBadgeEntry, ownerId: string) {
    const pair = entry.pair ? requestedEntry(entry.pair) : undefined;
    return pair && ownsRequestedBadge(pair, ownerId) ? pair : undefined;
}

export const shareBadgeDirect = (badge: string, to: string) =>
    api<Share>("/direct", { method: "POST", body: JSON.stringify({ badge, to }) });

export function canRequestBadge(entryId: string, ownerId: string) {
    const me = UserStore.getCurrentUser()?.id;
    const entry = requestedEntry(entryId);
    return !!entry && !!me && me !== ownerId && ownsRequestedBadge(entry, ownerId) && !entry.users.includes(me);
}

function SharePanel({ modalProps, entry, ownerId }: { modalProps: RenderModalProps; entry: RequestedBadgeEntry; ownerId: string; }) {
    const owner = UserStore.getUser(ownerId);
    const parts = [entry, pairOf(entry, ownerId)].filter((e): e is RequestedBadgeEntry => !!e);
    const names = parts.map(p => p.name);
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState<Share | null>(null);
    const [mine, , loading] = useAwaiter(loadMine, { fallbackValue: null, onError: e => setError(errorText(e)) });
    const share = sent ?? shareFor(mine, entry, ownerId);

    async function send() {
        setSending(true);
        setError(null);
        try {
            setSent(await api<Share>("", { method: "POST", body: JSON.stringify({ owner: ownerId, badge: entry.id, note: note.trim() }) }));
        } catch (e) {
            setError(errorText(e));
        } finally {
            setSending(false);
        }
    }

    const actions = share
        ? [{ text: "Close", variant: "primary", onClick: modalProps.onClose }]
        : [
            { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
            { text: "Send request", variant: "primary", onClick: send, loading: sending, disabled: sending || loading }
        ];

    return (
        <Modal
            {...modalProps}
            title={parts.length > 1 ? "Request these badges" : "Request this badge"}
            subtitle={share ? "Here's where your request stands." : "The owner gets your request and decides whether to share it."}
            actions={actions}
            notice={error ? { message: error, type: "critical" } : undefined}
        >
            <div className={cl("panel")}>
                <div className={cl("stage")}>
                    {parts.map(p => <BadgePreview key={p.id} design={p.design} image={p.image} size={parts.length > 1 ? 72 : 96} />)}
                </div>
                <div className={cl("names")}>
                    {parts.map(p => <BadgeName key={p.id} name={p.name} colors={p.design.colors} />)}
                </div>
                {parts.length > 1 && <Paragraph className={cl("hint")}>These are a matching pair, so they're asked for and shared together.</Paragraph>}
                <div className={cl("owner")}>
                    {owner && <img className={cl("avatar")} src={owner.getAvatarURL(void 0, 40, false)} alt="" />}
                    <span>Owned by <b>{owner ? owner.globalName || owner.username : ownerId}</b></span>
                </div>
                {share ? (
                    <div className={cl("result")}>
                        <StatusPill status={share.status} />
                        <Paragraph className={cl("hint")}>{statusLine(share)}</Paragraph>
                        {share.note && <div className={cl("note-shown")}>{share.note}</div>}
                    </div>
                ) : (
                    <div className={cl("compose")}>
                        <span className={cl("label")}>Add a note <span className={cl("optional")}>optional</span></span>
                        <TextArea
                            value={note}
                            onChange={(v: string) => setNote(v.slice(0, NOTE_MAX))}
                            maxLength={NOTE_MAX}
                            rows={3}
                            placeholder={`Say why you'd like ${humanFriendlyJoin(names)}`}
                        />
                        <span className={cl("count")}>{note.length}/{NOTE_MAX}</span>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function openBadgeShareRequest(entryId: string, ownerId: string) {
    const entry = requestedEntry(entryId);
    if (entry) openModal(modalProps => <SharePanel modalProps={modalProps} entry={entry} ownerId={ownerId} />);
}

function MiniBadges({ share }: { share: Share; }) {
    return (
        <span className={cl("mini")}>
            {badgesOf(share).map(e => <BadgePreview key={e.id} design={e.design} image={e.image} size={20} />)}
        </span>
    );
}

export const BadgeShareSection = ErrorBoundary.wrap(() => {
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [mine, error, loading] = useAwaiter(loadMine, { fallbackValue: null, deps: [version] });
    const refresh = () => setVersion(v => v + 1);

    async function link() {
        try {
            await linkAccount();
            refresh();
        } catch (e) {
            showToast({ text: errorText(e), variant: "critical" });
        }
    }

    async function revoke(share: Share) {
        setBusy(share.id);
        try {
            await api(`/${share.id}`, { method: "DELETE" });
            showToast({ text: `Stopped sharing with ${nameOf(share.requester)}.`, variant: "success" });
        } catch (e) {
            showToast({ text: errorText(e), variant: "critical" });
        } finally {
            setBusy(null);
            refresh();
        }
    }

    if (loading && !mine) return null;

    return (
        <div className={cl("section")}>
            <Paragraph className={cl("section-title")}>Badge sharing</Paragraph>
            {!mine ? (
                <>
                    <Paragraph className={cl("section-hint")}>
                        {error ? errorText(error) : "Right-click a custom badge on someone's profile to ask them to share it. Link your Discord account to send requests and see who you share with."}
                    </Paragraph>
                    <Button variant="secondary" size="small" onClick={link}>Link Discord account</Button>
                </>
            ) : (
                <>
                    {!mine.sent.length && !mine.shared.length && (
                        <Paragraph className={cl("section-hint")}>No badge shares yet. Right-click a custom badge on someone's profile to ask them to share it.</Paragraph>
                    )}
                    {mine.sent.length > 0 && (
                        <>
                            <span className={cl("list-title")}>Your requests</span>
                            {mine.sent.map(s => (
                                <div key={s.id} className={cl("row")}>
                                    <MiniBadges share={s} />
                                    <span className={cl("row-text")}><b>{humanFriendlyJoin([s.badgeName, s.pairName].filter((n): n is string => !!n))}</b> from {nameOf(s.owner)}</span>
                                    <StatusPill status={s.status} />
                                </div>
                            ))}
                        </>
                    )}
                    {mine.shared.length > 0 && (
                        <>
                            <span className={cl("list-title")}>Shared by you</span>
                            {mine.shared.map(s => (
                                <div key={s.id} className={cl("row")}>
                                    <MiniBadges share={s} />
                                    <span className={cl("row-text")}><b>{humanFriendlyJoin([s.badgeName, s.pairName].filter((n): n is string => !!n))}</b> with {nameOf(s.requester)}</span>
                                    <Button variant="dangerSecondary" size="small" disabled={busy === s.id} onClick={() => revoke(s)}>Revoke</Button>
                                </div>
                            ))}
                        </>
                    )}
                </>
            )}
        </div>
    );
}, { noop: true });
