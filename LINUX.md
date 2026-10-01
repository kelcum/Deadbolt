# Deadbolt on Linux

Deadbolt builds from source and injects the same way across every distro —
there's no distro-specific injection quirk like Windows' `app.asar` packing
or macOS' code signing. The only thing that differs per distro is how you
install the prerequisites below.

## Requirements

- Git
- Node.js 22 or newer
- pnpm
- The official Discord Linux build (`.deb`/`.rpm`/`.tar.gz` from
  [discord.com/download](https://discord.com/download), or your distro's
  package — Flatpak/Snap builds aren't supported, since Deadbolt needs to
  write into Discord's own install directory)

<details>
<summary>Installing the prerequisites on your distro</summary>

| Distro family | Git | Node.js 22+ | pnpm |
|---|---|---|---|
| Debian / Ubuntu / Pop!_OS / Mint | `sudo apt install git` | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash -`<br>`sudo apt install nodejs` | `sudo npm i -g pnpm` |
| Fedora / RHEL / CentOS / Rocky / Alma | `sudo dnf install git` | `sudo dnf module install nodejs:22` | `sudo npm i -g pnpm` |
| Arch / Manjaro / EndeavourOS | `sudo pacman -S git` | `sudo pacman -S nodejs npm` | `sudo pacman -S pnpm` |
| openSUSE | `sudo zypper install git` | `sudo zypper install nodejs22` | `sudo npm i -g pnpm` |
| Alpine | `sudo apk add git` | `sudo apk add nodejs npm` | `sudo npm i -g pnpm` |
| Void | `sudo xbps-install -S git` | `sudo xbps-install -S nodejs` | `sudo npm i -g pnpm` |

Something else, or these are out of date for your distro? Grab Node 22+ from
[nodejs.org](https://nodejs.org) directly and `npm i -g pnpm` afterward.

</details>

## One-command installation

[`scripts/install-linux.sh`](scripts/install-linux.sh) checks the
prerequisites above are present (and tells you exactly what to run if one's
missing — it never runs a package manager on your behalf), then clones,
builds, and injects:

```bash
curl -fsSL https://xan.gripe/deadbolt/install-linux.sh | bash
```

Want to read it before running it? That URL is a thin redirect to [`scripts/install-linux.sh`](scripts/install-linux.sh) in this repo - download and inspect that instead:

```bash
curl -fsSL https://raw.githubusercontent.com/kelcum/Deadbolt/main/scripts/install-linux.sh -o /tmp/deadbolt-linux.sh && less /tmp/deadbolt-linux.sh && bash /tmp/deadbolt-linux.sh
```

## Manual installation

```bash
git clone https://github.com/kelcum/Deadbolt.git ~/Deadbolt
cd ~/Deadbolt
pnpm install --frozen-lockfile
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
```

Then start Discord from your app launcher, or run the `Discord` binary
directly.

## Update Deadbolt

```bash
cd ~/Deadbolt
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
```

## Re-inject after a Discord update

```bash
cd ~/Deadbolt
pnpm build
pkill -x Discord 2>/dev/null || true
pnpm inject
```

## Repair

```bash
cd ~/Deadbolt
pnpm build
pnpm repair
```

## Uninstall Deadbolt

```bash
cd ~/Deadbolt
pkill -x Discord 2>/dev/null || true
pnpm uninject
```

## Completely delete Deadbolt source after uninstalling

```bash
cd ~/Deadbolt
pnpm uninject
cd ~
rm -rf ~/Deadbolt
```

Optional settings wipe:

```bash
rm -rf "$HOME/.config/Equicord"
```
