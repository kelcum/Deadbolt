<#
.SYNOPSIS
    Reapplies Deadbolt's Windows-side branding (patcher injection, taskbar/
    shortcut icons, boot splash logo) after Discord Canary or Stable auto-update.

.DESCRIPTION
    Discord's own Squirrel-based updater prunes old app-X.Y.Z version folders
    and replaces app.ico / Start Menu shortcuts on every update, which
    silently undoes everything this script reapplies. None of this touches
    Deadbolt's actual mod code or your settings/QuickCSS (those live in
    %APPDATA%\Deadbolt, untouched by any of this) - it's purely the injection
    stub + a few cosmetic OS-level files living inside each client's own
    install tree, which the updater owns and periodically resets.

    Handles both Discord Canary and Discord Stable by default - pass
    -Clients to restrict it to just one.

    Run this any time a client crashes on launch with a "Cannot find module
    ...patcher.js" error, or whenever the taskbar/splash branding reverts to
    stock Discord after an update.

.PARAMETER Restart
    Also kill and relaunch each client this run touched, but only the ones
    that were already running before this script started - it never launches
    a client that wasn't already open.

.PARAMETER Clients
    Which client(s) to reapply to. Defaults to both Canary and Stable.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\reapply-branding.ps1 -Restart

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\reapply-branding.ps1 -Clients Stable
#>

param(
    [switch]$Restart,
    [ValidateSet("Canary", "Stable")]
    [string[]]$Clients = @("Canary", "Stable")
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PatcherPath = Join-Path $RepoRoot "dist\desktop\patcher.js"
$DeadboltIco = Join-Path $RepoRoot "browser\deadbolt.ico"
$SplashSvg = Join-Path $RepoRoot "browser\splash.svg"

$ClientDefs = @{
    Canary = @{
        ProcessName   = "DiscordCanary"
        Root          = Join-Path $env:LOCALAPPDATA "DiscordCanary"
        ShortcutNames = @("Discord Canary.lnk")
    }
    Stable = @{
        ProcessName   = "Discord"
        Root          = Join-Path $env:LOCALAPPDATA "Discord"
        ShortcutNames = @("Discord.lnk")
    }
}

function Write-Step($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "   SKIP: $msg" -ForegroundColor Yellow }

Write-Host "Deadbolt branding reapply" -ForegroundColor Magenta
Write-Host "Repo:    $RepoRoot"
Write-Host "Clients: $($Clients -join ', ')"
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

$PatcherRequirePath = $PatcherPath -replace "\\", "/"
$StubContent = "require(`"$PatcherRequirePath`");"
$shell = New-Object -ComObject WScript.Shell
$touchedClients = @()

foreach ($clientName in $Clients) {
    $client = $ClientDefs[$clientName]
    $ClientRoot = $client.Root

    Write-Host "== $clientName ($ClientRoot) ==" -ForegroundColor Magenta

    if (-not (Test-Path $ClientRoot)) {
        Write-Warn2 "Discord $clientName isn't installed at $ClientRoot, skipping."
        Write-Host ""
        continue
    }
    $touchedClients += $clientName

    # ── 1. Version folders: injection stub, per-version app.ico, splash logo ──
    $versionDirs = Get-ChildItem -Path $ClientRoot -Directory -Filter "app-*" -ErrorAction SilentlyContinue
    if (-not $versionDirs) {
        Write-Warn2 "No app-* version folders found under $ClientRoot"
    }

    foreach ($verDir in $versionDirs) {
        Write-Step "Version folder: $($verDir.Name)"

        # Discord sometimes ships resources/app.asar as a real packed archive
        # rather than the unpacked directory we can write index.js into
        # directly - unpack it in place (same path, now a directory) first.
        $appAsar = Join-Path $verDir.FullName "resources\app.asar"
        if ((Test-Path $appAsar) -and -not (Get-Item $appAsar).PSIsContainer) {
            Write-Step "app.asar is a packed archive here, unpacking it first..."
            & node (Join-Path $RepoRoot "scripts\ensure-asar-unpacked.cjs") $appAsar | ForEach-Object { Write-Host "   $_" }
        }

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
    $rootIco = Join-Path $ClientRoot "app.ico"
    if (Test-Path $rootIco) {
        $rootIcoOrig = "$rootIco.orig"
        if (-not (Test-Path $rootIcoOrig)) { Copy-Item $rootIco $rootIcoOrig }
        Copy-Item -Path $DeadboltIco -Destination $rootIco -Force
        Write-Ok "$rootIco"
    }

    # ── 3. Shortcuts (Discord's installer re-touches these on update too) ──
    Write-Step "Shortcuts"
    $shortcutPaths = foreach ($lnkName in $client.ShortcutNames) {
        Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\$lnkName"
        Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$lnkName"
        Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Discord Inc\$lnkName"
    }
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
}

Write-Host "Done." -ForegroundColor Magenta

if ($Restart) {
    foreach ($clientName in $touchedClients) {
        $client = $ClientDefs[$clientName]
        $running = Get-Process -Name $client.ProcessName -ErrorAction SilentlyContinue
        if ($running) {
            Write-Step "Restarting Discord $clientName (was already running)"
            Stop-Process -Name $client.ProcessName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
            Start-Process (Join-Path $client.Root "Update.exe") -ArgumentList "--processStart $($client.ProcessName).exe"
            Write-Ok "relaunch requested"
        } else {
            Write-Step "Discord $clientName isn't running, not launching it"
        }
    }
} else {
    Write-Host "Run with -Restart to also relaunch whichever clients were already running, or restart them yourself to apply." -ForegroundColor DarkGray
}
