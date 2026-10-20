/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./requestedBadges.css";

import { BadgePosition, ProfileBadge } from "@api/Badges";
import { BadgeDesign, BadgeName, BadgePreview } from "@components/settings/tabs/vencord/BadgeDesigner";
import { Tooltip } from "@webpack/common";

import { requestedBadges } from "./requested/badges";

export interface RequestedBadgeEntry {
    id: string;
    users: string[];
    name: string;
    image: string | null;
    design: BadgeDesign;
}

function makeBadge(entry: RequestedBadgeEntry): ProfileBadge {
    const Component = () => (
        <Tooltip text={<div className="vc-requested-badge-tip"><BadgeName name={entry.name} colors={entry.design.colors} /></div>}>
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="vc-requested-badge"
                    role="img"
                    aria-label={entry.name}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <BadgePreview design={entry.design} image={entry.image} size={20} />
                </span>
            )}
        </Tooltip>
    );

    return {
        id: `requested_${entry.id}`,
        description: entry.name,
        key: `requested_${entry.id}`,
        component: Component,
        position: BadgePosition.START,
        shouldShow: ({ userId }) => entry.users.includes(userId),
    };
}

export const RequestedBadges = requestedBadges.map(makeBadge);
