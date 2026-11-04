/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityStatusDisplayType, ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher } from "@webpack/common";

import { fetchLyrics, lineIndexAt, lyricFields, LyricLine } from "./lyrics";

type SongActivity = Activity & {
    details: string;
    state: string;
    timestamps: { start: number; end?: number; };
};

const SOCKET_ID = "LyricsPresence";
const MIN_UPDATE_GAP_MS = 4000;
const LYRICS_RETRY_MS = 30_000;

const logger = new Logger("LyricsPresence");

let running = false;
let source: SongActivity | null = null;
let songKey: string | null = null;
let lines: LyricLine[] = [];
let lyricsRequest: AbortController | null = null;
let shownIndex = -1;
let lastUpdateAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function isSong(activity: Activity): activity is SongActivity {
    return activity.type === ActivityType.LISTENING
        && activity.application_id != null
        && activity.timestamps?.start != null
        && !!activity.details
        && !!activity.state;
}

function decorate(song: SongActivity): Activity {
    const index = lineIndexAt(lines, Date.now() - song.timestamps.start);
    if (index !== shownIndex) {
        shownIndex = index;
        lastUpdateAt = Date.now();
    }

    const { details, state, largeText } = lyricFields(
        { title: song.details, artist: song.state, album: song.assets?.large_text },
        lines,
        index
    );

    return {
        ...song,
        status_display_type: ActivityStatusDisplayType.DETAILS,
        details,
        state,
        assets: { ...song.assets, large_text: largeText }
    };
}

function recompute() {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        activity: null,
        socketId: SOCKET_ID
    });
}

function loadLyrics(song: SongActivity) {
    const { start, end } = song.timestamps;
    const request = lyricsRequest = new AbortController();

    fetchLyrics({
        title: song.details,
        artist: song.state,
        album: song.assets?.large_text,
        durationSeconds: end != null ? (end - start) / 1000 : undefined
    }, request.signal)
        .then(found => {
            if (request.signal.aborted) return;
            logger.info(`${found.length} synced lines for ${song.state} - ${song.details}`);
            lines = found;
            sync();
        })
        .catch(e => {
            if (request.signal.aborted) return;
            logger.error("Failed to fetch lyrics, retrying soon", e);
            retryTimer = setTimeout(() => {
                lyricsRequest = null;
                sync();
            }, LYRICS_RETRY_MS);
        });
}

function sync() {
    clearTimeout(timer);

    if (!running || !source) return;

    if (!lyricsRequest) loadLyrics(source);

    const now = Date.now();
    const position = now - source.timestamps.start;
    const index = lineIndexAt(lines, position);

    if (index !== shownIndex) {
        const wait = lastUpdateAt + MIN_UPDATE_GAP_MS - now;
        if (wait > 0) {
            timer = setTimeout(sync, wait);
            return;
        }
        recompute();
    }

    const nextLine = lines[index + 1];
    if (nextLine) timer = setTimeout(sync, nextLine.time - position);
}

function reset() {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    lyricsRequest?.abort();
    lyricsRequest = null;
    lines = [];
    shownIndex = -1;
}

export default definePlugin({
    name: "LyricsPresence",
    description: "Puts the lyrics of the current song in your status while a music app like Uprising shows Rich Presence, or the song title if it has no synced lyrics. It doesn't work with Discord's own Spotify connection. Your status changes about every 4 seconds and everyone can see the lyrics, explicit ones included. Song names are sent to lrclib.net to find them.",
    authors: [Devs.K3],

    patches: [
        {
            find: '"LocalActivityStore"',
            replacement: {
                match: /\.LISTENING.+?([,:])(?=!?\i\(\)\(\i,\i\))(?<=(\i)\.push.+?)/,
                replace: (m, separator, activities) => `${m}${activities}=$self.applyLyrics(${activities})${separator}`
            }
        }
    ],

    applyLyrics(activities: Activity[]) {
        if (!running) return activities;

        const song = activities.find(isSong) ?? null;

        if (song !== source) {
            source = song;

            const key = song && `${song.state}\u0001${song.details}`;
            if (key && key !== songKey) {
                songKey = key;
                reset();
            }

            setTimeout(sync);
        }

        return song ? activities.map(activity => activity === song ? decorate(song) : activity) : activities;
    },

    start() {
        running = true;
        recompute();
    },

    stop() {
        running = false;
        reset();
        source = null;
        songKey = null;
        recompute();
    }
});
