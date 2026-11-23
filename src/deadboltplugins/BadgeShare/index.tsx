/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BadgeUserArgs, ProfileBadge } from "@api/Badges";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { canRequestBadge, errorText, openBadgeShareRequest, shareBadgeDirect } from "@components/settings/tabs/vencord/BadgeShare";
import { loadRequestedBadges, ownedRequestedEntries, RequestedBadgeEntry, requestedEntries, requestedEntry } from "@plugins/_api/badges/requestedBadges";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { Alerts, Menu, showToast, UserStore } from "@webpack/common";

const badgeMenu: NavContextMenuPatchCallback = (children, { badge }: { badge: ProfileBadge & BadgeUserArgs; }) => {
    const id = (badge?.id ?? badge?.key)?.match(/^requested_([0-9a-f]{16})$/)?.[1];
    if (!id || !canRequestBadge(id, badge.userId)) return;
    const pair = requestedEntry(id)?.pair;
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-badge-share-request"
            label={pair && canRequestBadge(pair, badge.userId) ? "Request this badge pair" : "Request this badge"}
            action={() => openBadgeShareRequest(id, badge.userId)}
        />
    );
};

function confirmShare(group: RequestedBadgeEntry[], user: User) {
    Alerts.show({
        title: "Share this badge?",
        body: `${user.globalName || user.username} gets ${groupName(group)} on their profile for everyone on Deadbolt. You can stop sharing any time from the Your badges card.`,
        confirmText: "Share",
        cancelText: "Cancel",
        async onConfirm() {
            try {
                await shareBadgeDirect(group[0].id, user.id);
                showToast({ text: `Shared ${groupName(group)}.`, variant: "success" });
                loadRequestedBadges();
            } catch (e) {
                showToast({ text: errorText(e), variant: "critical" });
            }
        }
    });
}

const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
    const me = UserStore.getCurrentUser()?.id;
    const giveable = me && me !== user.id ? badgeGroups(ownedRequestedEntries(me)).filter(g => !g[0].users.includes(user.id)) : [];
    if (giveable.length) {
        children.push(
            <Menu.MenuItem id="vc-badge-share-give" label="Share a badge">
                {giveable.map(g => (
                    <Menu.MenuItem key={g[0].id} id={`vc-badge-share-give-${g[0].id}`} label={groupName(g)} action={() => confirmShare(g, user)} />
                ))}
            </Menu.MenuItem>
        );
    }
    const seen = new Set<string>();
    const options = ownedRequestedEntries(user.id).filter(e => {
        if (seen.has(e.id) || !canRequestBadge(e.id, user.id)) return false;
        seen.add(e.id);
        if (e.pair && canRequestBadge(e.pair, user.id)) seen.add(e.pair);
        return true;
    });
    if (!options.length) return;
    children.push(
        <Menu.MenuItem id="vc-badge-share-user" label="Request a badge">
            {options.map(e => {
                const pair = e.pair && seen.has(e.pair) ? requestedEntry(e.pair) : undefined;
                return (
                    <Menu.MenuItem
                        key={e.id}
                        id={`vc-badge-share-${e.id}`}
                        label={pair ? `${e.name} + ${pair.name}` : e.name}
                        action={() => openBadgeShareRequest(e.id, user.id)}
                    />
                );
            })}
        </Menu.MenuItem>
    );
};

function badgeGroups(entries: RequestedBadgeEntry[]) {
    const ids = new Set(entries.map(e => e.id));
    const seen = new Set<string>();
    const groups: RequestedBadgeEntry[][] = [];
    for (const e of entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        const pair = e.pair && ids.has(e.pair) ? requestedEntry(e.pair) : undefined;
        if (pair) seen.add(pair.id);
        groups.push(pair ? [e, pair] : [e]);
    }
    return groups;
}

const groupName = (group: RequestedBadgeEntry[]) => group.map(e => e.name).join(" + ");

export default definePlugin({
    name: "BadgeShare",
    description: "Share your custom Deadbolt badges with /sharebadge or by right-clicking someone, and ask others for theirs by right-clicking their badge.",
    authors: [Devs.K3],
    tags: ["Appearance"],
    enabledByDefault: true,
    commands: [
        {
            name: "sharebadge",
            description: "Share one of your custom Deadbolt badges with someone.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "badge", description: "The name of your badge", type: ApplicationCommandOptionType.STRING, required: true },
                { name: "user", description: "Who gets it", type: ApplicationCommandOptionType.USER, required: true }
            ],
            async execute(args, ctx) {
                const name = findOption(args, "badge", "").trim().toLowerCase();
                const to: string = findOption(args, "user", "");
                const groups = badgeGroups(ownedRequestedEntries(UserStore.getCurrentUser().id));
                const group = groups.find(g => g.some(e => e.name.toLowerCase() === name)) ?? groups.find(g => g.some(e => e.name.toLowerCase().includes(name)));
                if (!group) {
                    sendBotMessage(ctx.channel.id, {
                        content: groups.length
                            ? `You don't have a badge called "${name}". Yours are: ${groups.map(g => `**${groupName(g)}**`).join(", ")}.`
                            : "You don't have any custom badges to share yet."
                    });
                    return;
                }
                try {
                    await shareBadgeDirect(group[0].id, to);
                    sendBotMessage(ctx.channel.id, {
                        content: `Shared **${groupName(group)}** with <@${to}>. It shows up for everyone on Deadbolt within a few minutes. You can stop sharing from the Your badges card in Deadbolt's settings.`
                    });
                    loadRequestedBadges();
                } catch (e) {
                    sendBotMessage(ctx.channel.id, { content: `Couldn't share **${groupName(group)}**: ${errorText(e)}` });
                }
            }
        },
        {
            name: "mybadges",
            description: "List your custom Deadbolt badges and who you share them with.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                const me = UserStore.getCurrentUser().id;
                const owned = badgeGroups(ownedRequestedEntries(me)).map(g => {
                    const shared = g[0].shared?.filter(u => g[0].users.includes(u)) ?? [];
                    return `- **${groupName(g)}**${shared.length ? ` · shared with ${shared.map(u => `<@${u}>`).join(", ")}` : ""}`;
                });
                const received = badgeGroups(requestedEntries().filter(e => e.shared?.includes(me) && e.users.includes(me))).map(g => {
                    const owner = g[0].users.find(u => !g[0].shared?.includes(u));
                    return `- **${groupName(g)}**${owner ? ` · from <@${owner}>` : ""}`;
                });
                const parts = [
                    owned.length ? `**Your badges**\n${owned.join("\n")}` : "You don't own any custom badges yet.",
                    received.length ? `**Shared with you**\n${received.join("\n")}` : "",
                    owned.length ? "Share one with `/sharebadge`, stop sharing from the Your badges card in Deadbolt's settings." : ""
                ];
                sendBotMessage(ctx.channel.id, { content: parts.filter(Boolean).join("\n\n") });
            }
        }
    ],
    contextMenus: {
        "vc-badge-context": badgeMenu,
        "user-context": userMenu
    }
});
