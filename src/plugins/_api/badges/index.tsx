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
const WRAITHCORD_CREATOR_BADGE_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAASSklEQVR4nN07e3CV1Z2/c873ffeZm3tzQxJikIeAEAwqaKHaNkGWhwpid+ZmlajbuiuouzvTOnV3ZtudSLdbtn9o3dmpCn3sWkQw6awWqqKgCZ1iEQSimADhJRBC3u/7+h7n7PzOd2+8BMEk94uzs7+ZQPK9zvm9nwdgokAAidREWHlduVJdXU3H8QWC72bx/ugWAYcBkcb/aytrrczrK9+qCihg3Mg8qo8nrTKqsqCpc6CIGv5wYXJODwJYSeKmx/6wZFtX5vvVopo21TaR2spaLsn7f40AkZoIq43UcCBEDCOswO2EwkrG6CJBRKnqVcPMowJVqfzJREMIAVbCAmFy0If0fhCimRu8UQDdqVB+4PUlW1uG1xIRVkucIQTJ9gPIGXgGYMOGDbghWPPeQ3dwIb7D3Oxuza+VMLcCXLcg0R2HwXP9Qu9PilhblEdbB4EyW7KFJUALuCDnhlyiuBWSMz1IPfleUHyqJEiyNzHIDbNOUOXXro74rtrKWn2Y6CMk7asjgAASqY3Q9AZW1z+0jBLytOpRlmm5Loh3xKDnWBfvOtLOuw93kFjrEI13xoiZMOXLAnjG8shIAgQoUIWCO+wR3sk+HpobFpO+NpmE5uaznKm5YOkW6P3JT7lh/dzVrb+ChEjbhzQDvhICVItquoHYC66uq1pMKf2x5lOXIbd7j3eL1rpzvGXPOTpwqo9YlmmjxpgUe0LJ1VcWtipwgwM3uSQSEsU32S8mL5nCS/5iGuTfUsiYi0GiO/EpGNZP31i6dVuGWlgTToDyunJl75K95sotVQH39eQnRKGPu8NetetIG2/e0ija911kif44UMKAuZmNsERMKvqod0UI/mMTBTlvmSYoLhXCNxfwmWtLRcnSaQyvG0PJt/Uh43tv3/tac3pvE0aA8rpqZe+SDeaqPVULFBf7pSfsWRBrj4qT25r46e3HWXIgDopmGzmJNHfIWCMtKJG2wkwYUpqmrJzO5zx2swjdmMcSXfFuU7ee3Ll0a42UTtgggIzOQJLR7iFtcO7bXfWo4lOed+W6c1rqz5tHnzug9J3uSSHOQHDuoJP6gg2nJEqPJ8Gd54W5j91szXpgLuOmAH0g8fyOpa9+X2KF2jMKIpDRrFleV85QtFbtqVrvDmgv4VdPbmm0mjY3MLTwile1uT1WxDNt4FhfZRS4boJpWDB99Sxx0/du477JfhZtHfrlAGt5cm/FXtsefAkRyGjF/r7da19w53ufMGKG1fCz/fTsjhNE9bikro5X1NNEI4rN1TEDIUAogB5NQHheISzaWG4GZgSVeGdsn5XjXb5w4eTEl6kDHZXOv/PgekQ+2ha1/vTku/TsjpNE87k/R2IcgPqs5mjgKfBKiz8ufySEHUP4PNDb2AX1f/OW0vbni4Z3sv9O2jf0Anqq8vpqjEzJmAkQERGGyN/z9trvuPM8L5lxw/zwn+pp58dtRPO75MLj1XXUY9MwoOiO62BmVSlYhvG5exwHCIvLoCnRnYD9P6hTez7pMHzFOX+9etcDLyEO5XWSCKMnQLWopuhT1+xeW+bKUX6BfD6ycT/r+qSduPxuGZ1lBRJXAaHSfJi0oBAIY2i0sgJkiOJRQB9IwkfP7FMHzw+YniL/+lW7HvwuEiGdo3w5AQQQTDru+9OjOYKSra6Qx9v820ZxducJovk0W1yzBCn+bhfkzcsHX0kO5E4NgqWbWQfmkgg+Dbqb2qHhZx8yYXJL9Wv/uXrPI/PRg8mwfQTQkRfS4a0Vi2/0FfvLLtafN5s2NTA0eE74dRR1K2lCcE4Y/NMCwFwKFH69GCzLykoN0oDS6fJ7oKXuLDnx8lFwBV0+EMbLaM+QscjgqxKgGkW/sta6//21CzWftj7WEbOOPnuAIddlZOaEfyeY+XIo+kaJFFnkPP7OFCVrNUgDtziobg2aNn/MOg+3m96inFv8yebHETdk8JfaAMvgz3rCHuXkK43Qd6aH4EYdi+o4AGMKhOfnS3XiOofAjCB4C31gGZYzCTq6VmZLWtOLR5ilm1xxsR/fv/vhcA2m7BlSQNO/oJFAt3Hv7qoKd76vvPNwm3XmtWMM428nQ1rkeM70XAjMDNn5vyXAleeG/AWFMt53Qg2G7YxXg7b9LeTczlPcV+wPGab5D4QQEYGaYbxp+pfSSKlAFaCCV2MS07ylERIDCZmeOhXaSv23LChcXAyu3JQrTSU8qAYYuzodRhNKofnlRhZriwrFy/7+2+88VFALlcNSQDO5f2jPqYWuoKei91g3b9/XwlSX5hz30+KvKFB053WoZsNZnxk3ITx/EviLAzLzc6pOhXtX3AoMnO0ll/ZdtHxF/rBJ+MMYGaYCJLAlIBKxX7CsdVquBpjPI/fHHaJeTfwNS+o66ryVMIdTXsz/XWEP5M7JA25a9nWnILX/ll1nqJUwhSDw3UhNRNtb8YzMFSiKQi2ptNa8viaouJXVWMlp2X2OYcqJxQmnQIq/aUpdR50XZkr80/cJkaph/+HYsrYUuFTo/KiNdn3SKdxB97xogN6GtctITYTRtFswVN+trqC7sKepiw+c6iWK5pxbsndiF71Q11MVsMtD44QJk24rAleuR0qEk0RASdZjSej4sJW7gpjA0eV4/UxviNKOSaW2MVDFvagv3UfaOefWl6RJY92BXdVBHUddR52/TMxRDXQLfMV+CN9aID2F02qA3+tu6CBG1ACmkBXI/VXrJlu0oLNJgBCEMPJ13GTXkQ5bMR20fbg4in9gVgi0kBus5JWlO/QIKAnhskmyZOqoGgghY4++4z00dikKRFXK4m4lhIZfRn73/X6Nnyp0dqIrDtHWIeq0/qetfcmyabL8rQa0yw0sAdACGlCNQXHFFJAJV9pFOgECJZyC3p8gQxcHuJajerjGZ+MtKehcc8/RcrTQ4Pl+nuiMkZFNi6xAijcHxaVJMW/Z/Rm0/fEC6H1JGa3J/Zkc2ve3yntDFwbBne+RUZyMC5wCanuh/hM9XPWqVKH0drysyA0Q4qMaY8m+BEf3NFzicsr3exTAUvYnPz8oL1lxExY/uwQKFxVL44c24cjGD2Uqi5KhuBRwBd1gxrLPEDMBVQulnCgo4RAYJgAlBHt1EG+LYY3FsQWRw2h95/zVfJjzaBnoA7rNdQGAPQREHEH1aVDxX3fbFR50W14VOg5cggP/vBcUj0PMSHkhbM5I6aKkbJgAQEgYxT7WOmgTwMmWaQpZLeiWbQFb7Mnl1WMCoPrV4euq3wWqT52Q6nKsdQgEulkG4WECECCmXZycmC40chD1XAY/EqkriSzvoZCmn0UjOAEgcbTL5lL8bBsAwvE2+ZUrZ/xc7f5onnNuP3KFlBFMVekmiOrpLpHU5XRrcETam9bz9HOOuuHMdVI4pneiyM0IYuCi6KMddT0pQPuCOm0luW0D0DUmrc+NGwFp+OTGuJDPYqlsIgDjDSQ+AWHg33IVU/CP0DLmzMiVt5wyPtKiawqc33UGeo52ADfsaA/Xmvd3CyBUGpYhMrq7Q8/sAwxT5eYokS4RAyPHJEGiJSBnWq5AowwW+WiYAIyTODe5wNKXkwUQKWeUQvTCIAx+1pfaBwEOFszqnzesBmj0Og62yQ5PWgIJoTJ2cNoTyKELLoBzEZN/y6smHDcG9aHAtGCOK+wRye4EIapzkoCcZIR9nvnFDDsUhgw3mJoGyQyRHS3GoDumDII35mFdAIDww3JvOGHhSZi9lsFPuwu84J3sF7I252g2ljJsGT8jiTvyvqPIo80xOeYgImdKgOqDyYRqKU14i9ZXgEyIBOcNqleF0Nw8XH7i3dBXCMhMbliQMzVXeIv9YCb5OWVI78BiEIX6evspC36PVMKZHIqZwwT2+L9ySPUi8hcUclfIjZGgHLRauHmdQvc+Y/fRKRUHkr3xQRxIQjXAzO3/jRSkirH5C4uoTLBAvIeXZ4R6OUWHiOXwHcu3txox84/oJiZXTOGmgzX6YbhWlJd5z8lyGBrdpIEuVxTcXkTi3fFLNO6RYl8bqeUy+Jc9MzsgeonrFsFpLBUbIg5GhtL1GHY+IMSVYzTyuvzBZ7iz4s85lCybbrlCHmLpfNuO+38ziL1CICAkAXD8VAhB3AHjvVhX9ET+rYU0b34Bx4EkRxqWQoDq18Cd55bVIM3vvqIiJK/nukDLdcuymWN9SJ2DN+wTxUuup4nueFJQ9iu8tbfCLvkq6T1WQiWrvaM2fu9bD2xkLuW/Z1aV8q4jbVlvREZ+CRMjMFi08VvD9UAMfc2kKb+PLaxv/mKZdFVopJo2NcDJbY2gerJrzODahqHD7L+8iQdnhdjAmb7X3rp7+zE58EU2pPoCKcDZW7QFFvRtj14aPFmydCqdsnwGx2msdOlq/N0ZFToOt8KZ/2kG//UBORozUgIwQvNPCUD3xx1wuva4fCdb5JHwwRvyxKyqUhLvipkU2E/R9WEbMP0czdwr2oJd9+xKEg4/5Donc9fdzD0hb9Z1epngeDQ4trkBLr5/zi65yfw/BVxIIg+1DMChf/3AOfG3OMxdfwv3Fvgw+Nm04+6tJ7APkp5yRbisAiL75zURtmP5q7Xx7tju4I15ypzHbrZMrNNnawswCVQoNPz7foh3RO04P7UNkQqXGzZ+CPHO1L0siID5jB5NwrRVM3nJ0mk01h7tBJP9C0a9aPkvexZGQGljqcAHFa/6RLwj1jvzwVIyfdUsIROV1HT3uH2xxiDaEYWjzx8CqmFXTth6H3TB6W3H4NL+C7I+mI33kXXIqA6hWfkw/6mvSeNu6uLJN1e92ts0r+mK4Uk68gM4dY0PvvGN3542EsY6YXJa9tRtZnheoTDjqaLmOMEeadPgwntn4NSrx0DL0WQShJlg44tH5FRHtnpvE9QNC3602PAU+ZREd/z5N1ds/Z0cpv6C0Xr6RR/CB9FPvrli++8SPfHnfUV+ddHGcsud57HbWlkaRUS08cXD0P1xp+wVHP63D+SoW3oMdjwgZ4nx0EXShIU/usMqXHydOnRxYL9nufkDafXhctEffg9GMSK7ek/VZl+R7zEcQtz/dJ2KTQ3Fr407YLGboQaE5oQx+4QL750FzZcamBjP9xgmO1z2FG95epE5+5EyJdEZ/Siuu1e8s+JXvbLGcJVpUXqN7wqct0V7sHPp1vWx9uifi785Rf3WppVmaF4+6EPxzyus42xZ9zX3wsX3z4PmyQJ5hcpKEnqWO55das1+5CYl2Rvv4QapfHflr3sqaytluH+19+m1vw5iA06PQTXRfbAyemnoN+GyScriZ++ySu6aIfShxPBA0lgBxRWbMXIAaxxlr+HS2VACixxw538sNaauugFH5w8aCXPxzhWvnE1PvV0bxdEAztOkqHjf7rUvufO961HkTmw5ah3b/DFDvcNoTj7qZCHjGmcHsL2GMf7UVTP5/KduF94iP4u3D+0zo2I1WvzRnicio15YCBKprZQUXbOn6m+Zlz2nBdw5OIfXtOkIa9vXQrCOhxydCEJIA5maIzANE4Izw2Lu+luskrumKrgWnhW4eOrEPx5af8gYy2EqMtaNpD+eOjXygivoWoTx/bk/nDKbtzSygdO9dr3dpQ6Hu1LEx3GWwJ4hsttlkuPAwZvvE9O+PZvPqiplngIfJLvircKwvv/G0q01YzkoMW4CZB5QWrhuoVryYOnjVCE/dE/yFsbbo3Dpg4tmy9tnaOehNorRGO6GKUwaq3Rf0KYKXAmyDilk0IRhLHIbK8iMqZB3U764btlUq7j8eiV3Vh4ew9OFYW2KJuEnu1e80jHes4QExgmXnRzb80AhZewJqrLH3fneQkxCuo92io4DrRaOpeBkht6XJDginwp8U+XvjGwo4ygdpQybNCJnakDkLyzk+QsKacHtxRQzxXhXTOcJcysl5LnXl7zyabbnB8l4CZB+P1KTcXZQEkJ5GAAeVv3afC3oAjNqAI6l4GRGf3MPxwOU8fYYiV0akj0DBBRx7Er5p+UKjAyDc/Kof0qAeov8cqLMipmQ6Eu0CAHbraR4+c0VGYhjbD8GkXeaADYIIOX1dtCUlo6G908v5txaThhdzjRlnuJVAogcqgLaDBlEZZwZQiOHHRsZzcVN0Af1ODetz7gJ7wLhdUaC1O26Z+tAGnHMWcZ7WDITCDgJIwiRhlV1D+aLBJ9LFHYroSSXcFFGFBYUZmoazZ5EN4UpDnLgCabRg8zjPa6c77+UKdp4LrCivoI7gfhEA7GPzlcrI+fzxwqINBq4bL9zNfhfRNSY1+TnDu4AAAAASUVORK5CYII=";
const WRAITHCORD_CREATOR_IDS = ["195516525631897600", "330452516842110988"];

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

const WraithcordCreatorBadge: ProfileBadge = {
    id: "wraithcord_creator_badge",
    description: "Wraithcord Creator",
    iconSrc: WRAITHCORD_CREATOR_BADGE_ICON,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => WRAITHCORD_CREATOR_IDS.includes(userId),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
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

    userProfileBadges: [ContributorBadge, EquicordContributorBadge, WraithcordCreatorBadge, UserPluginContributorBadge],

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
