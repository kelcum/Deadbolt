/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { SpecialCard } from "@components/settings/SpecialCard";
import { isBadgeHidden, setHiddenBadgeUsers } from "@plugins/_api/badges/hiddenBadges";
import team from "@plugins/_api/badges/team.json";
import { useAwaiter } from "@utils/react";
import { PluginNative } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, UserStore, useState } from "@webpack/common";

import { BadgeDesigner, BadgePreview, cl, renderBadgePng, toHex, useBadgeForm } from "./BadgeDesigner";

const API = "https://api.xan.gripe/v1/badge-requests";
const CARD_COLOR = "#b3abf7";

const CREST = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 15 160 160">
<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f6f9fc"/><stop offset="15%" stop-color="#d4dbe3"/><stop offset="34%" stop-color="#a7b1bd"/><stop offset="49%" stop-color="#757f8b"/><stop offset="51%" stop-color="#6a7480"/><stop offset="66%" stop-color="#b6c0cb"/><stop offset="82%" stop-color="#e9eef4"/><stop offset="100%" stop-color="#c3ccd6"/></linearGradient></defs>
<rect x="4" y="15" width="160" height="160" rx="36" fill="#171A21"/>
<g transform="translate(84,95) scale(1.45)"><path d="M0 -4 L -32 -50" stroke="url(#c)" stroke-width="16" stroke-linecap="round" fill="none"/><path d="M0 -4 L 32 -50" stroke="url(#c)" stroke-width="16" stroke-linecap="round" fill="none"/><rect x="-9" y="-10" width="18" height="60" rx="9" fill="url(#c)"/><rect x="-26" y="26" width="52" height="16" rx="8" fill="url(#c)"/></g>
</svg>`);

const hexagon = (x: number, y: number, r: number, o: number) =>
    `<polygon points="${[0, 1, 2, 3, 4, 5].map(i => {
        const a = Math.PI / 3 * i + Math.PI / 6;
        return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ")}" fill="#fff" fill-opacity="${o}"/>`;

const sparkle = (x: number, y: number, r: number, o: number) =>
    `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff" fill-opacity="${o}"/>`;

const PATTERN = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" preserveAspectRatio="xMidYMid slice">${[
    hexagon(470, 40, 34, 0.22),
    hexagon(610, 150, 46, 0.18),
    hexagon(330, 190, 24, 0.2),
    hexagon(760, 60, 28, 0.2),
    hexagon(120, 200, 30, 0.14),
    sparkle(540, 110, 18, 0.35),
    sparkle(700, 200, 14, 0.3),
    sparkle(380, 70, 12, 0.3),
    sparkle(250, 30, 10, 0.25),
    sparkle(690, 20, 9, 0.3),
    sparkle(30, 120, 11, 0.22),
].join("")}</svg>`);

function BadgeIcon() {
    return (
        <svg className={cl("icon")} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 2 4.5 6.3v8.4L12 19l7.5-4.3V6.3L12 2Zm0 4.2 1.4 2.9 3.2.4-2.3 2.2.6 3.2L12 13.4l-2.9 1.5.6-3.2-2.3-2.2 3.2-.4L12 6.2Z" />
            <path fill="currentColor" d="M8.5 19.6 12 21.6l3.5-2 .9 1.6L12 23.7l-4.4-2.5.9-1.6Z" />
        </svg>
    );
}

function BadgeRequestModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const me = UserStore.getCurrentUser();
    const form = useBadgeForm(me?.id ?? "", me?.username ?? "");
    const { state } = form;
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    const ready = /^\d{17,20}$/.test(state.discordId.trim()) && !!state.name.trim() && !!state.badge.trim() && state.design.colors.length > 0;

    async function submit() {
        setSending(true);
        setError(null);
        try {
            const { colors, ...design } = state.design;
            const preview = await renderBadgePng(state.design, state.image?.url ?? null).catch(() => undefined);
            const res = await fetch(API, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    discordId: state.discordId.trim(),
                    name: state.name.trim(),
                    badge: state.badge.trim(),
                    colors: colors.map(toHex),
                    details: state.details.trim(),
                    image: state.image?.url.replace(/^data:[^,]*,/, ""),
                    design,
                    preview,
                    source: "deadbolt"
                })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}). Try again in a bit.`);
            setSent(true);
        } catch (e) {
            setError(e instanceof TypeError ? "Couldn't reach xan.gripe. Check your connection and try again." : String((e as Error).message ?? e));
        } finally {
            setSending(false);
        }
    }

    if (sent) {
        return (
            <Modal
                {...modalProps}
                title="Request sent"
                subtitle="Thanks for the idea!"
                actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}
            >
                <div className={cl("sent")}>
                    <div className={cl("stage", "stage-dark")}>
                        <BadgePreview design={state.design} image={state.image?.url ?? null} size={96} />
                    </div>
                    <Paragraph>
                        Your design for <b>{state.badge.trim()}</b> went straight to Deadbolt's owner. If it gets made, it shows up on your profile for everyone on Deadbolt after the next update.
                    </Paragraph>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Design a badge"
            subtitle="Put together how you want it to look. It goes straight to Deadbolt's owner, who makes the real thing."
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Send request", variant: "primary", onClick: submit, loading: sending, disabled: !ready || sending }
            ]}
            notice={error ? { message: error, type: "critical" } : undefined}
        >
            <BadgeDesigner form={form} avatar={me?.getAvatarURL?.(void 0, 64, false)} onError={setError} />
        </Modal>
    );
}

export function openBadgeRequestModal() {
    openModal(modalProps => <BadgeRequestModal modalProps={modalProps} />);
}

type VisibilityNative = PluginNative<typeof import("../../../../deadboltplugins/badgeVisibility.desktop/native")>;
const visibility = () => VencordNative.pluginHelpers?.BadgeVisibility as VisibilityNative | undefined;
const BADGE_OWNERS = team.find(b => b.key === "deadbolt_creator")?.users ?? [];

const BadgeVisibilityButton = ErrorBoundary.wrap(({ userId }: { userId: string; }) => {
    const [allowed] = useAwaiter(async () => !!await visibility()?.canToggle().catch(() => false), { fallbackValue: false });
    const [hidden, setHidden] = useState(() => isBadgeHidden(userId));
    const [busy, setBusy] = useState(false);

    if (!allowed) return null;

    async function toggle() {
        setBusy(true);
        try {
            const native = visibility();
            if (!native) throw new Error("fully restart Discord first");
            const users = await native.setHidden(!hidden);
            setHiddenBadgeUsers(users);
            const now = users.includes(userId);
            setHidden(now);
            showToast({ text: now ? "Your Deadbolt badges are hidden for everyone." : "Your Deadbolt badges are showing again.", variant: "success" });
        } catch (e) {
            showToast({ text: `Couldn't change your badges: ${e instanceof Error ? e.message : e}`, variant: "critical" });
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button variant="none" size="medium" type="button" onClick={toggle} disabled={busy} className={cl("button")}>
            {hidden ? "Show my badges" : "Hide my badges"}
        </Button>
    );
}, { noop: true });

export function BadgeRequestCard() {
    const userId = UserStore.getCurrentUser()?.id;
    const owner = !IS_WEB && !!userId && BADGE_OWNERS.includes(userId);

    return (
        <SpecialCard
            title="Custom Badges"
            subtitle="Want a badge of your own?"
            description="Design a profile badge and send it in. If it gets made, everyone on Deadbolt sees it next to your name."
            cardImage={CREST}
            backgroundImage={PATTERN}
            backgroundColor={CARD_COLOR}
        >
            <Button variant="none" size="medium" type="button" onClick={openBadgeRequestModal} className={cl("button")}>
                <BadgeIcon />
                Design a badge
            </Button>
            {owner && <BadgeVisibilityButton userId={userId} />}
        </SpecialCard>
    );
}
