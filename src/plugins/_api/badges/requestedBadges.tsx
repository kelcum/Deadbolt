/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./requestedBadges.css";

import { BadgePosition, BadgeRarity, ProfileBadge } from "@api/Badges";
import * as DataStore from "@api/DataStore";
import { BadgeDesign, BadgeName, BadgePreview, renderBadgePng } from "@components/settings/tabs/vencord/BadgeDesigner";
import { Logger } from "@utils/Logger";
import { ContextMenuApi, Tooltip } from "@webpack/common";

import { BadgeContextMenu } from ".";
import { notifyBadgesChanged } from "./badgeChanges";
import { holdsEveryBadge, isBadgeHidden } from "./hiddenBadges";
import { requestedBadges } from "./requested/badges";

export interface RequestedBadgeEntry {
    id: string;
    users: string[];
    name: string;
    image: string | null;
    design: BadgeDesign;
    shared?: string[];
    pair?: string;
}

interface CachedEntry extends RequestedBadgeEntry {
    imageKey: string | null;
}

interface PublishedEntry {
    id: string;
    users: string[];
    name: string;
    colors: string[];
    image: string | null;
    imageType: string | null;
    imageHash?: string;
    design: Omit<BadgeDesign, "colors">;
    shared?: string[];
    request?: { pair?: string; };
}

const PUBLISHED_URL = "https://raw.githubusercontent.com/kelcum/Deadbolt/main/src/plugins/_api/badges/requested";
const LIVE_URL = "https://api.xan.gripe/v1/badges/published";
const commitUrl = (sha: string) => `https://raw.githubusercontent.com/kelcum/Deadbolt/${sha}/src/plugins/_api/badges/requested`;
const CACHE_KEY = "Deadbolt_RequestedBadges";
const IMAGE_FILE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

const logger = new Logger("RequestedBadges");

let entries: RequestedBadgeEntry[] = requestedBadges;
const badgeFor = new WeakMap<RequestedBadgeEntry, ProfileBadge>();
const drawnIcons = new Map<string, string>();
let drawing: Promise<void> = Promise.resolve();

const isBareImage = ({ image, design }: RequestedBadgeEntry) =>
    !!image && design.shape === "none" && design.background === "none" && design.zoom === 1 && !design.x && !design.y && !design.rotate;

const iconKey = (entry: RequestedBadgeEntry) =>
    `${entry.id}:${JSON.stringify(entry.design)}:${entry.image?.length ?? 0}:${entry.image?.slice(-64) ?? ""}`;

function makeBadge(entry: RequestedBadgeEntry): ProfileBadge {
    const Component = () => (
        <Tooltip text={<div className="vc-requested-badge-tip"><BadgeName name={entry.name} colors={entry.design.colors} /></div>}>
            {({ onMouseEnter, onMouseLeave }) => (
                <span
                    className="vc-requested-badge"
                    role="img"
                    aria-label={entry.name}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                >
                    <BadgePreview design={entry.design} image={entry.image} size={20} />
                </span>
            )}
        </Tooltip>
    );

    const icon = isBareImage(entry) ? entry.image! : drawnIcons.get(iconKey(entry));

    return {
        id: `requested_${entry.id}`,
        description: entry.name,
        iconSrc: icon,
        largeIconSrc: icon,
        key: `requested_${entry.id}`,
        name: entry.name,
        detail: "A custom badge made with the Deadbolt badge designer.",
        infoLabel: "Deadbolt",
        rarity: BadgeRarity.RARE,
        component: Component,
        position: BadgePosition.START,
        onContextMenu: (event, badge) => ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />),
    };
}

function getBadge(entry: RequestedBadgeEntry) {
    let badge = badgeFor.get(entry);
    if (!badge) {
        badge = makeBadge(entry);
        badgeFor.set(entry, badge);
    }
    return badge;
}

async function drawIcons() {
    let changed = false;
    for (const entry of entries) {
        const badge = getBadge(entry);
        if (badge.iconSrc) continue;
        try {
            const key = iconKey(entry);
            const src = drawnIcons.get(key) ?? `data:image/png;base64,${await renderBadgePng(entry.design, entry.image)}`;
            drawnIcons.set(key, src);
            badge.iconSrc = src;
            badge.largeIconSrc = src;
            changed = true;
        } catch (e) {
            logger.warn(`Couldn't draw the image for badge ${entry.id}`, e);
        }
    }
    if (changed) notifyBadgesChanged();
}

function drawAllIcons() {
    drawing = drawing.then(drawIcons, drawIcons);
}

export const requestedEntry = (id: string) => entries.find(e => e.id === id);

export const ownsRequestedBadge = (entry: RequestedBadgeEntry, userId: string) => entry.users.includes(userId) && !entry.shared?.includes(userId);

export const requestedEntries = () => entries;

export const ownedRequestedEntries = (userId: string) => entries.filter(e => ownsRequestedBadge(e, userId));

export function requestedBadgesOf(userId: string) {
    const all = holdsEveryBadge(userId);
    return entries.filter(e => all || e.users.includes(userId)).map(getBadge);
}

const shown = (userId: string) => requestedBadgesOf(userId).filter(b => !isBadgeHidden(userId, b.id));

export const RequestedBadges: ProfileBadge = {
    id: "requested_badges",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shown(userId).length > 0,
    getBadges: ({ userId }) => shown(userId),
};

async function fetchImage(base: string, file: string, type: string | null) {
    if (!IMAGE_FILE.test(file)) throw new Error(`Bad badge image name: ${file}`);
    const res = await fetch(`${base}/${file}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const blob = new Blob([await res.arrayBuffer()], { type: type ?? res.headers.get("content-type") ?? "image/png" });
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function toEntry(base: string, e: PublishedEntry, old: CachedEntry | undefined): Promise<CachedEntry> {
    const imageKey = e.image ? `${e.image}:${e.imageHash ?? ""}` : null;
    const image = !e.image
        ? null
        : old?.image && old.imageKey === imageKey && e.imageHash
            ? old.image
            : await fetchImage(base, e.image, e.imageType);

    return {
        id: e.id,
        users: e.users.map(String),
        name: e.name,
        image,
        imageKey,
        design: { ...e.design, colors: e.colors.map(c => parseInt(c.replace("#", ""), 16)) },
        shared: e.shared?.map(String),
        pair: e.request?.pair,
    };
}

async function fetchPublished(): Promise<{ base: string; published: PublishedEntry[]; }> {
    try {
        const res = await fetch(LIVE_URL, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${LIVE_URL}: ${res.status}`);
        const { commit, badges }: { commit: string; badges: PublishedEntry[]; } = await res.json();
        if (!/^[0-9a-f]{40}$/.test(commit) || !Array.isArray(badges)) throw new Error("Unexpected badge list");
        return { base: commitUrl(commit), published: badges };
    } catch (e) {
        logger.warn("Couldn't get the live badge list, falling back to GitHub", e);
        const res = await fetch(`${PUBLISHED_URL}/badges.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(`badges.json: ${res.status}`);
        return { base: PUBLISHED_URL, published: await res.json() };
    }
}

let loading: Promise<void> | null = null;

async function load() {
    const cached = await DataStore.get<CachedEntry[]>(CACHE_KEY).catch(() => undefined);
    if (cached?.length && entries === requestedBadges) {
        entries = cached;
        notifyBadgesChanged();
    }
    drawAllIcons();

    const { base, published } = await fetchPublished();

    const known = new Map((cached ?? []).map(e => [e.id, e]));
    const next = await Promise.all(published.map(e => toEntry(base, e, known.get(e.id))));

    entries = next;
    notifyBadgesChanged();
    drawAllIcons();
    await DataStore.set(CACHE_KEY, next);
}

export function loadRequestedBadges() {
    loading ??= load()
        .catch(e => logger.warn("Couldn't load the latest badges, using the saved ones", e))
        .finally(() => loading = null);
    return loading;
}
