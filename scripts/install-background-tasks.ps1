$ErrorActionPreference = "Stop"

$ScriptsDir = $PSScriptRoot
$UpdateScript = Join-Path $ScriptsDir "auto-update.ps1"
$GuardScript = Join-Path $ScriptsDir "deadbolt-guard.ps1"

function New-HiddenAction($scriptPath) {
    $arguments = "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    New-ScheduledTaskAction -Execute "conhost.exe" -Argument $arguments
}

function New-TaskSettings($limit) {
    New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit $limit `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$updateTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(7).AddMinutes(37) -RepetitionInterval (New-TimeSpan -Hours 5)
Register-ScheduledTask -TaskName "Deadbolt Auto-Update" `
    -Description "Pulls Deadbolt and upstream Equicord, rebuilds, pushes, and re-applies Deadbolt to Discord." `
    -Action (New-HiddenAction $UpdateScript) `
    -Trigger $updateTrigger `
    -Settings (New-TaskSettings (New-TimeSpan -Hours 1)) `
    -Principal $principal `
    -Force | Out-Null
Write-Host "Registered 'Deadbolt Auto-Update' (every 5 hours, 1 hour limit)."

$guardTriggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $user),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10))
)
Register-ScheduledTask -TaskName "Deadbolt Guard" `
    -Description "Re-applies Deadbolt to Discord within minutes after Discord updates itself." `
    -Action (New-HiddenAction $GuardScript) `
    -Trigger $guardTriggers `
    -Settings (New-TaskSettings (New-TimeSpan -Minutes 10)) `
    -Principal $principal `
    -Force | Out-Null
Write-Host "Registered 'Deadbolt Guard' (at log on and every 10 minutes)."
