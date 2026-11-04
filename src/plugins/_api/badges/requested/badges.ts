/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import img_3b7a05876fba5c07 from "file://3b7a05876fba5c07.png?base64";
import img_166fe28fc2c180a4 from "file://166fe28fc2c180a4.png?base64";
import img_67334176be871a31 from "file://67334176be871a31.gif?base64";
import img_eba83c3c42fe5637 from "file://eba83c3c42fe5637.jpg?base64";

import type { RequestedBadgeEntry } from "../requestedBadges";

export const requestedBadges: RequestedBadgeEntry[] = [
    {
        id: "166fe28fc2c180a4",
        users: ["195516525631897600"],
        name: "llama",
        image: `data:image/png;base64,${img_166fe28fc2c180a4}`,
        design: { shape: "none", background: "none", colors: [0xd97af0, 0x0b33b3, 0x6031b5, 0x35343d], effects: ["shine", "glint", "pulse"], speed: 1, zoom: 1, x: 0, y: 0, rotate: 0 },
    },
    {
        id: "eba83c3c42fe5637",
        users: ["720465317226086413"],
        name: "BT-7274",
        image: `data:image/jpeg;base64,${img_eba83c3c42fe5637}`,
        design: { shape: "circle", background: "gradient", colors: [0x000000, 0xffffff], effects: ["pulse", "shine", "glint"], speed: 1, zoom: 2, x: 0.243, y: -0.07, rotate: 0 },
    },
    {
        id: "67334176be871a31",
        users: ["1537438364607840287"],
        name: "immortal",
        image: `data:image/gif;base64,${img_67334176be871a31}`,
        design: { shape: "circle", background: "gradient", colors: [0x000000, 0x6a6970], effects: ["shine", "glint", "spin", "pulse"], speed: 0.7, zoom: 1.77, x: 0, y: 0, rotate: 0 },
    },
    {
        id: "3b7a05876fba5c07",
        users: ["1510759328372494506"],
        name: "Fuck idk",
        image: `data:image/png;base64,${img_3b7a05876fba5c07}`,
        design: { shape: "circle", background: "gradient", colors: [0xff0000, 0x07ff00], effects: ["shine", "glint", "pulse", "float"], speed: 1, zoom: 1.33, x: 0, y: 0.16, rotate: 0 },
    },
    {
        id: "5ff6b2b93ec7f7b5",
        users: ["1531412914005606513"],
        name: "Zot",
        image: null,
        design: { shape: "rounded", background: "gradient", colors: [0x000000, 0x191919], effects: ["shine", "glint"], speed: 1.15, zoom: 1, x: 0, y: 0, rotate: 0 },
    },
];
