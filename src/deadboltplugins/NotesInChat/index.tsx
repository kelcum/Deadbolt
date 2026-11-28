/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NotesIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Constants, FluxDispatcher, NoteStore, RestAPI, Tooltip, UserStore, useStateFromStores } from "@webpack/common";

const cl = classNameFactory("vc-notes-in-chat-");
const logger = new Logger("NotesInChat");

async function loadNotes() {
    const { body } = await RestAPI.get({ url: Constants.Endpoints.NOTES });
    for (const [id, note] of Object.entries(body as Record<string, string>))
        FluxDispatcher.dispatch({ type: "USER_NOTE_UPDATE", id, note });
}

function NoteIcon({ userId }: { userId: string; }) {
    const note = useStateFromStores([NoteStore], () => NoteStore.getNote(userId)?.note);
    if (!note) return null;

    return (
        <Tooltip text={note} tooltipContentClassName={cl("tooltip")}>
            {props => (
                <span {...props} className={cl("icon")} aria-label={`Your note: ${note}`}>
                    <NotesIcon width={16} height={16} />
                </span>
            )}
        </Tooltip>
    );
}

export default definePlugin({
    name: "NotesInChat",
    description: "Shows a note icon next to the name of anyone you have written a Discord note about. Hover it to read the note.",
    tags: ["Chat", "Friends"],
    authors: [Devs.K3],
    dependencies: ["MessageDecorationsAPI"],
    flux: {
        CONNECTION_OPEN: loadNotes
    },
    start() {
        if (UserStore.getCurrentUser()) loadNotes().catch(e => logger.error("Could not load your notes.", e));
    },
    renderMessageDecoration({ message }) {
        return <NoteIcon userId={message.author.id} />;
    }
});
