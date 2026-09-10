$ErrorActionPreference = "Stop"

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred -split "`n" | Where-Object { $_ -like "password=*" }) -replace "password=", ""

if (-not $token) {
    Write-Error "Could not get a GitHub token from Git Credential Manager. Are you logged in via 'gh auth login' or has Windows Credential Manager cached a token for github.com?"
    exit 1
}

$headers = @{
    Authorization = "token $token"
    "User-Agent"  = "wraithcord-release"
}

Write-Host "Creating release v1.0.0-wraithcord..."
$body = @{
    tag_name   = "v1.0.0-wraithcord"
    name       = "Wraithcord v1.0.0"
    body       = "First packaged Wraithcord build. Grab the installer from the site, or the raw desktop patch below for manual injection."
    draft      = $false
    prerelease = $false
} | ConvertTo-Json

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Wraithcord/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"

Write-Host "Release created: $($release.html_url)"

$uploadUrl = $release.upload_url -replace "\{.*\}", ""
$zipPath = "$env:LOCALAPPDATA\Temp\wraithcord-dist.zip"

if (-not (Test-Path $zipPath)) {
    Write-Error "Could not find $zipPath - the dist zip Claude built earlier. Ask Claude to rebuild it if this is missing."
    exit 1
}

Write-Host "Uploading wraithcord-dist.zip..."
$uploadHeaders = @{
    Authorization  = "token $token"
    "Content-Type" = "application/zip"
}
$asset = Invoke-RestMethod -Uri "$uploadUrl`?name=wraithcord-dist.zip" -Method Post -Headers $uploadHeaders -InFile $zipPath

Write-Host "Uploaded: $($asset.browser_download_url)"
Write-Host ""
Write-Host "Done. Release is live at: $($release.html_url)"
