$script:AlertStateFile = Join-Path $env:LOCALAPPDATA "DeadboltAutoUpdate\last-alert.json"
$script:AlertRepeatHours = 24
$script:Stuck = $false

$script:ToastAppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

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
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddDays(3)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($script:ToastAppId).Show($toast)
}

function Show-StuckPopup([string]$Title, [string]$Body, [string]$OpenPath) {
    $q = { param($s) "'" + ($s -replace "'", "''") + "'" }

    $code = @'
Add-Type -Namespace Win32 -Name Msg -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);'
# MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SYSTEMMODAL
$answer = [Win32.Msg]::MessageBox([IntPtr]::Zero, __BODY__, __TITLE__, [uint32](0x4 -bor 0x30 -bor 0x100 -bor 0x1000))
if ($answer -eq 6) { Start-Process __PATH__ }
'@
    $code = $code.Replace('__BODY__', (& $q ($Body + "`r`n`r`nOpen the log now?"))).Replace('__TITLE__', (& $q $Title)).Replace('__PATH__', (& $q $OpenPath))

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
}

function Send-StuckAlert([string]$Key, [string]$Message) {
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
