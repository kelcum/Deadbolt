$ErrorActionPreference = "Stop"

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred -split "`n" | Where-Object { $_ -like "password=*" }) -replace "password=", ""

if (-not $token) {
    Write-Error "Could not get a GitHub token from Git Credential Manager."
    exit 1
}

$headers = @{
    Authorization = "token $token"
    "User-Agent"  = "wraithcord-release"
}

Write-Host "Fetching release v1.0.0-wraithcord..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Wraithcord/releases/tags/v1.0.0-wraithcord" -Headers $headers

$uploadUrl = $release.upload_url -replace "\{.*\}", ""
$exePath = "$env:LOCALAPPDATA\Temp\WraithcordSetup.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "Could not find $exePath - ask Claude to rebuild/copy it if missing."
    exit 1
}

Write-Host "Uploading WraithcordSetup.exe ($([math]::Round((Get-Item $exePath).Length / 1MB, 1)) MB)..."
$uploadHeaders = @{
    Authorization  = "token $token"
    "Content-Type" = "application/octet-stream"
}
$asset = Invoke-RestMethod -Uri "$uploadUrl`?name=WraithcordSetup.exe" -Method Post -Headers $uploadHeaders -InFile $exePath

Write-Host "Uploaded: $($asset.browser_download_url)"
