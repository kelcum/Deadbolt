/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

const ENTRY_FILES = ["index.ts", "index.tsx"];
const PLUGIN_NAME_REGEX = /definePlugin\(\{\s*(["'])?name\1:\s*(["'`])(.+?)\2/;
const repoRoot = join(__dirname, "..", "..");

export async function addUserPlugin(_: IpcMainInvokeEvent, folder: string, code: string, replace: boolean): Promise<{ error: string; } | { pluginName: string; entry: string; }> {
    if (typeof folder !== "string" || !/^[A-Za-z0-9][\w-]{0,63}$/.test(folder))
        return { error: "Plugin names can only use letters, numbers, dashes and underscores, and have to start with a letter or number." };
    if (typeof code !== "string" || code.length > 2_000_000)
        return { error: "That file is way too big to be a plugin." };

    const pluginName = PLUGIN_NAME_REGEX.exec(code)?.[3];
    if (!pluginName)
        return { error: "That file doesn't look like a plugin. It needs `export default definePlugin({ name: \"...\", ... })` with name as the first property." };

    if (!existsSync(join(repoRoot, "src")))
        return { error: "Couldn't find your Deadbolt source folder. Adding plugins only works when Deadbolt is built from source." };

    const dir = join(repoRoot, "src", "userplugins", folder);
    const existed = existsSync(dir);
    if (existed && replace !== true)
        return { error: `A plugin folder named ${folder} already exists. Run the command again with replace set to True to overwrite it.` };

    const backup = await Promise.all(ENTRY_FILES.map(f => readFile(join(dir, f), "utf8").catch(() => null)));
    const entry = /<\/|\/>/.test(code) ? "index.tsx" : "index.ts";

    await mkdir(dir, { recursive: true });
    await Promise.all(ENTRY_FILES.map(f => rm(join(dir, f), { force: true })));
    await writeFile(join(dir, entry), code);

    const buildError = await new Promise<string | null>(resolve =>
        exec(
            IS_DEV ? "pnpm build --dev" : "pnpm build",
            {
                cwd: repoRoot,
                maxBuffer: 4 * 1024 * 1024,
                env: {
                    ...process.env,
                    NO_COLOR: "1",
                    FORCE_COLOR: "0"
                }
            },
            (err, stdout, stderr) => {
                if (!err) return resolve(null);

                const output = `${stdout}\n${stderr}`.trim();
                resolve(output || err.message);
            }
        )
    );

    if (buildError === null)
        return { pluginName, entry };

    if (existed)
        await Promise.all(
            ENTRY_FILES.map((f, i) =>
                backup[i] === null
                    ? rm(join(dir, f), { force: true })
                    : writeFile(join(dir, f), backup[i])
            )
        );
    else
        await rm(dir, { recursive: true });

    const cleanOutput = buildError
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
        .trim();

    const maxLength = 1500;
    const output = cleanOutput.length > maxLength
        ? "...\n" + cleanOutput.slice(-maxLength)
        : cleanOutput;

    return {
        error: `Deadbolt failed to rebuild with your plugin, so nothing was changed.\n\`\`\`\n${output}\n\`\`\``
    };
}
