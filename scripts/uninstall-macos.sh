#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This uninstaller is only for macOS."
    exit 1
fi

DEADBOLT_DIR="${DEADBOLT_DIR:-$HOME/Deadbolt}"

if [ ! -d "$DEADBOLT_DIR" ]; then
    echo "Deadbolt source folder not found: $DEADBOLT_DIR"
    exit 1
fi

cd "$DEADBOLT_DIR"

pkill -x Discord 2>/dev/null || true
sleep 1

pnpm uninject

echo
echo "Deadbolt macOS injection removed."
echo "Starting Discord..."

open -a Discord
