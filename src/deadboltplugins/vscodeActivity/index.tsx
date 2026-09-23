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
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

const Native = VencordNative.pluginHelpers.VSCodeActivity as PluginNative<typeof import("./native")>;

const logger = new Logger("VSCodeActivity");

// Placeholder used when no real application ID is configured. Discord has
// no registered "detectable game" entry for VS Code at all (checked the
// public applications/detectable list), so without an app you own with an
// uploaded Rich Presence asset there's no icon to show - this just needs
// to be a syntactically valid id.
const PLACEHOLDER_APPLICATION_ID = "1000000000000000000";
const SOCKET_ID = "DeadboltVSCodeActivity";

const TITLE_SUFFIX = / - Visual Studio Code(?: - Insiders)?$/;

const DEFAULT_SPOOF_FILES = [
    "index.ts",
    "native.ts",
    "deadboltLoading.css",
    "PluginCard.tsx",
    "patcher.ts",
    "badges/index.tsx",
].join("\n");

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

async function buildActivity(parsed: ParsedTitle, sessionStart: number): Promise<Activity> {
    const appId = settings.store.applicationId.trim() || PLACEHOLDER_APPLICATION_ID;

    const activity = {
        application_id: appId,
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

    const assetKey = settings.store.iconAssetKey.trim();
    if (settings.store.applicationId.trim() && assetKey) {
        try {
            const assetId = (await ApplicationAssetUtils.fetchAssetIds(appId, [assetKey]))[0];
            if (assetId) {
                activity.assets = { large_image: assetId, large_text: "Visual Studio Code" };
            }
        } catch (e) {
            logger.warn("Failed to fetch custom icon asset, falling back to text-only", e);
        }
    }

    return activity;
}

let pollTimer: ReturnType<typeof setInterval> | undefined;
let spoofTimer: ReturnType<typeof setInterval> | undefined;
let spoofIndex = 0;
let sessionStart = 0;
let lastKey = "";

function clearActivity() {
    if (!lastKey) return;
    lastKey = "";
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: SOCKET_ID });
}

async function pushActivity(parsed: ParsedTitle, keyPrefix: string) {
    const key = keyPrefix + activityKey(parsed);
    if (key === lastKey) return;
    lastKey = key;

    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: await buildActivity(parsed, sessionStart),
        socketId: SOCKET_ID
    });
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
        await pushActivity(parseTitle(title), "real:");
    } catch (e) {
        logger.error("Failed to poll VS Code window title", e);
    }
}

function getSpoofFileList(): string[] {
    return settings.store.spoofFiles.split("\n").map(f => f.trim()).filter(Boolean);
}

async function spoofPoll() {
    try {
        const files = getSpoofFileList();
        if (!files.length) return;

        if (!sessionStart) sessionStart = Date.now();

        await pushActivity({
            file: files[spoofIndex % files.length],
            workspace: settings.store.spoofWorkspace.trim() || undefined,
            dirty: false
        }, "spoof:");
    } catch (e) {
        logger.error("Failed to update spoofed activity", e);
    }
}

function advanceSpoof() {
    spoofIndex++;
    spoofPoll();
}

// Some settings (icon, display toggles) don't change the file/workspace
// key pushActivity() dedupes on, so changing them alone would otherwise
// sit there unapplied until the next natural rotation/poll. Force it.
function refreshNow() {
    lastKey = "";
    if (settings.store.spoofMode) spoofPoll(); else poll();
}

function startPolling() {
    stopPolling();
    sessionStart = 0;
    lastKey = "";

    if (settings.store.spoofMode) {
        spoofIndex = 0;
        spoofPoll();
        const minutes = Math.max(1, settings.store.spoofRotateMinutes);
        spoofTimer = setInterval(advanceSpoof, minutes * 60000);
    } else {
        poll();
        pollTimer = setInterval(poll, settings.store.pollInterval);
    }
}

function stopPolling() {
    if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
    }
    if (spoofTimer !== undefined) {
        clearInterval(spoofTimer);
        spoofTimer = undefined;
    }
    sessionStart = 0;
    clearActivity();
}

const settings = definePluginSettings({
    spoofMode: {
        description: "Always show as actively editing (a rotating fake file), regardless of whether VS Code is actually open or what you're really doing",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: () => startPolling()
    },
    spoofWorkspace: {
        description: "Workspace/folder name to show while spoofing",
        type: OptionType.STRING,
        default: "Deadbolt",
        onChange: refreshNow
    },
    spoofFiles: {
        description: "Files to rotate through while spoofing, one per line",
        type: OptionType.STRING,
        default: DEFAULT_SPOOF_FILES,
        multiline: true,
        onChange: refreshNow
    },
    spoofRotateMinutes: {
        description: "How often to switch to a different fake file while spoofing (minutes)",
        type: OptionType.NUMBER,
        default: 6,
        onChange: () => startPolling()
    },
    pollInterval: {
        description: "How often to check VS Code's real window title (ms) - ignored while spoofing",
        type: OptionType.NUMBER,
        default: 15000,
        onChange: () => startPolling()
    },
    showWorkspace: {
        description: "Show the workspace/folder name as the status line",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: refreshNow
    },
    showDirtyIndicator: {
        description: "Note when the current (real) file has unsaved changes",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: refreshNow
    },
    applicationId: {
        description: "Optional: your own Discord application ID (developer portal) with an uploaded Rich Presence asset, for a real icon. Leave blank for text-only.",
        type: OptionType.STRING,
        default: "",
        onChange: refreshNow
    },
    iconAssetKey: {
        description: "Asset key name you uploaded under that application's Rich Presence tab",
        type: OptionType.STRING,
        default: "vscode",
        onChange: refreshNow
    },
});

export default definePlugin({
    name: "VSCodeActivity",
    description: "Replaces Discord's generic 'Playing Visual Studio Code' detection with the actual file/workspace you're editing (or, in spoof mode, a fake rotating one). Real mode reads Code.exe's own window title, Windows only. Pair with IgnoreActivities to hide the generic entry.",
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
