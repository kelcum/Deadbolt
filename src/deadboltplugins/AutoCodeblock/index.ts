/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { DraftStore, DraftType, SelectedChannelStore } from "@webpack/common";

const settings = definePluginSettings({
    minLines: {
        type: OptionType.SLIDER,
        description: "How many lines pasted code needs before it gets wrapped.",
        markers: [2, 3, 4, 5, 6, 8, 10],
        default: 2
    },
    wrapUnknown: {
        type: OptionType.BOOLEAN,
        description: "Still wrap code when the language can't be told, just without a language.",
        default: true
    }
});

const LANGUAGES: [string, RegExp[]][] = [
    ["diff", [/^@@ -\d+(?:,\d+)? \+\d+/m, /^diff --git /m, /^(?:---|\+\+\+) [ab]\//m]],
    ["php", [/^<\?php/, /\$this->/, /\bfunction \w+\(.*\)\s*\{/, /\becho\s+["$]/]],
    ["html", [/^<!doctype html/i, /<\/(?:div|span|body|head|html|p|a|ul|li|script|style)>/i, /<(?:div|span|a|img|input|button|meta|link)\b[^>]*>/i]],
    ["xml", [/^<\?xml /, /<\/[\w:.-]+>\s*$/m]],
    ["tsx", [/^import .* from ["'].+["'];?$/m, /<[A-Z]\w*[\s/>]/, /:\s*(?:string|number|boolean|React\.\w+)\b/, /\binterface \w+\s*\{/]],
    ["ts", [/\binterface \w+(?:<.+>)?\s*(?:extends .+)?\{/, /\btype \w+(?:<.+>)?\s*=/, /:\s*(?:string|number|boolean|void|unknown|never)(?:\[\])?\s*[,;)=]/, /\b(?:export|import) .* from ["']/, /\bas const\b/, /\b(?:private|public|readonly) \w+\s*[:;]/]],
    ["js", [/\b(?:const|let|var) \w+\s*=/, /=>/, /\bfunction\s*\w*\(/, /\bconsole\.\w+\(/, /\brequire\(["']/, /\bdocument\.\w+/, /\bmodule\.exports\b/, /\basync \w*\(|\bawait\s/]],
    ["py", [/^\s*def \w+\(.*\)\s*(?:->.+)?:\s*$/m, /^\s*(?:from \w[\w.]* )?import \w+/m, /^\s*(?:elif|except|finally|with)\b.*:\s*$/m, /\bprint\(/, /\bself\.\w+/, /^\s*class \w+(?:\(.*\))?:\s*$/m, /\bNone\b|\bTrue\b|\bFalse\b/, /^if __name__ ==/m]],
    ["rust", [/\bfn \w+(?:<.+>)?\(/, /\blet mut \w+/, /\bimpl(?:<.+>)? \w+/, /\bpub (?:fn|struct|enum|mod)\b/, /\w+::\w+/, /\b(?:println|vec|format)!\(/, /&(?:mut |'\w+ )?self\b/]],
    ["go", [/^package \w+$/m, /\bfunc (?:\(\w+ \*?\w+\) )?\w+\(/, /\w+ := /, /\bfmt\.\w+\(/, /\bif err != nil\b/]],
    ["java", [/\bpublic (?:static )?(?:final )?(?:class|void|int|String)\b/, /\bSystem\.out\.print/, /^import java\./m, /@Override\b/, /\bnew \w+(?:<.*>)?\(/]],
    ["cs", [/^using System(?:\.\w+)*;$/m, /\bnamespace [\w.]+/, /\bConsole\.Write(?:Line)?\(/, /\b(?:public|private|internal) (?:static )?(?:async )?(?:void|string|int|Task)\b/, /\bvar \w+ = new\b/, /\{ get; (?:private )?set; \}/]],
    ["cpp", [/^#include\s*[<"]/m, /\bstd::\w+/, /\bint main\s*\(/, /\b(?:cout|cin|endl)\b/, /\btemplate\s*</, /->\w+/, /\bprintf\(/]],
    ["kotlin", [/\bfun \w+\(/, /\bval \w+(?::\s*\w+)?\s*=/, /\bprintln\(/, /\bdata class\b/, /\bwhen\s*\(.*\)\s*\{/]],
    ["swift", [/^import (?:SwiftUI|Foundation|UIKit)$/m, /\bfunc \w+\(.*\)\s*(?:->\s*\w+)?\s*\{/, /\bguard let\b|\bif let\b/, /\bvar body: some View\b/]],
    ["rb", [/^\s*def \w+[?!]?(?:\(.*\))?\s*$/m, /^\s*end\s*$/m, /\bputs\b/, /\battr_(?:accessor|reader)\b/, /\.each do \|/, /^require ["']/m]],
    ["lua", [/\blocal \w+\s*=/, /\bfunction [\w.:]+\(.*\)\s*$/m, /^\s*end\s*$/m, /\bthen\s*$/m, /~=/, /\bpairs\(/]],
    ["sql", [/\bSELECT\b[\s\S]+\bFROM\b/, /\bINSERT INTO\b/, /\bCREATE (?:TABLE|INDEX|VIEW)\b/, /\bUPDATE \w+ SET\b/, /\bWHERE\b/, /\b(?:LEFT|INNER|RIGHT) JOIN\b/, /\bORDER BY\b|\bGROUP BY\b/]],
    ["css", [/^\s*[.#]?[\w-]+(?:[\s>+~:.#[\]=-]+[\w-]*)*\s*\{\s*$/m, /^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/m, /@media\b|@keyframes\b|@import\b/, /:\s*var\(--[\w-]+\)/]],
    ["ps1", [/\$env:\w+/, /\b(?:Get|Set|New|Remove|Write|Invoke|Start|Test)-[A-Z]\w+/, /\bparam\s*\(/i, /\$_\.\w+|\$PSScriptRoot/, /-(?:eq|ne|lt|gt|like|match)\b/]],
    ["bash", [/^#!\/(?:usr\/)?bin\/(?:env )?(?:ba|z)?sh/, /^\s*(?:sudo |apt(?:-get)? |npm |pnpm |yarn |pip |git |cd |ls |echo |export |curl |wget |chmod |mkdir |rm )/m, /\$\{?\w+\}?/, /^\s*(?:fi|done|esac)\s*$/m, /\s(?:&&|\|\|)\s/, /\s\|\s\w+/]],
    ["dockerfile", [/^FROM \S+/m, /^(?:RUN|COPY|WORKDIR|ENTRYPOINT|CMD|EXPOSE|ENV) /m]],
    ["yaml", [/^[\w-]+:\s*$/m, /^\s+[\w-]+:\s+\S/m, /^\s*- [\w"'-]/m]],
    ["toml", [/^\[[\w.-]+\]\s*$/m, /^[\w-]+\s*=\s*(?:"|\d|true|false|\[)/m]]
];

const VSCODE_MODES: Record<string, string> = {
    typescriptreact: "tsx",
    javascriptreact: "jsx",
    typescript: "ts",
    javascript: "js",
    python: "py",
    shellscript: "bash",
    csharp: "cs",
    powershell: "ps1",
    ruby: "rb",
    plaintext: ""
};

const CODE_LINE = /[;{}()[\]]\s*$|^\s*[{}\])]|^(?: {2,}|\t)\S|^\s*(?:\/\/|\/\*|#!|<\/?[\w!?])|\s(?:=>|===?|!==?|&&|\|\||:=|->|::)\s|^\s*(?:import|export|return|const|let|var|def|fn|func|function|class|public|private|if|for|while)\b/;

function detectLanguage(code: string) {
    const trimmed = code.trim();
    if (/^[[{]/.test(trimmed)) {
        try {
            JSON.parse(trimmed);
            return "json";
        } catch {
            if (/^\{\s*"[\w-]+"\s*:/.test(trimmed)) return "json";
        }
    }

    let best = "";
    let bestScore = 1;
    for (const [lang, tests] of LANGUAGES) {
        const score = tests.reduce((n, re) => n + Number(re.test(code)), 0);
        if (score > bestScore) {
            best = lang;
            bestScore = score;
        }
    }
    return best;
}

function looksLikeCode(lines: string[], lang: string) {
    const filled = lines.filter(l => l.trim());
    const codeLines = filled.filter(l => CODE_LINE.test(l)).length;
    const proseLines = filled.filter(l => /[.!?]["')]?\s*$/.test(l) && l.trim().split(/\s+/).length > 6).length;
    return (lang !== "" || codeLines / filled.length >= 0.5) && proseLines / filled.length < 0.3;
}

function insideOpenCodeblock() {
    const channelId = SelectedChannelStore.getChannelId();
    const draft = channelId ? DraftStore.getDraft(channelId, DraftType.ChannelMessage) : "";
    return (draft.match(/```/g)?.length ?? 0) % 2 === 1;
}

function vscodeLanguage(data: DataTransfer) {
    const raw = data.getData("vscode-editor-data");
    if (!raw) return;
    try {
        const { mode } = JSON.parse(raw) as { mode?: string; };
        if (typeof mode === "string") return VSCODE_MODES[mode] ?? mode;
    } catch {
        return;
    }
}

function wrap(text: string, data: DataTransfer) {
    if (text.includes("```")) return;

    const code = text.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "");
    const lines = code.split("\n");
    if (lines.length < settings.store.minLines) return;

    const fromEditor = vscodeLanguage(data);
    const lang = fromEditor ?? detectLanguage(code);
    if (fromEditor === undefined && (!looksLikeCode(lines, lang) || (!lang && !settings.store.wrapUnknown))) return;

    return `\`\`\`${lang}\n${code}\n\`\`\``;
}

function onPaste(e: ClipboardEvent) {
    const { target, clipboardData } = e;
    if (!clipboardData || clipboardData.files.length || !(target instanceof Element)) return;

    const editor = target.closest("[data-slate-editor=\"true\"][role=\"textbox\"]");
    if (!editor || insideOpenCodeblock()) return;

    const fenced = wrap(clipboardData.getData("text/plain"), clipboardData);
    if (!fenced) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const data = new DataTransfer();
    data.setData("text/plain", fenced);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
}

export default definePlugin({
    name: "AutoCodeblock",
    description: "Wraps code you paste into the chat box in a code block with the right language, so it keeps its formatting and gets highlighted.",
    tags: ["Chat", "Utility"],
    authors: [Devs.K3],
    settings,

    start() {
        document.addEventListener("paste", onPaste, true);
    },

    stop() {
        document.removeEventListener("paste", onPaste, true);
    },

    wrap,
    detectLanguage
});
