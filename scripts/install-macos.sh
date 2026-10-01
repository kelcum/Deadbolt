#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This installer is only for macOS."
    exit 1
fi

DEADBOLT_DIR="${DEADBOLT_DIR:-$HOME/Deadbolt}"
REPO_URL="https://github.com/kelcum/Deadbolt.git"

command -v git >/dev/null || {
    echo "Git is required."
    exit 1
}

command -v node >/dev/null || {
    echo "Node.js 22 or newer is required."
    exit 1
}

node -e '
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
    console.error("Node.js 22 or newer is required.");
    process.exit(1);
}
'

command -v pnpm >/dev/null || {
    echo "pnpm is required."
    echo "Install pnpm 12.6.0 and run this installer again."
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
echo "Starting Discord..."

open -a Discord
