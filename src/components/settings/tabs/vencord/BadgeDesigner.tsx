/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./BadgeRequestCard.css";

import { classNameFactory } from "@utils/css";
import { ColorPicker, React, TextInput, useEffect, useRef, useState } from "@webpack/common";

export const cl = classNameFactory("vc-badge-request-");

export type Shape = "circle" | "rounded" | "none";
export type Background = "gradient" | "solid" | "none";
export type Effect = "shine" | "glint" | "pulse" | "float" | "spin";

export interface BadgeDesign {
    shape: Shape;
    background: Background;
    colors: number[];
    effects: Effect[];
    speed: number;
    zoom: number;
    x: number;
    y: number;
    rotate: number;
}

export interface BadgeImage {
    name: string;
    url: string;
}

export interface BadgeFormState {
    discordId: string;
    name: string;
    badge: string;
    details: string;
    image: BadgeImage | null;
    design: BadgeDesign;
}

export const MAX_COLORS = 4;
export const MAX_IMAGE_BYTES = 1_500_000;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const PREVIEW_PX = 160;

const SHAPES: [Shape, string][] = [["circle", "Circle"], ["rounded", "Rounded"], ["none", "No frame"]];
const BACKGROUNDS: [Background, string][] = [["gradient", "Gradient"], ["solid", "Solid"], ["none", "None"]];
const STAGES: ["dark" | "light", string][] = [["dark", "Dark"], ["light", "Light"]];
const EFFECTS: [Effect, string][] = [["shine", "Shine"], ["glint", "Glint"], ["pulse", "Pulse"], ["float", "Float"], ["spin", "Spin"]];

export const DEFAULT_DESIGN: BadgeDesign = {
    shape: "circle",
    background: "gradient",
    colors: [0x7c6ff0, 0x1e1a4d],
    effects: ["shine", "glint"],
    speed: 1,
    zoom: 1,
    x: 0,
    y: 0,
    rotate: 0
};

const FIT_DEFAULTS = { zoom: 1, x: 0, y: 0, rotate: 0 };

export const toHex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function nameGradient(colors: number[]) {
    const c = colors.map(toHex);
    if (!c.length) return undefined;
    const stops = c.length === 1 ? [c[0], `color-mix(in srgb, ${c[0]} 45%, white)`, c[0]] : [...c, c[0]];
    return `linear-gradient(100deg, ${stops.join(", ")})`;
}

export function BadgeName({ name, colors }: { name: string; colors: number[]; }) {
    return (
        <span className={cl("name")} style={{ "--name-gradient": nameGradient(colors) } as React.CSSProperties}>
            {name}
        </span>
    );
}

export function backgroundCss(d: BadgeDesign) {
    const c = d.colors.map(toHex);
    if (d.background === "none" || !c.length) return "transparent";
    if (d.background === "solid" || c.length === 1) return c[0];
    return `linear-gradient(135deg, ${c.join(", ")})`;
}

const artTransform = (d: BadgeDesign) =>
    `translate(${(d.x * 100).toFixed(2)}%, ${(d.y * 100).toFixed(2)}%) rotate(${d.rotate}deg) scale(${d.zoom})`;

export function useBadgeForm(discordId: string, name: string) {
    const [state, setState] = useState<BadgeFormState>({
        discordId,
        name,
        badge: "",
        details: "",
        image: null,
        design: DEFAULT_DESIGN
    });
    return {
        state,
        set: (patch: Partial<BadgeFormState>) => setState(s => ({ ...s, ...patch })),
        setDesign: (patch: Partial<BadgeDesign>) => setState(s => ({ ...s, design: { ...s.design, ...patch } }))
    };
}

export type BadgeForm = ReturnType<typeof useBadgeForm>;

function loadImage(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

export async function renderBadgePng(design: BadgeDesign, image: string | null) {
    const S = PREVIEW_PX;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d")!;
    if (design.shape !== "none") {
        ctx.beginPath();
        if (design.shape === "circle") ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
        else ctx.roundRect(0, 0, S, S, S * 0.28);
        ctx.clip();
    }
    const colors = design.colors.map(toHex);
    if (design.shape !== "none" && design.background !== "none" && colors.length) {
        if (design.background === "solid" || colors.length === 1) {
            ctx.fillStyle = colors[0];
        } else {
            const g = ctx.createLinearGradient(0, 0, S, S);
            colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
            ctx.fillStyle = g;
        }
        ctx.fillRect(0, 0, S, S);
    }
    if (image) {
        const img = await loadImage(image);
        const fit = Math.min(S / img.naturalWidth, S / img.naturalHeight);
        const w = img.naturalWidth * fit, h = img.naturalHeight * fit;
        ctx.translate(S / 2 + design.x * S, S / 2 + design.y * S);
        ctx.rotate(design.rotate * Math.PI / 180);
        ctx.scale(design.zoom, design.zoom);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    return canvas.toDataURL("image/png").replace(/^data:[^,]*,/, "");
}

interface PreviewProps {
    design: BadgeDesign;
    image: string | null;
    size: number;
    onAdjust?(patch: Partial<BadgeDesign>): void;
}

export function BadgePreview({ design, image, size, onAdjust }: PreviewProps) {
    const ref = useRef<HTMLDivElement>(null);
    const latest = useRef({ design, onAdjust, image });
    latest.current = { design, onAdjust, image };
    const drag = useRef<{ px: number; py: number; x: number; y: number; } | null>(null);
    const fx = new Set(design.effects);
    const framed = design.shape !== "none";
    const canMove = !!(onAdjust && image);

    useEffect(() => {
        const el = ref.current;
        if (!el || !onAdjust) return;
        const wheel = (e: WheelEvent) => {
            const { design: d, onAdjust: adjust, image: img } = latest.current;
            if (!img || !adjust) return;
            e.preventDefault();
            adjust({ zoom: Math.round(clamp(d.zoom * Math.pow(1.1, -e.deltaY / 100), 0.1, 5) * 100) / 100 });
        };
        el.addEventListener("wheel", wheel, { passive: false });
        return () => el.removeEventListener("wheel", wheel);
    }, [!!onAdjust]);

    const mask = image ? { WebkitMaskImage: `url("${image}")`, maskImage: `url("${image}")` } : undefined;

    return (
        <div className={cl("float", fx.has("float") && "fx-float")} style={{ "--size": `${size}px`, "--speed": design.speed } as React.CSSProperties}>
            <div
                ref={ref}
                className={cl(
                    "medal",
                    `shape-${design.shape}`,
                    design.effects.map(f => `fx-${f}`),
                    canMove && "movable",
                    !image && (design.background === "none" || !framed) && "empty"
                )}
                style={{ "--glow": toHex(design.colors[0] ?? 0xffffff), "--bg": backgroundCss(design) } as React.CSSProperties}
                onPointerDown={e => {
                    if (!canMove) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { px: e.clientX, py: e.clientY, x: design.x, y: design.y };
                }}
                onPointerMove={e => {
                    const d = drag.current;
                    if (!d || !onAdjust) return;
                    onAdjust({
                        x: Math.round(clamp(d.x + (e.clientX - d.px) / size, -1, 1) * 1000) / 1000,
                        y: Math.round(clamp(d.y + (e.clientY - d.py) / size, -1, 1) * 1000) / 1000
                    });
                }}
                onPointerUp={() => { drag.current = null; }}
                onPointerCancel={() => { drag.current = null; }}
            >
                {image && (
                    <div className={cl("art")} style={{ transform: artTransform(design) }}>
                        <img className={cl("art-img")} src={image} alt="" draggable={false} />
                        {!framed && fx.has("glint") && <span className={cl("art-glint")} style={mask} />}
                        {!framed && fx.has("shine") && <span className={cl("art-shine")} style={mask} />}
                    </div>
                )}
                {framed && fx.has("glint") && <span className={cl("glint")} />}
                {framed && fx.has("shine") && <span className={cl("shine")} />}
            </div>
        </div>
    );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange(v: T): void; label: string; }) {
    return (
        <div className={cl("segmented")} role="radiogroup" aria-label={label}>
            {options.map(([v, text]) => (
                <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === value}
                    className={cl("segment", v === value && "segment-on")}
                    onClick={() => onChange(v)}
                >
                    {text}
                </button>
            ))}
        </div>
    );
}

function Slider({ label, value, min, max, step, format, onChange }: {
    label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void;
}) {
    return (
        <label className={cl("slider")}>
            <span className={cl("slider-label")}>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
            <span className={cl("slider-value")}>{format(value)}</span>
        </label>
    );
}

function Field({ label, hint, action, children, grow, disabled }: {
    label: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; grow?: boolean; disabled?: boolean;
}) {
    return (
        <section className={cl("field", grow && "grow", disabled && "field-disabled")}>
            <div className={cl("label")}>
                {label}
                {hint && <span className={cl("label-hint")}>{hint}</span>}
                {action && <span className={cl("label-action")}>{action}</span>}
            </div>
            {children}
        </section>
    );
}

function readImage(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export function BadgeDesigner({ form, avatar, onError }: { form: BadgeForm; avatar?: string; onError(message: string | null): void; }) {
    const { state, set, setDesign } = form;
    const { design } = state;
    const fileInput = useRef<HTMLInputElement>(null);
    const [stage, setStage] = useState<"dark" | "light">("dark");
    const idValid = /^\d{17,20}$/.test(state.discordId.trim());
    const fitChanged = design.zoom !== 1 || design.x !== 0 || design.y !== 0 || design.rotate !== 0;

    async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (!file) return;
        if (!IMAGE_TYPES.includes(file.type)) return onError("The image has to be a PNG, JPG, GIF or WebP.");
        if (file.size > MAX_IMAGE_BYTES) return onError("That image is too big. Keep it under 1.5 MB.");
        try {
            set({ image: { name: file.name, url: await readImage(file) } });
            setDesign(FIT_DEFAULTS);
            onError(null);
        } catch {
            onError("Couldn't read that image. Try another one.");
        }
    }

    const toggleEffect = (fx: Effect) =>
        setDesign({ effects: design.effects.includes(fx) ? design.effects.filter(f => f !== fx) : [...design.effects, fx] });

    return (
        <div className={cl("designer")}>
            <div className={cl("controls")}>
                <div className={cl("row")}>
                    <Field label="Discord ID" grow>
                        <TextInput
                            value={state.discordId}
                            onChange={v => set({ discordId: v.replace(/\D/g, "") })}
                            placeholder="195516525631897600"
                            maxLength={20}
                            error={state.discordId && !idValid ? "That's not a Discord ID." : undefined}
                        />
                    </Field>
                    <Field label="Username" grow>
                        <TextInput value={state.name} onChange={v => set({ name: v })} placeholder="your.name" maxLength={32} />
                    </Field>
                </div>

                <Field label="Badge name">
                    <TextInput value={state.badge} onChange={v => set({ badge: v })} placeholder="What it says when someone hovers it" maxLength={40} />
                </Field>

                <Field label="Image" hint="optional, animated works too">
                    <div className={cl("file")}>
                        <button type="button" className={cl("pill-button")} onClick={() => fileInput.current?.click()}>
                            {state.image ? "Change image" : "Upload image"}
                        </button>
                        {state.image
                            ? (
                                <>
                                    <span className={cl("file-name")}>{state.image.name}</span>
                                    <button type="button" className={cl("remove")} aria-label="Remove image" onClick={() => set({ image: null })}>×</button>
                                </>
                            )
                            : <span className={cl("hint")}>PNG, JPG, GIF or WebP, up to 1.5 MB</span>}
                    </div>
                    <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={pickImage} />
                </Field>

                {state.image && (
                    <Field
                        label="Position"
                        hint="or drag the preview and scroll to zoom"
                        action={fitChanged && <button type="button" className={cl("text-button")} onClick={() => setDesign(FIT_DEFAULTS)}>Reset</button>}
                    >
                        <div className={cl("sliders")}>
                            <Slider label="Zoom" value={design.zoom} min={0.1} max={5} step={0.01} format={v => `${Math.round(v * 100)}%`} onChange={zoom => setDesign({ zoom })} />
                            <Slider label="Left / right" value={design.x} min={-1} max={1} step={0.005} format={v => `${Math.round(v * 100)}`} onChange={x => setDesign({ x })} />
                            <Slider label="Up / down" value={design.y} min={-1} max={1} step={0.005} format={v => `${Math.round(v * 100)}`} onChange={y => setDesign({ y })} />
                            <Slider label="Rotate" value={design.rotate} min={-180} max={180} step={1} format={v => `${v}°`} onChange={rotate => setDesign({ rotate })} />
                        </div>
                    </Field>
                )}

                <div className={cl("row")}>
                    <Field label="Frame">
                        <Segmented label="Frame" value={design.shape} options={SHAPES} onChange={shape => setDesign({ shape })} />
                    </Field>
                    <Field label="Background" hint={design.shape === "none" ? "needs a frame" : undefined} disabled={design.shape === "none"}>
                        <Segmented label="Background" value={design.background} options={BACKGROUNDS} onChange={background => setDesign({ background })} />
                    </Field>
                </div>

                <Field label="Colors">
                    <div className={cl("colors")}>
                        {design.colors.map((c, i) => (
                            <div className={cl("color")} key={i}>
                                <ColorPicker
                                    color={c}
                                    showEyeDropper={false}
                                    onChange={v => setDesign({ colors: design.colors.map((old, j) => j === i ? v ?? old : old) })}
                                />
                                <code className={cl("hex")}>{toHex(c)}</code>
                                {design.colors.length > 1 && (
                                    <button
                                        type="button"
                                        className={cl("remove")}
                                        aria-label={`Remove ${toHex(c)}`}
                                        onClick={() => setDesign({ colors: design.colors.filter((_, j) => j !== i) })}
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {design.colors.length < MAX_COLORS && (
                            <button type="button" className={cl("pill-button")} onClick={() => setDesign({ colors: [...design.colors, 0xffffff] })}>
                                Add color
                            </button>
                        )}
                    </div>
                </Field>

                <Field label="Effects">
                    <div className={cl("chips")}>
                        {EFFECTS.map(([fx, text]) => (
                            <button
                                key={fx}
                                type="button"
                                aria-pressed={design.effects.includes(fx)}
                                className={cl("chip", design.effects.includes(fx) && "chip-on")}
                                onClick={() => toggleEffect(fx)}
                            >
                                {text}
                            </button>
                        ))}
                    </div>
                    {design.effects.length > 0 && (
                        <div className={cl("sliders")}>
                            <Slider label="Speed" value={design.speed} min={0.25} max={3} step={0.05} format={v => `${v.toFixed(2).replace(/\.?0+$/, "")}x`} onChange={speed => setDesign({ speed })} />
                        </div>
                    )}
                </Field>

                <Field label="Anything else?" hint="optional">
                    <textarea
                        className={cl("textarea")}
                        value={state.details}
                        onChange={e => set({ details: e.currentTarget.value })}
                        placeholder="How it should move, what it should show, where the idea came from..."
                        maxLength={1000}
                        rows={3}
                    />
                </Field>
            </div>

            <aside className={cl("preview-panel")}>
                <div className={cl("stage", `stage-${stage}`)}>
                    <BadgePreview design={design} image={state.image?.url ?? null} size={128} onAdjust={setDesign} />
                </div>
                <Segmented label="Preview background" value={stage} options={STAGES} onChange={v => setStage(v)} />
                <div className={cl("profile", `stage-${stage}`)}>
                    <div className={cl("profile-label")}>On a profile</div>
                    <div className={cl("profile-row")}>
                        {avatar && <img className={cl("avatar")} src={avatar} alt="" />}
                        <div className={cl("profile-text")}>
                            <div className={cl("profile-name")}>{state.name.trim() || "you"}</div>
                            <div className={cl("profile-badges")}>
                                <BadgePreview design={design} image={state.image?.url ?? null} size={22} />
                            </div>
                        </div>
                    </div>
                    <div className={cl("tooltip")}><BadgeName name={state.badge.trim() || "Badge name"} colors={design.colors} /></div>
                </div>
            </aside>
        </div>
    );
}
