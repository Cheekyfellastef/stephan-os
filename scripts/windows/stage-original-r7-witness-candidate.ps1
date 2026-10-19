#requires -Version 5.1
<#
  Stage-only original R7 custody witness candidate.
  Read-only by default; -Stage explicitly requires an interactive elevated
  Windows administrator. Never starts a service, commissions a signer,
  grants source/lease authority, or downloads arbitrary binaries.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$CandidateExe,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ExpectedSha256,
    [switch]$Stage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$service = 'StephanosOriginalR7CustodyWitness'
$account = "NT SERVICE\$service"
$fixedExe = 'Stephanos.OriginalR7CustodyWitness.exe'
# Derive privileged destination and SCM executable from Windows known-folder
# APIs, never from an inherited/overridable ProgramFiles or SystemRoot value.
$programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$systemDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::System)
if (-not $programFiles -or -not $systemDirectory) {
    throw 'R7_STAGE_OS_KNOWN_FOLDERS_UNAVAILABLE'
}
$installDirectory = [IO.Path]::Combine($programFiles, 'StephanosR7CustodyWitness')
$installedExe = [IO.Path]::Combine($installDirectory, $fixedExe)
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$service"
$sc = [IO.Path]::Combine($systemDirectory, 'sc.exe')

function Assert-PlainLocalExistingPath([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:\\' -or $Value.Contains('%')) {
        throw 'R7_STAGE_LOCAL_DRIVE_ABSOLUTE_REQUIRED'
    }
    $canonical = [IO.Path]::GetFullPath($Value)
    # The canonical path may differ from a Windows temporary-directory alias
    # without traversing to another target. Reject traversal components
    # explicitly and independently reject all reparse ancestors below.
    $segments = @($Value -split '[\\/]')
    if ($segments -contains '.' -or $segments -contains '..') {
        throw 'R7_STAGE_TRAVERSAL_OR_ALIAS_FORBIDDEN'
    }
    $cursor = $canonical
    while ($cursor) {
        if (-not (Test-Path -LiteralPath $cursor)) { throw 'R7_STAGE_PATH_MISSING' }
        if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'R7_STAGE_REPARSE_ANCESTOR'
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $canonical
}
function Read-LocalSha256([string]$Path) {
    # Windows PowerShell may run with module auto-loading disabled. Use .NET
    # directly rather than relying on an optional Get-FileHash cmdlet import.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open,
        [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}
function Assert-NoExistingServiceOrDestination {
    if ((Test-Path -LiteralPath $serviceKey) -or
        (Test-Path -LiteralPath $installDirectory)) {
        throw 'R7_STAGE_EXISTING_SERVICE_OR_DATA_HOLD'
    }
}
function Add-Rule($acl, $sid, $rights, $inheritance) {
    $allow = [Security.AccessControl.AccessControlType]::Allow
    if ($inheritance) {
        $flags = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [Security.AccessControl.InheritanceFlags]::ObjectInherit
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid, $rights, $flags,
            [Security.AccessControl.PropagationFlags]::None, $allow)
    } else {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $allow)
    }
    $acl.AddAccessRule($rule)
}
function Protect-StagedImage {
    $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $witness = ([Security.Principal.NTAccount]::new('NT SERVICE', $service)).Translate(
        [Security.Principal.SecurityIdentifier])
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $read = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    $directoryAcl = [Security.AccessControl.DirectorySecurity]::new()
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.SetOwner($admins)
    Add-Rule $directoryAcl $admins $full $true
    Add-Rule $directoryAcl $system $full $true
    Add-Rule $directoryAcl $witness $read $true
    Set-Acl -LiteralPath $installDirectory -AclObject $directoryAcl
    $fileAcl = [Security.AccessControl.FileSecurity]::new()
    $fileAcl.SetAccessRuleProtection($true, $false)
    $fileAcl.SetOwner($admins)
    Add-Rule $fileAcl $admins $full $false
    Add-Rule $fileAcl $system $full $false
    Add-Rule $fileAcl $witness $read $false
    Set-Acl -LiteralPath $installedExe -AclObject $fileAcl
}
if ($env:OS -ne 'Windows_NT' -or [IntPtr]::Size -ne 8) {
    throw 'R7_STAGE_WINDOWS_X64_REQUIRED'
}
if ([IO.Path]::GetFileName($CandidateExe) -cne $fixedExe) {
    throw 'R7_STAGE_FIXED_BUNDLE_FILENAME_REQUIRED'
}
$candidate = Assert-PlainLocalExistingPath $CandidateExe
[void](Assert-PlainLocalExistingPath $sc)
if (-not (Test-Path -LiteralPath $sc -PathType Leaf)) {
    throw 'R7_STAGE_SCM_UNAVAILABLE'
}
$sidecars = @(Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($candidate)) -File |
    Where-Object { $_.Extension -in @('.dll', '.json', '.deps') })
if ($sidecars.Count -ne 0) { throw 'R7_STAGE_NOT_SINGLE_FILE_BUNDLE' }
$info = Get-Item -LiteralPath $candidate
if ($info.PSIsContainer -or $info.Length -le 0 -or $info.Length -gt 250MB) {
    throw 'R7_STAGE_CANDIDATE_INVALID'
}
if ((Read-LocalSha256 $candidate) -cne $ExpectedSha256) {
    throw 'R7_STAGE_CANDIDATE_HASH_MISMATCH'
}
Assert-NoExistingServiceOrDestination
$receipt = [ordered]@{
    schemaVersion = 'stephanos.original-r7-witness-stage-b.v1'
    serviceName = $service
    leaseId = 'critical-2962-elastic-goal-r7-lease'
    pinnedCandidateDigestObserved = $true
    serviceStarted = $false
    witnessCommissioned = $false
    originalWriterExcluded = $false
    protectedAuditProven = $false
    independentSignerProven = $false
    operatorSignerProven = $false
    leaseReleased = $false
    finalVerdict = 'R7_STAGE_B_PREFLIGHT_ONLY'
}
if (-not $Stage -or $WhatIfPreference) {
    $receipt | ConvertTo-Json -Compress
    return
}
$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
    -not [Environment]::UserInteractive) {
    throw 'R7_STAGE_INTERACTIVE_ADMIN_REQUIRED'
}
if (-not $PSCmdlet.ShouldProcess($service, 'Stage disabled fixed SCM witness, without starting it')) {
    $receipt | ConvertTo-Json -Compress
    return
}
$directoryCreated = $false
$serviceCreated = $false
try {
    [void](Assert-PlainLocalExistingPath $programFiles)
    [void](New-Item -ItemType Directory -Path $installDirectory -ErrorAction Stop)
    $directoryCreated = $true
    Copy-Item -LiteralPath $candidate -Destination $installedExe -ErrorAction Stop
    if ((Read-LocalSha256 $installedExe) -cne $ExpectedSha256) {
        throw 'R7_STAGE_COPIED_IMAGE_HASH_MISMATCH'
    }
    # Disable at creation, including partial failures before SID/ACL setup.
    # Enabling the candidate belongs to separately approved commissioning.
    & $sc create $service 'type=' 'own' 'start=' 'disabled' 'binPath=' ('"' + $installedExe + '"') 'obj=' $account 'password=' '' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'R7_STAGE_CREATE_SERVICE_FAILED' }
    $serviceCreated = $true
    & $sc sidtype $service restricted | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'R7_STAGE_RESTRICTED_SID_FAILED' }
    Protect-StagedImage
    New-ItemProperty -LiteralPath $serviceKey -Name PinnedImageSha256 -PropertyType String -Value $ExpectedSha256 -ErrorAction Stop | Out-Null
    $props = Get-ItemProperty -LiteralPath $serviceKey -ErrorAction Stop
    $expectedImagePath = '"' + $installedExe + '"'
    if ($props.ObjectName -cne $account -or [int]$props.Type -ne 16 -or
        [int]$props.Start -ne 4 -or [int]$props.ServiceSidType -ne 3 -or
        $props.PinnedImageSha256 -cne $ExpectedSha256 -or
        -not [string]::Equals([string]$props.ImagePath, $expectedImagePath,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'R7_STAGE_POSTCONDITION_MISMATCH'
    }
    # The staging operation must never start the newly registered service.
    # Trust the real SCM status as well as the disabled Start=4 value.
    $controller = [System.ServiceProcess.ServiceController]::new($service)
    try {
        $controller.Refresh()
        if ($controller.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
            throw 'R7_STAGE_SERVICE_NOT_STOPPED'
        }
    } finally {
        $controller.Dispose()
    }
    # Verify the *actual* ACL grants, not just that its SID names are
    # familiar. A missing service ACE or an overprivileged service ACE must
    # never produce a positive staging receipt.
    $witnessSid = ([Security.Principal.NTAccount]::new('NT SERVICE', $service)).Translate(
        [Security.Principal.SecurityIdentifier]).Value
    $expectedFull = [int][Security.AccessControl.FileSystemRights]::FullControl
    $requiredRead = [int][Security.AccessControl.FileSystemRights]::ReadAndExecute
    # Windows may normalize allowed ReadAndExecute ACEs by adding Synchronize.
    $allowedRead = $requiredRead -bor [int][Security.AccessControl.FileSystemRights]::Synchronize
    $expectedSids = @('S-1-5-32-544', 'S-1-5-18', $witnessSid)
    foreach ($target in @($installDirectory, $installedExe)) {
        $readback = Get-Acl -LiteralPath $target -ErrorAction Stop
        if (-not $readback.AreAccessRulesProtected -or
            $readback.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') {
            throw 'R7_STAGE_PROTECTED_ACL_NOT_OBSERVED'
        }
        $seen = @{}
        $expectedInheritance = [Security.AccessControl.InheritanceFlags]::None
        if ([string]::Equals($target, $installDirectory,
            [StringComparison]::OrdinalIgnoreCase)) {
            $expectedInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                [Security.AccessControl.InheritanceFlags]::ObjectInherit
        }
        foreach ($entry in $readback.Access) {
            $sid = $entry.IdentityReference.Translate(
                [Security.Principal.SecurityIdentifier]).Value
            if ($entry.IsInherited -or
                $entry.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
                $sid -notin $expectedSids -or $seen.ContainsKey($sid) -or
                $entry.InheritanceFlags -ne $expectedInheritance -or
                $entry.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
                throw 'R7_STAGE_UNEXPECTED_ACL_PRINCIPAL'
            }
            $seen[$sid] = $true
            $rights = [int]$entry.FileSystemRights
            if ($sid -eq $witnessSid) {
                if (($rights -band $requiredRead) -ne $requiredRead -or
                    ($rights -band (-bnot $allowedRead)) -ne 0) {
                    throw 'R7_STAGE_UNEXPECTED_ACL_RIGHTS'
                }
            } elseif ($rights -ne $expectedFull) {
                throw 'R7_STAGE_UNEXPECTED_ACL_RIGHTS'
            }
        }
        foreach ($requiredSid in $expectedSids) {
            if (-not $seen.ContainsKey($requiredSid)) {
                throw 'R7_STAGE_REQUIRED_ACL_PRINCIPAL_MISSING'
            }
        }
    }
    if ((Read-LocalSha256 $installedExe) -cne $ExpectedSha256) {
        throw 'R7_STAGE_POST_ACL_IMAGE_HASH_MISMATCH'
    }
    $receipt.finalVerdict = 'R7_STAGE_B_DISABLED_SERVICE_STAGED_NOT_COMMISSIONED'
    $receipt | ConvertTo-Json -Compress
} catch {
    # No destructive automatic rollback: even partial service registration
    # requires independent host review before a scoped removal.
    $receipt.finalVerdict = 'R7_STAGE_B_PARTIAL_ARTIFACTS_REQUIRE_REVIEW'
    $receipt.createdServiceInAttempt = $serviceCreated
    $receipt.createdDirectoryInAttempt = $directoryCreated
    $receipt | ConvertTo-Json -Compress
    throw 'R7_STAGE_B_INCOMPLETE_FAIL_CLOSED'
}
