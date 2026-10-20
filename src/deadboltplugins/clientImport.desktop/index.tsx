/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { Native, openImportModal } from "./ImportModal";

const settings = definePluginSettings({
    offered: {
        type: OptionType.BOOLEAN,
        description: "Already offered to import from another client mod",
        default: false,
        hidden: true,
    },
});

export default definePlugin({
    name: "ClientImport",
    description: "Brings your plugins, their settings, themes and QuickCSS over from Vencord, Equicord, Vesktop, Equibop or BetterDiscord.",
    authors: [Devs.K3],
    required: true,
    settings,
    openImportModal,

    settingsAboutComponent: () => (
        <Button onClick={() => openImportModal()}>Import from another client mod</Button>
    ),

    start() {
        if (settings.store.offered) return;
        setTimeout(async () => {
            settings.store.offered = true;
            const sources = await Native.findSources().catch(() => []);
            if (sources.length) openImportModal(sources, true);
        }, 6000);
    },
});
