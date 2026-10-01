# Deadbolt on macOS

Deadbolt uses a separate injection method on macOS.

Instead of modifying Discord's signed `app.asar`, Deadbolt loads through Discord's external `discord_desktop_core` module:

```text
~/Library/Application Support/discord/app-*/modules/discord_desktop_core-*/discord_desktop_core/
```

This keeps `/Applications/Discord.app` untouched and preserves Discord's original Apple code signature.

## Requirements

- macOS
- Official Discord
- Git
- Node.js 22 or newer
- pnpm

## One-command installation

Recommended:

```bash
curl -fsSL https://raw.githubusercontent.com/kelcum/Deadbolt/main/scripts/install-macos.sh -o /tmp/deadbolt-macos.sh && bash /tmp/deadbolt-macos.sh
```

Short form:

```bash
curl -fsSL https://raw.githubusercontent.com/kelcum/Deadbolt/main/scripts/install-macos.sh | bash
```

## Manual installation

```bash
git clone https://github.com/kelcum/Deadbolt.git ~/Deadbolt
cd ~/Deadbolt
pnpm install --frozen-lockfile
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
open -a Discord
```

## Run Discord

```bash
open -a Discord
```

or click Discord normally.

No special Deadbolt executable is required.

## Update Deadbolt

```bash
cd ~/Deadbolt
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
open -a Discord
```

## Re-inject after a Discord update

Discord updates may create a new `app-*` and `discord_desktop_core-*` directory.

Run:

```bash
cd ~/Deadbolt
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
open -a Discord
```

The installer automatically locates the newest core module.

## Repair

```bash
cd ~/Deadbolt
pnpm build
pnpm repair
```

Then:

```bash
open -a Discord
```

## Uninstall Deadbolt

```bash
cd ~/Deadbolt
pkill -x Discord 2>/dev/null || true
pnpm uninject
open -a Discord
```

Or:

```bash
bash ~/Deadbolt/scripts/uninstall-macos.sh
```

## Completely delete Deadbolt source after uninstalling

First uninject:

```bash
cd ~/Deadbolt
pnpm uninject
```

Then:

```bash
cd ~
rm -rf ~/Deadbolt
```

## Optional: delete Deadbolt/Equicord settings too

```bash
rm -rf "$HOME/Library/Application Support/Equicord"
```

Do not delete:

```text
~/Library/Application Support/discord
```

unless you intentionally want to reset Discord's own application data.

## Verify official Discord signature

```bash
codesign --verify --deep --strict "/Applications/Discord.app"
```

The macOS Deadbolt installer does not modify:

```text
/Applications/Discord.app/Contents/Resources/app.asar
```

and does not use:

```bash
codesign --force
xattr -cr "/Applications/Discord.app"
```

## How the injection works

The installer finds the newest:

```text
~/Library/Application Support/discord/app-*/modules/discord_desktop_core-*/discord_desktop_core/index.js
```

It saves the original as:

```text
index.deadbolt-original.js
```

and writes a small loader to `index.js`.

That loader:

1. sets `DEADBOLT_CORE_INJECT=1`
2. loads Deadbolt's `dist/desktop/patcher.js`
3. loads the original Discord desktop core

Deadbolt therefore installs its BrowserWindow/preload hooks without replacing Discord's signed `app.asar`.

## Tested

Confirmed working with:

```text
macOS 26.6.2
Apple M1
Discord 0.0.414
Deadbolt 1.15.9.0/current main
```
