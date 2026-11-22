/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BadgeUserArgs, ProfileBadge } from "@api/Badges";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { canRequestBadge, openBadgeShareRequest } from "@components/settings/tabs/vencord/BadgeShare";
import { requestedEntry } from "@plugins/_api/badges/requestedBadges";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";

const badgeMenu: NavContextMenuPatchCallback = (children, { badge }: { badge: ProfileBadge & BadgeUserArgs; }) => {
    const id = badge?.key?.match(/^requested_([0-9a-f]{16})$/)?.[1];
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

export default definePlugin({
    name: "BadgeShare",
    description: "Ask people to share their custom Deadbolt badges with you. Right-click a badge on their profile to send a request, and they decide.",
    authors: [Devs.K3],
    tags: ["Appearance"],
    enabledByDefault: true,
    contextMenus: {
        "vc-badge-context": badgeMenu
    }
});
