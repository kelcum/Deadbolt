/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./fixDiscordBadgePadding.css";
import "./deadboltBadge.css";

import { _getBadges, BadgePosition, BadgeUserArgs, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { CopyIcon, LinkIcon } from "@components/Icons";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { shouldShowContributorBadge, shouldShowEquicordContributorBadge } from "@utils/misc";
import definePlugin from "@utils/types";
import { ContextMenuApi, Menu, Toasts, UserStore } from "@webpack/common";

import Plugins, { PluginMeta } from "~plugins";

import { EquicordDonorModal, EquicordTranslatorModal, VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const EQUICORD_CONTRIBUTOR_BADGE = "https://equicord.org/assets/favicon.png";
const USERPLUGIN_CONTRIBUTOR_BADGE = "https://equicord.org/assets/icons/misc/userplugin.png";
const DEADBOLT_CREATOR_BADGE_ICON = "data:image/png;base64,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";
const DEADBOLT_CREATOR_IDS = ["195516525631897600"];

const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    iconSrc: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const EquicordContributorBadge: ProfileBadge = {
    id: "equicord_contributor_badge",
    description: "Equicord Contributor",
    iconSrc: EQUICORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowEquicordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

function AnimatedDeadboltCreatorBadge() {
    return (
        <span
            className="deadbolt-creator-badge"
            role="img"
            aria-label="Deadbolt Creator"
            title="Deadbolt Creator"
        >
            <img src={DEADBOLT_CREATOR_BADGE_ICON} alt="" draggable={false} />
        </span>
    );
}

const DeadboltCreatorBadge: ProfileBadge = {
    id: "deadbolt_creator_badge",
    description: "Deadbolt Creator",
    key: "Deadbolt Creator",
    component: AnimatedDeadboltCreatorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => DEADBOLT_CREATOR_IDS.includes(userId),
};

const UserPluginContributorBadge: ProfileBadge = {
    id: "user_plugin_contributor_badge",
    description: "User Plugin Contributor",
    iconSrc: USERPLUGIN_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        if (!IS_DEV) return false;
        const allPlugins = Object.values(Plugins);
        return allPlugins.some(p => {
            const pluginMeta = PluginMeta[p.name];
            return pluginMeta?.userPlugin && p.authors.some(a => a.id.toString() === userId);
        });
    },
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

let DonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let EquicordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;

async function loadBadges(url: string, noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";

    return await fetch(url, init).then(r => r.json());
}

async function loadAllBadges(noCache = false) {
    const vencordBadges = await loadBadges("https://badges.vencord.dev/badges.json", noCache);
    const equicordBadges = await loadBadges("https://badge.equicord.org/badges.json", noCache);

    DonorBadges = vencordBadges;
    EquicordDonorBadges = equicordBadges;
}

let intervalId: any;

export function BadgeContextMenu({ badge }: { badge: Omit<ProfileBadge, "id"> & BadgeUserArgs; }) {
    return (
        <Menu.Menu
            navId="vc-badge-context"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Badge Options"
        >
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => copyWithToast(badge.description!)}
                    leadingAccessory={{ type: "icon", icon: CopyIcon }}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.iconSrc!)}
                    leadingAccessory={{ type: "icon", icon: LinkIcon }}
                />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun],
    required: true,
    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /alt:" ","aria-hidden":!0,src:.{0,50}(\i).iconSrc/,
                    replace: "...$1.props,$&"
                },
                // Path with 2026-04-badge-discovery OFF
                {
                    match: /(?<=forceOpen:.{0,40}?ariaHidden:!0,)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // Path with 2026-04-badge-discovery ON
                {
                    match: /(?<=fallbackIconSrc:.{0,50}?)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // handle onClick and onContextMenu
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{.{0,100}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        }
    ],

    // for access from the console or other plugins
    get DonorBadges() {
        return DonorBadges;
    },

    get EquicordDonorBadges() {
        return EquicordDonorBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadAllBadges(true);
            Toasts.show({
                id: Toasts.genId(),
                message: "Successfully refetched badges!",
                type: Toasts.Type.SUCCESS
            });
        }
    },

    userProfileBadges: [ContributorBadge, EquicordContributorBadge, DeadboltCreatorBadge, UserPluginContributorBadge],

    async start() {
        await loadAllBadges();
        clearInterval(intervalId);
        intervalId = setInterval(loadAllBadges, 1000 * 60 * 30); // 30 minutes
    },

    async stop() {
        clearInterval(intervalId);
    },

    getBadges(profile: { userId: string; guildId: string; }) {
        if (!profile) return [];

        try {
            return _getBadges(profile);
        } catch (e) {
            new Logger("BadgeAPI#getBadges").error(e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;

        if (!badge) return handlers; // sanity check

        const { onClick, onContextMenu } = badge;

        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);

        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map((badge, idx) => ({
            id: `vencord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)" // The image is a bit too big compared to default badges
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return VencordDonorModal();
            },
        } satisfies ProfileBadge));
    },

    getEquicordDonorBadges(userId: string) {
        return EquicordDonorBadges[userId]?.map((badge, idx) => ({
            id: `equicord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)" // The image is a bit too big compared to default badges
                }
            },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return badge.tooltip === "Equicord Translator" ? EquicordTranslatorModal() : EquicordDonorModal();
            },
        } satisfies ProfileBadge));
    }
});
