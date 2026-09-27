<#
.SYNOPSIS
    Keeps a local Deadbolt checkout current, unattended: pulls new commits,
    rebuilds if anything changed, and reapplies the Windows-side injection/
    branding so Discord Canary always has the latest build actually loaded.

.DESCRIPTION
    Meant to run on a schedule (Task Scheduler), not interactively. It only
    ever fast-forwards (never rebases/force-pulls), only rebuilds when the
    pull actually brought new commits, and only restarts Discord Canary if
    it's already running when this fires - it will never launch Discord on
    its own. Discord Stable is never touched.

    This handles two separate kinds of staleness:
    1. New commits on origin/main (e.g. from an upstream Equicord sync) -
       pulled and rebuilt here.
    2. Discord Canary's own updater resetting the injection stub / icon /
       splash / shortcuts - reapplied every run via reapply-branding.ps1,
       regardless of whether step 1 found anything (that reset can happen
       independently of any Deadbolt-side change).

    Logs to auto-update.log next to this script, trimmed to the last 500
    lines each run so it can't grow unbounded.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\auto-update.ps1
#>

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot "auto-update.log"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

if (Test-Path $LogFile) {
    $tail = Get-Content -Path $LogFile -Tail 500
    Set-Content -Path $LogFile -Value $tail
}

Log "=== auto-update run starting ==="

try {
    Set-Location $RepoRoot

    $status = git status --porcelain 2>&1
    if ($status) {
        Log "Working tree isn't clean, skipping pull/build so nothing local gets clobbered:"
        Log ($status | Out-String)
    } else {
        git fetch origin main *>&1 | ForEach-Object { Log $_ }

        $before = git rev-parse HEAD
        $behind = [int](git rev-list --count "HEAD..origin/main")
        $ahead  = [int](git rev-list --count "origin/main..HEAD")

        if ($ahead -gt 0) {
            Log "Local main is $ahead commit(s) ahead of origin/main - not touching it, this needs a human to push or reset."
        } elseif ($behind -eq 0) {
            Log "Already up to date with origin/main ($before)."
        } else {
            Log "$behind commit(s) behind origin/main, fast-forwarding..."
            git merge --ff-only origin/main *>&1 | ForEach-Object { Log $_ }
            $after = git rev-parse HEAD

            if ($after -ne $before) {
                Log "Updated $before -> $after. Installing and rebuilding..."
                pnpm install --config.confirmModulesPurge=false *>&1 | ForEach-Object { Log $_ }
                pnpm build *>&1 | ForEach-Object { Log $_ }
                if ($LASTEXITCODE -ne 0) {
                    Log "BUILD FAILED (exit $LASTEXITCODE) - leaving whatever dist/ produced, needs a human to look."
                } else {
                    Log "Build succeeded."
                }
            }
        }
    }
} catch {
    Log "ERROR during git/build step: $_"
}

# Reapply branding/injection every run regardless of the above - Canary's
# own updater can reset this independently of any Deadbolt-side change.
try {
    $canaryRunning = $null -ne (Get-Process -Name "DiscordCanary" -ErrorAction SilentlyContinue)
    $reapplyArgs = @{ File = (Join-Path $RepoRoot "scripts\reapply-branding.ps1") }
    if ($canaryRunning) {
        Log "Discord Canary is running - reapplying branding and restarting it to pick up any change."
        & powershell -ExecutionPolicy Bypass -File $reapplyArgs.File -Restart *>&1 | ForEach-Object { Log $_ }
    } else {
        Log "Discord Canary isn't running - reapplying branding without launching it."
        & powershell -ExecutionPolicy Bypass -File $reapplyArgs.File *>&1 | ForEach-Object { Log $_ }
    }
} catch {
    Log "ERROR during branding reapply: $_"
}

Log "=== auto-update run finished ==="
