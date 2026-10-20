/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import img_166fe28fc2c180a4 from "file://166fe28fc2c180a4.png?base64";
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
];
