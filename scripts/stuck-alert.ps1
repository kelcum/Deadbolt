$script:AlertStateFile = Join-Path $env:LOCALAPPDATA "DeadboltAutoUpdate\last-alert.json"
$script:AlertRepeatHours = 24
$script:BehindGraceHours = 72
$script:BehindKeys = @("conflict", "merge", "dirty-tree", "unpushed", "push", "fetch")
$script:Stuck = $false
$script:RaisedKeys = New-Object System.Collections.Generic.List[string]

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
$answer = [Win32.Msg]::MessageBox([IntPtr]::Zero, __BODY__, __TITLE__, [uint32](0x4 -bor 0x30 -bor 0x100 -bor 0x1000))
if ($answer -eq 6) { Start-Process __PATH__ }
'@
    $code = $code.Replace('__BODY__', (& $q ($Body + "`r`n`r`nOpen the log now?"))).Replace('__TITLE__', (& $q $Title)).Replace('__PATH__', (& $q $OpenPath))

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $psArgs = @("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded)
    $conhost = Join-Path $env:SystemRoot "System32\conhost.exe"
    if (Test-Path -LiteralPath $conhost) {
        Start-Process -FilePath $conhost -ArgumentList (@("--headless") + $psArgs)
    } else {
        Start-Process -FilePath $psArgs[0] -WindowStyle Hidden -ArgumentList $psArgs[1..($psArgs.Count - 1)]
    }
}

function Read-AlertState {
    $state = @{}
    if (-not (Test-Path -LiteralPath $script:AlertStateFile)) { return $state }
    try {
        $raw = Get-Content -LiteralPath $script:AlertStateFile -Raw | ConvertFrom-Json
        if ($raw.alerts) {
            foreach ($p in $raw.alerts.PSObject.Properties) {
                $state[$p.Name] = @{ first = [string]$p.Value.first; last = [string]$p.Value.last }
            }
        } elseif ($raw.key) {
            $state[[string]$raw.key] = @{ first = [string]$raw.time; last = [string]$raw.time }
        }
    } catch { }
    return $state
}

function Write-AlertState($state) {
    New-Item -ItemType Directory -Force -Path (Split-Path $script:AlertStateFile) | Out-Null
    if ($state.Count -eq 0) {
        Remove-Item -LiteralPath $script:AlertStateFile -Force -ErrorAction SilentlyContinue
        return
    }
    @{ alerts = $state } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:AlertStateFile
}

function Send-StuckAlert([string]$Key, [string]$Message) {
    $script:Stuck = $true
    if (-not $script:RaisedKeys.Contains($Key)) { $script:RaisedKeys.Add($Key) }
    try {
        Log "STUCK: $Message"

        $now = Get-Date
        $state = Read-AlertState
        if (-not $state.ContainsKey($Key)) { $state[$Key] = @{ first = $now.ToString("o"); last = "" } }
        $entry = $state[$Key]

        if ($script:BehindKeys -contains $Key) {
            $age = ($now - [datetime]$entry.first).TotalHours
            if ($age -lt $script:BehindGraceHours) {
                Log ("'{0}' only means updates are waiting, so no alert unless it's still like this after {1}h (it's been {2:N0}h)." -f $Key, $script:BehindGraceHours, $age)
                Write-AlertState $state
                return
            }
        }

        if ($entry.last -and ($now - [datetime]$entry.last).TotalHours -lt $script:AlertRepeatHours) {
            Log "Already told you about '$Key' in the last $($script:AlertRepeatHours)h - not repeating."
            return
        }

        $title = "Deadbolt needs a look"
        if (Test-ToastsEnabled) {
            Show-DeadboltToast $title $Message $LogFile
            $how = "toast"
        } else {
            Show-StuckPopup $title $Message $LogFile
            $how = "popup (Windows notifications are off for this account)"
        }

        $entry.last = $now.ToString("o")
        Write-AlertState $state
        Log "Alerted ('$Key') as a $how."
    } catch {
        Log "Couldn't show the stuck alert: $_"
    }
}

function Clear-StuckAlert([string[]]$Keys) {
    $state = Read-AlertState
    if ($state.Count -eq 0) { return }
    $cleared = @($state.Keys | Where-Object { ($Keys -contains $_) -and -not $script:RaisedKeys.Contains($_) })
    if (-not $cleared) { return }
    foreach ($k in $cleared) { $state.Remove($k) }
    Write-AlertState $state
}
