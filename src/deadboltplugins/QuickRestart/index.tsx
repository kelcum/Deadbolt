/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin from "@utils/types";
import { Modal, openModal } from "@webpack/common";

function confirmRestart() {
    openModal(props => <Modal {...props} size="sm" title="Restart Discord?"
        actions={[
            { text: "Cancel", variant: "secondary", onClick: props.onClose },
            { text: "Restart", variant: "primary", onClick: () => { props.onClose(); relaunch(); } }
        ]}>
        <Text size="sm">Discord will reopen. Finish any unsent messages or ongoing calls first.</Text>
    </Modal>);
}

export default definePlugin({
    name: "QuickRestart",
    description: "Restart Discord from the toolbox.",
    authors: [Devs.Zot],
    tags: ["Utility"],
    toolboxActions: { "Restart Discord": confirmRestart }
});
