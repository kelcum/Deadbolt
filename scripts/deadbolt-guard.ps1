$ErrorActionPreference = "Continue"

$LogFile = Join-Path $PSScriptRoot "guard.log"
$ReapplyScript = Join-Path $PSScriptRoot "reapply-branding.ps1"

function Log($msg) {
    Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg)
}

. (Join-Path $PSScriptRoot "stuck-alert.ps1")

$output = & powershell -NoProfile -ExecutionPolicy Bypass -File $ReapplyScript -Restart -Quiet *>&1 | ForEach-Object { "$_" }
$exitCode = $LASTEXITCODE

$changed = $output | Where-Object { $_ -match "^   (OK|FAILED):" }
if ($changed -or $exitCode -ne 0) {
    if (Test-Path $LogFile) {
        Set-Content -Path $LogFile -Value (Get-Content -Path $LogFile -Tail 400)
    }
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$stamp] === guard found something to fix (exit $exitCode) ==="
    $output | ForEach-Object { Add-Content -Path $LogFile -Value "[$stamp] $_" }
}

if ($exitCode -ne 0) {
    Send-StuckAlert "guard" "Deadbolt couldn't re-apply itself to Discord after an update. Run scripts\repair.ps1 in the Deadbolt folder."
}

Clear-StuckAlert @("guard")

exit $exitCode
