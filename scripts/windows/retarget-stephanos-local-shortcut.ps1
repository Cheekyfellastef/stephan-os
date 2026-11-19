[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedHead,
    [Parameter(Mandatory = $true)][string]$ExpectedShortcutSha256,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:StephanosRetargetSourcePath = $PSCommandPath

function Get-StephanosRetargetDigest([byte[]]$Bytes) {
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($digest.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $digest.Dispose() }
}

function Test-StephanosRetargetSamePath([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right) -or
        -not [IO.Path]::IsPathRooted($Left) -or -not [IO.Path]::IsPathRooted($Right)) { return $false }
    try { return [string]::Equals([IO.Path]::GetFullPath($Left).TrimEnd('\'), [IO.Path]::GetFullPath($Right).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) }
    catch { return $false }
}

function Get-StephanosRetargetPathAttributes([string]$Path) { return [IO.File]::GetAttributes($Path) }

function Assert-StephanosRetargetPathChain([string]$Path, [string]$ProfileRoot, [bool]$RequiredDirectory = $false) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($ProfileRoot).TrimEnd('\')
    if (-not (Test-StephanosRetargetSamePath $full $root) -and
        -not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'STEPHANOS_LOCAL_SHORTCUT_PROFILE_PATH_UNPROVEN' }
    if ($RequiredDirectory -and -not [IO.Directory]::Exists($full)) { throw 'STEPHANOS_LOCAL_SHORTCUT_DIRECTORY_MISSING' }
    $cursor = $full
    while ($true) {
        $observed = $false; $attributes = $null
        try { $attributes = Get-StephanosRetargetPathAttributes $cursor; $observed = $true }
        catch {
            $native = $_.Exception.GetBaseException()
            if ($native -isnot [IO.FileNotFoundException] -and $native -isnot [IO.DirectoryNotFoundException]) { throw 'STEPHANOS_LOCAL_SHORTCUT_PATH_UNPROVEN' }
        }
        if ($observed -and ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'STEPHANOS_LOCAL_SHORTCUT_REPARSE_PATH' }
        if (Test-StephanosRetargetSamePath $cursor $root) { break }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { throw 'STEPHANOS_LOCAL_SHORTCUT_PROFILE_PATH_UNPROVEN' }
        $cursor = $parent
    }
}

function Get-StephanosRetargetOperatorObservation {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = if ($null -ne $identity.User) { [string]$identity.User.Value } else { '' }
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        $registered = ''
        $key = $null
        try {
            if ($sid -cmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') {
                $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + $sid, $false)
                if ($null -ne $key) { $registered = [Environment]::ExpandEnvironmentVariables([string]$key.GetValue('ProfileImagePath', '')) }
            }
        } finally { if ($null -ne $key) { $key.Dispose() } }
        return [pscustomobject]@{
            Sid = $sid; Interactive = [Environment]::UserInteractive
            SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
            Administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
            Profile = [Environment]::GetFolderPath('UserProfile'); EnvironmentProfile = [string]$env:USERPROFILE
            RegisteredProfile = $registered; Desktop = [Environment]::GetFolderPath('DesktopDirectory')
            LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
        }
    } finally { $identity.Dispose() }
}

function Get-StephanosRetargetContext {
    $operator = Get-StephanosRetargetOperatorObservation
    if ($operator.Sid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        $operator.Interactive -ne $true -or $operator.SessionId -le 0 -or $operator.Administrator -ne $false) { throw 'STEPHANOS_LOCAL_SHORTCUT_OPERATOR_UNPROVEN' }
    if (-not (Test-StephanosRetargetSamePath $operator.Profile $operator.EnvironmentProfile) -or
        -not (Test-StephanosRetargetSamePath $operator.Profile $operator.RegisteredProfile)) { throw 'STEPHANOS_LOCAL_SHORTCUT_OPERATOR_PROFILE_MISMATCH' }
    $profile = [IO.Path]::GetFullPath($operator.Profile).TrimEnd('\')
    if ($profile -cnotmatch '^[A-Za-z]:\\') { throw 'STEPHANOS_LOCAL_SHORTCUT_OPERATOR_PROFILE_MISMATCH' }
    $repo = [IO.Path]::Combine($profile, 'Documents\GitHub\stephan-os')
    $adapter = [IO.Path]::Combine($repo, 'scripts\windows\retarget-stephanos-local-shortcut.ps1')
    if (-not (Test-StephanosRetargetSamePath $script:StephanosRetargetSourcePath $adapter)) { throw 'STEPHANOS_LOCAL_SHORTCUT_NON_CANONICAL_ADAPTER' }
    Assert-StephanosRetargetPathChain $profile $profile $true
    Assert-StephanosRetargetPathChain $operator.Desktop $profile $true
    Assert-StephanosRetargetPathChain $operator.LocalAppData $profile $true
    Assert-StephanosRetargetPathChain $repo $profile $true
    $desktop = [IO.Path]::GetFullPath($operator.Desktop).TrimEnd('\')
    $link = [IO.Path]::Combine($desktop, 'Stephanos Local.lnk')
    $target = [IO.Path]::Combine($repo, 'windows\Launch-Stephanos-Local.cmd')
    Assert-StephanosRetargetPathChain $link $profile
    Assert-StephanosRetargetPathChain $target $profile
    if (-not [IO.File]::Exists($target)) { throw 'STEPHANOS_LOCAL_SHORTCUT_TARGET_MISSING' }
    return [pscustomobject]@{
        Sid = $operator.Sid; Profile = $profile; Desktop = $desktop; LocalAppData = $operator.LocalAppData
        Link = $link; Repo = $repo; Target = $target; WorkingDirectory = $repo
        Arguments = '-Mode launcher-root -BootMode cockpit -Unattended'
        BackupRoot = [IO.Path]::Combine($operator.LocalAppData, 'Stephanos\shortcut-retarget')
        SourceProbe = [IO.Path]::Combine($repo, 'scripts\battle-bridge-ignition-supervisor.mjs')
    }
}

function Test-StephanosRetargetSameContext($Left, $Right) {
    if ($Left.Sid -cne $Right.Sid -or $Left.Arguments -cne $Right.Arguments) { return $false }
    foreach ($field in @('Profile', 'Desktop', 'LocalAppData', 'Link', 'Repo', 'Target', 'WorkingDirectory', 'BackupRoot', 'SourceProbe')) {
        if (-not (Test-StephanosRetargetSamePath ([string]$Left.$field) ([string]$Right.$field))) { return $false }
    }
    return $true
}

function Open-StephanosRetargetBinaryRead([string]$Path) {
    return [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
}

function Read-StephanosRetargetBinary([string]$Path, [string]$ProfileRoot) {
    Assert-StephanosRetargetPathChain $Path $ProfileRoot
    if (-not [IO.File]::Exists($Path)) { throw 'STEPHANOS_LOCAL_SHORTCUT_FILE_MISSING' }
    $before = [IO.FileInfo]::new($Path)
    if ($before.Length -le 0 -or $before.Length -gt 65536) { throw 'STEPHANOS_LOCAL_SHORTCUT_FILE_SIZE_INVALID' }
    $size = $before.Length; $writeTime = $before.LastWriteTimeUtc.Ticks
    $stream = $null
    try {
        $stream = Open-StephanosRetargetBinaryRead $Path
        if ($stream.Length -ne $size) { throw 'STEPHANOS_LOCAL_SHORTCUT_FILE_CHANGED' }
        $buffer = [byte[]]::new(65537)
        $total = 0
        while ($total -lt $buffer.Length) {
            $read = $stream.Read($buffer, $total, $buffer.Length - $total)
            if ($read -eq 0) { break }
            $total += $read
        }
        if ($total -ne $size -or $stream.Length -ne $size) { throw 'STEPHANOS_LOCAL_SHORTCUT_FILE_CHANGED' }
        $bytes = [byte[]]::new($total)
        [Array]::Copy($buffer, $bytes, $total)
    } finally { if ($null -ne $stream) { $stream.Dispose() } }
    Assert-StephanosRetargetPathChain $Path $ProfileRoot
    $after = [IO.FileInfo]::new($Path)
    if ($after.Length -ne $size -or $after.LastWriteTimeUtc.Ticks -ne $writeTime) { throw 'STEPHANOS_LOCAL_SHORTCUT_FILE_CHANGED' }
    return [pscustomobject]@{ Bytes = $bytes; Length = $total; Sha256 = Get-StephanosRetargetDigest $bytes }
}

function New-StephanosRetargetShell { return [Activator]::CreateInstance([type]::GetTypeFromProgID('WScript.Shell')) }
function Close-StephanosRetargetCom($Value) {
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) }
}

function Read-StephanosRetargetView([string]$Path) {
    $shell = $null; $link = $null
    try {
        $shell = New-StephanosRetargetShell
        $link = $shell.CreateShortcut($Path)
        return [pscustomobject]@{ Target = [string]$link.TargetPath; Arguments = [string]$link.Arguments
            WorkingDirectory = [string]$link.WorkingDirectory; Description = [string]$link.Description
            IconLocation = [string]$link.IconLocation; Hotkey = [string]$link.Hotkey; WindowStyle = [int]$link.WindowStyle }
    } finally { Close-StephanosRetargetCom $link; Close-StephanosRetargetCom $shell }
}

function Save-StephanosRetargetView($Context) {
    $shell = $null; $link = $null
    try {
        $shell = New-StephanosRetargetShell
        $link = $shell.CreateShortcut($Context.Link)
        $link.TargetPath = $Context.Target
        $link.Arguments = $Context.Arguments
        $link.WorkingDirectory = $Context.WorkingDirectory
        $link.Save()
    } finally { Close-StephanosRetargetCom $link; Close-StephanosRetargetCom $shell }
}

function Get-StephanosRetargetSourceProof($Context) {
    $node = 'C:\Program Files\nodejs\node.exe'
    if (-not [IO.File]::Exists($node) -or -not [IO.File]::Exists($Context.SourceProbe)) { throw 'STEPHANOS_LOCAL_SHORTCUT_SOURCE_HOST_MISSING' }
    $process = [Diagnostics.Process]::new()
    try {
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $node
        $start.Arguments = '"' + $Context.SourceProbe + '" --source-truth-json'
        $start.WorkingDirectory = $Context.Repo
        $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
        # The fixed probe must not inherit Node preload or Git injection variables.
        $start.EnvironmentVariables.Clear()
        foreach ($entry in @{
            SystemRoot = 'C:\Windows'; windir = 'C:\Windows'; ComSpec = 'C:\Windows\System32\cmd.exe'
            PATH = 'C:\Windows\System32;C:\Windows;C:\Program Files\Git\cmd;C:\Program Files\nodejs'
            USERPROFILE = $Context.Profile; LOCALAPPDATA = $Context.LocalAppData
            TEMP = [IO.Path]::Combine($Context.LocalAppData, 'Temp'); TMP = [IO.Path]::Combine($Context.LocalAppData, 'Temp')
        }.GetEnumerator()) { $start.EnvironmentVariables[$entry.Key] = $entry.Value }
        $process.StartInfo = $start
        if (-not $process.Start()) { throw 'STEPHANOS_LOCAL_SHORTCUT_SOURCE_PROBE_FAILED' }
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            try { $process.Kill() } catch { }
            throw 'STEPHANOS_LOCAL_SHORTCUT_SOURCE_PROBE_TIMEOUT'
        }
        $output = $stdout.GetAwaiter().GetResult(); $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or $output.Length -gt 131072 -or $errorOutput.Length -gt 131072) { throw 'STEPHANOS_LOCAL_SHORTCUT_SOURCE_PROBE_FAILED' }
        return Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject $output -ErrorAction Stop
    } finally { $process.Dispose() }
}

function Assert-StephanosRetargetSource($Context, [string]$ExpectedHead) {
    $proof = Get-StephanosRetargetSourceProof $Context
    $fields = @($proof.PSObject.Properties.Name)
    if ($fields.Count -ne 3 -or @('ok', 'head', 'publicationState' | Where-Object { $fields -cnotcontains $_ }).Count -ne 0 -or
        $proof.ok -isnot [bool] -or $proof.ok -ne $true -or $proof.head -isnot [string] -or
        $proof.head -cne $ExpectedHead -or $proof.publicationState -cne 'healthy-synced') { throw 'STEPHANOS_LOCAL_SHORTCUT_SOURCE_UNPROVEN' }
}

function Write-StephanosRetargetBackup($Context, $Preimage) {
    Assert-StephanosRetargetPathChain $Context.BackupRoot $Context.Profile
    [void][IO.Directory]::CreateDirectory($Context.BackupRoot)
    Assert-StephanosRetargetPathChain $Context.BackupRoot $Context.Profile $true
    $path = [IO.Path]::Combine($Context.BackupRoot, 'Stephanos Local.preimage-' + $Preimage.Sha256 + '.lnk')
    if ([IO.File]::Exists($path)) {
        $existing = Read-StephanosRetargetBinary $path $Context.Profile
        if ($existing.Sha256 -cne $Preimage.Sha256 -or $existing.Length -ne $Preimage.Length) { throw 'STEPHANOS_LOCAL_SHORTCUT_BACKUP_CONFLICT' }
    } else {
        $stream = $null
        try {
            $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $stream.Write($Preimage.Bytes, 0, $Preimage.Bytes.Length); $stream.Flush($true)
        } finally { if ($null -ne $stream) { $stream.Dispose() } }
        $existing = Read-StephanosRetargetBinary $path $Context.Profile
        if ($existing.Sha256 -cne $Preimage.Sha256 -or $existing.Length -ne $Preimage.Length) { throw 'STEPHANOS_LOCAL_SHORTCUT_BACKUP_UNPROVEN' }
    }
    return [pscustomobject]@{ Path = $path; Sha256 = $existing.Sha256 }
}

function Invoke-StephanosLocalShortcutRetarget([string]$ExpectedHead, [string]$ExpectedShortcutSha256, [bool]$Apply) {
    $result = [ordered]@{ schemaVersion = 'stephanos.local-shortcut-retarget.v1'; ok = $false; status = 'BLOCKED'; blocker = ''
        mode = $(if ($Apply) { 'APPLY' } else { 'PREVIEW' }); expectedHead = $ExpectedHead; expectedShortcutSha256 = $ExpectedShortcutSha256
        sourceQualified = $false; applyAdmission = $false; retargeted = $false; mutationAttempted = $false
        preimageSha256 = ''; backupPath = ''; backupSha256 = ''; afterSha256 = ''; operatorSid = ''
        targetPath = ''; arguments = ''; workingDirectory = ''; sourceProbeRan = $false; sourceProbeMayFetch = $false
        launcherExecuted = $false; tasksChanged = $false; wrapperChanged = $false; otherLinksChanged = $false
        atomicityClaimed = $false; executionQualificationClaimed = $false }
    try {
        if ($ExpectedHead -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedShortcutSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'STEPHANOS_LOCAL_SHORTCUT_ARGUMENTS_INVALID' }
        $context = Get-StephanosRetargetContext
        $result.operatorSid = $context.Sid; $result.targetPath = $context.Target; $result.arguments = $context.Arguments; $result.workingDirectory = $context.WorkingDirectory
        $preimage = Read-StephanosRetargetBinary $context.Link $context.Profile
        $result.preimageSha256 = $preimage.Sha256
        if ($preimage.Sha256 -cne $ExpectedShortcutSha256) { throw 'STEPHANOS_LOCAL_SHORTCUT_PREIMAGE_MISMATCH' }
        $beforeView = Read-StephanosRetargetView $context.Link
        if ([string]::IsNullOrWhiteSpace($beforeView.Target)) { throw 'STEPHANOS_LOCAL_SHORTCUT_PREIMAGE_VIEW_UNPROVEN' }
        if (-not $Apply) {
            $result.ok = $true; $result.status = 'PREVIEW'
            return [pscustomobject]$result
        }
        $result.sourceProbeRan = $true; $result.sourceProbeMayFetch = $true
        Assert-StephanosRetargetSource $context $ExpectedHead
        $result.sourceQualified = $true
        $backup = Write-StephanosRetargetBackup $context $preimage
        $result.backupPath = $backup.Path; $result.backupSha256 = $backup.Sha256
        if ($backup.Sha256 -cne $ExpectedShortcutSha256) { throw 'STEPHANOS_LOCAL_SHORTCUT_BACKUP_UNPROVEN' }
        $current = Get-StephanosRetargetContext
        if (-not (Test-StephanosRetargetSameContext $context $current)) { throw 'STEPHANOS_LOCAL_SHORTCUT_CONTEXT_CHANGED' }
        Assert-StephanosRetargetSource $context $ExpectedHead
        $lastPreimage = Read-StephanosRetargetBinary $context.Link $context.Profile
        if ($lastPreimage.Sha256 -cne $ExpectedShortcutSha256) { throw 'STEPHANOS_LOCAL_SHORTCUT_PREIMAGE_CHANGED' }
        $result.mutationAttempted = $true
        Save-StephanosRetargetView $context
        $after = Read-StephanosRetargetBinary $context.Link $context.Profile
        $savedView = Read-StephanosRetargetView $context.Link
        $afterAgain = Read-StephanosRetargetBinary $context.Link $context.Profile
        $result.afterSha256 = $afterAgain.Sha256
        if ($after.Sha256 -cne $afterAgain.Sha256 -or
            -not (Test-StephanosRetargetSamePath $savedView.Target $context.Target) -or $savedView.Arguments -cne $context.Arguments -or
            -not (Test-StephanosRetargetSamePath $savedView.WorkingDirectory $context.WorkingDirectory)) { throw 'STEPHANOS_LOCAL_SHORTCUT_READBACK_UNPROVEN' }
        foreach ($field in @('Description', 'IconLocation', 'Hotkey', 'WindowStyle')) {
            if ($savedView.$field -cne $beforeView.$field) { throw 'STEPHANOS_LOCAL_SHORTCUT_METADATA_CHANGED' }
        }
        $current = Get-StephanosRetargetContext
        if (-not (Test-StephanosRetargetSameContext $context $current)) { throw 'STEPHANOS_LOCAL_SHORTCUT_CONTEXT_CHANGED' }
        Assert-StephanosRetargetSource $context $ExpectedHead
        $result.ok = $true; $result.status = 'RETARGETED'; $result.applyAdmission = $true; $result.retargeted = $true
        return [pscustomobject]$result
    } catch {
        $result.ok = $false; $result.status = 'BLOCKED'; $result.sourceQualified = $false; $result.applyAdmission = $false; $result.retargeted = $false
        $message = [string]$_.Exception.Message
        $result.blocker = if ($message -cmatch '^STEPHANOS_LOCAL_SHORTCUT_[A-Z_]+$') { $message } else { 'STEPHANOS_LOCAL_SHORTCUT_OPERATION_FAILED' }
        return [pscustomobject]$result
    }
}

function Get-StephanosRetargetExitCode($Outcome) {
    if ($Outcome.ok -is [bool] -and $Outcome.ok -eq $true) { return 0 }
    return 2
}

if ($MyInvocation.InvocationName -ne '.') {
    $outcome = Invoke-StephanosLocalShortcutRetarget $ExpectedHead $ExpectedShortcutSha256 $Apply.IsPresent
    Microsoft.PowerShell.Utility\ConvertTo-Json -InputObject $outcome -Depth 6 -Compress
    exit (Get-StephanosRetargetExitCode $outcome)
}
