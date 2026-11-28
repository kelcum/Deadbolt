/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ReplyIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { proxyLazy } from "@utils/lazy";
import definePlugin from "@utils/types";
import { MessageActions, MessageStore, SelectedChannelStore, zustandCreate } from "@webpack/common";

const MAX_STEPS = 20;
const SETTLE_MS = 1500;

type Stacks = Record<string, (string | null)[]>;

interface StackStore {
    <T>(selector: (state: { stacks: Stacks; }) => T): T;
    getState(): { stacks: Stacks; };
    setState(state: { stacks: Stacks; }): void;
}

interface Snapshot {
    seq: number;
    target: string | null;
    atPresent: boolean;
}

const useStacks: StackStore = proxyLazy(() => zustandCreate(() => ({ stacks: {} })));
const returning = new Map<string, string>();
let current: string | null = null;
let settledAt = 0;
let last: Snapshot | null = null;

function setStack(channelId: string, stack: (string | null)[]) {
    const stacks = { ...useStacks.getState().stacks };
    if (stack.length) stacks[channelId] = stack;
    else delete stacks[channelId];
    useStacks.setState({ stacks });
}

function onChange() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return;
    const m = MessageStore.getMessages(channelId);
    if (!m.ready) return;
    const snap = { seq: m.jumpSequenceId, target: m.jumpTargetId, atPresent: !m.hasMoreAfter && (!m.jumped || m.jumpedToPresent) };
    const prev = last;
    last = snap;
    if (channelId !== current || !prev) {
        current = channelId;
        settledAt = Date.now() + SETTLE_MS;
        return;
    }
    if (prev.seq === snap.seq || !m.jumped || Date.now() < settledAt) return;
    const stack = useStacks.getState().stacks[channelId] ?? [];
    if (m.jumpedToPresent || !m.jumpTargetId) {
        if (stack.length) setStack(channelId, []);
        return;
    }
    if (returning.get(channelId) === m.jumpTargetId) {
        returning.delete(channelId);
        return;
    }
    const from = m.jumpReturnTargetId ?? (prev.atPresent ? null : prev.target);
    if (from === m.jumpTargetId) return;
    setStack(channelId, [...stack, from].slice(-MAX_STEPS));
}

function goBack(channelId: string) {
    const stack = useStacks.getState().stacks[channelId] ?? [];
    if (!stack.length) return;
    const target = stack[stack.length - 1];
    setStack(channelId, stack.slice(0, -1));
    if (target === null) {
        MessageActions.jumpToPresent(channelId, 50);
        return;
    }
    returning.set(channelId, target);
    MessageActions.jumpToMessage({ channelId, messageId: target, flash: true, jumpType: "INSTANT" });
}

const ReturnButton: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    const steps = useStacks(s => s.stacks[channel.id]?.length ?? 0);
    if (!isMainChat || !steps) return null;
    return (
        <ChatBarButton
            tooltip={steps > 1 ? `Return to where you were (${steps} steps)` : "Return to where you were"}
            onClick={() => goBack(channel.id)}
        >
            <ReplyIcon width={20} height={20} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "ReturnFromJump",
    description: "Shows a button in the chat bar after you jump to a reply, search result or pin, so one click takes you back to where you were reading.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],

    chatBarButton: {
        icon: ReplyIcon,
        render: ReturnButton
    },

    start() {
        MessageStore.addChangeListener(onChange);
        SelectedChannelStore.addChangeListener(onChange);
    },

    stop() {
        MessageStore.removeChangeListener(onChange);
        SelectedChannelStore.removeChangeListener(onChange);
        useStacks.setState({ stacks: {} });
        returning.clear();
        current = null;
        last = null;
    }
});
