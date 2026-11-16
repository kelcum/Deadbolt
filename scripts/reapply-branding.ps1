param(
    [switch]$Restart,
    [switch]$Quiet,
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

$script:Lines = New-Object System.Collections.Generic.List[string]
$script:Changes = 0
$script:Failures = 0

function Out-Line($text, $color = "Gray") {
    $script:Lines.Add($text)
    if (-not $Quiet) { Write-Host $text -ForegroundColor $color }
}
function Write-Step($msg) { Out-Line "-> $msg" "Cyan" }
function Write-Ok($msg) { $script:Changes++; Out-Line "   OK: $msg" "Green" }
function Write-Same($msg) { Out-Line "   already set: $msg" "DarkGray" }
function Write-Warn2($msg) { Out-Line "   SKIP: $msg" "Yellow" }
function Write-Fail($msg) { $script:Failures++; Out-Line "   FAILED: $msg" "Red" }

function Get-Hash($path) {
    (Get-FileHash -Path $path -Algorithm SHA256).Hash
}

function Copy-IfDifferent($source, $target) {
    if ((Test-Path $target) -and ((Get-Hash $source) -eq (Get-Hash $target))) { return $false }
    Copy-Item -Path $source -Destination $target -Force
    return $true
}

function Save-Original($path) {
    $orig = "$path.orig"
    if (-not (Test-Path $orig)) { Copy-Item $path $orig }
}

Out-Line "Deadbolt branding reapply" "Magenta"
Out-Line "Repo:    $RepoRoot"
Out-Line "Clients: $($Clients -join ', ')"
Out-Line ""

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
$newlyPatched = @{}

foreach ($clientName in $Clients) {
    $client = $ClientDefs[$clientName]
    $ClientRoot = $client.Root
    $newlyPatched[$clientName] = @()

    Out-Line "== $clientName ($ClientRoot) ==" "Magenta"

    if (-not (Test-Path $ClientRoot)) {
        Write-Warn2 "Discord $clientName isn't installed at $ClientRoot, skipping."
        Out-Line ""
        continue
    }
    $touchedClients += $clientName

    $versionDirs = Get-ChildItem -Path $ClientRoot -Directory -Filter "app-*" -ErrorAction SilentlyContinue
    if (-not $versionDirs) {
        Write-Warn2 "No app-* version folders found under $ClientRoot"
    }

    foreach ($verDir in $versionDirs) {
        Write-Step "Version folder: $($verDir.Name)"
        try {
            $appAsar = Join-Path $verDir.FullName "resources\app.asar"
            if ((Test-Path $appAsar) -and -not (Get-Item $appAsar).PSIsContainer) {
                Write-Step "app.asar is a packed archive here, unpacking it first..."
                & node (Join-Path $RepoRoot "scripts\ensure-asar-unpacked.cjs") $appAsar | ForEach-Object { Out-Line "   $_" }
                if ($LASTEXITCODE -ne 0) { throw "unpacking $appAsar failed (exit $LASTEXITCODE)" }
            }

            $indexJs = Join-Path $verDir.FullName "resources\app.asar\index.js"
            if (Test-Path $indexJs) {
                $current = Get-Content -Path $indexJs -Raw -ErrorAction SilentlyContinue
                if ($current -ne $StubContent) {
                    Set-Content -Path $indexJs -Value $StubContent -NoNewline -Encoding ascii
                    $newlyPatched[$clientName] += $verDir.FullName
                    Write-Ok "patcher stub -> $indexJs"
                } else {
                    Write-Same "patcher stub in $($verDir.Name)"
                }
            } else {
                Write-Warn2 "no resources\app.asar\index.js here"
            }

            $verIco = Join-Path $verDir.FullName "app.ico"
            if (Test-Path $verIco) {
                Save-Original $verIco
                if (Copy-IfDifferent $DeadboltIco $verIco) { Write-Ok "app.ico -> $verIco" } else { Write-Same "app.ico in $($verDir.Name)" }
            }

            $coreDirs = Get-ChildItem -Path (Join-Path $verDir.FullName "modules") -Directory -Filter "discord_desktop_core-*" -ErrorAction SilentlyContinue
            foreach ($coreDir in $coreDirs) {
                $svg = Join-Path $coreDir.FullName "discord_desktop_core\app\images\discord.svg"
                if (Test-Path $svg) {
                    Save-Original $svg
                    if (Copy-IfDifferent $SplashSvg $svg) { Write-Ok "splash logo -> $($coreDir.Name)" } else { Write-Same "splash logo in $($coreDir.Name)" }
                }
            }
        } catch {
            Write-Fail "$($verDir.Name): $_"
        }
    }

    Write-Step "Root app.ico"
    try {
        $rootIco = Join-Path $ClientRoot "app.ico"
        if (Test-Path $rootIco) {
            Save-Original $rootIco
            if (Copy-IfDifferent $DeadboltIco $rootIco) { Write-Ok "$rootIco" } else { Write-Same "$rootIco" }
        }
    } catch {
        Write-Fail "root app.ico: $_"
    }

    Write-Step "Shortcuts"
    $wantIcon = "$DeadboltIco,0"
    $shortcutPaths = foreach ($lnkName in $client.ShortcutNames) {
        Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\$lnkName"
        Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$lnkName"
        Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Discord Inc\$lnkName"
        Join-Path ([Environment]::GetFolderPath("Desktop")) $lnkName
    }
    foreach ($p in $shortcutPaths) {
        if (-not (Test-Path $p)) { continue }
        try {
            $lnk = $shell.CreateShortcut($p)
            if ($lnk.IconLocation -ne $wantIcon) {
                $lnk.IconLocation = $wantIcon
                $lnk.Save()
                Write-Ok "$p"
            } else {
                Write-Same "$p"
            }
        } catch {
            Write-Fail "shortcut $p : $_"
        }
    }

    Out-Line ""
}

if ($Restart) {
    foreach ($clientName in $touchedClients) {
        $client = $ClientDefs[$clientName]
        $running = @(Get-Process -Name $client.ProcessName -ErrorAction SilentlyContinue)
        if (-not $running) { continue }

        $runningDirs = @($running | ForEach-Object { try { Split-Path -Parent $_.Path } catch { $null } } | Where-Object { $_ } | Sort-Object -Unique)
        $needsRestart = @($runningDirs | Where-Object { $newlyPatched[$clientName] -contains $_ })

        if ($needsRestart) {
            Write-Step "Restarting Discord $($clientName), it was running without Deadbolt ($(Split-Path -Leaf $needsRestart[0]))"
            Stop-Process -Name $client.ProcessName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            Start-Process (Join-Path $client.Root "Update.exe") -ArgumentList "--processStart $($client.ProcessName).exe"
            Write-Ok "relaunch requested"
        } else {
            Out-Line "-> Discord $clientName is running with Deadbolt already, leaving it alone" "DarkGray"
        }
    }
}

if ($Quiet -and ($script:Changes -gt 0 -or $script:Failures -gt 0)) {
    $script:Lines | ForEach-Object { Write-Output $_ }
}

if ($script:Changes -eq 0 -and $script:Failures -eq 0) {
    Write-Output "Done. Everything was already in place."
} else {
    Write-Output "Done. $($script:Changes) change(s), $($script:Failures) failure(s)."
}

if ($script:Failures -gt 0) { exit 2 }
exit 0
