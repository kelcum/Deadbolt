/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./requestedBadges.css";

import { BadgePosition, ProfileBadge } from "@api/Badges";
import * as DataStore from "@api/DataStore";
import { BadgeDesign, BadgeName, BadgePreview } from "@components/settings/tabs/vencord/BadgeDesigner";
import { Logger } from "@utils/Logger";
import { Tooltip } from "@webpack/common";

import { requestedBadges } from "./requested/badges";

export interface RequestedBadgeEntry {
    id: string;
    users: string[];
    name: string;
    image: string | null;
    design: BadgeDesign;
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
}

const PUBLISHED_URL = "https://raw.githubusercontent.com/kelcum/Deadbolt/main/src/plugins/_api/badges/requested";
const CACHE_KEY = "Deadbolt_RequestedBadges";
const IMAGE_FILE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

const logger = new Logger("RequestedBadges");

let entries: RequestedBadgeEntry[] = requestedBadges;
const badgeFor = new WeakMap<RequestedBadgeEntry, ProfileBadge>();

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

    return {
        id: `requested_${entry.id}`,
        description: entry.name,
        key: `requested_${entry.id}`,
        component: Component,
        position: BadgePosition.START,
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

export const RequestedBadges: ProfileBadge = {
    id: "requested_badges",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => entries.some(e => e.users.includes(userId)),
    getBadges: ({ userId }) => entries.filter(e => e.users.includes(userId)).map(getBadge),
};

async function fetchImage(file: string, type: string | null) {
    if (!IMAGE_FILE.test(file)) throw new Error(`Bad badge image name: ${file}`);
    const res = await fetch(`${PUBLISHED_URL}/${file}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const blob = new Blob([await res.arrayBuffer()], { type: type ?? res.headers.get("content-type") ?? "image/png" });
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function toEntry(e: PublishedEntry, old: CachedEntry | undefined): Promise<CachedEntry> {
    const imageKey = e.image ? `${e.image}:${e.imageHash ?? ""}` : null;
    const image = !e.image
        ? null
        : old?.image && old.imageKey === imageKey && e.imageHash
            ? old.image
            : await fetchImage(e.image, e.imageType);

    return {
        id: e.id,
        users: e.users.map(String),
        name: e.name,
        image,
        imageKey,
        design: { ...e.design, colors: e.colors.map(c => parseInt(c.replace("#", ""), 16)) },
    };
}

let loading: Promise<void> | null = null;

async function load() {
    const cached = await DataStore.get<CachedEntry[]>(CACHE_KEY).catch(() => undefined);
    if (cached?.length && entries === requestedBadges) entries = cached;

    const res = await fetch(`${PUBLISHED_URL}/badges.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`badges.json: ${res.status}`);
    const published: PublishedEntry[] = await res.json();

    const known = new Map((cached ?? []).map(e => [e.id, e]));
    const next = await Promise.all(published.map(e => toEntry(e, known.get(e.id))));

    entries = next;
    await DataStore.set(CACHE_KEY, next);
}

export function loadRequestedBadges() {
    loading ??= load()
        .catch(e => logger.warn("Couldn't load the latest badges, using the saved ones", e))
        .finally(() => loading = null);
    return loading;
}
