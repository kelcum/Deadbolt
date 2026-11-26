/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin from "@utils/types";
import { markdownFormat, markdownPreview } from "@utils/zotExpansion";
import { chatButton, column, currentChannel, field, launchButton, owns, row, showPanel, Status } from "@utils/zotPanels";
import { useRef, useState } from "@webpack/common";

function Editor({ userId, close }: { userId: string; close(): void; }) {
    const [channel] = useState(() => currentChannel()?.id);
    const [text, setText] = useState("");
    const [status, setStatus] = useState("");
    const [reveal, setReveal] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null);
    function format(kind: string) {
        const start = input.current?.selectionStart ?? 0;
        const end = input.current?.selectionEnd ?? text.length;
        const next = markdownFormat(text.slice(start, end), kind);
        const formatted = text.slice(0, start) + next + text.slice(end);
        if (formatted.length > 20_000) { setStatus("The formatted draft exceeds 20,000 characters."); return; }
        setText(formatted);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start, start + next.length); });
    }
    return <div style={column}>
        <Text size="sm">Select text and choose formatting. Insert adds the formatted draft without sending it.</Text>
        <div style={row}>{["bold", "italic", "underline", "strike", "spoiler", "quote", "list", "code"].map(kind => <Button key={kind} size="xs" variant="secondary" onClick={() => format(kind)}>{kind}</Button>)}</div>
        <textarea ref={input} value={text} aria-label="Markdown draft" placeholder="Write or paste text here" style={{ ...field, minHeight: 180, resize: "vertical" }} maxLength={20_000} onChange={e => setText(e.target.value)} />
        <Text size="xs" color="text-muted">{text.length.toLocaleString()} characters · Markdown source</Text>
        <div style={row}><Text size="sm" weight="semibold">Formatting preview</Text><label><input type="checkbox" checked={reveal} onChange={e => setReveal(e.target.checked)}/> Reveal spoilers</label></div>
        <div style={{ ...field, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 160, overflowY: "auto", minHeight: 48 }}>{markdownPreview(text).map((part, i) => part.kind === "bold" ? <strong key={i}>{part.text}</strong> : part.kind === "italic" ? <em key={i}>{part.text}</em> : part.kind === "underline" ? <u key={i}>{part.text}</u> : part.kind === "strike" ? <s key={i}>{part.text}</s> : part.kind === "code" ? <pre key={i} style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-code, monospace)" }}>{part.text}</pre> : part.kind === "spoiler" ? <span key={i} style={{ borderRadius: 3, background: "var(--background-base-lowest)" }}>{reveal ? part.text : "[Spoiler hidden]"}</span> : <span key={i}>{part.text}</span>)}</div>
        <Text size="xs" color="text-muted">Preview supports the toolbar's inline formatting and code fences. Discord renders the final Markdown.</Text>
        <div style={row}><Button disabled={!text} onClick={() => { if (!owns(userId) || !channel || currentChannel()?.id !== channel) { setStatus("The channel changed. Reopen the editor."); return; } close(); insertTextIntoChatInputBox(text); }}>Insert into draft</Button><Button variant="secondary" disabled={!text} onClick={() => { if (owns(userId)) void copyToClipboard(text).then(() => setStatus("Copied."), () => setStatus("Clipboard unavailable.")); }}>Copy Markdown</Button></div><Status>{status}</Status>
    </div>;
}
function open() { showPanel("Formatting toolbar", Editor); }
export default definePlugin({ name: "FormattingToolbar", description: "Format selected text with a visual toolbar and insert the Markdown into your draft.", authors: [Devs.Zot], tags: ["Chat", "Utility"], chatBarButton: chatButton("Formatting toolbar", open), toolboxActions: { "Formatting toolbar": open }, settingsAboutComponent: launchButton("Open formatting toolbar", open) });
