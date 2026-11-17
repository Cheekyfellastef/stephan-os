[CmdletBinding()]
param([string]$ExpectedHead = '')

# -NoProfile alone still allows per-user module autoload. This fixed adapter
# uses only the Windows inbox modules for networking and process observation.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'spatial-window-install-lock.ps1')

function New-SpatialPreparationReceipt {
    param([string]$Head)
    return [ordered]@{
        schemaVersion = 'stephanos.spatial-workspace-readiness.v1'
        actionId = 'prepare-spatial-workspace'
        sourceHead = $(if ($Head -cmatch '^[a-f0-9]{40}$') { $Head } else { '' })
        buildId = ''
        installationVerified = $false
        uiReady = $false
        helperProbePassed = $false
        nativeProbePassed = $false
        existingHostPreserved = $false
        createdProbeStopped = $true
        hostRunningAfter = $false
        mutationAttempted = $false
        readyForOperatorLaunch = $false
        interactiveAcceptance = $false
        voiceAcceptance = $false
        headsetAcceptance = $false
        blocker = ''
        ok = $false
    }
}

function New-SpatialPreparationProcessInfo {
    param([string]$Executable, [string[]]$Arguments, [string]$RepositoryRoot, [switch]$StandardInput)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    # Every argument is fixed by this adapter, or a validated canonical path/SHA.
    # Refuse embedded quoting instead of accepting an extra command-line surface.
    $quoted = @()
    foreach ($argument in $Arguments) {
        if ($null -eq $argument -or $argument.Contains('"') -or $argument.Contains([string][char]0) -or $argument.EndsWith('\')) { throw 'SPATIAL_PREPARE_FAILED' }
        $quoted += '"' + $argument + '"'
    }
    $info.Arguments = $quoted -join ' '
    $info.WorkingDirectory = $RepositoryRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = [bool]$StandardInput
    return $info
}

function Stop-SpatialPreparationChild {
    param($Process)
    if (-not $Process) { return $true }
    try {
        # The retained Process owns its original handle; never kill by a port or
        # an enumerated PID. A different process reusing a PID is not our child.
        if (-not $Process.HasExited) {
            $fresh = [Diagnostics.Process]::GetProcessById($Process.Id)
            try {
                if ($fresh.StartTime.ToUniversalTime().Ticks -ne $Process.StartTime.ToUniversalTime().Ticks) { return $false }
                $Process.Kill()
            } finally { $fresh.Dispose() }
        }
        return [bool]$Process.WaitForExit(2000)
    } catch {
        try { return [bool]$Process.HasExited } catch { return $false }
    }
}

function Invoke-SpatialPreparationReadOnlyCommand {
    param([string]$Executable, [string[]]$Arguments, [string]$RepositoryRoot)
    $process = $null
    try {
        $info = New-SpatialPreparationProcessInfo -Executable $Executable -Arguments $Arguments -RepositoryRoot $RepositoryRoot
        foreach ($key in @($info.EnvironmentVariables.Keys)) {
            if ([string]$key -like 'GIT_*') { $info.EnvironmentVariables.Remove([string]$key) }
        }
        $info.EnvironmentVariables['GIT_CONFIG_NOSYSTEM'] = '1'
        $info.EnvironmentVariables['GIT_CONFIG_GLOBAL'] = 'NUL'
        $info.EnvironmentVariables['GIT_NO_REPLACE_OBJECTS'] = '1'
        $info.EnvironmentVariables['GIT_OPTIONAL_LOCKS'] = '0'
        $info.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
        $process = [Diagnostics.Process]::Start($info)
        $outputTask = $process.StandardOutput.ReadToEndAsync()
        $errorTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(5000)) { throw 'SPATIAL_PREPARE_FAILED' }
        if (-not $outputTask.Wait(1000) -or -not $errorTask.Wait(1000)) { throw 'SPATIAL_PREPARE_FAILED' }
        if ($outputTask.Result.Length -gt 16384 -or $errorTask.Result.Length -gt 16384) { throw 'SPATIAL_PREPARE_FAILED' }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $outputTask.Result }
    } finally {
        if ($process) {
            $stopped = Stop-SpatialPreparationChild -Process $process
            $process.Dispose()
            if (-not $stopped) { throw 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN' }
        }
    }
}

function Get-SpatialPreparationContext {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'SPATIAL_PREPARE_PLATFORM_UNSUPPORTED' }
    $windowsBuild = [string](Get-CimInstance Win32_OperatingSystem -Property BuildNumber -ErrorAction Stop).BuildNumber
    if ($windowsBuild -notmatch '^[0-9]{5,}$' -or [int]$windowsBuild -lt 14393) { throw 'SPATIAL_PREPARE_PLATFORM_UNSUPPORTED' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $session = [Diagnostics.Process]::GetCurrentProcess().SessionId
    if (-not [Environment]::UserInteractive -or $session -le 0 -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'SPATIAL_PREPARE_OPERATOR_CONTEXT_REQUIRED' }
    $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $canonicalRoot = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
    if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\'), $canonicalRoot)) { throw 'SPATIAL_PREPARE_SOURCE_MISMATCH' }
    Assert-SpatialWindowPlainPath -Path $repositoryRoot
    $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'SPATIAL_PREPARE_NODE_MISSING' }
    $gitCommand = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $gitCommand) { throw 'SPATIAL_PREPARE_SOURCE_MISMATCH' }
    return [pscustomobject]@{
        Root = $repositoryRoot; Node = $nodeCommand.Source; Git = $gitCommand.Source
        Sid = $identity.User.Value; Session = $session
        HostScript = Join-Path $repositoryRoot 'scripts\spatial-window-host.mjs'
        Installation = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints\spatial-window'
    }
}

function Get-SpatialPreparationSourcePaths {
    return @(
        'scripts/sovereign-commander-spatial-workspace.mjs','shared/agents/sovereignSpatialWorkspaceV1.mjs',
        'scripts/windows/prepare-spatial-workspace.ps1','scripts/windows/spatial-window-install-lock.ps1',
        'scripts/windows/install-spatial-window.ps1','scripts/windows/build-spatial-window.ps1',
        'scripts/windows/start-spatial-window-host.ps1','scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1',
        'scripts/windows/launch-stephanos-spatial-workspace.ps1','scripts/spatial-window-host.mjs',
        'shared/vr/spatialDesktopSurfaceContractV1.mjs','src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp',
        'apps/spatial-bridge/quest-entry.html'
    )
}

function Open-SpatialPreparationSourceHandles {
    param($Context)
    $handles = New-Object 'System.Collections.Generic.List[System.IO.FileStream]'
    try {
        foreach ($relative in (Get-SpatialPreparationSourcePaths)) {
            $path = Join-Path $Context.Root $relative
            Assert-SpatialWindowPlainPath -Path $path
            $handles.Add([IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
        }
        return ,$handles
    } catch {
        foreach ($handle in $handles) { $handle.Dispose() }
        throw 'SPATIAL_PREPARE_SOURCE_MISMATCH'
    }
}

function Assert-SpatialPreparationSource {
    param($Context, [string]$Head)
    $prefix = @('-c','core.fsmonitor=false','-c','core.hooksPath=NUL','-C',$Context.Root)
    $observations = @(
        @{ Args=@('rev-parse','--show-toplevel'); Expected=$Context.Root.Replace('\','/') },
        @{ Args=@('symbolic-ref','--quiet','--short','HEAD'); Expected='main' },
        @{ Args=@('rev-parse','--verify','HEAD'); Expected=$Head },
        @{ Args=@('rev-parse','--verify','refs/heads/main'); Expected=$Head },
        @{ Args=@('rev-parse','--verify','refs/remotes/origin/main'); Expected=$Head }
    )
    foreach ($observation in $observations) {
        $observed = Invoke-SpatialPreparationReadOnlyCommand -Executable $Context.Git -Arguments ($prefix + $observation.Args) -RepositoryRoot $Context.Root
        if ($observed.ExitCode -ne 0 -or -not [StringComparer]::OrdinalIgnoreCase.Equals($observed.Output.Trim(), $observation.Expected)) { throw 'SPATIAL_PREPARE_SOURCE_MISMATCH' }
    }
    $paths = @(Get-SpatialPreparationSourcePaths)
    foreach ($path in $paths) { Assert-SpatialWindowPlainPath -Path (Join-Path $Context.Root $path) }
    $tracked = Invoke-SpatialPreparationReadOnlyCommand -Executable $Context.Git -Arguments ($prefix + @('ls-files','--error-unmatch','--') + $paths) -RepositoryRoot $Context.Root
    if ($tracked.ExitCode -ne 0) { throw 'SPATIAL_PREPARE_SOURCE_MISMATCH' }
    $clean = Invoke-SpatialPreparationReadOnlyCommand -Executable $Context.Git -Arguments ($prefix + @('diff','--quiet','--no-ext-diff','--no-textconv','HEAD','--') + $paths) -RepositoryRoot $Context.Root
    if ($clean.ExitCode -ne 0) { throw 'SPATIAL_PREPARE_SOURCE_MISMATCH' }
}

function Invoke-SpatialPreparationFreshInstallation {
    param($Context)
    # Only the existing installer can return this invocation's fresh build pins.
    # On-disk receipts are consistency records, never executable authority here.
    return (& (Join-Path $PSScriptRoot 'install-spatial-window.ps1') -RequirePortUnused -PassThruPinned 2>$null 3>$null 4>$null 5>$null 6>$null)
}

function Assert-SpatialPreparationBuildTools {
    param($Context)
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    if ([string]::IsNullOrWhiteSpace($programFilesX86)) { throw 'SPATIAL_PREPARE_COMPILER_MISSING' }
    $vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw 'SPATIAL_PREPARE_COMPILER_MISSING' }
    $found = Invoke-SpatialPreparationReadOnlyCommand -Executable $vswhere -Arguments @('-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath') -RepositoryRoot $Context.Root
    if ($found.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($found.Output)) { throw 'SPATIAL_PREPARE_COMPILER_MISSING' }
    $compilerRoot = Join-Path $found.Output.Trim() 'VC\Tools\MSVC'
    $versions = @(Get-ChildItem -LiteralPath $compilerRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\Hostx64\x64\cl.exe') -PathType Leaf })
    if ($versions.Count -eq 0) { throw 'SPATIAL_PREPARE_COMPILER_MISSING' }
    $sdkInclude = Join-Path $programFilesX86 'Windows Kits\10\Include'
    $sdks = @(Get-ChildItem -LiteralPath $sdkInclude -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cppwinrt\winrt\Windows.Graphics.Capture.h') -PathType Leaf })
    if ($sdks.Count -eq 0) { throw 'SPATIAL_PREPARE_SDK_MISSING' }
}

function Get-SpatialPreparationHostWitness {
    param($Context, [string]$BuildId, $ExpectedProcess = $null, [switch]$ProbeOnly)
    $listeners = @(Get-SpatialWindowListeners)
    if ($listeners.Count -eq 0) { return $null }
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -le 0 -or $BuildId -notmatch '^[a-f0-9]{64}$') { throw 'SPATIAL_PREPARE_PORT_OCCUPIED' }
    $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess) -ErrorAction Stop
    $command = '"' + $Context.Node + '" "' + $Context.HostScript + '"' + $(if ($ProbeOnly) { ' "--readiness-probe"' } else { '' })
    if (-not $owner -or -not [StringComparer]::OrdinalIgnoreCase.Equals($owner.ExecutablePath,$Context.Node) -or $owner.CommandLine -cne $command -or $owner.SessionId -ne $Context.Session) { throw 'SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN' }
    $operator = Invoke-CimMethod -InputObject $owner -MethodName GetOwnerSid -ErrorAction Stop
    if ($operator.ReturnValue -ne 0 -or $operator.Sid -cne $Context.Sid) { throw 'SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN' }
    # CIM timestamps may truncate the last fractional millisecond. The retained
    # live child handle, matching PID and unchanged CIM birth bind this witness.
    if ($ExpectedProcess -and ($owner.ProcessId -ne $ExpectedProcess.Id -or $ExpectedProcess.HasExited -or [Math]::Abs(($owner.CreationDate.ToUniversalTime() - $ExpectedProcess.StartTime.ToUniversalTime()).TotalMilliseconds) -gt 1)) { throw 'SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN' }
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4180/health' -Headers @{Origin='http://127.0.0.1:4173'} -TimeoutSec 2 }
    catch { throw 'SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN' }
    if ($health.schema -ne 'stephanos.spatial-window-health.v1' -or $health.buildId -cne $BuildId) { throw 'SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN' }
    if ($ProbeOnly -and (-not $health.PSObject.Properties['readinessOnly'] -or $health.readinessOnly -ne $true)) { throw 'SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN' }
    $again = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner.ProcessId) -ErrorAction Stop
    $after = @(Get-SpatialWindowListeners)
    if (-not $again -or $again.CreationDate -ne $owner.CreationDate -or $again.CommandLine -cne $command -or $again.SessionId -ne $Context.Session -or $after.Count -ne 1 -or $after[0].OwningProcess -ne $owner.ProcessId -or $after[0].LocalAddress -ne '127.0.0.1') { throw 'SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN' }
    return $owner
}

function Test-SpatialPreparationShortcut {
    param($Context)
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ([string]::IsNullOrWhiteSpace($desktop)) { return $false }
    $path = Join-Path $desktop 'Stephanos Spatial Workspace.lnk'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    Assert-SpatialWindowPlainPath -Path $path
    $shell = $null; $shortcut = $null
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($path)
        $target = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $launcher = Join-Path $Context.Root 'scripts\windows\launch-stephanos-spatial-workspace.ps1'
        $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
        return $shortcut.TargetPath -eq $target -and $shortcut.Arguments -ceq $arguments -and $shortcut.WorkingDirectory -eq $Context.Root
    } finally {
        if ($shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
        if ($shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
    }
}

function Test-SpatialPreparationUi {
    param($Context, [string]$Head)
    try {
        $uri = 'http://127.0.0.1:4173/apps/spatial-bridge/quest-entry.html'
        $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -MaximumRedirection 0 -TimeoutSec 3
        if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'Stephanos Spatial Workspace') { return $false }
        $expected = [IO.File]::ReadAllText((Join-Path $Context.Root 'apps\spatial-bridge\quest-entry.html'))
        # The server may stamp this one source-head field; all other entry HTML
        # must match reviewed source. This is reachability, not headset proof.
        $meta = '<meta name="stephanos-renderer-source-head" content="'
        $actual = ([string]$response.Content).Replace($meta + $Head + '"', $meta + '"')
        return $actual.Replace([string][char]13,'') -ceq $expected.Replace([string][char]13,'')
    } catch { return $false }
}

function Assert-SpatialPreparationNativeReply {
    param([string]$Line)
    try {
    if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -gt 1048576) { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
    $value = $Line | ConvertFrom-Json
    if ($value.status -ne 'windows' -or $value.windows -isnot [Array] -or $value.windows.Count -gt 1024) { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
    foreach ($window in $value.windows) {
        if ($window.status -ne 'window' -or $window.id -isnot [ValueType] -or $window.id -is [bool] -or [double]$window.id -le 0 -or [double]$window.id -gt 9007199254740991 -or [double]$window.id -ne [Math]::Floor([double]$window.id) -or $window.pid -isnot [ValueType] -or $window.pid -is [bool] -or [double]$window.pid -le 0 -or [double]$window.pid -gt 4294967295 -or [double]$window.pid -ne [Math]::Floor([double]$window.pid) -or $window.title -isnot [string] -or $window.title.Length -gt 4096) { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
    }
    } catch { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
}

function Invoke-SpatialWorkspacePreparation {
    param([string]$Head)
    $result = New-SpatialPreparationReceipt -Head $Head
    $context = $null; $lock = $null; $installation = $null; $sourcePins = @(); $createdHost = $null; $createdNative = $null
    try {
        if ($Head -cnotmatch '^[a-f0-9]{40}$') { throw 'SPATIAL_PREPARE_EXPECTED_HEAD_INVALID' }
        $context = Get-SpatialPreparationContext
        $sourcePins = Open-SpatialPreparationSourceHandles -Context $context
        Assert-SpatialPreparationSource -Context $context -Head $Head
        $lock = Enter-SpatialWindowInstallLock -RepositoryRoot $context.Root
        # An existing host is left untouched. Its writable receipt cannot prove
        # provenance, so this unattended action cannot reuse or replace it.
        Assert-SpatialWindowPortUnused
        Assert-SpatialWindowInstallationDirectory -Directory $context.Installation
        Assert-SpatialPreparationBuildTools -Context $context
        $result.mutationAttempted = $true
        try { $installation = Invoke-SpatialPreparationFreshInstallation -Context $context }
        catch {
            if ($_.Exception.Message -in @('SPATIAL_PREPARE_PORT_OCCUPIED','SPATIAL_PREPARE_LOCK_BUSY','SPATIAL_PREPARE_INSTALLATION_INVALID')) { throw }
            throw 'SPATIAL_PREPARE_INSTALL_FAILED'
        }
        if (-not $installation) { throw 'SPATIAL_PREPARE_INSTALLATION_INVALID' }
        Assert-SpatialWindowPinnedInstallation -Value $installation
        $result.buildId = $installation.BuildId
        $result.installationVerified = $true
        if (-not (Test-SpatialPreparationShortcut -Context $context)) {
            $result.mutationAttempted = $true
            try { & (Join-Path $PSScriptRoot 'install-stephanos-spatial-workspace-shortcut.ps1') -VerifiedHelperOnly *> $null }
            catch { throw 'SPATIAL_PREPARE_INSTALL_FAILED' }
            if (-not (Test-SpatialPreparationShortcut -Context $context)) { throw 'SPATIAL_PREPARE_INSTALL_FAILED' }
        }
        Assert-SpatialPreparationSource -Context $context -Head $Head
        Assert-SpatialWindowPortUnused
        $result.mutationAttempted = $true
        $result.createdProbeStopped = $false
        $info = New-SpatialPreparationProcessInfo -Executable $context.Node -Arguments @($context.HostScript,'--readiness-probe') -RepositoryRoot $context.Root
        try { $createdHost = [Diagnostics.Process]::Start($info) }
        catch { throw 'SPATIAL_PREPARE_HOST_START_FAILED' }
        $hostOutput = $createdHost.StandardOutput.ReadToEndAsync()
        $hostErrors = $createdHost.StandardError.ReadToEndAsync()
        $deadline = (Get-Date).AddSeconds(10)
        $witness = $null
        do {
            if ($createdHost.HasExited) { throw 'SPATIAL_PREPARE_HOST_START_FAILED' }
            $witness = Get-SpatialPreparationHostWitness -Context $context -BuildId $installation.BuildId -ExpectedProcess $createdHost -ProbeOnly
            if ($witness) { break }
            Start-Sleep -Milliseconds 150
        } while ((Get-Date) -lt $deadline)
        if (-not $witness) { throw 'SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN' }
        $result.helperProbePassed = $true
        # Do not request a session/windows from the running host: that would
        # mutate its session or native child. The separate EXE only receives list.
        $result.mutationAttempted = $true
        $result.createdProbeStopped = $false
        Assert-SpatialWindowPinnedInstallation -Value $installation
        $nativeInfo = New-SpatialPreparationProcessInfo -Executable $installation.Binary -Arguments @() -RepositoryRoot $context.Root -StandardInput
        $nativeInfo.WorkingDirectory = [Environment]::SystemDirectory
        $nativeInfo.EnvironmentVariables['PATH'] = [Environment]::SystemDirectory
        try { $createdNative = [Diagnostics.Process]::Start($nativeInfo) }
        catch { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
        $nativeErrors = $createdNative.StandardError.ReadToEndAsync()
        $replyTask = $createdNative.StandardOutput.ReadLineAsync()
        $createdNative.StandardInput.WriteLine('{"op":"list"}')
        $createdNative.StandardInput.Flush()
        $createdNative.StandardInput.Close()
        if (-not $replyTask.Wait(7000)) { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
        Assert-SpatialPreparationNativeReply -Line $replyTask.Result
        if (-not $createdNative.WaitForExit(2000) -or $createdNative.ExitCode -ne 0) { throw 'SPATIAL_PREPARE_NATIVE_PROBE_FAILED' }
        $result.nativeProbePassed = $true
        $result.uiReady = [bool](Test-SpatialPreparationUi -Context $context -Head $Head)
        if (-not $result.uiReady) { throw 'SPATIAL_PREPARE_UI_UNAVAILABLE' }
        Assert-SpatialPreparationSource -Context $context -Head $Head
        Assert-SpatialWindowPinnedInstallation -Value $installation
    } catch {
        $known = @(
            'SPATIAL_PREPARE_PLATFORM_UNSUPPORTED','SPATIAL_PREPARE_EXPECTED_HEAD_INVALID','SPATIAL_PREPARE_OPERATOR_CONTEXT_REQUIRED',
            'SPATIAL_PREPARE_SOURCE_MISMATCH','SPATIAL_PREPARE_LOCK_BUSY','SPATIAL_PREPARE_NODE_MISSING',
            'SPATIAL_PREPARE_COMPILER_MISSING','SPATIAL_PREPARE_SDK_MISSING','SPATIAL_PREPARE_INSTALLATION_INVALID',
            'SPATIAL_PREPARE_INSTALL_FAILED','SPATIAL_PREPARE_PORT_OCCUPIED','SPATIAL_PREPARE_HOST_IDENTITY_UNPROVEN',
            'SPATIAL_PREPARE_HOST_START_FAILED','SPATIAL_PREPARE_HOST_HEALTH_UNPROVEN','SPATIAL_PREPARE_NATIVE_PROBE_FAILED',
            'SPATIAL_PREPARE_UI_UNAVAILABLE','SPATIAL_PREPARE_PROBE_STOP_UNPROVEN','SPATIAL_PREPARE_FAILED'
        )
        $result.blocker = if ($_.Exception.Message -in $known) { $_.Exception.Message } else { 'SPATIAL_PREPARE_FAILED' }
    } finally {
        $nativeStopped = Stop-SpatialPreparationChild -Process $createdNative
        $hostStopped = Stop-SpatialPreparationChild -Process $createdHost
        $result.createdProbeStopped = [bool]($nativeStopped -and $hostStopped -and $result.blocker -ne 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN')
        if (-not $result.createdProbeStopped) { $result.blocker = 'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN' }
        if ($createdNative) { $createdNative.Dispose() }
        if ($createdHost) { $createdHost.Dispose() }
        Close-SpatialWindowBuildHandles -Value $installation
        foreach ($sourcePin in $sourcePins) { $sourcePin.Dispose() }
        if ($lock) {
            try { Exit-SpatialWindowInstallLock -Mutex $lock }
            catch { if (-not $result.blocker) { $result.blocker = 'SPATIAL_PREPARE_FAILED' } }
        }
    }
    $result.readyForOperatorLaunch = [bool](-not $result.blocker -and $result.installationVerified -and $result.uiReady -and $result.helperProbePassed -and $result.nativeProbePassed -and $result.createdProbeStopped)
    $result.ok = $result.readyForOperatorLaunch
    if (-not $result.ok -and -not $result.blocker) { $result.blocker = 'SPATIAL_PREPARE_FAILED' }
    return $result
}

# Dot-sourcing exposes the coordinator for isolated Windows tests, never an
# alternate command-line authority or native-action dispatch surface.
if ($MyInvocation.InvocationName -ne '.') {
    $result = Invoke-SpatialWorkspacePreparation -Head $ExpectedHead
    [Console]::Out.WriteLine('SOVEREIGN_SPATIAL_WORKSPACE_RESULT=' + ($result | ConvertTo-Json -Compress -Depth 4))
    if ($result.ok) { exit 0 } else { exit 2 }
}
