param(
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptsDir = $PSScriptRoot
Set-Location $RepoRoot

Write-Host "Deadbolt repair" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path (Join-Path $RepoRoot "dist\desktop\patcher.js"))) {
    Write-Host "-> No Deadbolt build found, building it (this takes a minute)..." -ForegroundColor Cyan
    pnpm install --config.confirmModulesPurge=false
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed (exit $LASTEXITCODE)" }
}

Write-Host "-> Re-applying Deadbolt to every Discord install..." -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "reapply-branding.ps1")
if ($LASTEXITCODE -ne 0) { throw "re-applying Deadbolt failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "-> Making sure the background tasks are set up..." -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "install-background-tasks.ps1")
if ($LASTEXITCODE -ne 0) { throw "registering the background tasks failed (exit $LASTEXITCODE)" }

if (-not $NoRestart) {
    $clients = @(
        @{ Name = "Canary"; Process = "DiscordCanary"; Root = Join-Path $env:LOCALAPPDATA "DiscordCanary" },
        @{ Name = "Stable"; Process = "Discord"; Root = Join-Path $env:LOCALAPPDATA "Discord" }
    )
    foreach ($c in $clients) {
        if (Get-Process -Name $c.Process -ErrorAction SilentlyContinue) {
            Write-Host "-> Restarting Discord $($c.Name) so it loads Deadbolt..." -ForegroundColor Cyan
            Stop-Process -Name $c.Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            Start-Process (Join-Path $c.Root "Update.exe") -ArgumentList "--processStart $($c.Process).exe"
        }
    }
}

Write-Host ""
Write-Host "Repair finished. Deadbolt is applied and will keep re-applying itself after Discord updates." -ForegroundColor Green
