/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher } from "@webpack/common";

const Native = VencordNative.pluginHelpers.VSCodeActivity as PluginNative<typeof import("./native")>;

const logger = new Logger("VSCodeActivity");

// Windows-only placeholder id - there's no owned Discord application with
// uploaded VS Code branded assets behind this, so the activity renders as
// text only (no icon). See the settings description for details.
const APPLICATION_ID = "1000000000000000000";
const SOCKET_ID = "DeadboltVSCodeActivity";

const TITLE_SUFFIX = / - Visual Studio Code(?: - Insiders)?$/;

interface ParsedTitle {
    file?: string;
    workspace?: string;
    dirty: boolean;
}

function parseTitle(rawTitle: string): ParsedTitle {
    let title = rawTitle.replace(TITLE_SUFFIX, "").trim();

    let dirty = false;
    if (title.startsWith("●")) {
        dirty = true;
        title = title.slice(1).trim();
    }

    if (!title) return { dirty };

    const parts = title.split(" - ").map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return { dirty };

    if (parts.length === 1) {
        // Ambiguous on its own: VS Code's title is either just the open
        // file or just the open folder here. Filenames always carry a
        // short extension; folder names almost never do.
        if (/\.[a-zA-Z0-9]{1,10}$/.test(parts[0])) return { file: parts[0], dirty };
        return { workspace: parts[0], dirty };
    }

    return { file: parts[0], workspace: parts[parts.length - 1], dirty };
}

function activityKey(parsed: ParsedTitle) {
    return `${parsed.file ?? ""}|${parsed.workspace ?? ""}|${parsed.dirty}`;
}

function buildActivity(parsed: ParsedTitle, sessionStart: number): Activity {
    const activity = {
        application_id: APPLICATION_ID,
        name: "Visual Studio Code",
        type: ActivityType.PLAYING,
        timestamps: { start: sessionStart },
        flags: ActivityFlags.INSTANCE,
    } as Activity;

    if (parsed.file) {
        activity.details = settings.store.showDirtyIndicator && parsed.dirty
            ? `Editing ${parsed.file} (unsaved)`
            : `Editing ${parsed.file}`;
    } else {
        activity.details = "Idle";
    }

    if (settings.store.showWorkspace && parsed.workspace) {
        activity.state = `Workspace: ${parsed.workspace}`;
    }

    return activity;
}

let pollTimer: ReturnType<typeof setInterval> | undefined;
let sessionStart = 0;
let lastKey = "";

function clearActivity() {
    if (!lastKey) return;
    lastKey = "";
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: SOCKET_ID });
}

async function poll() {
    try {
        const title = await Native.getVSCodeWindowTitle();

        if (!title) {
            sessionStart = 0;
            clearActivity();
            return;
        }

        if (!sessionStart) sessionStart = Date.now();

        const parsed = parseTitle(title);
        const key = activityKey(parsed);
        if (key === lastKey) return;
        lastKey = key;

        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: buildActivity(parsed, sessionStart),
            socketId: SOCKET_ID
        });
    } catch (e) {
        logger.error("Failed to poll VS Code window title", e);
    }
}

function startPolling() {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, settings.store.pollInterval);
}

function stopPolling() {
    if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
    }
    sessionStart = 0;
    clearActivity();
}

const settings = definePluginSettings({
    pollInterval: {
        description: "How often to check VS Code's window title (ms)",
        type: OptionType.NUMBER,
        default: 15000,
        onChange: () => startPolling()
    },
    showWorkspace: {
        description: "Show the open workspace/folder name as the status line",
        type: OptionType.BOOLEAN,
        default: true
    },
    showDirtyIndicator: {
        description: "Note when the current file has unsaved changes",
        type: OptionType.BOOLEAN,
        default: true
    },
});

export default definePlugin({
    name: "VSCodeActivity",
    description: "Replaces Discord's generic 'Playing Visual Studio Code' detection with the actual file/workspace you're editing, read from VS Code's own window title. Windows only. Pair with IgnoreActivities to hide the generic one.",
    tags: ["Activity"],
    authors: [Devs.K3],

    settings,

    start() {
        startPolling();
    },

    stop() {
        stopPolling();
    }
});
