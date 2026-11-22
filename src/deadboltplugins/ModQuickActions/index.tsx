/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { getUniqueUsername } from "@utils/discord";
import { isObject } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps, User } from "@vencord/discord-types";
import { Constants, GuildMemberStore, GuildStore, Menu, Modal, openModal, PermissionsBits, PermissionStore, RestAPI, Select, showToast, TextInput, UserStore, useState } from "@webpack/common";
import type { ReactElement } from "react";

const UNITS = { s: [1000, "second"], m: [60_000, "minute"], h: [3_600_000, "hour"], d: [86_400_000, "day"], w: [604_800_000, "week"] } as const;
const MAX_TIMEOUT = 28 * 86_400_000;
const DELETE_OPTIONS = [
    { label: "Don't delete any", value: 0 },
    { label: "Previous hour", value: 3600 },
    { label: "Previous 24 hours", value: 86400 },
    { label: "Previous 7 days", value: 604800 }
];

const settings = definePluginSettings({
    timeouts: {
        type: OptionType.STRING,
        description: "Timeout lengths shown in the menu, separated by commas. Use s, m, h, d or w, up to 28 days.",
        default: "60s, 5m, 10m, 1h, 1d, 1w"
    },
    reasons: {
        type: OptionType.STRING,
        description: "Saved reasons you can pick before acting, one per line.",
        multiline: true,
        default: "Spam\nHarassment\nOff topic\nBreaking the server rules"
    }
});

type Action = { kind: "timeout"; ms: number; label: string; } | { kind: "kick"; } | { kind: "ban"; };

function parseLengths(text: string) {
    return text.split(/[\s,]+/).flatMap(part => {
        const match = /^(\d+)([smhdw])$/i.exec(part);
        if (!match) return [];
        const count = Number(match[1]);
        const [unit, name] = UNITS[match[2].toLowerCase() as keyof typeof UNITS];
        const ms = count * unit;
        return ms > 0 && ms <= MAX_TIMEOUT ? [{ ms, label: `${count} ${name}${count === 1 ? "" : "s"}` }] : [];
    });
}

function errorText(error: unknown) {
    const body = isObject(error) && "body" in error ? error.body : null;
    return isObject(body) && "message" in body && typeof body.message === "string" ? body.message : "Discord refused that action.";
}

function runAction(action: Action, guildId: string, userId: string, reason: string, deleteSeconds: number) {
    const member = Constants.Endpoints.GUILD_MEMBER(guildId, userId);
    const audit = reason || undefined;
    switch (action.kind) {
        case "timeout":
            return RestAPI.patch({ url: member, body: { communication_disabled_until: new Date(Date.now() + action.ms).toISOString() }, reason: audit });
        case "kick":
            return RestAPI.del({ url: member, reason: audit });
        case "ban":
            return RestAPI.put({ url: Constants.Endpoints.GUILD_BAN(guildId, userId), body: { delete_message_seconds: deleteSeconds }, reason: audit });
    }
}

async function removeTimeout(guildId: string, user: User) {
    try {
        await RestAPI.patch({ url: Constants.Endpoints.GUILD_MEMBER(guildId, user.id), body: { communication_disabled_until: null } });
        showToast({ text: `Removed the timeout from ${getUniqueUsername(user)}.`, variant: "success" });
    } catch (error) {
        showToast({ text: errorText(error), variant: "critical" });
    }
}

function ActionModal({ modalProps, action, guildId, user }: { modalProps: RenderModalProps; action: Action; guildId: string; user: User; }) {
    const [reason, setReason] = useState("");
    const [deleteSeconds, setDeleteSeconds] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reasons = settings.store.reasons.split("\n").map(r => r.trim()).filter(Boolean);
    const name = getUniqueUsername(user);

    const text = {
        timeout: { title: `Timeout ${name} for ${action.kind === "timeout" ? action.label : ""}`, confirm: "Timeout", done: `Timed out ${name}.`, about: `${name} won't be able to chat, react or join voice until it ends.` },
        kick: { title: `Kick ${name}`, confirm: "Kick", done: `Kicked ${name}.`, about: `${name} is removed from this server and can join again with an invite.` },
        ban: { title: `Ban ${name}`, confirm: "Ban", done: `Banned ${name}.`, about: `${name} is removed from this server and can't join again until unbanned.` }
    }[action.kind];

    const confirm = async () => {
        setBusy(true);
        try {
            await runAction(action, guildId, user.id, reason.trim(), deleteSeconds);
            modalProps.onClose();
            showToast({ text: text.done, variant: "success" });
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    };

    return (
        <Modal
            {...modalProps}
            title={text.title}
            notice={error ? { message: error, type: "critical" } : undefined}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: text.confirm, variant: "critical-primary", loading: busy, onClick: confirm }
            ]}
        >
            <Paragraph className={Margins.bottom16}>{text.about}</Paragraph>
            <Heading className={Margins.bottom8}>Reason</Heading>
            {reasons.length ? (
                <Select
                    className={Margins.bottom8}
                    placeholder="Pick a saved reason"
                    options={reasons.map(r => ({ label: r, value: r }))}
                    select={setReason}
                    isSelected={r => r === reason}
                    serialize={String}
                />
            ) : null}
            <TextInput value={reason} onChange={setReason} placeholder="Shown in the audit log" maxLength={512} autoFocus />
            {action.kind === "ban" ? (
                <>
                    <Heading className={Margins.top16}>Delete their messages</Heading>
                    <Select
                        className={Margins.top8}
                        options={DELETE_OPTIONS}
                        select={setDeleteSeconds}
                        isSelected={v => v === deleteSeconds}
                        serialize={String}
                    />
                </>
            ) : null}
        </Modal>
    );
}

const patchUserMenu: NavContextMenuPatchCallback = (children, { user, guildId }: { user?: User; guildId?: string; }) => {
    if (!user || !guildId || user.id === UserStore.getCurrentUser().id) return;

    const guild = GuildStore.getGuild(guildId);
    const member = GuildMemberStore.getMember(guildId, user.id);
    const open = (action: Action) => openModal(props => <ActionModal modalProps={props} action={action} guildId={guildId} user={user} />);
    const items: ReactElement[] = [];

    if (member && PermissionStore.canManageUser(PermissionsBits.MODERATE_MEMBERS, user.id, guild)) {
        const lengths = parseLengths(settings.store.timeouts);
        if (lengths.length) items.push(
            <Menu.MenuItem id="vc-modquick-timeout" label="Timeout" key="timeout">
                {lengths.map(l => (
                    <Menu.MenuItem id={`vc-modquick-timeout-${l.ms}`} key={l.ms} label={l.label} action={() => open({ kind: "timeout", ...l })} />
                ))}
            </Menu.MenuItem>
        );
        if (member.communicationDisabledUntil && Date.parse(member.communicationDisabledUntil) > Date.now()) items.push(
            <Menu.MenuItem id="vc-modquick-untimeout" label="Remove Timeout" key="untimeout" action={() => removeTimeout(guildId, user)} />
        );
    }
    if (member && PermissionStore.canManageUser(PermissionsBits.KICK_MEMBERS, user.id, guild)) items.push(
        <Menu.MenuItem id="vc-modquick-kick" label="Kick" key="kick" color="danger" action={() => open({ kind: "kick" })} />
    );
    if (PermissionStore.canManageUser(PermissionsBits.BAN_MEMBERS, user.id, guild)) items.push(
        <Menu.MenuItem id="vc-modquick-ban" label="Ban" key="ban" color="danger" action={() => open({ kind: "ban" })} />
    );

    if (items.length) children.push(
        <Menu.MenuItem id="vc-modquick" label="Quick Mod">{items}</Menu.MenuItem>
    );
};

export default definePlugin({
    name: "ModQuickActions",
    description: "Time out, kick or ban someone from their right click menu with your own timeout lengths and saved reasons.",
    tags: ["Servers", "Utility"],
    authors: [Devs.K3],
    settings,

    contextMenus: {
        "user-context": patchUserMenu
    }
});
