param(
    [string]$Tag = "v1.0.0"
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

Write-Host "Fetching release $Tag..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/kelcum/Deadbolt/releases/tags/$Tag" -Headers $headers

$uploadUrl = $release.upload_url -replace "\{.*\}", ""
$exePath = "$env:LOCALAPPDATA\Temp\DeadboltSetup.exe"

if (-not (Test-Path $exePath)) {
    Write-Error "Could not find $exePath - build it from installer/deadboltSetup.cjs first (npx @yao-pkg/pkg installer/deadboltSetup.cjs --targets node22-win-x64 --output DeadboltSetup.exe)."
    exit 1
}

Write-Host "Uploading DeadboltSetup.exe ($([math]::Round((Get-Item $exePath).Length / 1MB, 1)) MB)..."
$uploadHeaders = @{
    Authorization  = "token $token"
    "Content-Type" = "application/octet-stream"
}
$asset = Invoke-RestMethod -Uri "$uploadUrl`?name=DeadboltSetup.exe" -Method Post -Headers $uploadHeaders -InFile $exePath

Write-Host "Uploaded: $($asset.browser_download_url)"
