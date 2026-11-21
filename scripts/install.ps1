& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    if ($env:OS -ne "Windows_NT") {
        Write-Host "This installer is for Windows. For macOS and Linux see https://github.com/kelcum/Deadbolt#installing" -ForegroundColor Red
        return
    }

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch { }

    $repo = "kelcum/Deadbolt"
    $headers = @{ "User-Agent" = "deadbolt-install" }
    $url = "https://github.com/$repo/releases/latest/download/DeadboltSetup.exe"
    $digest = $null

    if ($env:DEADBOLT_SETUP_URL) {
        $url = $env:DEADBOLT_SETUP_URL
    } else {
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers -UseBasicParsing
            $asset = @($release.assets | Where-Object { $_.name -eq "DeadboltSetup.exe" })[0]
            if ($asset) {
                $url = $asset.browser_download_url
                if ($asset.digest -like "sha256:*") { $digest = $asset.digest.Substring(7) }
                Write-Host "Deadbolt $($release.tag_name)"
            }
        } catch {
            Write-Host "Couldn't read the latest release details, downloading the latest DeadboltSetup.exe directly." -ForegroundColor Yellow
        }
    }

    $dir = Join-Path ([IO.Path]::GetTempPath()) ("deadbolt-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $exe = Join-Path $dir "DeadboltSetup.exe"

    try {
        Write-Host "Downloading DeadboltSetup.exe..."
        Invoke-WebRequest -Uri $url -OutFile $exe -Headers $headers -UseBasicParsing

        $file = Get-Item -LiteralPath $exe
        $stream = [IO.File]::OpenRead($exe)
        try { $head = @($stream.ReadByte(), $stream.ReadByte()) } finally { $stream.Dispose() }
        if ($file.Length -lt 1MB -or $head[0] -ne 0x4D -or $head[1] -ne 0x5A) {
            throw "The download isn't a Windows program ($($file.Length) bytes). Try again in a minute."
        }
        if ($digest) {
            $actual = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLower()
            if ($actual -ne $digest.ToLower()) { throw "The download doesn't match the release's checksum. Try again in a minute." }
        }
        Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue

        Write-Host ""
        & $exe --no-pause
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            Write-Host ""
            Write-Host "Setup didn't finish (exit code $code). The log is at $env:LOCALAPPDATA\DeadboltInstall\setup.log" -ForegroundColor Red
        }
    } catch {
        Write-Host "Deadbolt install failed: $($_.Exception.Message)" -ForegroundColor Red
    } finally {
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
