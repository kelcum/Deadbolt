#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
    echo "This installer is only for Linux."
    exit 1
fi

DEADBOLT_DIR="${DEADBOLT_DIR:-$HOME/Deadbolt}"
REPO_URL="https://github.com/kelcum/Deadbolt.git"

# Package-manager hints per distro family - printed, never run automatically.
# Keeps this script to "check, then tell you the one command to run", the
# same minimal footprint as install-macos.sh, instead of silently running
# sudo package-manager commands on your behalf.
distro_hint() {
    local pkg="$1"   # git | node | pnpm
    local id="" id_like=""
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        id="${ID:-}"
        id_like="${ID_LIKE:-}"
    fi

    case "$id $id_like" in
        *debian*|*ubuntu*)
            case "$pkg" in
                git)  echo "sudo apt update && sudo apt install -y git" ;;
                node) echo "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs" ;;
                pnpm) echo "sudo npm i -g pnpm" ;;
            esac ;;
        *fedora*|*rhel*|*centos*|*rocky*|*alma*)
            case "$pkg" in
                git)  echo "sudo dnf install -y git" ;;
                node) echo "sudo dnf module install -y nodejs:22" ;;
                pnpm) echo "sudo npm i -g pnpm" ;;
            esac ;;
        *arch*|*manjaro*|*endeavouros*)
            case "$pkg" in
                git)  echo "sudo pacman -S --needed git" ;;
                node) echo "sudo pacman -S --needed nodejs npm" ;;
                pnpm) echo "sudo pacman -S --needed pnpm" ;;
            esac ;;
        *opensuse*|*suse*)
            case "$pkg" in
                git)  echo "sudo zypper install -y git" ;;
                node) echo "sudo zypper install -y nodejs22" ;;
                pnpm) echo "sudo npm i -g pnpm" ;;
            esac ;;
        *alpine*)
            case "$pkg" in
                git)  echo "sudo apk add git" ;;
                node) echo "sudo apk add nodejs npm" ;;
                pnpm) echo "sudo npm i -g pnpm" ;;
            esac ;;
        *void*)
            case "$pkg" in
                git)  echo "sudo xbps-install -S git" ;;
                node) echo "sudo xbps-install -S nodejs" ;;
                pnpm) echo "sudo npm i -g pnpm" ;;
            esac ;;
        *)
            case "$pkg" in
                git)  echo "install git with your distro's package manager" ;;
                node) echo "install Node.js 22+ from https://nodejs.org or your distro's package manager" ;;
                pnpm) echo "npm i -g pnpm (after Node.js is installed)" ;;
            esac ;;
    esac
}

command -v git >/dev/null || {
    echo "Git is required."
    echo "Try: $(distro_hint git)"
    exit 1
}

command -v node >/dev/null || {
    echo "Node.js 22 or newer is required."
    echo "Try: $(distro_hint node)"
    exit 1
}

node -e '
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
    console.error("Node.js 22 or newer is required (found " + process.version + ").");
    process.exit(1);
}
' || {
    echo "Try: $(distro_hint node)"
    exit 1
}

command -v pnpm >/dev/null || {
    echo "pnpm is required."
    echo "Try: $(distro_hint pnpm)"
    exit 1
}

if [ ! -d "$DEADBOLT_DIR/.git" ]; then
    git clone "$REPO_URL" "$DEADBOLT_DIR"
else
    if [ -z "$(git -C "$DEADBOLT_DIR" status --porcelain)" ]; then
        git -C "$DEADBOLT_DIR" pull --ff-only
    else
        echo "Local Deadbolt changes detected; skipping git pull."
    fi
fi

cd "$DEADBOLT_DIR"

echo "=== INSTALL DEPENDENCIES ==="
pnpm install --frozen-lockfile

echo "=== BUILD DEADBOLT ==="
pnpm build

echo "=== CLOSE DISCORD ==="
pkill -x Discord 2>/dev/null || true
sleep 1

echo "=== INJECT DEADBOLT ==="
pnpm inject

echo
echo "Deadbolt installed successfully."
echo "Start Discord from your app launcher, or run the Discord binary directly."
