param([Parameter(ValueFromRemainingArguments = $true)][string[]]$RelayArgs)

# Windows PowerShell 5.1: no Node is needed to select or download the runtime.
function Assert-RelayPath {
    param([string]$Path, $Messages)
    if ((Test-Path -LiteralPath $Path) -and
        ((Get-Item -LiteralPath $Path -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw ('BOOTSTRAP_PATH: ' + $Messages.BOOTSTRAP_PATH)
    }
}

function Assert-RelayRuntime {
    param([string]$Path, $Pin, $Messages)
    Assert-RelayPath -Path $Path -Messages $Messages
    # Use .NET directly: inherited PowerShell 7 module paths can hide the 5.1 Get-FileHash function.
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($hash -ne $Pin.sha256) {
        throw ('BOOTSTRAP_HASH: ' + $Messages.BOOTSTRAP_HASH)
    }
}

function Find-RelayInstalledNode {
    $command = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { return $null }
    try {
        $output = & $command.Source --version 2>$null
        if ($LASTEXITCODE -eq 0 -and "$output" -match '^v(\d+\.\d+\.\d+)$') {
            $version = [version]$Matches[1]
            if ($version -ge [version]'24.14.0' -and $version -lt [version]'25.0.0') { return $command.Source }
        }
    } catch { }
    return $null
}

function Get-RelayNode {
    param([string]$Root, $Messages)
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
        throw ('BOOTSTRAP_PLATFORM: ' + $Messages.BOOTSTRAP_PLATFORM)
    }
    $pin = Get-Content -LiteralPath (Join-Path $Root 'scripts/node-runtime.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    $runtimeDir = Join-Path $Root 'runtime'
    $binary = Join-Path $runtimeDir 'node.exe'
    Assert-RelayPath -Path $runtimeDir -Messages $Messages
    if (Test-Path -LiteralPath $binary) {
        Assert-RelayRuntime -Path $binary -Pin $pin -Messages $Messages
        return $binary
    }
    $installed = Find-RelayInstalledNode
    if ($installed) { return $installed }

    [IO.Directory]::CreateDirectory($runtimeDir) | Out-Null
    $lockPath = Join-Path $runtimeDir '.download.lock'
    Assert-RelayPath -Path $lockPath -Messages $Messages
    $lock = $null
    # Allow the first download's 60-second network timeout plus verification time.
    $deadline = [DateTime]::UtcNow.AddSeconds(75)
    # OS-held lock: a crash releases it; the empty lock file may remain safely.
    while ($null -eq $lock) {
        try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) { throw ('BOOTSTRAP_LOCK: ' + $Messages.BOOTSTRAP_LOCK) }
            Start-Sleep -Milliseconds 150
        }
    }
    $temporary = Join-Path $runtimeDir ([Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        if (Test-Path -LiteralPath $binary) {
            Assert-RelayRuntime -Path $binary -Pin $pin -Messages $Messages
            return $binary
        }
        [Console]::Error.WriteLine($Messages.BOOTSTRAP_DOWNLOAD)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        try { Invoke-WebRequest -Uri $pin.url -OutFile $temporary -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop | Out-Null }
        catch { throw ('BOOTSTRAP_FAILED: ' + $Messages.BOOTSTRAP_FAILED) }
        Assert-RelayRuntime -Path $temporary -Pin $pin -Messages $Messages
        # Never overwrite an existing destination, including one made by another process.
        [IO.File]::Move($temporary, $binary)
        return $binary
    } finally {
        try { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop } }
        finally { $lock.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding
    $root = Split-Path -Parent $PSScriptRoot
    $language = 'en'
    for ($i = 0; $i -lt ($RelayArgs.Count - 1); $i++) {
        if ($RelayArgs[$i] -eq '--lang' -and $RelayArgs[$i + 1] -eq 'ko') { $language = 'ko' }
    }
    try {
        $messages = Get-Content -LiteralPath (Join-Path $root "locales/$language.json") -Raw -Encoding UTF8 | ConvertFrom-Json
        $node = Get-RelayNode -Root $root -Messages $messages
        & $node (Join-Path $root 'bin/relay.mjs') @RelayArgs
        exit $LASTEXITCODE
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 2
    }
}
