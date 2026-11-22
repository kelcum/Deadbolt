/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { CloudUpload, RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, DraftType, Modal, openModal, showToast, UploadAttachmentStore, UploadHandler, UploadManager, useEffect, useRef, useState } from "@webpack/common";
import type { PointerEvent, ReactNode } from "react";

interface ActionBarIconProps {
    tooltip: string;
    onClick(): void;
    children: ReactNode;
}

interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

type Tool = "crop" | "hide";

const ActionBarIcon = findComponentByCodeLazy<ActionBarIconProps>("Children.map", "isValidElement", "dangerous:");

const cl = classNameFactory("vc-pastecrop-");
const logger = new Logger("PasteCrop");
const EDITABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

const settings = definePluginSettings({
    coverStyle: {
        type: OptionType.SELECT,
        description: "How the parts you hide get covered.",
        options: [
            { label: "Blur", value: "blur", default: true },
            { label: "Pixelate", value: "pixelate" },
            { label: "Solid black box", value: "solid" }
        ]
    }
});

function blankCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function context(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    return ctx;
}

function crop(source: HTMLCanvasElement, { x, y, w, h }: Box) {
    const out = blankCanvas(w, h);
    context(out).drawImage(source, x, y, w, h, 0, 0, w, h);
    return out;
}

function cover(source: HTMLCanvasElement, { x, y, w, h }: Box) {
    const out = blankCanvas(source.width, source.height);
    const ctx = context(out);
    ctx.drawImage(source, 0, 0);
    const size = Math.max(source.width, source.height);

    switch (settings.store.coverStyle) {
        case "solid":
            ctx.fillStyle = "#000";
            ctx.fillRect(x, y, w, h);
            break;
        case "pixelate": {
            const block = Math.max(8, Math.round(size / 80));
            const small = blankCanvas(Math.ceil(w / block), Math.ceil(h / block));
            context(small).drawImage(source, x, y, w, h, 0, 0, small.width, small.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
            break;
        }
        default: {
            const radius = Math.max(8, Math.round(size / 60));
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.filter = `blur(${radius}px)`;
            for (let pass = 0; pass < 2; pass++) ctx.drawImage(out, 0, 0);
            ctx.restore();
        }
    }
    return out;
}

function toFile(canvas: HTMLCanvasElement, name: string, type: string) {
    return new Promise<File>((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(new File([blob], name, { type })) : reject(new Error("Could not encode the image")),
        type,
        0.92
    ));
}

async function replaceUpload(upload: CloudUpload, file: File) {
    const { channelId } = upload;
    const before = [...UploadAttachmentStore.getUploads(channelId, DraftType.ChannelMessage)];
    await UploadHandler.promptToUpload([file], ChannelStore.getChannel(channelId), DraftType.ChannelMessage);

    const uploads = UploadAttachmentStore.getUploads(channelId, DraftType.ChannelMessage);
    const added = uploads.find(u => !before.includes(u));
    if (!added) return;

    added.spoiler = upload.spoiler;
    added.description = upload.description;
    added.filename = upload.filename;
    UploadManager.setUploads({
        channelId,
        draftType: DraftType.ChannelMessage,
        uploads: uploads.filter(u => u !== added).map(u => u === upload ? added : u)
    });
}

function Editor({ modalProps, upload }: { modalProps: RenderModalProps; upload: CloudUpload; }) {
    const [history, setHistory] = useState<HTMLCanvasElement[]>([]);
    const [tool, setTool] = useState<Tool>("hide");
    const [box, setBox] = useState<Box | null>(null);
    const [saving, setSaving] = useState(false);
    const view = useRef<HTMLCanvasElement>(null);
    const start = useRef<{ x: number; y: number; } | null>(null);
    const current = history[history.length - 1];

    useEffect(() => {
        createImageBitmap(upload.item.file).then(bitmap => {
            const canvas = blankCanvas(bitmap.width, bitmap.height);
            context(canvas).drawImage(bitmap, 0, 0);
            bitmap.close();
            setHistory([canvas]);
        }, err => {
            logger.error("Could not open the image", err);
            showToast({ text: "This image could not be opened.", variant: "critical" });
            modalProps.onClose();
        });
    }, []);

    useEffect(() => {
        if (!current || !view.current) return;
        view.current.width = current.width;
        view.current.height = current.height;
        context(view.current).drawImage(current, 0, 0);
    }, [current]);

    const point = (e: PointerEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));
        return {
            x: clamp((e.clientX - rect.left) / rect.width * current.width, current.width),
            y: clamp((e.clientY - rect.top) / rect.height * current.height, current.height)
        };
    };

    const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
        if (!current || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setBox(null);
    };

    const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
        if (!start.current) return;
        const end = point(e);
        setBox({
            x: Math.min(start.current.x, end.x),
            y: Math.min(start.current.y, end.y),
            w: Math.abs(end.x - start.current.x),
            h: Math.abs(end.y - start.current.y)
        });
    };

    const onPointerUp = () => {
        start.current = null;
        setBox(null);
        if (!box || box.w < 4 || box.h < 4) return;
        setHistory([...history, tool === "crop" ? crop(current, box) : cover(current, box)]);
    };

    const save = async () => {
        setSaving(true);
        try {
            await replaceUpload(upload, await toFile(current, upload.filename, upload.item.file.type));
            modalProps.onClose();
        } catch (err) {
            logger.error("Could not save the edited image", err);
            showToast({ text: "Could not save the edited image.", variant: "critical" });
            setSaving(false);
        }
    };

    return (
        <Modal
            {...modalProps}
            title="Crop or hide"
            size="lg"
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Save", variant: "primary", disabled: history.length < 2, loading: saving, onClick: save }
            ]}
        >
            <div className={cl("toolbar")}>
                <Button size="small" variant={tool === "hide" ? "primary" : "secondary"} onClick={() => setTool("hide")}>Hide</Button>
                <Button size="small" variant={tool === "crop" ? "primary" : "secondary"} onClick={() => setTool("crop")}>Crop</Button>
                <Button size="small" variant="secondary" disabled={history.length < 2} onClick={() => setHistory(history.slice(0, -1))}>Undo</Button>
            </div>
            <Paragraph className={cl("hint")}>
                {tool === "crop" ? "Drag over the part you want to keep." : "Drag over anything you want to hide."}
            </Paragraph>
            <div className={cl("stage")}>
                <canvas
                    ref={view}
                    className={cl("canvas")}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                />
                {box && current && (
                    <div
                        className={cl("box", tool)}
                        style={{
                            left: `${box.x / current.width * 100}%`,
                            top: `${box.y / current.height * 100}%`,
                            width: `${box.w / current.width * 100}%`,
                            height: `${box.h / current.height * 100}%`
                        }}
                    />
                )}
            </div>
        </Modal>
    );
}

const CropIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path fill="currentColor" d="M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z" />
    </svg>
);

export default definePlugin({
    name: "PasteCrop",
    description: "Adds a crop button to images waiting to be sent, so you can trim a pasted screenshot or blur out private parts before it uploads.",
    tags: ["Privacy", "Media"],
    authors: [Devs.K3],
    settings,

    patches: [
        {
            find: "#{intl::ATTACHMENT_UTILITIES_SPOILER}",
            replacement: {
                match: /(?<=children:\[)(?=.{10,80}tooltip:.{0,100}#{intl::ATTACHMENT_UTILITIES_SPOILER})/,
                replace: "arguments[0].canEdit!==false?$self.CropButton(arguments[0]):null,"
            }
        }
    ],

    CropButton: ErrorBoundary.wrap(({ upload }: { upload: CloudUpload; }) => {
        if (!upload.isImage || !EDITABLE.has(upload.item.file.type)) return null;
        if (!UploadAttachmentStore.getUploads(upload.channelId, DraftType.ChannelMessage).includes(upload)) return null;

        return (
            <ActionBarIcon
                tooltip="Crop or hide parts"
                onClick={() => openModal(props => <Editor modalProps={props} upload={upload} />)}
            >
                <CropIcon />
            </ActionBarIcon>
        );
    }, { noop: true })
});
