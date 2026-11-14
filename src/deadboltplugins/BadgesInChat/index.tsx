/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import BadgeAPI, { badgeChangesVersion, subscribeBadgeChanges, visibleDeadboltBadgesOf } from "@plugins/_api/badges";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { React } from "@webpack/common";

const { roleIcon } = findCssClassesLazy("roleIcon", "separator");
const RoleIconComponent = findComponentByCodeLazy("#{intl::ROLE_ICON_ALT_TEXT}");

function DeadboltChatBadges({ author }: { author: User; }) {
    React.useSyncExternalStore(subscribeBadgeChanges, badgeChangesVersion);

    const badges = visibleDeadboltBadgesOf(author.id).filter(b => b.component || b.iconSrc);
    if (!badges.length) return null;

    const RenderBadge = BadgeAPI.renderBadgeComponent;

    return (
        <span className="vc-deadbolt-chat-badges">
            {badges.map(badge => badge.component
                ? (
                    <span key={badge.id} className="vc-deadbolt-chat-badge">
                        <RenderBadge {...badge} userId={author.id} guildId="" />
                    </span>
                )
                : (
                    <RoleIconComponent
                        key={badge.id}
                        className={roleIcon}
                        name={badge.name ?? badge.description}
                        size={20}
                        src={badge.iconSrc}
                    />
                ))}
        </span>
    );
}

export default definePlugin({
    name: "DeadboltBadgesInChat",
    description: "Shows people's Deadbolt badges next to their name in chat.",
    authors: [Devs.K3],
    tags: ["Appearance", "Chat"],
    dependencies: ["MessageDecorationsAPI"],
    enabledByDefault: true,
    renderMessageDecoration(props) {
        const author = props.message?.author;
        return author ? <DeadboltChatBadges author={author} /> : null;
    }
});
