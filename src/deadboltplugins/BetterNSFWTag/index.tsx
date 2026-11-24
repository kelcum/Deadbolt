/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelToolbarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { ChannelStore, SelectedChannelStore, useStateFromStores } from "@webpack/common";

function AgeRestrictedIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
            <path d="M7 9h2v6M7 15h4m3-3h3m-1.5-1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

const AgeRestrictedBadge = ErrorBoundary.wrap(() => {
    const restricted = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        return Boolean(channel?.guild_id && (channel.nsfw || (channel.parent_id && ChannelStore.getChannel(channel.parent_id)?.nsfw)));
    });
    if (!restricted) return null;
    return <ChannelToolbarButton icon={AgeRestrictedIcon} tooltip="Age-restricted channel" aria-label="Age-restricted channel" />;
}, { noop: true });

export default definePlugin({
    name: "BetterNSFWTag",
    description: "Adds a visible age-restricted channel indicator to the channel toolbar.",
    authors: [Devs.Zot],
    tags: ["Accessibility", "Servers"],
    headerBarButton: {
        icon: AgeRestrictedIcon,
        location: "channeltoolbar",
        render: () => <AgeRestrictedBadge />
    }
});
