<#
.SYNOPSIS
    Keeps a local Deadbolt checkout current, unattended: pulls new commits
    (both from your own fork and from upstream Equicord), rebuilds if
    anything changed, and reapplies the Windows-side injection/branding so
    Discord Canary/Stable always have the latest build actually loaded.

.DESCRIPTION
    Meant to run on a schedule (Task Scheduler), not interactively. It only
    restarts a Discord client (Canary or Stable) if it's already running
    when this fires - it will never launch either one on its own.

    This handles three separate kinds of staleness:
    1. New commits already pushed to origin/main (your own fork, e.g. from
       another machine) - fast-forwarded only, never rebased/force-pulled.
    2. New commits on upstream Equicord/Equicord:main - merged in (a real
       merge, since this fork has diverged) only when it comes back clean;
       a conflict aborts the merge and leaves it for a human instead of
       guessing at a resolution. A clean merge is rebuilt and verified
       before being pushed to origin/main - never pushed if the build fails.
    3. Discord's own updater (Canary or Stable) resetting the injection
       stub / icon / splash / shortcuts - reapplied every run via
       reapply-branding.ps1 for both clients, regardless of whether 1/2
       found anything (that reset can happen independently of any
       Deadbolt-side change).

    Logs to auto-update.log next to this script, trimmed to the last 500
    lines each run so it can't grow unbounded.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\auto-update.ps1
#>

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot "auto-update.log"
$UpstreamRemote = "upstream"
$UpstreamBranch = "main"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

# Shared by both the origin fast-forward and the upstream merge below - only
# ever called once a merge has actually landed something new on HEAD.
function Build-Repo() {
    pnpm install --config.confirmModulesPurge=false 2>&1 | ForEach-Object { Log $_ }
    $installExit = $LASTEXITCODE
    pnpm build 2>&1 | ForEach-Object { Log $_ }
    $buildExit = $LASTEXITCODE
    if ($installExit -ne 0 -or $buildExit -ne 0) {
        Log "BUILD FAILED (install exit $installExit, build exit $buildExit)."
        return $false
    }
    Log "Build succeeded."
    return $true
}

if (Test-Path $LogFile) {
    $tail = Get-Content -Path $LogFile -Tail 500
    Set-Content -Path $LogFile -Value $tail
}

Log "=== auto-update run starting ==="

# Native git/pnpm commands write ordinary progress info to stderr (e.g.
# git fetch's "From https://..." line); with $ErrorActionPreference =
# "Stop" that can otherwise get misread as a terminating error even on
# success. Run this block with it relaxed and check $LASTEXITCODE
# explicitly instead.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    Set-Location $RepoRoot

    $status = git status --porcelain 2>&1
    if ($status) {
        Log "Working tree isn't clean, skipping pull/build so nothing local gets clobbered:"
        Log ($status | Out-String)
    } else {
        # ── Phase 1: fast-forward from our own fork (origin/main) ──────────
        git fetch origin main 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -ne 0) { throw "git fetch origin failed (exit $LASTEXITCODE)" }

        $before = git rev-parse HEAD
        $behind = [int](git rev-list --count "HEAD..origin/main")
        $ahead  = [int](git rev-list --count "origin/main..HEAD")

        if ($ahead -gt 0) {
            Log "Local main is $ahead commit(s) ahead of origin/main - not touching it, this needs a human to push or reset. Skipping the upstream sync too until that's sorted out."
        } else {
            if ($behind -eq 0) {
                Log "Already up to date with origin/main ($before)."
            } else {
                Log "$behind commit(s) behind origin/main, fast-forwarding..."
                git merge --ff-only origin/main 2>&1 | ForEach-Object { Log $_ }
                if ($LASTEXITCODE -ne 0) { throw "git merge --ff-only failed (exit $LASTEXITCODE)" }
                $after = git rev-parse HEAD
                if ($after -ne $before) {
                    Log "Updated $before -> $after. Installing and rebuilding..."
                    if (-not (Build-Repo)) {
                        Log "Leaving whatever dist/ produced - needs a human to look."
                    }
                }
            }

            # ── Phase 2: merge in new commits from upstream Equicord ────────
            git fetch $UpstreamRemote $UpstreamBranch 2>&1 | ForEach-Object { Log $_ }
            if ($LASTEXITCODE -ne 0) {
                Log "git fetch $UpstreamRemote failed (exit $LASTEXITCODE) - skipping upstream sync this run."
            } else {
                $upstreamRef = "$UpstreamRemote/$UpstreamBranch"
                $upstreamBehind = [int](git rev-list --count "HEAD..$upstreamRef")
                if ($upstreamBehind -eq 0) {
                    Log "Already up to date with $upstreamRef too."
                } else {
                    Log "$upstreamBehind commit(s) behind $upstreamRef, attempting a merge..."
                    $preMergeSha = git rev-parse HEAD
                    git merge $upstreamRef --no-edit 2>&1 | ForEach-Object { Log $_ }
                    $mergeExit = $LASTEXITCODE

                    if ($mergeExit -ne 0) {
                        Log "Merge from $upstreamRef conflicted - aborting and leaving it for a human (git log $upstreamRef for what's new)."
                        git merge --abort 2>&1 | ForEach-Object { Log $_ }
                    } else {
                        $mergedSha = git rev-parse HEAD
                        Log "Merged $upstreamRef cleanly: $preMergeSha -> $mergedSha. Rebuilding to verify before pushing..."
                        if (Build-Repo) {
                            Log "Build verified, pushing to origin/main..."
                            git push origin main 2>&1 | ForEach-Object { Log $_ }
                            if ($LASTEXITCODE -ne 0) {
                                Log "git push failed (exit $LASTEXITCODE) - local main has the merge but origin doesn't yet. Needs a human (possible race with another push)."
                            } else {
                                Log "Pushed. Fork is now current with $upstreamRef."
                            }
                        } else {
                            Log "Build failed after merging $upstreamRef - reverting to $preMergeSha so nothing broken gets pushed. Needs a human to redo this merge properly."
                            git reset --hard $preMergeSha 2>&1 | ForEach-Object { Log $_ }
                        }
                    }
                }
            }
        }
    }
} catch {
    Log "ERROR during git/build step: $_"
} finally {
    $ErrorActionPreference = $prevEap
}

# Reapply branding/injection every run regardless of the above - Discord's
# own updater can reset this independently of any Deadbolt-side change.
# Covers both Canary and Stable; reapply-branding.ps1 only restarts whichever
# client(s) were already running, and never launches one that wasn't.
try {
    $reapplyScript = Join-Path $RepoRoot "scripts\reapply-branding.ps1"
    Log "Reapplying branding to Canary and Stable (only restarting whichever is already running)..."
    & powershell -ExecutionPolicy Bypass -File $reapplyScript -Restart *>&1 | ForEach-Object { Log $_ }
} catch {
    Log "ERROR during branding reapply: $_"
}

Log "=== auto-update run finished ==="
