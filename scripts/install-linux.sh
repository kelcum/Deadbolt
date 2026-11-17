#!/bin/bash
set -euo pipefail

SELF="${BASH_SOURCE[0]:-}"
TAB=$'\t'
REPO_URL="https://github.com/kelcum/Deadbolt.git"
SCRIPT_URL="${DEADBOLT_SCRIPT_URL:-https://raw.githubusercontent.com/kelcum/Deadbolt/main/scripts/install-linux.sh}"
DIST_URL="${DEADBOLT_DIST_URL:-https://github.com/kelcum/Deadbolt/releases/latest/download/deadbolt-dist.zip}"
EQUILOTL_URL="${DEADBOLT_EQUILOTL_URL:-https://github.com/Equicord/Equilotl/releases/latest/download}"
NODE_MIRROR="${DEADBOLT_NODE_MIRROR:-https://nodejs.org/dist}"
DEADBOLT_DIR="${DEADBOLT_DIR:-$HOME/Deadbolt}"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/DeadboltInstall"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$CONFIG_HOME/systemd/user"
AUTOSTART_FILE="$CONFIG_HOME/autostart/deadbolt-repair.desktop"
TOOLS="$INSTALL_DIR/tools"
STATE="$INSTALL_DIR/state"
LOG="$INSTALL_DIR/repair.log"
ALERT="$INSTALL_DIR/last-alert"
EQUILOTL="$INSTALL_DIR/EquilotlCli"
INSTALLED_SCRIPT="$INSTALL_DIR/deadbolt-linux.sh"
DIST_FILES="package.json patcher.js preload.js renderer.css renderer.js"
DISCORD_NAMES="Discord DiscordCanary DiscordDevelopment DiscordPTB com.discordapp.Discord com.discordapp.DiscordCanary com.discordapp.DiscordDevelopment com.discordapp.DiscordPTB discord discord-canary discord-development discord-ptb discordcanary discorddevelopment discordptb"

say() {
    printf '%s\n' "$*"
}

die() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Deadbolt for Linux

  install-linux.sh                    install or repair Deadbolt from the latest release
  install-linux.sh --from-source      build ~/Deadbolt from git instead (needed for /addplugin)
  install-linux.sh --uninstall        remove Deadbolt and its repair hook
  install-linux.sh --branch canary    pick stable, canary, ptb or auto (default)
  install-linux.sh --location DIR     patch the Discord install in DIR

DEADBOLT_FROM_SOURCE=1, DEADBOLT_BRANCH and DEADBOLT_DISCORD_DIR do the same
when the script is piped into bash.
EOF
}

distro_hint() {
    local id="" id_like=""
    if [ -r /etc/os-release ]; then
        id=$(sed -n 's/^ID=//p' /etc/os-release | tr -d '"')
        id_like=$(sed -n 's/^ID_LIKE=//p' /etc/os-release | tr -d '"')
    fi

    case "$1 $id $id_like" in
        "git "*debian*|"git "*ubuntu*) echo "sudo apt install -y git" ;;
        "git "*fedora*|"git "*rhel*|"git "*centos*) echo "sudo dnf install -y git" ;;
        "git "*arch*) echo "sudo pacman -S --needed git" ;;
        "git "*suse*) echo "sudo zypper install -y git" ;;
        "git "*alpine*) echo "sudo apk add git" ;;
        "git "*void*) echo "sudo xbps-install -S git" ;;
        "node "*debian*|"node "*ubuntu*) echo "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs" ;;
        "node "*fedora*|"node "*rhel*|"node "*centos*) echo "sudo dnf install -y nodejs22" ;;
        "node "*arch*) echo "sudo pacman -S --needed nodejs npm" ;;
        "node "*suse*) echo "sudo zypper install -y nodejs22" ;;
        "node "*alpine*) echo "sudo apk add nodejs npm" ;;
        "node "*void*) echo "sudo xbps-install -S nodejs" ;;
        git*) echo "install git with your distro's package manager" ;;
        *) echo "install Node.js 22 or newer from your distro's package manager" ;;
    esac
}

lower() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

branch_of() {
    case "$(lower "$1")" in
        *canary) echo canary ;;
        *development) echo development ;;
        *ptb) echo ptb ;;
        *) echo stable ;;
    esac
}

branch_of_path() {
    case "$(lower "$1")" in
        *canary*) echo canary ;;
        *development*) echo development ;;
        *ptb*) echo ptb ;;
        *) echo stable ;;
    esac
}

process_name() {
    case "$1" in
        canary) echo DiscordCanary ;;
        ptb) echo DiscordPTB ;;
        development) echo DiscordDevelopment ;;
        *) echo Discord ;;
    esac
}

version_key() {
    local version="$1" key="" part count=0
    case "$version" in
        ''|*[!0-9.]*|.*|*.|*..*) return 1 ;;
    esac

    local IFS=.
    for part in $version; do
        key="$key$(printf '%08d' "$((10#$part))")."
        count=$((count + 1))
    done
    while [ "$count" -lt 4 ]; do
        key="${key}00000000."
        count=$((count + 1))
    done
    printf '%s\n' "$key"
}

app_resources() {
    local root="$1" name="$2" resources
    case "$name" in
        app-*) ;;
        *) return 1 ;;
    esac
    version_key "${name#app-}" >/dev/null || return 1

    resources="$root/$name/resources"
    [ -d "$resources" ] || return 1
    [ -e "$resources/_app.asar" ] || [ -e "$resources/app.asar" ] || return 1
    printf '%s\n' "$resources"
}

newest_app_resources() {
    local root="$1" best="" best_key="" dir name key resources link

    if [ -L "$root/Discord" ]; then
        link=$(readlink "$root/Discord")
        link=${link%/*}
        if resources=$(app_resources "$root" "${link##*/}"); then
            printf '%s\n' "$resources"
            return 0
        fi
    fi

    for dir in "$root"/app-*; do
        [ -d "$dir" ] && [ ! -L "$dir" ] || continue
        name=${dir##*/}
        resources=$(app_resources "$root" "$name") || continue
        key=$(version_key "${name#app-}")
        if [ -z "$best" ] || [[ "$key" > "$best_key" ]]; then
            best=$resources
            best_key=$key
        fi
    done

    [ -n "$best" ] || return 1
    printf '%s\n' "$best"
}

classic_install() {
    local dir="$1" name base flat
    name=${dir##*/}
    base=$dir

    case "$dir" in
        */current/active/files/*) ;;
        */flatpak/*)
            case "$name" in
                com.discordapp.*)
                    flat=$(lower "${name#com.discordapp.}")
                    [ "$flat" = discord ] || flat="${flat:0:7}-${flat:7}"
                    base="$dir/current/active/files/$flat"
                    ;;
            esac
            ;;
    esac

    [ -e "$base/resources/app.asar" ] || return 1
    printf '%s\t%s\t%s\n' "$(branch_of "$name")" "$dir" "$base/resources"
}

find_discords() {
    local seen=" " root resolved name dir resources

    for root in /usr/share /usr/lib /usr/lib64 /opt "$HOME/Applications" "$HOME/AppImages" "$HOME/.local/share" "$HOME/.local/bin" "$HOME/.dvm" "$HOME/.config" "$HOME/.var/app" /var/lib/flatpak/app "$HOME/.local/share/flatpak/app"; do
        resolved=$(cd -P "$root" 2>/dev/null && pwd -P) || continue
        case "$seen" in
            *" $resolved "*) continue ;;
        esac
        seen="$seen$resolved "

        for name in $DISCORD_NAMES; do
            dir="$root/$name"
            [ -d "$dir" ] && [ ! -L "$dir" ] || continue
            classic_install "$dir" || true
        done
    done

    for name in discord discordcanary discordptb; do
        dir="$HOME/.config/$name"
        if resources=$(newest_app_resources "$dir"); then
            printf '%s\t%s\t%s\n' "$(branch_of "$name")" "$dir" "$resources"
        fi
    done

    for name in Discord DiscordCanary DiscordPTB; do
        dir="$HOME/.var/app/com.discordapp.$name/config/discord"
        if resources=$(newest_app_resources "$dir"); then
            printf '%s\t%s\t%s\n' "$(branch_of "$name")" "$dir" "$resources"
        fi
    done

    return 0
}

resources_at() {
    local location="$1" line
    if newest_app_resources "$location"; then
        return 0
    fi
    line=$(classic_install "$location") || return 1
    printf '%s\n' "${line##*"$TAB"}"
}

pick_target() {
    local branch="$1" location="$2" installs wanted line resources

    if [ -n "$location" ]; then
        resources=$(resources_at "$location") || return 1
        TARGET_BRANCH=$(branch_of_path "$location")
        TARGET_ROOT=$location
        TARGET_RESOURCES=$resources
        return 0
    fi

    installs=$(find_discords)
    [ "$branch" = auto ] && set -- stable canary ptb || set -- "$branch"

    for wanted in "$@"; do
        while IFS= read -r line; do
            [ -n "$line" ] || continue
            [ "${line%%"$TAB"*}" = "$wanted" ] || continue
            TARGET_BRANCH=$wanted
            line=${line#*"$TAB"}
            TARGET_ROOT=${line%%"$TAB"*}
            TARGET_RESOURCES=${line#*"$TAB"}
            return 0
        done <<EOF
$installs
EOF
    done

    return 1
}

current_resources() {
    resources_at "$1"
}

is_injected() {
    local resources="$1" size
    [ -e "$resources/_app.asar" ] || return 1

    if [ -d "$resources/app.asar" ]; then
        grep -q 'require(' "$resources/app.asar/index.js" 2>/dev/null
        return
    fi

    [ -f "$resources/app.asar" ] || return 1
    size=$(($(wc -c < "$resources/app.asar")))
    [ "$size" -le 131072 ] && grep -aq 'require(' "$resources/app.asar"
}

can_write() {
    local probe="$1/.deadbolt-write-test.$$"
    (: > "$probe") 2>/dev/null || return 1
    rm -f "$probe"
}

elevator() {
    local tool
    for tool in sudo doas run0 pkexec; do
        if command -v "$tool" >/dev/null 2>&1; then
            echo "$tool"
            return 0
        fi
    done
    return 1
}

run_equilotl() {
    local resources="$1" quiet="$2" tool
    shift 2

    if [ "$(id -u)" -eq 0 ] || can_write "$resources"; then
        env EQUICORD_USER_DATA_DIR="$INSTALL_DIR" EQUICORD_DIRECTORY="$DIST" EQUICORD_DEV_INSTALL=1 "$EQUILOTL" "$@" < /dev/null
        return
    fi

    if [ "$quiet" = 1 ]; then
        command -v sudo >/dev/null 2>&1 || return 1
        sudo -n env EQUICORD_USER_DATA_DIR="$INSTALL_DIR" EQUICORD_DIRECTORY="$DIST" EQUICORD_DEV_INSTALL=1 SUDO_USER="$(id -un)" "$EQUILOTL" "$@" < /dev/null
        return
    fi

    tool=$(elevator) || die "$resources belongs to root and none of sudo, doas, run0 or pkexec is installed. Install sudo, then run this again."
    say "Discord's folder ($resources) belongs to root, so $tool will ask for your password to patch it."
    say "Only that step runs as root. Deadbolt's own files stay yours."
    "$tool" env EQUICORD_USER_DATA_DIR="$INSTALL_DIR" EQUICORD_DIRECTORY="$DIST" EQUICORD_DEV_INSTALL=1 SUDO_USER="$(id -un)" "$EQUILOTL" "$@" < /dev/null
}

download() {
    curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1"
}

equilotl_name() {
    case "$(uname -m)" in
        x86_64|amd64) echo EquilotlCli-Linux ;;
        aarch64|arm64) echo EquilotlCli-linux-arm64 ;;
        *) return 1 ;;
    esac
}

fetch_equilotl() {
    local name
    name=$(equilotl_name) || die "Equilotl, the tool that patches Discord, has no build for $(uname -m)."
    download "$EQUILOTL_URL/$name" "$EQUILOTL.new" || die "Couldn't download $name from $EQUILOTL_URL."
    chmod +x "$EQUILOTL.new"
    mv -f "$EQUILOTL.new" "$EQUILOTL"
}

extract_zip() {
    if command -v unzip >/dev/null 2>&1; then
        unzip -q -o "$1" -d "$2"
    elif command -v bsdtar >/dev/null 2>&1; then
        bsdtar -xf "$1" -C "$2"
    elif command -v python3 >/dev/null 2>&1; then
        python3 -m zipfile -e "$1" "$2"
    else
        die "Unpacking Deadbolt needs unzip, bsdtar or python3. Install unzip, then run this again."
    fi
}

fetch_release() {
    local staging="$INSTALL_DIR/dist.new" zip="$INSTALL_DIR/deadbolt-dist.zip" file

    say "=== DOWNLOAD DEADBOLT ==="
    rm -rf "$staging"
    mkdir -p "$staging"
    download "$DIST_URL" "$zip" || die "Couldn't download $DIST_URL."
    extract_zip "$zip" "$staging"

    for file in $DIST_FILES; do
        [ -s "$staging/$file" ] || die "The downloaded Deadbolt build is missing $file."
    done

    rm -rf "$INSTALL_DIR/dist.old"
    if [ -d "$INSTALL_DIR/dist" ]; then
        mv "$INSTALL_DIR/dist" "$INSTALL_DIR/dist.old"
    fi
    mv "$staging" "$INSTALL_DIR/dist"
    rm -rf "$INSTALL_DIR/dist.old" "$zip"
    DIST="$INSTALL_DIR/dist"
}

node_major() {
    node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d' ' -f1
    else
        shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

install_private_node() {
    local arch sums file sum tmp

    case "$(uname -m)" in
        x86_64|amd64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) die "Node.js 22 or newer is required. Try: $(distro_hint node)" ;;
    esac

    if ldd --version 2>&1 | grep -qi musl; then
        die "Node.js 22 or newer is required, and nodejs.org has no build for musl systems. Try: $(distro_hint node)"
    fi

    say "Node.js 22 or newer isn't installed, so Deadbolt is putting a private copy in $TOOLS."
    sums=$(curl -fsSL --retry 3 "$NODE_MIRROR/latest-v22.x/SHASUMS256.txt") || die "Couldn't reach $NODE_MIRROR."
    file=$(printf '%s\n' "$sums" | awk -v suffix="-linux-$arch.tar.gz" '!found && $2 ~ /^node-v22\.[0-9]+\.[0-9]+-/ && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; found = 1 }')
    sum=$(printf '%s\n' "$sums" | awk -v name="$file" '!found && $2 == name { print $1; found = 1 }')
    [ -n "$file" ] && [ -n "$sum" ] || die "Couldn't find a Node.js 22 build for linux-$arch."

    tmp=$(mktemp -d)
    download "$NODE_MIRROR/latest-v22.x/$file" "$tmp/$file" || die "Couldn't download $file."
    [ "$(sha256_of "$tmp/$file")" = "$sum" ] || die "$file didn't match its published checksum."

    rm -rf "$TOOLS.new"
    mkdir -p "$TOOLS.new"
    tar -xzf "$tmp/$file" -C "$TOOLS.new" --strip-components=1
    rm -rf "$TOOLS" "$tmp"
    mv "$TOOLS.new" "$TOOLS"
}

ensure_node() {
    if [ -x "$TOOLS/bin/node" ]; then
        PATH="$TOOLS/bin:$PATH"
    fi

    if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 22 ]; then
        return 0
    fi

    install_private_node
    PATH="$TOOLS/bin:$PATH"
    [ "$(node_major)" -ge 22 ] || die "The Node.js copy in $TOOLS doesn't run on this system. Try: $(distro_hint node)"
}

PNPM_SPEC=""

ensure_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        return 0
    fi

    PNPM_SPEC=$(node -p 'String(require("./package.json").packageManager || "pnpm").split("+")[0]')
    say "pnpm isn't installed, so Deadbolt is adding $PNPM_SPEC to $TOOLS."
    if npm install -g --prefix "$TOOLS" "$PNPM_SPEC" > /dev/null 2>&1; then
        PATH="$TOOLS/bin:$PATH"
    else
        say "Couldn't install pnpm into $TOOLS, so this run uses npx instead."
    fi
}

run_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        pnpm "$@"
    else
        npx --yes "${PNPM_SPEC:-pnpm}" "$@"
    fi
}

update_checkout() {
    local changes

    if [ ! -e "$DEADBOLT_DIR/.git" ]; then
        git clone "$REPO_URL" "$DEADBOLT_DIR"
        return
    fi

    changes=$(git -C "$DEADBOLT_DIR" status --porcelain --untracked-files=no)
    if [ -z "$changes" ]; then
        git -C "$DEADBOLT_DIR" pull --ff-only || say "Couldn't fast-forward $DEADBOLT_DIR, so this builds what's already there."
        return
    fi

    say "Not updating $DEADBOLT_DIR because these files have local changes:"
    printf '%s\n' "$changes"
    say "To update it anyway: git -C \"$DEADBOLT_DIR\" stash && git -C \"$DEADBOLT_DIR\" pull --ff-only"
    say "Building your local copy as it is."
}

build_from_source() {
    command -v git >/dev/null 2>&1 || die "Git is required for --from-source. Try: $(distro_hint git)"

    update_checkout
    cd "$DEADBOLT_DIR"
    ensure_node
    ensure_pnpm
    export PATH

    say "=== INSTALL DEPENDENCIES ==="
    run_pnpm install --frozen-lockfile
    say "=== BUILD DEADBOLT ==="
    run_pnpm build
    DIST="$DEADBOLT_DIR/dist/desktop"
    [ -f "$DIST/patcher.js" ] || die "The build didn't produce $DIST/patcher.js."
}

state_get() {
    [ -f "$STATE" ] || return 0
    sed -n "s/^$1=//p" "$STATE" | sed -n 1p
}

save_state() {
    printf 'BRANCH=%s\nLOCATION=%s\nDIST=%s\n' "$TARGET_BRANCH" "$TARGET_ROOT" "$DIST" > "$STATE"
}

save_script() {
    if [ -n "$SELF" ] && [ -f "$SELF" ]; then
        if [ "$(cd "$(dirname "$SELF")" && pwd -P)/$(basename "$SELF")" != "$INSTALLED_SCRIPT" ]; then
            cp -f "$SELF" "$INSTALLED_SCRIPT.new"
            mv -f "$INSTALLED_SCRIPT.new" "$INSTALLED_SCRIPT"
        fi
    else
        download "$SCRIPT_URL" "$INSTALLED_SCRIPT.new" || die "Couldn't download $SCRIPT_URL."
        mv -f "$INSTALLED_SCRIPT.new" "$INSTALLED_SCRIPT"
    fi
}

unit_escape() {
    printf '%s' "$1" | sed -e 's/%/%%/g'
}

desktop_escape() {
    printf '"%s"' "$(printf '%s' "$1" | sed -e 's/%/%%/g')"
}

exec_escape() {
    printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\$/$$/g' -e 's/%/%%/g')"
}

has_user_systemd() {
    command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

install_hook() {
    local bash_path watch

    bash_path=$(command -v bash)
    rm -f "$AUTOSTART_FILE"

    if has_user_systemd; then
        mkdir -p "$UNIT_DIR"
        cat > "$UNIT_DIR/deadbolt-repair.service" <<EOF
[Unit]
Description=Put Deadbolt back after Discord updates

[Service]
Type=oneshot
ExecStart=$(exec_escape "$bash_path") $(exec_escape "$INSTALLED_SCRIPT") --repair-if-needed

[Install]
WantedBy=default.target
EOF

        {
            printf '[Unit]\nDescription=Watch Discord for updates that remove Deadbolt\n\n[Path]\n'
            for watch in "$TARGET_RESOURCES" "$TARGET_ROOT"; do
                printf 'PathChanged=%s\n' "$(unit_escape "$watch")"
            done
            printf 'Unit=deadbolt-repair.service\n\n[Install]\nWantedBy=default.target\n'
        } > "$UNIT_DIR/deadbolt-repair.path"

        systemctl --user daemon-reload
        systemctl --user enable deadbolt-repair.service deadbolt-repair.path > /dev/null 2>&1
        systemctl --user restart deadbolt-repair.path
        say "A systemd user unit now puts Deadbolt back whenever a Discord update removes it."
        return
    fi

    mkdir -p "${AUTOSTART_FILE%/*}"
    cat > "$AUTOSTART_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Deadbolt repair
Comment=Put Deadbolt back after Discord updates
Exec=$(desktop_escape "$bash_path") $(desktop_escape "$INSTALLED_SCRIPT") --repair-if-needed
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
    say "systemd user units aren't available, so Deadbolt checks itself at every login instead."
}

remove_hook() {
    if has_user_systemd; then
        systemctl --user disable --now deadbolt-repair.path deadbolt-repair.service > /dev/null 2>&1 || true
    fi
    rm -f "$UNIT_DIR/deadbolt-repair.path" "$UNIT_DIR/deadbolt-repair.service" "$AUTOSTART_FILE"
    if has_user_systemd; then
        systemctl --user daemon-reload || true
    fi
}

notify() {
    if command -v notify-send >/dev/null 2>&1; then
        notify-send "Deadbolt" "$1" > /dev/null 2>&1 || true
    fi
}

log_line() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

alert() {
    local message="$1" now last_time="0" last_message=""
    now=$(date +%s)
    log_line "$message"

    if [ -f "$ALERT" ]; then
        last_time=$(sed -n 1p "$ALERT")
        last_message=$(sed -n 2p "$ALERT")
    fi
    case "$last_time" in
        ''|*[!0-9]*) last_time=0 ;;
    esac
    if [ "$last_message" = "$message" ] && [ $((now - last_time)) -lt 43200 ]; then
        return 0
    fi

    printf '%s\n%s\n' "$now" "$message" > "$ALERT"
    notify "$message"
}

close_discord() {
    local name waited=0
    name=$(process_name "$1")
    pkill -x "$name" 2>/dev/null || return 0
    while pgrep -x "$name" > /dev/null 2>&1 && [ "$waited" -lt 20 ]; do
        sleep 0.5
        waited=$((waited + 1))
    done
}

wait_for_package_managers() {
    local waited=0
    while pgrep -x 'dpkg|apt|apt-get|pacman|rpm|dnf|yum|zypper|packagekitd' > /dev/null 2>&1 && [ "$waited" -lt 120 ]; do
        sleep 5
        waited=$((waited + 1))
    done
}

repair_if_needed() {
    local location resources

    [ -f "$STATE" ] || exit 0
    location=$(state_get LOCATION)
    DIST=$(state_get DIST)
    [ -n "$location" ] && [ -n "$DIST" ] || exit 0

    wait_for_package_managers
    resources=$(current_resources "$location") || exit 0
    if is_injected "$resources"; then
        rm -f "$ALERT"
        exit 0
    fi

    if [ ! -f "$DIST/patcher.js" ]; then
        alert "Discord updated, but Deadbolt's files are missing from $DIST. Run the Deadbolt install command again."
        exit 1
    fi

    if [ ! -x "$EQUILOTL" ]; then
        (fetch_equilotl) > /dev/null 2>&1 || {
            alert "Discord updated and Deadbolt couldn't download Equilotl to put itself back. Run the Deadbolt install command again."
            exit 1
        }
    fi

    if run_equilotl "$resources" 1 --install --location "$location" > /dev/null 2>&1 && is_injected "$(current_resources "$location")"; then
        log_line "Put Deadbolt back into $resources after a Discord update"
        rm -f "$ALERT"
        exit 0
    fi

    if can_write "$resources"; then
        alert "Discord updated and Deadbolt couldn't put itself back. Run the Deadbolt install command again to see why."
    else
        alert "Discord updated and removed Deadbolt. Run this in a terminal to put it back (it asks for your password): bash \"$INSTALLED_SCRIPT\""
    fi
    exit 1
}

uninstall() {
    local location
    location=$(state_get LOCATION)
    DIST=$(state_get DIST)
    DIST=${DIST:-$INSTALL_DIR/dist}

    remove_hook

    if [ -n "$location" ] && pick_target auto "$location"; then
        :
    elif ! pick_target "$BRANCH" "$LOCATION_ARG"; then
        TARGET_RESOURCES=""
    fi

    if [ -n "$TARGET_RESOURCES" ] && [ -e "$TARGET_RESOURCES/_app.asar" ]; then
        mkdir -p "$INSTALL_DIR"
        [ -x "$EQUILOTL" ] || fetch_equilotl
        say "=== CLOSE DISCORD ==="
        close_discord "$TARGET_BRANCH"
        say "=== REMOVE DEADBOLT ==="
        run_equilotl "$TARGET_RESOURCES" 0 --uninstall --location "$TARGET_ROOT" || die "Equilotl couldn't remove Deadbolt from $TARGET_ROOT."
    else
        say "Deadbolt isn't patched into any Discord install."
    fi

    rm -rf "$INSTALL_DIR"
    say
    say "Deadbolt is removed. Your settings are still in ${CONFIG_HOME}/Deadbolt; delete that folder too if you want."
    if [ -e "$DEADBOLT_DIR/.git" ]; then
        say "The source checkout in $DEADBOLT_DIR wasn't touched."
    fi
}

install() {
    if ! pick_target "$BRANCH" "$LOCATION_ARG"; then
        if [ -n "$LOCATION_ARG" ]; then
            die "$LOCATION_ARG isn't a Discord install (no resources/app.asar)."
        fi
        die "No Discord install found. Install Discord from https://discord.com/download (.deb, .rpm or .tar.gz), start it once, then run this again."
    fi
    say "Found Discord ($TARGET_BRANCH) at $TARGET_ROOT"

    mkdir -p "$INSTALL_DIR"
    if [ "$FROM_SOURCE" = 1 ]; then
        build_from_source
    else
        fetch_release
    fi

    say "=== DOWNLOAD EQUILOTL ==="
    fetch_equilotl

    say "=== CLOSE DISCORD ==="
    close_discord "$TARGET_BRANCH"

    say "=== INJECT DEADBOLT ==="
    run_equilotl "$TARGET_RESOURCES" 0 --install --location "$TARGET_ROOT" || die "Equilotl couldn't patch $TARGET_ROOT. Check the messages above."
    TARGET_RESOURCES=$(current_resources "$TARGET_ROOT") || die "Discord at $TARGET_ROOT disappeared while patching."
    is_injected "$TARGET_RESOURCES" || die "Equilotl finished, but $TARGET_RESOURCES isn't patched."

    save_script
    save_state
    rm -f "$ALERT"
    install_hook

    say
    say "Deadbolt installed successfully."
    say "Start Discord from your app launcher."
    say "If a Discord update ever removes Deadbolt, run this same command again."
}

main() {
    MODE=install
    FROM_SOURCE="${DEADBOLT_FROM_SOURCE:-0}"
    BRANCH="${DEADBOLT_BRANCH:-auto}"
    LOCATION_ARG="${DEADBOLT_DISCORD_DIR:-}"
    TARGET_BRANCH=""
    TARGET_ROOT=""
    TARGET_RESOURCES=""
    DIST=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --from-source) FROM_SOURCE=1 ;;
            --repair-if-needed) MODE=repair ;;
            --uninstall) MODE=uninstall ;;
            --branch) [ $# -ge 2 ] || die "--branch needs stable, canary, ptb or auto."; BRANCH="$2"; shift ;;
            --branch=*) BRANCH="${1#*=}" ;;
            --location) [ $# -ge 2 ] || die "--location needs a folder."; LOCATION_ARG="$2"; shift ;;
            --location=*) LOCATION_ARG="${1#*=}" ;;
            -h|--help) usage; return 0 ;;
            *) die "Unknown option $1. See --help." ;;
        esac
        shift
    done

    case "$BRANCH" in
        auto|stable|canary|ptb|development) ;;
        *) die "--branch must be stable, canary, ptb or auto." ;;
    esac
    [ "$FROM_SOURCE" = 1 ] || FROM_SOURCE=0
    LOCATION_ARG=${LOCATION_ARG%/}

    if [ "$(uname -s)" != "Linux" ]; then
        die "This installer is only for Linux."
    fi

    if [ "$(id -u)" -eq 0 ]; then
        die "Run this as your normal user, not as root or with sudo. It asks for your password itself if Discord's folder needs it."
    fi

    case "$MODE" in
        repair) repair_if_needed ;;
        uninstall) uninstall ;;
        *) install ;;
    esac
}

main "$@"
