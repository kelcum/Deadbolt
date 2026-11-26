/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";
import "./syntax.css";

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { copyToClipboard } from "@utils/clipboard";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { Message, RenderModalProps } from "@vencord/discord-types";
import { Menu, Modal, openModal, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { detectLanguage, foldEnd, Language, tokens } from "./syntax";
import { attachmentUrl, decodeText, findMatch, indexText, isTextFile, MAX_BYTES, pageForLine, pageForOffset, readResponse } from "./text";

type Attachment = Message["attachments"][number];
const settings = definePluginSettings({
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show a full preview button below text attachments.",
        default: true
    }
});

export function canPreview(attachment: Attachment) {
    return isTextFile(attachment.filename, attachment.content_type) && Boolean(attachmentUrl(attachment.url));
}

export async function loadAttachment(attachment: Attachment, signal: AbortSignal) {
    const url = attachmentUrl(attachment.url);
    if (!url) throw new Error("Invalid Discord attachment URL.");
    if (attachment.size > MAX_BYTES) throw new Error("This file exceeds the 64 MiB preview limit.");
    try {
        const response = await fetch(url, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
        return await readResponse(response);
    } catch (error) {
        if (signal.aborted || !(error instanceof TypeError)) throw error;
        const native = VencordNative?.pluginHelpers?.TextFilePreview as PluginNative<typeof import("./native")> | undefined;
        if (!native?.fetchTextAttachment) throw new Error("Discord blocked the attachment preview. Try the desktop client or download the file.");
        const result = await native.fetchTextAttachment(url.href);
        if (!result.data) throw new Error(result.error ?? "Could not fetch the attachment.");
        return result.data;
    }
}

function Viewer({ attachment, userId, modalProps }: { attachment: Attachment; userId: string; modalProps: RenderModalProps; }) {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [file, setFile] = useState<ReturnType<typeof decodeText> & ReturnType<typeof indexText> | null>(null);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [page, setPage] = useState(0);
    const [query, setQuery] = useState("");
    const [match, setMatch] = useState(-1);
    const [line, setLine] = useState("");
    const [target, setTarget] = useState(0);
    const [wrap, setWrap] = useState(false);
    const [status, setStatus] = useState("");
    const scroll = useRef<HTMLDivElement>(null);
    const [language, setLanguage] = useState<Language | "auto">("auto");
    const [font, setFont] = useState(13);
    const [folded, setFolded] = useState<number[]>([]);

    useEffect(() => {
        if (account !== userId) {
            setFile(null);
            return;
        }
        const controller = new AbortController();
        let active = true;
        const timer = setTimeout(() => controller.abort(), 90_000);
        setFile(null);
        setError("");
        loadAttachment(attachment, controller.signal).then(buffer => {
            if (!active || controller.signal.aborted) return;
            const decoded = decodeText(buffer);
            setFile({ ...decoded, ...indexText(decoded.text) });
            setPage(0);
            setFolded([]);
            setMatch(-1);
            setTarget(0);
            setStatus("");
        }).catch(reason => {
            if (active) setError(controller.signal.aborted ? "Preview timed out." : reason instanceof Error ? reason.message : "Could not open attachment.");
        }).finally(() => {
            clearTimeout(timer);
            if (active && controller.signal.aborted) setError("Preview timed out.");
        });
        return () => {
            active = false;
            clearTimeout(timer);
            controller.abort();
        };
    }, [attachment, account, userId, revision]);

    useEffect(() => {
        if (!scroll.current) return;
        scroll.current.scrollTop = 0;
        if (target) (scroll.current.querySelector("mark") ?? scroll.current.querySelector(`[data-line="${target}"]`))?.scrollIntoView({ block: "center", inline: "nearest" });
    }, [page, target, file, match]);

    const section = file?.pages[page];
    const pageText = section && file ? file.text.slice(section.start, section.end) : "";
    const rows = pageText.split("\n");
    const selectedLanguage = language === "auto" ? detectLanguage(attachment.filename, file?.text.slice(0, 4000) ?? "") : language;
    const hidden = new Set<number>();
    for (const first of folded) {
        const start = first - (section?.firstLine ?? 1);
        if (start < 0 || start >= rows.length) continue;
        const end = foldEnd(rows, start);
        for (let i = start + 1; i <= end; i++) hidden.add(i);
    }
    if (section && file && section.end < file.text.length && pageText.endsWith("\n")) rows.pop();

    function navigate(next: number) {
        if (!file) return;
        setFolded([]);
        setPage(Math.max(0, Math.min(file.pages.length - 1, next)));
        setTarget(0);
        setMatch(-1);
        setStatus("");
    }

    function search(backwards = false) {
        if (!file || !query || account !== userId) return;
        const found = findMatch(file.text, query, match, backwards);
        setFolded([]);
        setMatch(found);
        if (found < 0) {
            setStatus("No matches found.");
            return;
        }
        const next = pageForOffset(file.pages, found);
        const entry = file.pages[next];
        const foundLine = entry.firstLine + file.text.slice(entry.start, found).split("\n").length - 1;
        setPage(next);
        setTarget(foundLine);
        setStatus(`Match on line ${foundLine.toLocaleString()}.`);
    }

    function jump() {
        if (!file) return;
        const number = Number(line);
        if (!Number.isInteger(number) || number < 1 || number > file.lineCount) {
            setStatus(`Enter a line between 1 and ${file.lineCount.toLocaleString()}.`);
            return;
        }
        setFolded([]);
        setPage(pageForLine(file.pages, number));
        setMatch(-1);
        setTarget(number);
        setStatus("");
    }

    async function copy(all: boolean) {
        if (!file || UserStore.getCurrentUser()?.id !== userId) return;
        try {
            await copyToClipboard(all ? file.text : pageText);
            setStatus(all ? "Full file copied." : "Section copied.");
        } catch {
            setStatus("Could not copy the text.");
        }
    }

    let offset = section?.start ?? 0;
    const canCopy = account === userId && Boolean(file && section) && !error;
    return <Modal {...modalProps} size="xl" title={
        <span className="db-tfp-header">
            <span className="db-tfp-filename" title={attachment.filename}>{attachment.filename}</span>
            <span className="db-tfp-header-actions">
                <Button size="small" variant="secondary" disabled={!canCopy} onClick={() => void copy(false)}>Copy section</Button>
                <Button size="small" disabled={!canCopy} onClick={() => void copy(true)}>Copy full file</Button>
            </span>
        </span>
    } subtitle="Full text preview">
        {account !== userId ? <Text size="sm">Account changed. Reopen the preview.</Text> : error ? <div className="db-tfp-panel">
            <Text size="sm" color="text-danger">{error}</Text>
            <Button size="small" variant="secondary" onClick={() => setRevision(n => n + 1)}>Retry</Button>
        </div> : !file || !section ? <Text size="sm" color="text-muted">Loading full attachment…</Text> : <div className="db-tfp-panel">
            <div className="db-tfp-tools">
                <Text size="xs" color="text-muted">{file.lineCount.toLocaleString()} lines · {file.encoding} · Complete file</Text>
                <Text size="xs" color="text-muted" role="status">{status}</Text>
                <label className="db-tfp-wrap"><input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} /> Wrap lines</label>
            </div>
            <div className="db-tfp-tools">
                <input className="db-tfp-search" aria-label="Search entire file" placeholder="Find in file (case sensitive)" value={query} maxLength={1000} onChange={e => { setQuery(e.target.value); setMatch(-1); setStatus(""); }} onKeyDown={e => { if (e.key === "Enter") search(e.shiftKey); }} />
                <Button size="small" variant="secondary" disabled={!query} onClick={() => search(true)}>Previous</Button>
                <Button size="small" disabled={!query} onClick={() => search()}>Find next</Button>
                <input className="db-tfp-line" aria-label="Line number" placeholder="Line" type="number" min={1} max={file.lineCount} value={line} onChange={e => setLine(e.target.value)} onKeyDown={e => { if (e.key === "Enter") jump(); }} />
                <Button size="small" variant="secondary" onClick={jump}>Go</Button>
            </div>
            {file.pages.length > 1 && <div className="db-tfp-tools">
                <Button size="small" variant="secondary" disabled={page === 0} onClick={() => navigate(0)}>First</Button>
                <Button size="small" variant="secondary" disabled={page === 0} onClick={() => navigate(page - 1)}>Previous section</Button>
                <Text size="xs" color="text-muted">{page + 1} / {file.pages.length} · Lines {section.firstLine.toLocaleString()}–{section.lastLine.toLocaleString()}</Text>
                <Button size="small" variant="secondary" disabled={page === file.pages.length - 1} onClick={() => navigate(page + 1)}>Next section</Button>
                <Button size="small" variant="secondary" disabled={page === file.pages.length - 1} onClick={() => navigate(file.pages.length - 1)}>Last</Button>
            </div>}
            <div className="db-tfp-tools db-code-tools">
                <label>Language <select value={language} onChange={e => setLanguage(e.target.value as Language | "auto")}><option value="auto">Auto ({selectedLanguage})</option>{["plain", "lua", "javascript", "python", "json", "shell", "c", "markup"].map(lang => <option key={lang}>{lang}</option>)}</select></label>
                <label>Font <input aria-label="Code font size" type="range" min={10} max={22} value={font} onChange={e => setFont(Number(e.target.value))} /> {font}px</label>
                {folded.length > 0 && <Button size="xs" variant="secondary" onClick={() => setFolded([])}>Expand all</Button>}
            </div>
            <div className="db-tfp-code" style={{ fontSize: font }} ref={scroll} tabIndex={0} aria-label="File contents">
                {rows.map((row, i) => {
                    const start = offset;
                    offset += row.length + 1;
                    const number = section.firstLine + i;
                    if (hidden.has(i)) return null;
                    const collapsible = selectedLanguage !== "plain" && i + 1 < rows.length && foldEnd(rows, i) > i;
                    const highlightStart = Math.max(0, match - start);
                    const highlightEnd = Math.min(row.length, match + query.length - start);
                    const highlight = match >= 0 && highlightEnd > highlightStart && highlightStart < row.length;
                    return <div className={`db-tfp-row${number === target ? " db-tfp-target" : ""}`} key={start} data-line={number}>
                        <span className="db-tfp-gutter">{collapsible && <button className="db-code-fold" aria-label={folded.includes(number) ? "Expand indented lines" : "Fold indented lines"} onClick={() => setFolded(old => old.includes(number) ? old.filter(n => n !== number) : [...old, number])}>{folded.includes(number) ? "▸" : "▾"}</button>}{number}</span>
                        <span className={wrap ? "db-tfp-text db-tfp-wrapped" : "db-tfp-text"}>{highlight ? <>{row.slice(0, highlightStart)}<mark>{row.slice(highlightStart, highlightEnd)}</mark>{row.slice(highlightEnd)}</> : (row ? tokens(row, selectedLanguage).map((token, j) => token.kind === "plain" ? token.text : <span key={j} className={`db-code-${token.kind}`}>{token.text}</span>) : " ")}{folded.includes(number) && <span className="db-code-comment"> …</span>}</span>
                    </div>;
                })}
            </div>
        </div>}
    </Modal>;
}

const SafeViewer = ErrorBoundary.wrap(Viewer);

export function openPreview(attachment: Attachment) {
    const userId = UserStore.getCurrentUser()?.id;
    if (userId) openModal(props => <SafeViewer attachment={attachment} userId={userId} modalProps={props} />);
}

function PreviewButtons({ message }: { message?: Message; }) {
    const { showButton } = settings.use(["showButton"]);
    if (!showButton || !message?.attachments?.length) return null;
    const attachments = message.attachments.filter(canPreview);
    if (!attachments.length) return null;
    return <div className="db-tfp-buttons">{attachments.map(attachment => <Button key={attachment.id} size="xs" variant="secondary" onClick={() => openPreview(attachment)}>
        Full preview: {(attachment.spoiler || attachment.filename.startsWith("SPOILER_")) ? "Spoiler file" : attachment.filename}
    </Button>)}</div>;
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    const attachments = message?.attachments?.filter(canPreview);
    if (!attachments?.length) return;
    children.push(<Menu.MenuItem id="db-full-text-preview" label="Preview full text file">
        {attachments.map(attachment => <Menu.MenuItem key={attachment.id} id={`db-text-${attachment.id}`} label={(attachment.spoiler || attachment.filename.startsWith("SPOILER_")) ? "Spoiler file" : attachment.filename} action={() => openPreview(attachment)} />)}
    </Menu.MenuItem>);
};

export default definePlugin({
    name: "TextFilePreview",
    description: "Open full text and code attachments with search, line numbers and copy controls.",
    authors: [Devs.Zot],
    tags: ["Chat", "Utility"],
    settings,
    contextMenus: { message: messageMenu },
    renderMessageAccessory: PreviewButtons
});
