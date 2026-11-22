/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import BadgeAPI, { badgeChangesVersion, openBadgeDirectory, subscribeBadgeChanges, visibleDeadboltBadgesOf } from "@plugins/_api/badges";
import { Devs } from "@utils/constants";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import { Clickable, React } from "@webpack/common";

const { roleIcon } = findCssClassesLazy("roleIcon", "separator");
const RoleIconComponent = findComponentByCodeLazy("#{intl::ROLE_ICON_ALT_TEXT}");

const settings = definePluginSettings({
    badgeSize: {
        type: OptionType.SLIDER,
        description: "How big each badge is, in pixels.",
        markers: makeRange(16, 26),
        default: 20
    },
    maxBadges: {
        type: OptionType.NUMBER,
        description: "Most badges shown next to a name. The rest go into a +N chip that opens the full badge list.",
        default: 12,
        isValid: (value: number) => Number.isInteger(value) && value >= 1 || "Show at least one badge."
    }
});

const SETTING_KEYS = ["badgeSize", "maxBadges"] as const;

function DeadboltChatBadges({ author }: { author: User; }) {
    React.useSyncExternalStore(subscribeBadgeChanges, badgeChangesVersion);
    const { badgeSize, maxBadges } = settings.use(SETTING_KEYS);

    const badges = visibleDeadboltBadgesOf(author.id).filter(b => b.component || b.iconSrc);
    if (!badges.length) return null;

    const RenderBadge = BadgeAPI.renderBadgeComponent;
    const shown = badges.length > maxBadges ? badges.slice(0, maxBadges - 1) : badges;
    const rest = badges.slice(shown.length);

    const openRest = () => openBadgeDirectory(
        { ...rest[0], userId: author.id, guildId: "" },
        BadgeAPI.getDirectoryBadgeId(rest[0].id, author.id)
    );

    return (
        <span className="vc-deadbolt-chat-badges" style={{ "--vc-deadbolt-chat-badge-size": `${badgeSize}px` } as React.CSSProperties}>
            {shown.map(badge => badge.component
                ? (
                    <span key={badge.id} className="vc-deadbolt-chat-badge" style={{ zoom: badgeSize / 22 }}>
                        <RenderBadge {...badge} userId={author.id} guildId="" />
                    </span>
                )
                : (
                    <RoleIconComponent
                        key={badge.id}
                        className={roleIcon}
                        name={badge.name ?? badge.description}
                        size={badgeSize}
                        src={badge.iconSrc}
                    />
                ))}
            {rest.length > 0 && (
                <Clickable className="vc-deadbolt-chat-badges-more" aria-label={`${rest.length} more badges`} onClick={openRest}>
                    +{rest.length}
                </Clickable>
            )}
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
    settings,
    renderMessageDecoration(props) {
        const author = props.message?.author;
        return author ? <DeadboltChatBadges author={author} /> : null;
    }
});
