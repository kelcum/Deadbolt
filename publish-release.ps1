param(
    [string]$Tag = "v1.0.0"
)

$ErrorActionPreference = "Stop"

$cred = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = ($cred -split "`n" | Where-Object { $_ -like "password=*" }) -replace "password=", ""

if (-not $token) {
    Write-Error "Could not get a GitHub token from Git Credential Manager. Are you logged in via 'gh auth login' or has Windows Credential Manager cached a token for github.com?"
    exit 1
}

$headers = @{
    Authorization = "token $token"
    "User-Agent"  = "deadbolt-release"
}

Write-Host "Creating release $Tag..."
$body = @{
    tag_name   = $Tag
    name       = "Deadbolt $Tag"
    body       = "Grab DeadboltSetup.exe for the one-click installer, or deadbolt-dist.zip for the raw desktop build if you'd rather inject manually."
    draft      = $false
    prerelease = $false
} | ConvertTo-Json

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Deadbolt/releases" -Method Post -Headers $headers -Body $body -ContentType "application/json"

Write-Host "Release created: $($release.html_url)"

$uploadUrl = $release.upload_url -replace "\{.*\}", ""
$zipPath = "$env:LOCALAPPDATA\Temp\deadbolt-dist.zip"

if (-not (Test-Path $zipPath)) {
    Write-Error "Could not find $zipPath - build Deadbolt from a clean checkout (so local-only src/userplugins aren't bundled in) and zip package.json, patcher.js, preload.js, renderer.css and renderer.js from dist/desktop."
    exit 1
}

Write-Host "Uploading deadbolt-dist.zip..."
$uploadHeaders = @{
    Authorization  = "token $token"
    "Content-Type" = "application/zip"
}
$asset = Invoke-RestMethod -Uri "$uploadUrl`?name=deadbolt-dist.zip" -Method Post -Headers $uploadHeaders -InFile $zipPath

Write-Host "Uploaded: $($asset.browser_download_url)"
Write-Host ""
Write-Host "Done. Release is live at: $($release.html_url)"
