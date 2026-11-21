$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot "auto-update.log"
$PauseFile = Join-Path $PSScriptRoot "sync.paused"
$DistDir = Join-Path $RepoRoot "dist\desktop"
$LastGoodDir = Join-Path $RepoRoot "dist\desktop.lastgood"
$BuiltFromFile = Join-Path $RepoRoot "dist\built-from.txt"
$UpstreamRemote = "upstream"
$UpstreamBranch = "main"
$env:GIT_TERMINAL_PROMPT = "0"

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

function Write-Lines {
    process {
        $text = "$_"
        if ($text -and $text -ne "System.Management.Automation.RemoteException") { Log $text }
    }
}

. (Join-Path $PSScriptRoot "stuck-alert.ps1")

$script:Checked = New-Object System.Collections.Generic.List[string]

function Set-Checked([string[]]$Keys) {
    foreach ($k in $Keys) { if (-not $script:Checked.Contains($k)) { $script:Checked.Add($k) } }
}

$mutex = New-Object System.Threading.Mutex($false, "Local\DeadboltAutoUpdate")
$hasLock = $false
try {
    $hasLock = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    $hasLock = $true
}
if (-not $hasLock) {
    Write-Output "Another Deadbolt auto-update is still running, skipping this one."
    exit 0
}

if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 512KB) {
    Move-Item -Path $LogFile -Destination "$LogFile.1" -Force
}

function Invoke-GitFetch($remote, $branch) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch $remote $branch 2>&1 | Write-Lines
        if ($LASTEXITCODE -eq 0) { return $true }
        Log "git fetch $remote failed (attempt $attempt of 3, exit $LASTEXITCODE)."
        if ($attempt -lt 3) { Start-Sleep -Seconds (15 * $attempt) }
    }
    return $false
}

function Save-LastGood {
    if (-not (Test-Path (Join-Path $DistDir "patcher.js"))) { return }
    if (Test-Path $LastGoodDir) { Remove-Item -Path $LastGoodDir -Recurse -Force }
    Copy-Item -Path $DistDir -Destination $LastGoodDir -Recurse
}

function Restore-LastGood {
    if (-not (Test-Path (Join-Path $LastGoodDir "patcher.js"))) {
        Log "No last good build to go back to, dist\desktop stays as the failed build left it."
        return
    }
    if (Test-Path $DistDir) { Remove-Item -Path $DistDir -Recurse -Force }
    Copy-Item -Path $LastGoodDir -Destination $DistDir -Recurse
    Log "Put the last good build back in dist\desktop."
}

function Build-Repo() {
    Save-LastGood
    pnpm install --config.confirmModulesPurge=false 2>&1 | Write-Lines
    $installExit = $LASTEXITCODE
    $buildExit = -1
    if ($installExit -eq 0) {
        pnpm build 2>&1 | Write-Lines
        $buildExit = $LASTEXITCODE
    }
    if ($installExit -ne 0 -or $buildExit -ne 0 -or -not (Test-Path (Join-Path $DistDir "patcher.js"))) {
        Log "BUILD FAILED (install exit $installExit, build exit $buildExit)."
        Restore-LastGood
        $script:BuildFailed = $true
        return $false
    }
    Set-Content -Path $BuiltFromFile -Value (git rev-parse HEAD)
    Set-Checked "build"
    Log "Build succeeded."
    return $true
}

function Test-BuildCurrent {
    if (-not (Test-Path $BuiltFromFile)) { return $false }
    return ((Get-Content -Path $BuiltFromFile -TotalCount 1) -eq (git rev-parse HEAD))
}

function Test-UpdaterMerge {
    $line = git rev-list --parents -n 1 HEAD
    $parts = @("$line" -split " " | Where-Object { $_ })
    if ($parts.Count -ne 3) { return $false }
    git merge-base --is-ancestor $parts[1] origin/main 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    git merge-base --is-ancestor $parts[2] "$UpstreamRemote/$UpstreamBranch" 2>$null
    if ($LASTEXITCODE -ne 0) { return $false }
    $autoTree = @(git merge-tree --write-tree $parts[1] $parts[2] 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $autoTree) { return $false }
    return ($autoTree[0] -eq (git rev-parse "HEAD^{tree}"))
}

function Resume-UpdaterMerge($behind) {
    $merge = git rev-parse HEAD
    if ($behind -gt 0) {
        Log "Local main has an unpushed upstream merge ($merge) from an earlier run, and origin/main moved since. Dropping it so this run merges again on top."
        git reset --hard "HEAD^1" 2>&1 | Write-Lines
        return $false
    }
    Log "Local main has an unpushed upstream merge ($merge) from an earlier run that didn't finish. Verifying it..."
    if (Build-Repo) {
        git push origin main 2>&1 | Write-Lines
        if ($LASTEXITCODE -eq 0) {
            Set-Checked "unpushed", "push", "merge-build"
            Log "Pushed the leftover merge. Fork is current again."
        } else {
            Log "Pushing the leftover merge failed (exit $LASTEXITCODE), the next run tries again."
            Send-StuckAlert "push" "The upstream merge worked locally but pushing it to GitHub keeps failing. Run git push in the Deadbolt folder."
        }
        return $true
    }
    Log "The leftover merge doesn't build, dropping it and going back to origin/main."
    git reset --hard origin/main 2>&1 | Write-Lines
    Send-StuckAlert "merge-build" "Merging upstream broke the build, so it was rolled back. It needs a manual merge."
    return $true
}

function Backup-UserPlugins {
    $source = Join-Path $RepoRoot "src\userplugins"
    if (-not (Test-Path $source)) { return }
    $files = @(Get-ChildItem -Path $source -Recurse -File -ErrorAction SilentlyContinue)
    if (-not $files) { return }
    $backupDir = Join-Path $env:LOCALAPPDATA "DeadboltAutoUpdate\userplugins-backups"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $fingerprint = ($files | Sort-Object FullName | ForEach-Object { "$($_.FullName.Substring($source.Length))|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"
    $stampFile = Join-Path $backupDir "last.txt"
    if ((Test-Path $stampFile) -and ((Get-Content -Path $stampFile -Raw) -eq $fingerprint)) { return }
    $zip = Join-Path $backupDir ("userplugins-{0}.zip" -f (Get-Date -Format "yyyy-MM-dd_HH-mm"))
    Compress-Archive -Path (Join-Path $source "*") -DestinationPath $zip -Force
    Set-Content -Path $stampFile -Value $fingerprint -NoNewline
    Get-ChildItem -Path $backupDir -Filter "userplugins-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 15 | Remove-Item -Force
    Log "Backed up src\userplugins ($($files.Count) files) to $zip"
}

$script:BuildFailed = $false

Log "=== auto-update run starting ==="

try {
    Backup-UserPlugins
} catch {
    Log "Couldn't back up src\userplugins: $_"
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    Set-Location $RepoRoot

    if (Test-Path $PauseFile) {
        Log "scripts\sync.paused exists, so no pulling, merging or building this run. Delete it to resume."
    } else {
        $status = git status --porcelain 2>&1
        if ($status) {
            Log "Working tree isn't clean, skipping pull/build so nothing local gets clobbered:"
            Log ($status | Out-String)
            Send-StuckAlert "dirty-tree" "Updates are paused: the Deadbolt folder has uncommitted changes. Commit or stash them and it carries on by itself."
        } elseif (-not (Invoke-GitFetch "origin" "main")) {
            Set-Checked "dirty-tree"
            Log "git fetch origin failed 3 times, skipping this run."
            Send-StuckAlert "fetch" "Deadbolt couldn't reach GitHub for 3 days, so it isn't updating. Check git fetch in the Deadbolt folder."
        } else {
            Set-Checked "dirty-tree", "fetch"
            $upstreamFetched = Invoke-GitFetch $UpstreamRemote $UpstreamBranch
            if (-not $upstreamFetched) { Log "git fetch $UpstreamRemote failed 3 times - skipping upstream sync this run." }

            $behind = [int](git rev-list --count "HEAD..origin/main")
            $ahead  = [int](git rev-list --count "origin/main..HEAD")
            $handled = $false

            $aheadFirstParent = [int](git rev-list --count --first-parent "origin/main..HEAD")

            if ($aheadFirstParent -eq 1 -and (Test-UpdaterMerge)) {
                $handled = Resume-UpdaterMerge $behind
                $behind = [int](git rev-list --count "HEAD..origin/main")
                $ahead = [int](git rev-list --count "origin/main..HEAD")
            }
            $before = git rev-parse HEAD

            if ($handled) {
                Log "Skipping the rest of the sync this run."
            } elseif ($ahead -gt 0) {
                Log "Local main is $ahead commit(s) ahead of origin/main - not touching it, this needs a human to push or reset. Skipping the upstream sync too until that's sorted out."
                Send-StuckAlert "unpushed" "Updates are paused: local main has commits that aren't pushed to GitHub. Push them (or reset) and it carries on by itself."
            } else {
                Set-Checked "unpushed"
                if ($behind -eq 0) {
                    Log "Already up to date with origin/main ($before)."
                    if (Test-BuildCurrent) {
                        Set-Checked "build"
                    } else {
                        Log "dist wasn't built from this commit, rebuilding..."
                        if (-not (Build-Repo)) {
                            Send-StuckAlert "build" "The build keeps failing. Discord keeps the last build that worked."
                        }
                    }
                } else {
                    Log "$behind commit(s) behind origin/main, fast-forwarding..."
                    git merge --ff-only --no-stat origin/main 2>&1 | Write-Lines
                    if ($LASTEXITCODE -ne 0) { throw "git merge --ff-only failed (exit $LASTEXITCODE)" }
                    $after = git rev-parse HEAD
                    if ($after -ne $before) {
                        Log "Updated $before -> $after. Installing and rebuilding..."
                        if (-not (Build-Repo)) {
                            Send-StuckAlert "build" "The build failed after pulling new commits. Discord keeps the last build that worked."
                        }
                    }
                }

                if ($upstreamFetched -and -not $script:BuildFailed) {
                    $upstreamRef = "$UpstreamRemote/$UpstreamBranch"
                    $upstreamBehind = [int](git rev-list --count "HEAD..$upstreamRef")
                    if ($upstreamBehind -eq 0) {
                        Set-Checked "conflict", "merge", "merge-build", "push"
                        Log "Already up to date with $upstreamRef too."
                    } else {
                        Log "$upstreamBehind commit(s) behind $upstreamRef, attempting a merge..."
                        $preMergeSha = git rev-parse HEAD
                        git merge $upstreamRef --no-edit --no-stat 2>&1 | Write-Lines
                        $mergeExit = $LASTEXITCODE

                        if ($mergeExit -ne 0) {
                            $conflicted = @(git diff --name-only --diff-filter=U 2>$null | Where-Object { $_ })
                            if (Test-Path (Join-Path $RepoRoot ".git\MERGE_HEAD")) { git merge --abort 2>&1 | Write-Lines }
                            if ((git rev-parse HEAD) -ne $preMergeSha) { git reset --hard $preMergeSha 2>&1 | Write-Lines }
                            if ($conflicted) {
                                Log "Merge from $upstreamRef conflicted in: $($conflicted -join ', '). Aborted, needs a manual merge."
                                Send-StuckAlert "conflict" "Merging upstream Equicord conflicts in $($conflicted.Count) file(s), so the fork is falling behind. It needs a manual merge."
                            } else {
                                Log "Merge from $upstreamRef failed without conflicts (exit $mergeExit), see the lines above."
                                Send-StuckAlert "merge" "Merging upstream Equicord keeps failing, so the fork is falling behind. Check the log."
                            }
                        } else {
                            $mergedSha = git rev-parse HEAD
                            Log "Merged $upstreamRef cleanly: $preMergeSha -> $mergedSha. Rebuilding to verify before pushing..."
                            if (Build-Repo) {
                                Log "Build verified, pushing to origin/main..."
                                git push origin main 2>&1 | Write-Lines
                                if ($LASTEXITCODE -ne 0) {
                                    Log "git push failed (exit $LASTEXITCODE) - local main has the merge, the next run retries the push."
                                    Send-StuckAlert "push" "The upstream merge worked locally but pushing it to GitHub keeps failing. Run git push in the Deadbolt folder."
                                } else {
                                    Set-Checked "conflict", "merge", "merge-build", "push"
                                    Log "Pushed. Fork is now current with $upstreamRef."
                                }
                            } else {
                                Log "Build failed after merging $upstreamRef - reverting to $preMergeSha so nothing broken gets pushed."
                                git reset --hard $preMergeSha 2>&1 | Write-Lines
                                Send-StuckAlert "merge-build" "Merging upstream broke the build, so it was rolled back. It needs a manual merge."
                            }
                        }
                    }
                }
            }
        }
    }
    Set-Checked "error"
} catch {
    Log "ERROR during git/build step: $_"
    Send-StuckAlert "error" ("The update step failed: " + (("$_" -split "`r?`n")[0]))
} finally {
    $ErrorActionPreference = $prevEap
}

if (Test-Path $PauseFile) {
    Log "scripts\sync.paused exists, so Discord is left as it is this run."
} else {
    try {
        $reapplyScript = Join-Path $RepoRoot "scripts\reapply-branding.ps1"
        $reapplyArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $reapplyScript, "-Quiet")
        if ($script:BuildFailed) {
            Log "Reapplying branding without restarting anything, since this run's build failed..."
        } else {
            $reapplyArgs += "-Restart"
            Log "Reapplying branding to Canary and Stable (restarting a client only if it was running without Deadbolt)..."
        }
        & powershell @reapplyArgs *>&1 | Write-Lines
        if ($LASTEXITCODE -eq 0) {
            Set-Checked "branding"
        } else {
            Send-StuckAlert "branding" "Re-applying Deadbolt to Discord failed, so Discord may be running without the mod. Run scripts\repair.ps1 in the Deadbolt folder."
        }
    } catch {
        Log "ERROR during branding reapply: $_"
        Send-StuckAlert "branding" "Re-applying Deadbolt to Discord failed, so Discord may be running without the mod. Run scripts\repair.ps1 in the Deadbolt folder."
    }
}

Clear-StuckAlert $script:Checked.ToArray()

Log "=== auto-update run finished ==="
