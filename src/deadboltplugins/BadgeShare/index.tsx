/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BadgeUserArgs, ProfileBadge } from "@api/Badges";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { canRequestBadge, openBadgeShareRequest } from "@components/settings/tabs/vencord/BadgeShare";
import { ownedRequestedEntries, requestedEntry } from "@plugins/_api/badges/requestedBadges";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

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

const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;
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

export default definePlugin({
    name: "BadgeShare",
    description: "Ask people to share their custom Deadbolt badges with you. Right-click a badge on their profile, or right-click them and pick Request a badge, and they decide.",
    authors: [Devs.K3],
    tags: ["Appearance"],
    enabledByDefault: true,
    contextMenus: {
        "vc-badge-context": badgeMenu,
        "user-context": userMenu
    }
});
