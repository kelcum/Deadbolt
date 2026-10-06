<#
.SYNOPSIS
    "The unattended auto-update is stuck" alert, dot-sourced by
    auto-update.ps1 (not meant to be run on its own).

.DESCRIPTION
    auto-update.ps1 runs hidden on a schedule, so a merge conflict or a failed
    build used to be visible only in auto-update.log. Send-StuckAlert logs the
    problem and tells you about it:

    - a Windows toast notification, normally;
    - a small popup window instead, when Windows has notifications switched
      off for the account (Settings > System > Notifications), because a toast
      would be accepted and then never shown.

    Both offer to open the log. The popup runs in its own detached process, so
    it never holds up the update run while it waits for a click.

    The same problem is only announced once per 24 hours, so a conflict that
    sits there over a weekend doesn't nag every 5 hours. A run that finishes
    with nothing stuck clears that memory (Clear-StuckAlert), so the next
    problem is announced straight away.

    The "already told you" state lives outside the repo on purpose: a file
    inside it would dirty the working tree, and a dirty tree is exactly what
    makes auto-update.ps1 skip a run.

    Needs Log and $LogFile from the caller. Nothing in here is allowed to
    throw into the update run - a failed alert is just another log line.
#>

$script:AlertStateFile = Join-Path $env:LOCALAPPDATA "DeadboltAutoUpdate\last-alert.json"
$script:AlertRepeatHours = 24
$script:Stuck = $false

# Windows PowerShell's own AppUserModelID. A made-up one gets its toasts
# dropped silently unless it's registered first; this one works as-is and
# needs no registry changes.
$script:ToastAppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

# Only the account-wide switch is checked. Turning off just PowerShell's
# notifications in Settings would still swallow the toast.
function Test-ToastsEnabled {
    try {
        $on = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -ErrorAction Stop).ToastEnabled
        return ($null -eq $on -or $on -ne 0)
    } catch {
        return $true
    }
}

function Show-DeadboltToast([string]$Title, [string]$Body, [string]$OpenPath) {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    $esc = { param($s) [System.Security.SecurityElement]::Escape($s) }

    $launch = ""
    if ($OpenPath) {
        $launch = ' activationType="protocol" launch="{0}"' -f (& $esc ([Uri]$OpenPath).AbsoluteUri)
    }

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast$launch><visual><binding template=`"ToastGeneric`"><text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual></toast>")

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    # Stay in the Action Center for a few days even if the pop-up is missed.
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddDays(3)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($script:ToastAppId).Show($toast)
}

# A plain Win32 message box, kept above other windows (MB_SYSTEMMODAL - on
# current Windows that just gives it the topmost style, it locks nothing; plain
# MB_TOPMOST doesn't) but without taking keyboard focus, and defaulting to
# "No", so an Enter or Space you
# happen to press while typing elsewhere can't answer it. Runs in a detached
# hidden PowerShell so waiting for a click can't stall the update run. "Yes"
# opens the log.
function Show-StuckPopup([string]$Title, [string]$Body, [string]$OpenPath) {
    $q = { param($s) "'" + ($s -replace "'", "''") + "'" }

    $code = @'
Add-Type -Namespace Win32 -Name Msg -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);'
# MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SYSTEMMODAL
$answer = [Win32.Msg]::MessageBox([IntPtr]::Zero, __BODY__, __TITLE__, [uint32](0x4 -bor 0x30 -bor 0x100 -bor 0x1000))
if ($answer -eq 6) { Start-Process __PATH__ }
'@
    $code = $code.Replace('__BODY__', (& $q ($Body + "`r`n`r`nOpen the log now?"))).Replace('__TITLE__', (& $q $Title)).Replace('__PATH__', (& $q $OpenPath))

    # -EncodedCommand sidesteps every quoting problem in the message text.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
}

function Send-StuckAlert([string]$Key, [string]$Message) {
    # Set before anything that can fail, so an alert problem can't make a
    # stuck run look healthy to Clear-StuckAlert.
    $script:Stuck = $true
    try {
        Log "STUCK: $Message"

        $now = Get-Date
        if (Test-Path $script:AlertStateFile) {
            $last = Get-Content -Path $script:AlertStateFile -Raw | ConvertFrom-Json
            if ($last.key -eq $Key -and ($now - [datetime]$last.time).TotalHours -lt $script:AlertRepeatHours) {
                Log "Already told you about '$Key' in the last $($script:AlertRepeatHours)h - not repeating."
                return
            }
        }

        $title = "Deadbolt auto-update is stuck"
        if (Test-ToastsEnabled) {
            Show-DeadboltToast $title $Message $LogFile
            $how = "toast"
        } else {
            Show-StuckPopup $title $Message $LogFile
            $how = "popup (Windows notifications are off for this account)"
        }

        New-Item -ItemType Directory -Force -Path (Split-Path $script:AlertStateFile) | Out-Null
        @{ key = $Key; time = $now.ToString("o") } | ConvertTo-Json | Set-Content -Path $script:AlertStateFile
        Log "Alerted ('$Key') as a $how."
    } catch {
        Log "Couldn't show the stuck alert: $_"
    }
}

function Clear-StuckAlert {
    Remove-Item -Path $script:AlertStateFile -Force -ErrorAction SilentlyContinue
}
