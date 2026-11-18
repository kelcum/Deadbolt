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
$StubPackage = '{"name":"discord","main":"index.js"}'
$VersionPattern = '^app-\d+(\.\d+)+$'

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

$mutex = New-Object System.Threading.Mutex($false, "Local\DeadboltReapply")
$hasLock = $false
try {
    $hasLock = $mutex.WaitOne(60000)
} catch [System.Threading.AbandonedMutexException] {
    $hasLock = $true
}
if (-not $hasLock) {
    Write-Output "Another Deadbolt reapply is still running, skipping this one."
    exit 0
}

function Get-Hash($path) {
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}

function Copy-IfDifferent($source, $target) {
    if ((Test-Path -LiteralPath $target) -and ((Get-Hash $source) -eq (Get-Hash $target))) { return $false }
    Copy-Item -LiteralPath $source -Destination $target -Force
    return $true
}

function Save-Original($path) {
    $orig = "$path.orig"
    if (-not (Test-Path -LiteralPath $orig)) { Copy-Item -LiteralPath $path -Destination $orig }
}

function Read-Text($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    [System.IO.File]::ReadAllText($path)
}

function Write-Text($path, $text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function ConvertTo-StubKey($text) {
    if ($null -eq $text) { return $null }
    ($text.Trim() -replace '\\\\', '/').ToLowerInvariant()
}

function New-ShimFolder($app, $orig, $stub) {
    $origName = Split-Path -Leaf $orig
    Rename-Item -LiteralPath $app -NewName $origName
    try {
        New-Item -ItemType Directory -Path $app | Out-Null
        Write-Text (Join-Path $app "package.json") $StubPackage
        Write-Text (Join-Path $app "index.js") $stub
    } catch {
        $err = $_
        if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force -ErrorAction SilentlyContinue }
        if (-not (Test-Path -LiteralPath $app)) { Rename-Item -LiteralPath $orig -NewName (Split-Path -Leaf $app) -ErrorAction SilentlyContinue }
        throw $err
    }
}

function Set-Shim($resources, $stub) {
    $app = Join-Path $resources "app.asar"
    $orig = Join-Path $resources "_app.asar"

    if (-not (Test-Path -LiteralPath $app)) { throw "no app.asar in $resources" }
    $isDir = (Get-Item -LiteralPath $app -Force).PSIsContainer
    $hasOrig = Test-Path -LiteralPath $orig

    if (-not $isDir) {
        if ($hasOrig) { throw "both a packed app.asar and _app.asar exist in $resources" }
        New-ShimFolder $app $orig $stub
        return "shimmed"
    }

    if (-not $hasOrig) {
        $main = $null
        try { $main = (Read-Text (Join-Path $app "package.json") | ConvertFrom-Json).main } catch { }
        if ($main -eq "index.js") { throw "app.asar is a Deadbolt shim but _app.asar is missing, so Discord can't start from $resources" }
        New-ShimFolder $app $orig $stub
        return "converted"
    }

    $changed = $false
    if ((Read-Text (Join-Path $app "package.json")) -ne $StubPackage) {
        Write-Text (Join-Path $app "package.json") $StubPackage
        $changed = $true
    }
    if ((ConvertTo-StubKey (Read-Text (Join-Path $app "index.js"))) -ne (ConvertTo-StubKey $stub)) {
        Write-Text (Join-Path $app "index.js") $stub
        $changed = $true
    }
    if ($changed) { return "updated" }
    return "same"
}

function Test-Injected($versionDir, $stub) {
    $resources = Join-Path $versionDir "resources"
    (Test-Path -LiteralPath (Join-Path $resources "_app.asar")) -and ((ConvertTo-StubKey (Read-Text (Join-Path $resources "app.asar\index.js"))) -eq (ConvertTo-StubKey $stub))
}

function Get-VersionNumber($name) {
    [version](($name -replace '^app-', '') -replace '[^\d\.]', '')
}

Out-Line "Deadbolt branding reapply" "Magenta"
Out-Line "Repo:    $RepoRoot"
Out-Line "Clients: $($Clients -join ', ')"
Out-Line ""

if (-not (Test-Path -LiteralPath $PatcherPath)) {
    Write-Host "ERROR: $PatcherPath not found." -ForegroundColor Red
    Write-Host "Run 'pnpm install' and 'pnpm build' in $RepoRoot first, then re-run this script." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $DeadboltIco)) {
    Write-Host "ERROR: $DeadboltIco not found (should be tracked in git)." -ForegroundColor Red
    exit 1
}

$PatcherRequirePath = $PatcherPath -replace "\\", "/"
$StubContent = "require(`"$PatcherRequirePath`");"
$shell = New-Object -ComObject WScript.Shell
$touchedClients = @()
$newlyPatched = @{}
$updating = @{}

foreach ($clientName in $Clients) {
    $client = $ClientDefs[$clientName]
    $ClientRoot = $client.Root
    $newlyPatched[$clientName] = @()
    $updating[$clientName] = $false

    Out-Line "== $clientName ($ClientRoot) ==" "Magenta"

    if (-not (Test-Path -LiteralPath $ClientRoot)) {
        Write-Warn2 "Discord $clientName isn't installed at $ClientRoot, skipping."
        Out-Line ""
        continue
    }
    $touchedClients += $clientName

    $staging = @(Get-ChildItem -LiteralPath $ClientRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like ".app-*.installing" })
    if ($staging) {
        $updating[$clientName] = $true
        Out-Line "-> Discord $clientName is installing an update ($($staging[0].Name)), leaving that folder alone" "Yellow"
    }

    $versionDirs = @(Get-ChildItem -LiteralPath $ClientRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $VersionPattern })
    if (-not $versionDirs) {
        Write-Warn2 "No app-* version folders found under $ClientRoot"
    }

    $newestName = if ($versionDirs) { ($versionDirs | Sort-Object { Get-VersionNumber $_.Name } | Select-Object -Last 1).Name } else { $null }

    foreach ($verDir in $versionDirs) {
        Write-Step "Version folder: $($verDir.Name)"
        $resources = Join-Path $verDir.FullName "resources"
        if ($verDir.Name -ne $newestName -and -not (Test-Path -LiteralPath (Join-Path $resources "app.asar")) -and -not (Test-Path -LiteralPath (Join-Path $resources "_app.asar"))) {
            Write-Warn2 "$($verDir.Name) is an old Discord version that's being deleted, leaving it alone"
            continue
        }
        try {
            $result = Set-Shim $resources $StubContent
            switch ($result) {
                "shimmed" { $newlyPatched[$clientName] += $verDir.FullName; Write-Ok "Deadbolt injected into $($verDir.Name) (packed app.asar moved to _app.asar)" }
                "converted" { $newlyPatched[$clientName] += $verDir.FullName; Write-Ok "Deadbolt injected into $($verDir.Name) (unpacked app folder moved to _app.asar)" }
                "updated" { $newlyPatched[$clientName] += $verDir.FullName; Write-Ok "patcher stub -> $($verDir.Name)" }
                default { Write-Same "patcher stub in $($verDir.Name)" }
            }
        } catch {
            Write-Fail "$($verDir.Name): $_"
        }

        try {
            $verIco = Join-Path $verDir.FullName "app.ico"
            if (Test-Path -LiteralPath $verIco) {
                Save-Original $verIco
                if (Copy-IfDifferent $DeadboltIco $verIco) { Write-Ok "app.ico -> $($verDir.Name)" } else { Write-Same "app.ico in $($verDir.Name)" }
            }

            $coreDirs = Get-ChildItem -LiteralPath (Join-Path $verDir.FullName "modules") -Directory -Filter "discord_desktop_core-*" -ErrorAction SilentlyContinue
            foreach ($coreDir in $coreDirs) {
                $svg = Join-Path $coreDir.FullName "discord_desktop_core\app\images\discord.svg"
                if (Test-Path -LiteralPath $svg) {
                    Save-Original $svg
                    if (Copy-IfDifferent $SplashSvg $svg) { Write-Ok "splash logo -> $($coreDir.Name)" } else { Write-Same "splash logo in $($coreDir.Name)" }
                }
            }
        } catch {
            Write-Fail "$($verDir.Name) branding: $_"
        }
    }

    if ($versionDirs) {
        $newest = $versionDirs | Sort-Object { Get-VersionNumber $_.Name } | Select-Object -Last 1
        if (-not (Test-Injected $newest.FullName $StubContent)) {
            Write-Fail "Discord $clientName launches $($newest.Name), which doesn't have Deadbolt"
        }
    }

    Write-Step "Root app.ico"
    try {
        $rootIco = Join-Path $ClientRoot "app.ico"
        if (Test-Path -LiteralPath $rootIco) {
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
        if (-not (Test-Path -LiteralPath $p)) { continue }
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

        if ($updating[$clientName]) {
            Out-Line "-> Discord $clientName is mid-update, not restarting it" "DarkGray"
            continue
        }

        $runningDirs = @($running | ForEach-Object { try { Split-Path -Parent $_.Path } catch { $null } } | Where-Object { $_ } | Sort-Object -Unique)
        $needsRestart = @($runningDirs | Where-Object { $newlyPatched[$clientName] -contains $_ })

        if ($needsRestart) {
            Write-Step "Restarting Discord $($clientName), it was running without Deadbolt ($(Split-Path -Leaf $needsRestart[0]))"
            Stop-Process -Name $client.ProcessName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            $launcher = Join-Path $client.Root "Update.exe"
            Start-Process -FilePath $launcher -ArgumentList "--processStart $($client.ProcessName).exe"
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
