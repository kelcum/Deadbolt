/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import { relaunch } from "@utils/native";
import definePlugin from "@utils/types";
import { Modal, openModal } from "@webpack/common";

function RestartIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" />
    </svg>;
}

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
    description: "Restart Discord with a top-bar button.",
    authors: [Devs.Zot],
    tags: ["Utility"],
    headerBarButton: { icon: RestartIcon, render: () => <HeaderBarButton icon={RestartIcon} tooltip="Restart Discord" onClick={confirmRestart} /> },
    toolboxActions: { "Restart Discord": confirmRestart }
});
