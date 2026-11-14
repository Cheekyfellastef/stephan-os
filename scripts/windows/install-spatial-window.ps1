[CmdletBinding()]
param([switch]$RequirePortUnused, [switch]$PassThruPinned)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'spatial-window-install-lock.ps1')
$installationLock = Enter-SpatialWindowInstallLock -RepositoryRoot $repositoryRoot
$staging = $null
$keepRecoveryFiles = $false
$freshBuild = $null; $pinned = $null; $pinsHandedOff = $false
try {
    if ($PassThruPinned -and -not $RequirePortUnused) { throw 'Pinned preparation requires an unused port.' }
    $hostScript = Join-Path $repositoryRoot 'scripts\spatial-window-host.mjs'
    $stateRoot = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints'
    $destination = Join-Path $stateRoot 'spatial-window'
    Assert-SpatialWindowPlainPath -Path $destination
    if ($PassThruPinned) { Assert-SpatialWindowInstallationDirectory -Directory $destination }
    $staging = Join-Path $stateRoot ('spatial-window-build-' + [Guid]::NewGuid().ToString('N'))
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    if ($RequirePortUnused) { Assert-SpatialWindowPortUnused }
    # Preparation never stops a connection, including one appearing mid-build.
    $freshBuild = & (Join-Path $PSScriptRoot 'build-spatial-window.ps1') -OutputDirectory $staging -PassThru
    Assert-SpatialWindowPlainPath -Path $destination
    $listeners = @(Get-SpatialWindowListeners)
    if ($RequirePortUnused) { Assert-SpatialWindowPortUnused }
    elseif ($listeners.Count -gt 0) {
        $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($owners.Count -ne 1) { throw 'The console port has an unexpected owner; no process was stopped.' }
        $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owners[0])
        $expectedCommand = '"' + $node + '" "' + $hostScript + '"'
        if (-not $owner -or $owner.ExecutablePath -ne $node -or $owner.CommandLine -cne $expectedCommand) { throw 'The console port belongs to another process; no process was stopped.' }
        $again = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner.ProcessId)
        if (-not $again -or $again.CreationDate -ne $owner.CreationDate -or $again.CommandLine -cne $expectedCommand) { throw 'The console process changed during installation.' }
        Stop-Process -Id $owner.ProcessId -ErrorAction Stop
    }
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $names = @('SpatialWindow.exe','build.json')
    $previous = @{}
    $promoted = New-Object 'System.Collections.Generic.List[string]'
    foreach ($name in $names) {
        $target = Join-Path $destination $name
        Assert-SpatialWindowPlainPath -Path $target
        if ((Test-Path -LiteralPath $target) -and -not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'The console installation target is not a regular file.' }
        $previous[$name] = Test-Path -LiteralPath $target -PathType Leaf
    }
    try {
        # ReplaceFile opens its replacement without sharing, so staging handles
        # must close here. Fresh in-memory digests remain authoritative; final
        # no-write/no-delete handles are rehashed before any executable use.
        Close-SpatialWindowBuildHandles -Value $freshBuild
        foreach ($name in $names) {
            if ($RequirePortUnused) { Assert-SpatialWindowPortUnused }
            $source = Join-Path $staging $name
            $target = Join-Path $destination $name
            $backup = Join-Path $staging ($name + '.previous')
            $replaceDeadline = (Get-Date).AddSeconds(5)
            do {
                if ($RequirePortUnused) { Assert-SpatialWindowPortUnused }
                try {
                    if ($previous[$name]) { [IO.File]::Replace($source, $target, $backup, $true) }
                    else { [IO.File]::Move($source, $target) }
                    break
                } catch {
                    $nativeError = $_.Exception.GetBaseException().HResult -band 65535
                    if ($nativeError -notin @(32,33) -or (Get-Date) -ge $replaceDeadline) { throw }
                    Start-Sleep -Milliseconds 200
                }
            } while ($true)
            $promoted.Add($name)
        }
        $pinned = Open-SpatialWindowPinnedInstallation -Directory $destination -FreshBuild $freshBuild
        & $node $hostScript --verify-installation | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'The console installation did not verify.' }
        if ($RequirePortUnused) { Assert-SpatialWindowPortUnused }
        if ($PassThruPinned) {
            $pinsHandedOff = $true
            return $pinned
        }
        [pscustomobject]@{status='verified';buildId=$pinned.BuildId} | ConvertTo-Json -Compress
    } catch {
        $failure = $_
        Close-SpatialWindowBuildHandles -Value $pinned
        $pinned = $null
        Close-SpatialWindowBuildHandles -Value $freshBuild
        $freshBuild = $null
        # A failed second promotion or verification restores the prior pair.
        foreach ($name in $promoted) {
            try {
                $target = Join-Path $destination $name
                $backup = Join-Path $staging ($name + '.previous')
                if ($previous[$name]) {
                    # PowerShell binds a null string argument as an empty path.
                    # Retain displaced candidate bytes only in our own staging.
                    $rejected = Join-Path $staging ($name + '.rejected')
                    if (Test-Path -LiteralPath $target) { [IO.File]::Replace($backup, $target, $rejected, $true) }
                    else { [IO.File]::Move($backup, $target) }
                } elseif (Test-Path -LiteralPath $target) { [IO.File]::Delete($target) }
            } catch { $keepRecoveryFiles = $true }
        }
        throw $failure
    }
} finally {
    if (-not $pinsHandedOff) { Close-SpatialWindowBuildHandles -Value $pinned }
    Close-SpatialWindowBuildHandles -Value $freshBuild
    if ($staging -and -not $keepRecoveryFiles -and (Test-Path -LiteralPath $staging)) {
        try {
            Assert-SpatialWindowPlainPath -Path $staging
            $stagedFiles = @(Get-ChildItem -LiteralPath $staging -Force -ErrorAction Stop)
            if (@($stagedFiles | Where-Object { $_.PSIsContainer -or (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) }).Count -eq 0) {
                foreach ($file in $stagedFiles) { [IO.File]::Delete($file.FullName) }
                [IO.Directory]::Delete($staging, $false)
            }
        } catch { }
    }
    Exit-SpatialWindowInstallLock -Mutex $installationLock
}
