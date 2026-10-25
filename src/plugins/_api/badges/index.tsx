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
import "./nullCreatorBadge.css";
import "./avoraCreatorBadge.css";
import "./pluginCreatorBadge.css";
import "./vesperCreatorBadge.css";
import "./vitraCreatorBadge.css";
import "./ruinednzBadge.css";

import { _getBadges, BadgePosition, BadgeRarity, BadgeUserArgs, DirectoryBadge, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { CopyIcon, LinkIcon } from "@components/Icons";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { pluralize, shouldShowContributorBadge, shouldShowEquicordContributorBadge } from "@utils/misc";
import definePlugin from "@utils/types";
import { ContextMenuApi, Menu, showToast, Tooltip, UserStore } from "@webpack/common";
import avoraCreatorLogo from "file://avoraCreatorLogo.png?base64";
import deadboltCreatorLogo from "file://deadboltCreatorLogo.png?base64";
import nullCreatorLogo from "file://nullCreatorLogo.png?base64";
import ruinednzBadge from "file://ruinednzBadge.png?base64";
import vesperCreatorLogo from "file://vesperCreatorLogo.png?base64";
import vitraCreatorCube from "file://vitraCreatorCube.png?base64";

import Plugins, { PluginMeta } from "~plugins";

import { isBadgeHidden, loadHiddenBadges } from "./hiddenBadges";
import { EquicordDonorModal, EquicordTranslatorModal, VencordDonorModal } from "./modals";
import { loadRequestedBadges, RequestedBadges } from "./requestedBadges";
import team from "./team.json";

const teamUsers = (key: string) => team.find(b => b.key === key)?.users ?? [];

const hideable = (badge: ProfileBadge): ProfileBadge => ({
    ...badge,
    shouldShow: args => !isBadgeHidden(args.userId) && (badge.shouldShow?.(args) ?? true),
});

const DEADBOLT_CREATOR_BADGE_ICON = `data:image/png;base64,${deadboltCreatorLogo}`;
const DEADBOLT_CREATOR_IDS = teamUsers("deadbolt_creator");

const DEADBOLT_CONTRIBUTOR_BADGE_ICON = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="dcbg" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#2d2466"/>
      <stop offset="100%" stop-color="#120e28"/>
    </radialGradient>
    <linearGradient id="dcbolt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c9c0ff"/>
      <stop offset="45%" stop-color="#7C6FF0"/>
      <stop offset="100%" stop-color="#4f3fc9"/>
    </linearGradient>
    <linearGradient id="dcboltinner" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#7C6FF0" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" fill="url(#dcbg)"/>
  <polygon points="32,5 55.4,18.5 55.4,45.5 32,59 8.6,45.5 8.6,18.5" fill="url(#dcbolt)"/>
  <polygon points="32,11 50.2,21.5 50.2,42.5 32,53 13.8,42.5 13.8,21.5" fill="url(#dcboltinner)"/>
  <circle cx="32" cy="32" r="9" fill="#120e28"/>
  <circle cx="29" cy="29" r="3" fill="#ffffff" fill-opacity="0.35"/>
</svg>`);
const DEADBOLT_CONTRIBUTOR_IDS = teamUsers("deadbolt_contributor");

const NULL_CREATOR_BADGE_ICON = `data:image/png;base64,${nullCreatorLogo}`;
const NULL_CREATOR_IDS = teamUsers("null_creator");

const AVORA_CREATOR_BADGE_ICON = `data:image/png;base64,${avoraCreatorLogo}`;
const AVORA_CREATOR_IDS = teamUsers("avora_creator");

const VESPER_CREATOR_BADGE_ICON = `data:image/png;base64,${vesperCreatorLogo}`;
const VESPER_CREATOR_IDS = teamUsers("vesper_creator");

const VITRA_CREATOR_BADGE_ICON = `data:image/png;base64,${vitraCreatorCube}`;
const VITRA_CREATOR_IDS = teamUsers("vitra_creator");

const RUINEDNZ_BADGE_ICON = `data:image/png;base64,${ruinednzBadge}`;
const RUINEDNZ_IDS = teamUsers("ruinednz");

const PLUGIN_CREATOR_BADGE_ICON = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="pcbg" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#2c3038"/>
      <stop offset="100%" stop-color="#101115"/>
    </radialGradient>
    <linearGradient id="pcpiece" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef1f5"/>
      <stop offset="50%" stop-color="#b3bbc6"/>
      <stop offset="100%" stop-color="#6f7783"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" fill="url(#pcbg)"/>
  <path transform="translate(32 32) scale(1.3) translate(-35 -35)" d="M18 24h8a6 6 0 1 1 12 0h8v8a6 6 0 1 1 0 12v8H18z" fill="url(#pcpiece)"/>
  <path transform="translate(32 32) scale(1.3) translate(-35 -35)" d="M21 27h4.5M21 27v7" stroke="#fff" stroke-opacity="0.55" stroke-width="1.6" stroke-linecap="round" fill="none"/>
</svg>`);

let deadboltPluginsByAuthor: Map<string, string[]> | undefined;

function getDeadboltPluginsBy(userId: string) {
    if (!deadboltPluginsByAuthor) {
        deadboltPluginsByAuthor = new Map();
        for (const plugin of Object.values(Plugins)) {
            if (!PluginMeta[plugin.name]?.folderName.startsWith("src/deadboltplugins/")) continue;
            for (const { id } of plugin.authors) {
                const key = id.toString();
                if (key === "0") continue;
                const names = deadboltPluginsByAuthor.get(key) ?? [];
                names.push(plugin.name);
                deadboltPluginsByAuthor.set(key, names);
            }
        }
    }
    return deadboltPluginsByAuthor.get(userId) ?? [];
}

const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    infoLabel: "Vencord",
    rarity: BadgeRarity.MYTHIC,
    iconSrc: "https://cdn.discordapp.com/emojis/1562267648857997356.webp?size=128",
    largeIconSrc: "https://cdn.discordapp.com/emojis/1562267648857997356.webp?size=512",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const EquicordContributorBadge: ProfileBadge = {
    id: "equicord_contributor_badge",
    description: "Equicord Contributor",
    infoLabel: "Equicord",
    rarity: BadgeRarity.MYTHIC,
    iconSrc: "https://cdn.discordapp.com/emojis/1563740725726683167.webp?size=128",
    largeIconSrc: "https://cdn.discordapp.com/emojis/1563740725726683167.webp?size=512",
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

const DEADBOLT_CREATED = "September 23, 2026";

function AnimatedDeadboltCreatorBadge() {
    return (
        <Tooltip
            text={
                <div className="deadbolt-creator-tip">
                    <div className="deadbolt-creator-tip-title">Deadbolt Creator</div>
                    <div className="deadbolt-creator-tip-sub">Forged {DEADBOLT_CREATED}</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="deadbolt-creator-badge"
                    role="img"
                    aria-label="Deadbolt Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <img src={DEADBOLT_CREATOR_BADGE_ICON} alt="" draggable={false} />
                </span>
            )}
        </Tooltip>
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

const VESPER_CREATED = "October 7, 2026";
const VITRA_CREATED = "October 7, 2026";

function AnimatedVesperCreatorBadge() {
    return (
        <Tooltip
            text={
                <div className="deadbolt-creator-tip">
                    <div className="vesper-creator-tip-title">Vesper Creator</div>
                    <div className="deadbolt-creator-tip-sub">Rose {VESPER_CREATED}</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="vesper-creator-badge"
                    role="img"
                    aria-label="Vesper Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <img src={VESPER_CREATOR_BADGE_ICON} alt="" draggable={false} />
                    <span className="vesper-creator-star" />
                </span>
            )}
        </Tooltip>
    );
}

const VesperCreatorBadge: ProfileBadge = {
    id: "vesper_creator_badge",
    description: "Vesper Creator",
    key: "Vesper Creator",
    component: AnimatedVesperCreatorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => VESPER_CREATOR_IDS.includes(userId),
};

function AnimatedVitraCreatorBadge() {
    return (
        <Tooltip
            text={
                <div className="deadbolt-creator-tip">
                    <div className="vitra-creator-tip-title">Vitra Creator</div>
                    <div className="deadbolt-creator-tip-sub">Crafted {VITRA_CREATED}</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="vitra-creator-badge"
                    role="img"
                    aria-label="Vitra Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    style={{ backgroundImage: `url("${VITRA_CREATOR_BADGE_ICON}")` }}
                />
            )}
        </Tooltip>
    );
}

const VitraCreatorBadge: ProfileBadge = {
    id: "vitra_creator_badge",
    description: "Vitra Creator",
    key: "Vitra Creator",
    component: AnimatedVitraCreatorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => VITRA_CREATOR_IDS.includes(userId),
};

function AnimatedRuinednzBadge() {
    return (
        <Tooltip
            text={
                <div className="ruinednz-tip">
                    <div className="ruinednz-tip-title">ruinednz</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="ruinednz-badge"
                    role="img"
                    aria-label="ruinednz"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <img src={RUINEDNZ_BADGE_ICON} alt="" draggable={false} />
                </span>
            )}
        </Tooltip>
    );
}

const RuinednzBadge: ProfileBadge = {
    id: "ruinednz_badge",
    description: "ruinednz",
    key: "ruinednz",
    component: AnimatedRuinednzBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => RUINEDNZ_IDS.includes(userId),
};

function AnimatedDeadboltContributorBadge({ userId }: ProfileBadge & BadgeUserArgs) {
    return (
        <Tooltip
            text={
                <div className="deadbolt-contributor-tip">
                    <div className="deadbolt-contributor-tip-title">Deadbolt Contributor</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="deadbolt-contributor-badge"
                    role="img"
                    aria-label="Deadbolt Contributor"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onClick={() => openContributorModal(UserStore.getUser(userId))}
                    style={{ cursor: "pointer" }}
                >
                    <img src={DEADBOLT_CONTRIBUTOR_BADGE_ICON} alt="" draggable={false} />
                </span>
            )}
        </Tooltip>
    );
}

const DeadboltContributorBadge: ProfileBadge = {
    id: "deadbolt_contributor_badge",
    description: "Deadbolt Contributor",
    key: "Deadbolt Contributor",
    component: AnimatedDeadboltContributorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => DEADBOLT_CONTRIBUTOR_IDS.includes(userId),
};

function PluginCreatorBadgeComponent({ userId }: ProfileBadge & BadgeUserArgs) {
    const count = getDeadboltPluginsBy(userId).length;

    return (
        <Tooltip
            text={
                <div className="deadbolt-plugin-creator-tip">
                    <div className="deadbolt-plugin-creator-tip-title">Plugin Creator</div>
                    <div className="deadbolt-plugin-creator-tip-sub">Made {pluralize(count, "Deadbolt plugin")} - click to see</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="deadbolt-plugin-creator-badge"
                    role="img"
                    aria-label="Plugin Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onClick={() => openContributorModal(UserStore.getUser(userId))}
                    style={{ cursor: "pointer" }}
                >
                    <img src={PLUGIN_CREATOR_BADGE_ICON} alt="" draggable={false} />
                </span>
            )}
        </Tooltip>
    );
}

const PluginCreatorBadge: ProfileBadge = {
    id: "deadbolt_plugin_creator_badge",
    description: "Plugin Creator",
    key: "Plugin Creator",
    component: PluginCreatorBadgeComponent,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => !DEADBOLT_CREATOR_IDS.includes(userId) && getDeadboltPluginsBy(userId).length > 0,
};

function AnimatedNullCreatorBadge() {
    const mask = `url("${NULL_CREATOR_BADGE_ICON}")`;

    return (
        <Tooltip
            text={
                <div className="null-creator-tip">
                    <div className="null-creator-tip-title">Null Creator</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="null-creator-badge"
                    role="img"
                    aria-label="Null Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <img src={NULL_CREATOR_BADGE_ICON} alt="" draggable={false} />
                    <span className="null-creator-sheen" style={{ WebkitMaskImage: mask, maskImage: mask }} />
                </span>
            )}
        </Tooltip>
    );
}

const NullCreatorBadge: ProfileBadge = {
    id: "null_creator_badge",
    description: "Null Creator",
    key: "Null Creator",
    component: AnimatedNullCreatorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => NULL_CREATOR_IDS.includes(userId),
};

function AnimatedAvoraCreatorBadge() {
    const mask = `url("${AVORA_CREATOR_BADGE_ICON}")`;

    return (
        <Tooltip
            text={
                <div className="avora-creator-tip">
                    <div className="avora-creator-tip-title">Avora Creator</div>
                </div>
            }
        >
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="avora-creator-badge"
                    role="img"
                    aria-label="Avora Creator"
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <img src={AVORA_CREATOR_BADGE_ICON} alt="" draggable={false} />
                    <span className="avora-creator-shine" style={{ WebkitMaskImage: mask, maskImage: mask }} />
                </span>
            )}
        </Tooltip>
    );
}

const AvoraCreatorBadge: ProfileBadge = {
    id: "avora_creator_badge",
    description: "Avora Creator",
    key: "Avora Creator",
    component: AnimatedAvoraCreatorBadge,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => AVORA_CREATOR_IDS.includes(userId),
};

const UserPluginContributorBadge: ProfileBadge = {
    id: "user_plugin_contributor_badge",
    description: "User Plugin Contributor",
    infoLabel: "Equicord",
    rarity: BadgeRarity.MYTHIC,
    iconSrc: "https://cdn.discordapp.com/emojis/1419345679729295420.webp?size=128",
    largeIconSrc: "https://cdn.discordapp.com/emojis/1419345679729295420.webp?size=512",
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
let DirectoryBadges = {} as Record<string, DirectoryBadge>;

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
let hiddenIntervalId: any;

function toDirectoryBadge(b: ProfileBadge, userId: string): DirectoryBadge {
    const id = `vc-${userId}-${b.id}`;

    return DirectoryBadges[id] ??= {
        badge_id: id,
        name: b.name ?? b.description ?? "",
        description: b.detail ?? b.description ?? b.name ?? "",
        info_label: b.infoLabel ?? "Equicord",
        rarity: b.rarity ?? BadgeRarity.COMMON,
        simple_icon_url: b.iconSrc!,
        complex_icon_static_url: b.largeIconSrc ?? b.iconSrc!,
        obtained_at: b.obtainedAt,
        is_earnable: false,
        owned: true,
        hidden: false,
        tiers: []
    };
}

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
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun, Devs.kaxtusik],
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
                },
                {
                    match: /legacyBadgeId:(\i),userId:(\i),.{0,100}?=\i,\i=\(0,\i\.\i\)\(\1\)/,
                    replace: "$&??$self.getDirectoryBadgeId($1,$2)"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{.{0,100}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        },
        {
            find: '"BadgeDirectoryStore"',
            replacement: {
                match: /getBadgeById\((\i),(\i)\)\{/,
                replace: "$&const vencordBadge=$self.getDirectoryBadge($1);if(vencordBadge)return vencordBadge;"
            }
        },
        {
            find: "badge_directory_closed",
            replacement: {
                match: /(\i\.\i\.getBadges\((\i)\))(?=:\[\],\[\2\]\))/,
                replace: "[...$1,...$self.getDirectoryBadges($2)]"
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
            await Promise.all([loadAllBadges(true), loadRequestedBadges(), loadHiddenBadges()]);
            showToast({ text: "Successfully refetched badges!", variant: "success" });
        }
    },

    userProfileBadges: [
        ContributorBadge,
        EquicordContributorBadge,
        ...[PluginCreatorBadge, DeadboltContributorBadge, RequestedBadges, RuinednzBadge, VitraCreatorBadge, VesperCreatorBadge, DeadboltCreatorBadge, NullCreatorBadge, AvoraCreatorBadge].map(hideable),
        UserPluginContributorBadge
    ],

    async start() {
        loadRequestedBadges();
        loadHiddenBadges();
        clearInterval(hiddenIntervalId);
        hiddenIntervalId = setInterval(loadHiddenBadges, 1000 * 60 * 5);
        clearInterval(intervalId);
        intervalId = setInterval(() => {
            loadRequestedBadges();
            loadAllBadges();
        }, 1000 * 60 * 30); // 30 minutes
        await loadAllBadges();
    },

    async stop() {
        clearInterval(intervalId);
        clearInterval(hiddenIntervalId);
        DirectoryBadges = {};
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

    getDirectoryBadge(id: string) {
        return DirectoryBadges[id];
    },

    getDirectoryBadges(userId: string) {
        return this.getBadges({ userId, guildId: "" })
            .filter(b => b.iconSrc)
            .map(b => toDirectoryBadge(b, userId));
    },

    getDirectoryBadgeId(badgeId: string, userId?: string) {
        if (!userId) return;

        const badge = this.getBadges({ userId, guildId: "" })
            .find(b => b.id === badgeId && b.iconSrc);

        if (badge) return toDirectoryBadge(badge, userId).badge_id;
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
            name: badge.tooltip,
            infoLabel: "Vencord Donor",
            rarity: BadgeRarity.MYTHIC,
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
            name: badge.tooltip,
            infoLabel: "Equicord Donor",
            rarity: BadgeRarity.MYTHIC,
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
