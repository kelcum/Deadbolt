/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import definePlugin, { PluginNative } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu, showToast } from "@webpack/common";

import { attachmentUrl, MAX_BYTES } from "../TextFilePreview/text";

type Attachment = Message["attachments"][number];
const Native = VencordNative?.pluginHelpers?.PDFPreview as PluginNative<typeof import("./native")> | undefined;
const eligible = (a: Attachment) => /\.pdf$/i.test(a.filename) && a.size <= MAX_BYTES && Boolean(attachmentUrl(a.url));
const label = (a: Attachment) => a.spoiler || a.filename.startsWith("SPOILER_") ? "Spoiler PDF" : a.filename;

async function open(attachment: Attachment) {
    if (!Native) return showToast({ text: "The native PDF viewer is unavailable on this client.", variant: "critical" });
    try {
        const result = await Native.previewPdf(attachment.url);
        if (!result.ok) showToast({ text: result.error ?? "Could not open PDF." });
    } catch {
        showToast({ text: "The PDF viewer could not be opened.", variant: "critical" });
    }
}

function Buttons({ message }: { message?: Message; }) {
    const files = message?.attachments?.filter(eligible);
    if (!files?.length) return null;
    return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{files.map(a => <Button key={a.id} size="xs" variant="secondary" onClick={() => void open(a)}>Preview PDF: {label(a)}</Button>)}</div>;
}

const menu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    const files = message?.attachments?.filter(eligible);
    if (files?.length) children.push(<Menu.MenuItem id="db-pdf-preview" label="Preview PDF">{files.map(a => <Menu.MenuItem key={a.id} id={`db-pdf-${a.id}`} label={label(a)} action={() => void open(a)} />)}</Menu.MenuItem>);
};

export default definePlugin({ name: "PDFPreview", description: "Open PDF attachments in a separate isolated desktop viewer, using the client's PDF renderer.", authors: [Devs.Zot], tags: ["Media", "Utility"], renderMessageAccessory: Buttons, contextMenus: { message: menu } });
