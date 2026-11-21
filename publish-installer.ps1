param(
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred -split "`n" | Where-Object { $_ -like "password=*" }) -replace "password=", ""

if (-not $token) {
    Write-Error "Could not get a GitHub token from Git Credential Manager."
    exit 1
}

$headers = @{
    Authorization = "token $token"
    "User-Agent"  = "deadbolt-release"
}

if ($Tag) {
    Write-Host "Fetching release $Tag..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Deadbolt/releases/tags/$Tag" -Headers $headers
} else {
    Write-Host "Fetching the latest release..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Deadbolt/releases/latest" -Headers $headers
    Write-Host "Latest release is $($release.tag_name)."
}

$uploadUrl = $release.upload_url -replace "\{.*\}", ""
$exePath = "$env:LOCALAPPDATA\Temp\DeadboltSetup.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "Could not find $exePath - build it from installer/deadboltSetup.cjs first (npx @yao-pkg/pkg installer/deadboltSetup.cjs --targets node22-win-x64 --output DeadboltSetup.exe)."
    exit 1
}

$assets = @(
    @{ Name = "DeadboltSetup.exe"; Path = $exePath },
    @{ Name = "install.ps1"; Path = Join-Path $PSScriptRoot "scripts\install.ps1" }
)

foreach ($a in $assets) {
    $existing = @($release.assets | Where-Object { $_.name -eq $a.Name })
    foreach ($old in $existing) {
        Write-Host "Removing the old $($a.Name) from $($release.tag_name)..."
        Invoke-RestMethod -Uri $old.url -Method Delete -Headers $headers | Out-Null
    }

    Write-Host "Uploading $($a.Name) ($([math]::Round((Get-Item $a.Path).Length / 1KB)) KB)..."
    $uploadHeaders = @{
        Authorization  = "token $token"
        "Content-Type" = "application/octet-stream"
    }
    $asset = Invoke-RestMethod -Uri "$uploadUrl`?name=$($a.Name)" -Method Post -Headers $uploadHeaders -InFile $a.Path
    Write-Host "Uploaded: $($asset.browser_download_url)"
}
