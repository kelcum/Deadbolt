/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./BadgeRequestCard.css";

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SpecialCard } from "@components/settings/SpecialCard";
import { classNameFactory } from "@utils/css";
import { RenderModalProps } from "@vencord/discord-types";
import { ColorPicker, Modal, openModal, React, TextArea, TextInput, useRef, UserStore, useState } from "@webpack/common";

const cl = classNameFactory("vc-badge-request-");

const API = "https://api.xan.gripe/v1/badge-requests";
const MAX_COLORS = 4;
const MAX_IMAGE_BYTES = 1_000_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const CARD_COLOR = "#b3abf7";

const CREST = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 15 160 160">
<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f6f9fc"/><stop offset="15%" stop-color="#d4dbe3"/><stop offset="34%" stop-color="#a7b1bd"/><stop offset="49%" stop-color="#757f8b"/><stop offset="51%" stop-color="#6a7480"/><stop offset="66%" stop-color="#b6c0cb"/><stop offset="82%" stop-color="#e9eef4"/><stop offset="100%" stop-color="#c3ccd6"/></linearGradient></defs>
<rect x="4" y="15" width="160" height="160" rx="36" fill="#171A21"/>
<g transform="translate(84,95) scale(1.45)"><path d="M0 -4 L -32 -50" stroke="url(#c)" stroke-width="16" stroke-linecap="round" fill="none"/><path d="M0 -4 L 32 -50" stroke="url(#c)" stroke-width="16" stroke-linecap="round" fill="none"/><rect x="-9" y="-10" width="18" height="60" rx="9" fill="url(#c)"/><rect x="-26" y="26" width="52" height="16" rx="8" fill="url(#c)"/></g>
</svg>`);

const hexagon = (x: number, y: number, r: number, o: number) =>
    `<polygon points="${[0, 1, 2, 3, 4, 5].map(i => {
        const a = Math.PI / 3 * i + Math.PI / 6;
        return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ")}" fill="#fff" fill-opacity="${o}"/>`;

const sparkle = (x: number, y: number, r: number, o: number) =>
    `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff" fill-opacity="${o}"/>`;

const PATTERN = "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" preserveAspectRatio="xMidYMid slice">${[
    hexagon(470, 40, 34, 0.22),
    hexagon(610, 150, 46, 0.18),
    hexagon(330, 190, 24, 0.2),
    hexagon(760, 60, 28, 0.2),
    hexagon(120, 200, 30, 0.14),
    sparkle(540, 110, 18, 0.35),
    sparkle(700, 200, 14, 0.3),
    sparkle(380, 70, 12, 0.3),
    sparkle(250, 30, 10, 0.25),
    sparkle(690, 20, 9, 0.3),
    sparkle(30, 120, 11, 0.22),
].join("")}</svg>`);

const toHex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

function BadgeIcon() {
    return (
        <svg className={cl("icon")} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 2 4.5 6.3v8.4L12 19l7.5-4.3V6.3L12 2Zm0 4.2 1.4 2.9 3.2.4-2.3 2.2.6 3.2L12 13.4l-2.9 1.5.6-3.2-2.3-2.2 3.2-.4L12 6.2Z" />
            <path fill="currentColor" d="M8.5 19.6 12 21.6l3.5-2 .9 1.6L12 23.7l-4.4-2.5.9-1.6Z" />
        </svg>
    );
}

function readImage(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function BadgeRequestModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const me = UserStore.getCurrentUser();
    const [discordId, setDiscordId] = useState(me?.id ?? "");
    const [name, setName] = useState(me?.username ?? "");
    const [badge, setBadge] = useState("");
    const [colors, setColors] = useState<number[]>([0x7c6ff0]);
    const [details, setDetails] = useState("");
    const [image, setImage] = useState<{ name: string; data: string; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const idValid = /^\d{17,20}$/.test(discordId.trim());
    const ready = idValid && !!name.trim() && !!badge.trim() && colors.length > 0;

    async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) return setError("The image has to be a PNG, JPG, GIF or WebP.");
        if (file.size > MAX_IMAGE_BYTES) return setError("That image is too big. Keep it under 1 MB.");
        try {
            setImage({ name: file.name, data: await readImage(file) });
            setError(null);
        } catch {
            setError("Couldn't read that image. Try another one.");
        }
    }

    async function submit() {
        setSending(true);
        setError(null);
        try {
            const res = await fetch(API, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    discordId: discordId.trim(),
                    name: name.trim(),
                    badge: badge.trim(),
                    colors: colors.map(toHex),
                    details: details.trim(),
                    image: image?.data,
                    source: "deadbolt"
                })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}). Try again in a bit.`);
            setSent(true);
        } catch (e) {
            setError(e instanceof TypeError ? "Couldn't reach xan.gripe. Check your connection and try again." : String((e as Error).message ?? e));
        } finally {
            setSending(false);
        }
    }

    if (sent) {
        return (
            <Modal
                {...modalProps}
                title="Request sent"
                subtitle="Thanks for the idea!"
                actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}
            >
                <Paragraph>
                    Your idea for <b>{badge.trim()}</b> went straight to Deadbolt's owner. If it gets made, it shows up on your profile for everyone on Deadbolt after the next update.
                </Paragraph>
            </Modal>
        );
    }

    return (
        <Modal
            {...modalProps}
            title="Request a badge"
            subtitle="Tell us what you'd like and it goes straight to Deadbolt's owner."
            actions={[
                { text: "Cancel", variant: "secondary", onClick: modalProps.onClose },
                { text: "Send request", variant: "primary", onClick: submit, loading: sending, disabled: !ready || sending }
            ]}
            notice={error ? { message: error, type: "critical" } : undefined}
        >
            <Flex flexDirection="column" gap={16}>
                <Flex gap={12}>
                    <section className={cl("grow")}>
                        <HeadingSecondary>Discord ID</HeadingSecondary>
                        <TextInput
                            value={discordId}
                            onChange={v => setDiscordId(v.replace(/\D/g, ""))}
                            placeholder="195516525631897600"
                            maxLength={20}
                            error={discordId && !idValid ? "That's not a Discord ID." : undefined}
                        />
                    </section>
                    <section className={cl("grow")}>
                        <HeadingSecondary>Username</HeadingSecondary>
                        <TextInput value={name} onChange={setName} placeholder="your.name" maxLength={32} />
                    </section>
                </Flex>

                <section>
                    <HeadingSecondary>Badge name</HeadingSecondary>
                    <TextInput value={badge} onChange={setBadge} placeholder="What it says when someone hovers it" maxLength={40} />
                </section>

                <section>
                    <HeadingSecondary>Colors</HeadingSecondary>
                    <div className={cl("colors")}>
                        {colors.map((c, i) => (
                            <div className={cl("color")} key={i}>
                                <ColorPicker
                                    color={c}
                                    showEyeDropper={false}
                                    onChange={v => setColors(colors.map((old, j) => j === i ? v ?? old : old))}
                                />
                                <code className={cl("hex")}>{toHex(c)}</code>
                                {colors.length > 1 && (
                                    <button
                                        type="button"
                                        className={cl("remove")}
                                        aria-label={`Remove ${toHex(c)}`}
                                        onClick={() => setColors(colors.filter((_, j) => j !== i))}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {colors.length < MAX_COLORS && (
                            <Button variant="secondary" size="small" onClick={() => setColors([...colors, 0xffffff])}>
                                Add color
                            </Button>
                        )}
                    </div>
                </section>

                <section>
                    <HeadingSecondary>Anything else?</HeadingSecondary>
                    <TextArea
                        value={details}
                        onChange={setDetails}
                        placeholder="Animated or still, the style you want, what it should show..."
                        maxLength={1000}
                        rows={4}
                    />
                </section>

                <section>
                    <HeadingSecondary>Reference image</HeadingSecondary>
                    <Flex alignItems="center" gap={10}>
                        <Button variant="secondary" size="small" onClick={() => fileInput.current?.click()}>
                            {image ? "Change image" : "Choose image"}
                        </Button>
                        {image
                            ? (
                                <>
                                    <span className={cl("file")}>{image.name}</span>
                                    <button type="button" className={cl("remove")} aria-label="Remove image" onClick={() => setImage(null)}>×</button>
                                </>
                            )
                            : <span className={cl("hint")}>Optional. A logo or picture to base it on, up to 1 MB.</span>}
                    </Flex>
                    <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={pickImage} />
                </section>
            </Flex>
        </Modal>
    );
}

export function openBadgeRequestModal() {
    openModal(modalProps => <BadgeRequestModal modalProps={modalProps} />);
}

export function BadgeRequestCard() {
    return (
        <SpecialCard
            title="Custom Badges"
            subtitle="Want a badge of your own?"
            description="Send in an idea for a profile badge. If it gets made, everyone on Deadbolt sees it next to your name."
            cardImage={CREST}
            backgroundImage={PATTERN}
            backgroundColor={CARD_COLOR}
        >
            <Button variant="none" size="medium" type="button" onClick={openBadgeRequestModal} className={cl("button")}>
                <BadgeIcon />
                Request a badge
            </Button>
        </SpecialCard>
    );
}
