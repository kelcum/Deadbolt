/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { getTheme, Theme } from "@utils/discord";
import definePlugin from "@utils/types";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { MessageActions, Menu, Modal, moment, NavigationRouter, openModal, SelectedChannelStore, showToast, SnowflakeUtils, Toasts, useState } from "@webpack/common";

const cl = classNameFactory("vc-jumptodate-");
const DAY = "YYYY-MM-DD";
const FORMATS = [DAY, "YYYY-MM-DD HH:mm", "YYYY/MM/DD", "D MMMM YYYY", "D MMM YYYY", "MMMM D YYYY", "MMMM D, YYYY", "MMM D YYYY", "MMM D, YYYY", "MMMM YYYY", "MMM YYYY", "YYYY"];
const RELATIVE = /^(\d+)\s*(d|days?|w|weeks?|m|mo|months?|y|years?)(\s+ago)?$/;
const UNITS = { d: "days", w: "weeks", m: "months", y: "years" } as const;

function parseDate(input: string) {
    const text = input.trim().toLowerCase();
    if (text === "today") return moment().startOf("day");
    if (text === "yesterday") return moment().subtract(1, "day").startOf("day");
    const rel = RELATIVE.exec(text);
    if (rel) return moment().subtract(Number(rel[1]), UNITS[rel[2][0] as keyof typeof UNITS]).startOf("day");
    const date = moment(input.trim(), FORMATS, true);
    return date.isValid() ? date : null;
}

function jumpToDate(channel: Channel, time: number) {
    if (time > Date.now()) {
        showToast("That date is still in the future.", Toasts.Type.FAILURE);
        return;
    }
    const messageId = time <= SnowflakeUtils.extractTimestamp(channel.id) ? channel.id : SnowflakeUtils.fromTimestamp(time);
    if (SelectedChannelStore.getChannelId() === channel.id)
        MessageActions.jumpToMessage({ channelId: channel.id, messageId, flash: false, jumpType: "INSTANT" });
    else
        NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${messageId}`);
}

function DateModal({ modalProps, channel }: { modalProps: RenderModalProps; channel: Channel; }) {
    const [value, setValue] = useState(() => moment().format(DAY));
    const date = moment(value, DAY, true);

    const submit = () => {
        if (!date.isValid()) return;
        modalProps.onClose();
        jumpToDate(channel, date.valueOf());
    };

    return (
        <Modal
            {...modalProps}
            title="Jump to Date"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Jump", variant: "primary", disabled: !date.isValid(), onClick: submit }
            ]}
        >
            <Paragraph className={cl("hint")}>Opens this chat at the first messages sent on the day you pick.</Paragraph>
            <input
                className={cl("input")}
                type="date"
                autoFocus
                value={value}
                min={moment(SnowflakeUtils.extractTimestamp(channel.id)).format(DAY)}
                max={moment().format(DAY)}
                onChange={e => setValue(e.currentTarget.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                style={{ colorScheme: getTheme() === Theme.Light ? "light" : "dark" }}
            />
        </Modal>
    );
}

const canJump = (channel: Channel | undefined): channel is Channel => channel != null && !channel.isCategory() && !channel.isForumLikeChannel();

const addMenuItem: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!canJump(channel)) return;
    children.push(
        <Menu.MenuItem
            id="vc-jump-to-date"
            label="Jump to Date"
            action={() => openModal(props => <DateModal modalProps={props} channel={channel} />)}
        />
    );
};

const addDmMenuItem: NavContextMenuPatchCallback = (children, props: { channel?: Channel; }) => {
    if (props.channel?.isDM()) addMenuItem(children, props);
};

export default definePlugin({
    name: "JumpToDate",
    description: "Jump to the messages a chat had on any day, from its right click menu or with /jumptodate.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],

    contextMenus: {
        "channel-context": addMenuItem,
        "thread-context": addMenuItem,
        "gdm-context": addMenuItem,
        "user-context": addDmMenuItem
    },

    commands: [{
        name: "jumptodate",
        description: "Jump to the messages this chat had on a given day.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [{
            name: "date",
            description: "A date like 2024-05-31, May 31 2024, yesterday or 3 weeks ago.",
            type: ApplicationCommandOptionType.STRING,
            required: true
        }],
        execute(args, ctx) {
            const date = parseDate(findOption(args, "date", ""));
            if (!date) {
                sendBotMessage(ctx.channel.id, { content: "I couldn't read that date. Try 2024-05-31, May 31 2024, yesterday or 3 weeks ago." });
                return;
            }
            if (!canJump(ctx.channel)) {
                sendBotMessage(ctx.channel.id, { content: "This chat can't be jumped through by date." });
                return;
            }
            jumpToDate(ctx.channel, date.valueOf());
        }
    }]
});
