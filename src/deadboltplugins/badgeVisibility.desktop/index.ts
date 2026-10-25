/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "BadgeVisibility",
    description: "Lets the Deadbolt creator hide or show their Deadbolt badges for everyone.",
    authors: [Devs.K3],
    required: true,
    hidden: true,
});
