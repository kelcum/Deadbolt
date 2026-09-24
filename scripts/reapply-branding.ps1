<#
.SYNOPSIS
    Reapplies Deadbolt's Windows-side branding (patcher injection, taskbar/
    shortcut icons, boot splash logo) after Discord Canary auto-updates.

.DESCRIPTION
    Discord Canary's own Squirrel-based updater prunes old app-X.Y.Z version
    folders and replaces app.ico / Start Menu shortcuts on every update, which
    silently undoes everything this script reapplies. None of this touches
    Deadbolt's actual mod code or your settings/QuickCSS (those live in
    %APPDATA%\Deadbolt, untouched by any of this) - it's purely the injection
    stub + a few cosmetic OS-level files living inside Canary's own install
    tree, which the updater owns and periodically resets.

    Run this any time Canary crashes on launch with a "Cannot find module
    ...patcher.js" error, or whenever the taskbar/splash branding reverts to
    stock Discord after an update.

.PARAMETER Restart
    Also kill and relaunch DiscordCanary.exe (only Canary, never Stable)
    after reapplying everything.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\reapply-branding.ps1 -Restart
#>

param(
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PatcherPath = Join-Path $RepoRoot "dist\desktop\patcher.js"
$DeadboltIco = Join-Path $RepoRoot "browser\deadbolt.ico"
$SplashSvg = Join-Path $RepoRoot "browser\splash.svg"
$CanaryRoot = Join-Path $env:LOCALAPPDATA "DiscordCanary"

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   SKIP: $msg" -ForegroundColor Yellow }

Write-Host "Deadbolt branding reapply" -ForegroundColor Magenta
Write-Host "Repo:   $RepoRoot"
Write-Host "Canary: $CanaryRoot"
Write-Host ""

if (-not (Test-Path $PatcherPath)) {
    Write-Host "ERROR: $PatcherPath not found." -ForegroundColor Red
    Write-Host "Run 'pnpm install' and 'pnpm build' in $RepoRoot first, then re-run this script." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $DeadboltIco)) {
    Write-Host "ERROR: $DeadboltIco not found (should be tracked in git)." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $CanaryRoot)) {
    Write-Host "ERROR: Discord Canary isn't installed at $CanaryRoot." -ForegroundColor Red
    exit 1
}

$PatcherRequirePath = $PatcherPath -replace "\\", "/"
$StubContent = "require(`"$PatcherRequirePath`");"

# ── 1. Version folders: injection stub, per-version app.ico, splash logo ──
$versionDirs = Get-ChildItem -Path $CanaryRoot -Directory -Filter "app-*" -ErrorAction SilentlyContinue
if (-not $versionDirs) {
    Write-Warn2 "No app-* version folders found under $CanaryRoot"
}

foreach ($verDir in $versionDirs) {
    Write-Step "Version folder: $($verDir.Name)"

    $indexJs = Join-Path $verDir.FullName "resources\app.asar\index.js"
    if (Test-Path $indexJs) {
        Set-Content -Path $indexJs -Value $StubContent -NoNewline -Encoding ascii
        Write-Ok "patcher stub -> $indexJs"
    } else {
        Write-Warn2 "no resources\app.asar\index.js here"
    }

    $verIco = Join-Path $verDir.FullName "app.ico"
    if (Test-Path $verIco) {
        $verIcoOrig = "$verIco.orig"
        if (-not (Test-Path $verIcoOrig)) { Copy-Item $verIco $verIcoOrig }
        Copy-Item -Path $DeadboltIco -Destination $verIco -Force
        Write-Ok "app.ico -> $verIco"
    }

    $coreDirs = Get-ChildItem -Path (Join-Path $verDir.FullName "modules") -Directory -Filter "discord_desktop_core-*" -ErrorAction SilentlyContinue
    foreach ($coreDir in $coreDirs) {
        $svg = Join-Path $coreDir.FullName "discord_desktop_core\app\images\discord.svg"
        if (Test-Path $svg) {
            $svgOrig = "$svg.orig"
            if (-not (Test-Path $svgOrig)) { Copy-Item $svg $svgOrig }
            Copy-Item -Path $SplashSvg -Destination $svg -Force
            Write-Ok "splash logo -> $($coreDir.Name)"
        }
    }
}

# ── 2. Root app.ico ──
Write-Step "Root app.ico"
$rootIco = Join-Path $CanaryRoot "app.ico"
if (Test-Path $rootIco) {
    $rootIcoOrig = "$rootIco.orig"
    if (-not (Test-Path $rootIcoOrig)) { Copy-Item $rootIco $rootIcoOrig }
    Copy-Item -Path $DeadboltIco -Destination $rootIco -Force
    Write-Ok "$rootIco"
}

# ── 3. Shortcuts (Discord's installer re-touches these on update too) ──
Write-Step "Shortcuts"
$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @(
    (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Discord Canary.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Discord Canary.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Discord Inc\Discord Canary.lnk")
)
foreach ($p in $shortcutPaths) {
    if (Test-Path $p) {
        $lnk = $shell.CreateShortcut($p)
        $lnk.IconLocation = "$DeadboltIco,0"
        $lnk.Save()
        Write-Ok "$p"
    } else {
        Write-Warn2 "not found: $p"
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Magenta

if ($Restart) {
    Write-Step "Restarting Discord Canary (Stable is never touched)"
    Stop-Process -Name "DiscordCanary" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Start-Process (Join-Path $CanaryRoot "Update.exe") -ArgumentList "--processStart DiscordCanary.exe"
    Write-Ok "relaunch requested"
} else {
    Write-Host "Run with -Restart to also relaunch Canary, or restart it yourself to apply." -ForegroundColor DarkGray
}
