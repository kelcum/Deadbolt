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

. (Join-Path $PSScriptRoot "stuck-alert.ps1")

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

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    Set-Location $RepoRoot

    $status = git status --porcelain 2>&1
    if ($status) {
        Log "Working tree isn't clean, skipping pull/build so nothing local gets clobbered:"
        Log ($status | Out-String)
        Send-StuckAlert "dirty-tree" "Updates are paused: the Deadbolt folder has uncommitted changes. Commit or stash them and it carries on by itself."
    } else {
        git fetch origin main 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -ne 0) { throw "git fetch origin failed (exit $LASTEXITCODE)" }

        $before = git rev-parse HEAD
        $behind = [int](git rev-list --count "HEAD..origin/main")
        $ahead  = [int](git rev-list --count "origin/main..HEAD")

        if ($ahead -gt 0) {
            Log "Local main is $ahead commit(s) ahead of origin/main - not touching it, this needs a human to push or reset. Skipping the upstream sync too until that's sorted out."
            Send-StuckAlert "unpushed" "Updates are paused: local main has commits that aren't pushed to GitHub. Push them (or reset) and it carries on by itself."
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
                        Send-StuckAlert "build" "The build failed after pulling new commits, so Discord may be running an old or broken build."
                    }
                }
            }

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
                        Send-StuckAlert "conflict" "Merging upstream Equicord hit a conflict, so the fork is falling behind. It needs a manual merge."
                    } else {
                        $mergedSha = git rev-parse HEAD
                        Log "Merged $upstreamRef cleanly: $preMergeSha -> $mergedSha. Rebuilding to verify before pushing..."
                        if (Build-Repo) {
                            Log "Build verified, pushing to origin/main..."
                            git push origin main 2>&1 | ForEach-Object { Log $_ }
                            if ($LASTEXITCODE -ne 0) {
                                Log "git push failed (exit $LASTEXITCODE) - local main has the merge but origin doesn't yet. Needs a human (possible race with another push)."
                                Send-StuckAlert "push" "The upstream merge worked locally but pushing it to GitHub failed. Run git push in the Deadbolt folder."
                            } else {
                                Log "Pushed. Fork is now current with $upstreamRef."
                            }
                        } else {
                            Log "Build failed after merging $upstreamRef - reverting to $preMergeSha so nothing broken gets pushed. Needs a human to redo this merge properly."
                            git reset --hard $preMergeSha 2>&1 | ForEach-Object { Log $_ }
                            Send-StuckAlert "merge-build" "Merging upstream broke the build, so it was rolled back. It needs a manual merge."
                        }
                    }
                }
            }
        }
    }
} catch {
    Log "ERROR during git/build step: $_"
    if ("$_" -notmatch "git fetch") {
        Send-StuckAlert "error" ("The update step failed: " + (("$_" -split "`r?`n")[0]))
    }
} finally {
    $ErrorActionPreference = $prevEap
}

try {
    $reapplyScript = Join-Path $RepoRoot "scripts\reapply-branding.ps1"
    Log "Reapplying branding to Canary and Stable (only restarting whichever is already running)..."
    & powershell -ExecutionPolicy Bypass -File $reapplyScript -Restart *>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        Send-StuckAlert "branding" "Re-applying Deadbolt to Discord failed, so Discord may be running without the mod."
    }
} catch {
    Log "ERROR during branding reapply: $_"
    Send-StuckAlert "branding" "Re-applying Deadbolt to Discord failed, so Discord may be running without the mod."
}

if (-not $script:Stuck) { Clear-StuckAlert }

Log "=== auto-update run finished ==="
