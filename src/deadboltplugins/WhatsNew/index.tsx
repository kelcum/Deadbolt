/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal } from "@webpack/common";

const cl = classNameFactory("vc-whatsnew-");

interface Release {
    id: string;
    title: string;
    items: string[];
}

const releases: Release[] = [
    {
        id: "2026-11-21",
        title: "November 2026",
        items: [
            "QuickFind: press Ctrl+Shift+F in any chat, DMs included, to search everything Discord has loaded there instantly and offline.",
            "/myplugins lets you edit, switch, share and remove your own plugins without leaving Discord.",
            "DeadboltDoctor: type /deadbolt to see whether Deadbolt survived Discord's last update and fix it in one click.",
            "The boot splash now shows tips and a progress bar while Discord connects.",
            "Animated badges pause while Discord is in the background, so they cost nothing when you're not looking.",
            "Updates are safer: your own plugins get backed up on every update, and Discord only restarts when Deadbolt really fell out."
        ]
    }
];

const settings = definePluginSettings({
    showOnUpdate: {
        description: "Pop up the list of new features once after Deadbolt updates.",
        type: OptionType.BOOLEAN,
        default: true
    }
}).withPrivateSettings<{
    lastSeen?: string;
}>();

function WhatsNewModal({ modalProps, list }: { modalProps: RenderModalProps; list: Release[]; }) {
    return (
        <Modal
            {...modalProps}
            size="md"
            title="What's new in Deadbolt"
            subtitle="Turn this off in the WhatsNew plugin settings, or reopen it any time with /whatsnew."
            actions={[{ text: "Got it", variant: "primary", onClick: modalProps.onClose }]}
        >
            <div className={cl("list")}>
                {list.map(r => (
                    <section key={r.id} className={cl("release")}>
                        <Heading tag="h3">{r.title}</Heading>
                        <ul className={cl("items")}>
                            {r.items.map(item => (
                                <li key={item}><Paragraph>{item}</Paragraph></li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </Modal>
    );
}

function open(list: Release[]) {
    settings.store.lastSeen = releases[0].id;
    openModal(props => <WhatsNewModal modalProps={props} list={list} />);
}

let showTimer: ReturnType<typeof setTimeout> | undefined;

export default definePlugin({
    name: "WhatsNew",
    description: "Shows what changed in Deadbolt once after each update, so new features don't go unnoticed.",
    tags: ["Utility"],
    authors: [Devs.K3],
    enabledByDefault: true,
    settings,
    toolboxActions: {
        "What's new in Deadbolt"() {
            open(releases);
        }
    },
    commands: [
        {
            name: "whatsnew",
            description: "See what's new in Deadbolt.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute() {
                open(releases);
            }
        }
    ],
    start() {
        const { lastSeen, showOnUpdate } = settings.store;
        if (lastSeen === releases[0].id) return;
        const seenAt = releases.findIndex(r => r.id === lastSeen);
        const unseen = seenAt === -1 ? releases.slice(0, 1) : releases.slice(0, seenAt);
        if (!showOnUpdate) {
            settings.store.lastSeen = releases[0].id;
            return;
        }
        showTimer = setTimeout(() => open(unseen), 8000);
    },
    stop() {
        clearTimeout(showTimer);
    }
});
