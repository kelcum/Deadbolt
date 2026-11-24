/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Menu, showToast, UserStore } from "@webpack/common";

const logger = new Logger("QuietDMs");
const ChannelActions = findByPropsLazy("openPrivateChannel", "ensurePrivateChannel");

async function openQuietly(userId: string) {
    const user = UserStore.getUser(userId);
    try {
        if (typeof ChannelActions.getOrEnsurePrivateChannel !== "function") throw new Error("DM action unavailable");
        await ChannelActions.getOrEnsurePrivateChannel(userId);
        showToast({ text: "Opened DM with " + (user?.globalName ?? user?.username ?? "user"), variant: "success" });
    } catch (e) {
        logger.error("Could not open DM", e);
        showToast({ text: "Could not open the DM.", variant: "critical" });
    }
}

const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id === UserStore.getCurrentUser()?.id) return;
    children.push(<Menu.MenuItem id="db-quiet-dm" label="Open DM without switching" action={() => void openQuietly(user.id)} />);
};

export default definePlugin({
    name: "QuietDMs",
    description: "Open a direct message from the user menu without leaving your current channel.",
    authors: [{ name: "reqon", id: 497562304498368513n }, Devs.Zot],
    tags: ["Chat", "Utility"],
    contextMenus: { "user-context": userMenu }
});
