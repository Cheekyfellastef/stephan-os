# SOURCE ONLY until separately reviewed and approved for one hosted execution.
# No workflow automatically invokes this script. Environment checks prevent an
# accidental local invocation; they are not an authorization mechanism.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallWimPath,
    [Parameter(Mandatory)][string]$NativePackagePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:RUNNER_ARCH -cne 'X64' -or $env:ImageOS -cne 'win22' -or $env:GITHUB_RUN_ATTEMPT -cne '1') { throw 'R7_FIXED_HOSTED_WINDOWS2022_FIRST_ATTEMPT_REQUIRED' }
if ($env:COMPUTERNAME -ceq 'BATTLE-BRIDGE') { throw 'R7_BATTLE_BRIDGE_EXECUTION_FORBIDDEN' }
$computer=Get-CimInstance Win32_ComputerSystem
if ($computer.Manufacturer -cne 'Microsoft Corporation' -or $computer.Model -cne 'Virtual Machine') { throw 'R7_EXISTING_HOSTED_VIRTUAL_MACHINE_REQUIRED' }
# Refuse absent Hyper-V; never enable a feature, install a hypervisor, change
# outer boot/code-integrity policy, attach a network or reboot the outer host.
if ((Get-Service vmms -ErrorAction Stop).Status -ne 'Running') { throw 'R7_EXISTING_HYPERV_UNAVAILABLE' }
Get-VMHost -ErrorAction Stop | Out-Null
if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1KB -lt 6GB -or [Environment]::ProcessorCount -lt 2) { throw 'R7_HOST_CAPACITY_INSUFFICIENT' }
$parent=[IO.Path]::GetFullPath($env:RUNNER_TEMP)
if (-not [IO.Path]::IsPathFullyQualified($parent) -or (Get-Item -LiteralPath $parent).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'R7_RUNNER_TEMP_UNSAFE' }
if ((Get-Volume -FilePath $parent).SizeRemaining -lt 32GB) { throw 'R7_TEMP_DISK_CAPACITY_INSUFFICIENT' }
# The fixed adapter independently reads the actual GitHub run, merged source,
# successful CI artifact and one immutable fresh owner approval for this run.
# Hash arguments or caller flags cannot substitute for that authority.
$gate=& 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'admit-r7-hosted-native-invocation.mjs') admit
if ($LASTEXITCODE -ne 0 -or @($gate).Count -ne 1) {throw 'R7_EXACT_RUN_OWNER_APPROVAL_REQUIRED'}
$admission=$gate | ConvertFrom-Json
if ($admission.admitted -ne $true -or $admission.workflowRunAttempt -ne 1 -or $admission.productionAuthority -ne $false -or $admission.claimMutationAuthority -ne $false) {throw 'R7_EXACT_RUN_OWNER_APPROVAL_UNPROVEN'}
$inputRoot=Join-Path $parent ('r7-native-invocation-'+$env:GITHUB_RUN_ID)
if (-not [string]::Equals([IO.Path]::GetFullPath($InstallWimPath),(Join-Path $inputRoot 'windows\install.wim'),[StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals([IO.Path]::GetFullPath($NativePackagePath),(Join-Path $inputRoot 'package\r7-native-test-package.zip'),[StringComparison]::OrdinalIgnoreCase)) {throw 'R7_PREPARED_INPUT_PATHS_REQUIRED'}
$NativePackageSha256=$admission.nativePackageSha256
$DriverSha256=$admission.driverSha256
$ClientSha256=$admission.clientSha256
$identity=[guid]::NewGuid().ToString('N')
$ownedRoot=[IO.Path]::GetFullPath((Join-Path $parent ('r7-native-'+$identity)))
if (-not $ownedRoot.StartsWith($parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $ownedRoot)) { throw 'R7_NEW_OWNED_DIRECTORY_REQUIRED' }
$vmName='R7Native-'+$identity
$osDisk=Join-Path $ownedRoot 'os.vhdx'
$ownedVmId=$null
$creationAttempted=$false
$mounted=$false
$wim=$null
$package=$null
$archive=$null
$receipt=$null
$cleanupCompleted=$false
$deadline=[DateTime]::Parse($admission.workflowCreatedAtUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().AddMinutes(110)
if ([DateTime]::UtcNow -ge $deadline) {throw 'R7_HOST_TOTAL_DEADLINE'}
function Invoke-FixedHostTool([ValidateSet('dism.exe','bcdboot.exe')][string]$Name,[string[]]$Arguments,[int]$TimeoutSeconds) {
    $TimeoutSeconds=[Math]::Min($TimeoutSeconds,[Math]::Floor(($deadline-[DateTime]::UtcNow).TotalSeconds))
    if ($TimeoutSeconds -lt 1) {throw 'R7_HOST_TOTAL_DEADLINE'}
    $start=[Diagnostics.ProcessStartInfo]::new((Join-Path $env:windir ('System32/'+$Name)))
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    foreach ($argument in $Arguments) {$start.ArgumentList.Add($argument)}
    $process=[Diagnostics.Process]::new();$process.StartInfo=$start
    try {
        if (-not $process.Start()) {throw 'R7_HOST_FIXED_TOOL_START_FAILED'}
        $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds*1000)) {$process.Kill($true);$process.WaitForExit();throw 'R7_HOST_FIXED_TOOL_TIMEOUT'}
        $null=$stdout.GetAwaiter().GetResult();$null=$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {throw ('R7_HOST_FIXED_TOOL_FAILED_'+$Name+'_'+$process.ExitCode)}
    } finally {$process.Dispose()}
}
function Get-ExactOwnedVm {
    $vm=Get-VM -Id $ownedVmId -ErrorAction Stop
    if ($vm.Name -cne $vmName -or (-not ([IO.Path]::GetFullPath($vm.ConfigurationLocation)).StartsWith($ownedRoot+'\',[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFullPath($vm.ConfigurationLocation) -cne $ownedRoot)) {throw 'R7_OWNED_VM_IDENTITY_CHANGED'}
    return $vm
}
function Invoke-OwnedGuest([scriptblock]$Code,[object[]]$Arguments,[int]$TimeoutSeconds) {
    if ([DateTime]::UtcNow -ge $deadline) {throw 'R7_HOST_TOTAL_DEADLINE'}
    Get-ExactOwnedVm | Out-Null
    $TimeoutSeconds=[Math]::Min($TimeoutSeconds,[Math]::Floor(($deadline-[DateTime]::UtcNow).TotalSeconds))
    if ($TimeoutSeconds -lt 1) {throw 'R7_HOST_TOTAL_DEADLINE'}
    $job=Invoke-Command -VMId $ownedVmId -Credential $credential -ScriptBlock $Code -ArgumentList $Arguments -AsJob -ErrorAction Stop
    try {
        $done=Wait-Job -Job $job -Timeout $TimeoutSeconds
        if (-not $done -or $job.State -cne 'Completed') {throw 'R7_GUEST_CALL_UNKNOWN_OR_TIMED_OUT'}
        Receive-Job -Job $job -ErrorAction Stop
    } finally {
        if ($job.State -in @('Running','NotStarted','Blocked')) {Stop-Job -Job $job}
        Remove-Job -Job $job -Force
    }
}
function Wait-OwnedGuest([string]$PriorBoot='') {
    $until=[DateTime]::UtcNow.AddMinutes(15)
    while ([DateTime]::UtcNow -lt $until -and [DateTime]::UtcNow -lt $deadline) {
        try {
            $ready=Invoke-OwnedGuest { [pscustomobject]@{name=$env:COMPUTERNAME;nonce=[IO.File]::ReadAllText('C:\R7Lab\nonce.txt');bootUtc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')} } @() 20
            if ($ready.name -ceq 'R7NATIVE-LAB' -and $ready.nonce -ceq $nonce -and (-not $PriorBoot -or $ready.bootUtc -cne $PriorBoot)) {return $ready}
        } catch { # Only readiness is retried. Native tests are never retried.
        }
        Start-Sleep -Seconds 5
    }
    throw 'R7_GUEST_BOOT_NOT_OBSERVED'
}
function Get-ExactOwnedOsDisk {
    $vhd=Get-VHD -Path $osDisk -ErrorAction Stop
    if ([IO.Path]::GetFullPath($vhd.Path) -cne $osDisk -or -not $vhd.Attached -or $vhd.Size -ne 64GB) {throw 'R7_OWNED_VHD_IDENTITY_CHANGED'}
    $disk=Get-Disk -Number $vhd.DiskNumber -ErrorAction Stop
    if ($disk.IsBoot -or $disk.IsSystem -or $disk.Size -ne 64GB -or [int]$disk.BusType -ne 15) {throw 'R7_OWNED_DISK_IDENTITY_UNPROVEN'}
    return $disk
}
try {
    $null=New-Item -ItemType Directory -Path $ownedRoot
    # Retain deny-write/delete handles through all input consumption.
    $wim=[IO.File]::Open([IO.Path]::GetFullPath($InstallWimPath),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    if ($wim.Length -ne 4340202461 -or (Get-FileHash -InputStream $wim -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'e073fe38d47d9832608ec4dff061cd5358f3924650dcd5c1b13456abc34eaac9') {throw 'R7_FIXED_OFFICIAL_WIM_HASH_MISMATCH'}
    $package=[IO.File]::Open([IO.Path]::GetFullPath($NativePackagePath),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    if ($package.Length -lt 1 -or $package.Length -gt 2MB -or (Get-FileHash -InputStream $package -Algorithm SHA256).Hash.ToLowerInvariant() -cne $NativePackageSha256) {throw 'R7_FIXED_NATIVE_PACKAGE_HASH_MISMATCH'}
    $package.Position=0
    $archive=[IO.Compression.ZipArchive]::new($package,[IO.Compression.ZipArchiveMode]::Read,$true)
    $entries=@($archive.Entries)
    if ($entries.Count -ne 4 -or @($entries | Where-Object {$_.FullName -cnotin @('R7NativeQualification.sys','R7NativeQualificationClient.exe','manifest.json','README.txt')}).Count -ne 0 -or @($entries.FullName | Select-Object -Unique).Count -ne 4) {throw 'R7_FIXED_NATIVE_ARCHIVE_LAYOUT'}
    New-VHD -Path $osDisk -SizeBytes 64GB -Dynamic -ErrorAction Stop | Out-Null
    Mount-VHD -Path $osDisk -NoDriveLetter -ErrorAction Stop
    $mounted=$true
    $disk=Get-ExactOwnedOsDisk
    if ($disk.PartitionStyle -ne 'RAW') {throw 'R7_FRESH_RAW_OS_DISK_REQUIRED'}
    $disk | Initialize-Disk -PartitionStyle GPT | Out-Null
    $disk=Get-ExactOwnedOsDisk
    $efi=$disk | New-Partition -Size 260MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' -AssignDriveLetter
    $efi | Get-Volume | Format-Volume -FileSystem FAT32 -NewFileSystemLabel R7LAB_EFI -Confirm:$false | Out-Null
    $disk | New-Partition -Size 16MB -GptType '{e3c9e316-0b5c-4db8-817d-f92df00215ae}' | Out-Null
    $windows=$disk | New-Partition -UseMaximumSize -AssignDriveLetter
    $windows | Get-Volume | Format-Volume -FileSystem NTFS -NewFileSystemLabel R7LAB_OS -Confirm:$false | Out-Null
    $osRoot=[string]$windows.DriveLetter+':\'
    $efiRoot=[string]$efi.DriveLetter+':'
    Invoke-FixedHostTool dism.exe @('/Apply-Image',('/ImageFile:'+[IO.Path]::GetFullPath($InstallWimPath)),'/Index:1',('/ApplyDir:'+$osRoot),'/CheckIntegrity','/Verify',('/LogPath:'+(Join-Path $ownedRoot 'apply.log'))) 2400
    # Explicit /s prevents an outer-host NVRAM boot entry. Never call bcdedit
    # on the outer host or BCDBoot without this verified guest EFI partition.
    Get-ExactOwnedOsDisk | Out-Null
    Invoke-FixedHostTool bcdboot.exe @((Join-Path $osRoot 'Windows'),'/s',$efiRoot,'/f','UEFI','/c') 60
    $lab=Join-Path $osRoot 'R7Lab'
    New-Item -ItemType Directory -Path $lab | Out-Null
    foreach ($name in @('R7NativeQualification.sys','R7NativeQualificationClient.exe')) {
        $entry=$archive.GetEntry($name)
        if ($entry.Length -lt 1 -or $entry.Length -gt 1MB) {throw 'R7_FIXED_NATIVE_ENTRY_SIZE'}
        $reader=$entry.Open();$writer=[IO.File]::Open((Join-Path $lab $name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$reader.CopyTo($writer)} finally {$writer.Dispose();$reader.Dispose()}
    }
    if ((Get-FileHash -LiteralPath (Join-Path $lab 'R7NativeQualification.sys')).Hash.ToLowerInvariant() -cne $DriverSha256 -or
        (Get-FileHash -LiteralPath (Join-Path $lab 'R7NativeQualificationClient.exe')).Hash.ToLowerInvariant() -cne $ClientSha256 -or
        (Get-AuthenticodeSignature -LiteralPath (Join-Path $lab 'R7NativeQualification.sys')).Status -ne 'NotSigned') {throw 'R7_APPROVED_NATIVE_PAYLOAD_HASH_MISMATCH'}
    [IO.File]::WriteAllText((Join-Path $lab 'input-pins.json'),(@{unsignedDriverSha256=$DriverSha256;clientSha256=$ClientSha256}|ConvertTo-Json -Compress))
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'invoke-r7-isolated-native-guest.ps1') -Destination (Join-Path $lab 'guest.ps1')
    $nonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $lab 'nonce.txt'),$nonce)
    $password='R7!a'+[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $credential=[Management.Automation.PSCredential]::new('Administrator',(ConvertTo-SecureString -String $password -AsPlainText -Force))
    $escaped=[Security.SecurityElement]::Escape($password)
    $unattend=@"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
 <settings pass="specialize"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><ComputerName>R7NATIVE-LAB</ComputerName><TimeZone>UTC</TimeZone></component></settings>
 <settings pass="oobeSystem"><component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"><OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE><UserAccounts><AdministratorPassword><Value>$escaped</Value><PlainText>true</PlainText></AdministratorPassword></UserAccounts></component></settings>
</unattend>
"@
    $panther=Join-Path $osRoot 'Windows\Panther'
    New-Item -ItemType Directory -Path $panther -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $panther 'Unattend.xml'),$unattend)
    $password=$null;$escaped=$null;$unattend=$null
    Dismount-VHD -Path $osDisk -ErrorAction Stop
    $mounted=$false
    if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) {throw 'R7_OWNED_VM_NAME_ALREADY_EXISTS'}
    $creationAttempted=$true
    $vm=New-VM -Name $vmName -Generation 2 -MemoryStartupBytes 4GB -NoVHD -Path $ownedRoot
    $ownedVmId=$vm.Id
    Get-ExactOwnedVm | Set-VMProcessor -Count 2
    Get-ExactOwnedVm | Set-VMMemory -DynamicMemoryEnabled $false -StartupBytes 4GB
    Get-ExactOwnedVm | Set-VM -AutomaticStartAction Nothing -AutomaticStopAction TurnOff -CheckpointType Disabled
    Get-ExactOwnedVm | Get-VMNetworkAdapter | Remove-VMNetworkAdapter
    Get-ExactOwnedVm | Add-VMHardDiskDrive -Path $osDisk
    Get-ExactOwnedVm | Set-VMFirmware -EnableSecureBoot Off
    Get-ExactOwnedVm | Start-VM -ErrorAction Stop
    $first=Wait-OwnedGuest
    $prepared=Invoke-OwnedGuest { & 'C:\R7Lab\guest.ps1' -Phase Prepare } @() 180
    if ($prepared.nonce -cne $nonce -or $prepared.bootUtc -cne $first.bootUtc) {throw 'R7_GUEST_PREPARATION_IDENTITY_MISMATCH'}
    # This is a guest-only reboot, after the exact prepared result is captured.
    Invoke-OwnedGuest { & 'C:\Windows\System32\shutdown.exe' /r /t 5 /f; if ($LASTEXITCODE -ne 0) {throw 'R7_GUEST_REBOOT_REQUEST_FAILED'} } @() 20 | Out-Null
    $second=Wait-OwnedGuest $first.bootUtc
    $result=Invoke-OwnedGuest { & 'C:\R7Lab\guest.ps1' -Phase Run } @() 180
    if ($result.nonce -cne $nonce -or $result.bootUtc -cne $second.bootUtc -or $result.normalUnloadSucceeded -ne $true -or $result.productionCustodyProven -ne $false -or $result.leaseChanged -ne $false) {throw 'R7_GUEST_RESULT_IDENTITY_MISMATCH'}
    $receipt=[ordered]@{schemaVersion='stephanos.r7-hosted-native-smoke.v1';admission=$admission;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;ownedVmId=[string]$ownedVmId;vmProcessors=2;vmMemoryBytes=4GB;osDiskLogicalBytes=64GB;networkAdapterCount=0;officialIsoSha256='3e4fa6d8507b554856fc9ca6079cc402df11a8b79344871669f0251535255325';wimSha256='e073fe38d47d9832608ec4dff061cd5358f3924650dcd5c1b13456abc34eaac9';nativePackageSha256=$NativePackageSha256;result=$result;productionCustodyProven=$false;leaseChanged=$false}
} finally {
    # GUID plus owned path/name checks precede removal. Never touch any other VM.
    if (-not $ownedVmId -and $creationAttempted) {
        $candidate=Get-VM -Name $vmName -ErrorAction SilentlyContinue
        if ($candidate) {$ownedVmId=$candidate.Id;Get-ExactOwnedVm | Out-Null}
    }
    if ($ownedVmId) {
        $vm=Get-ExactOwnedVm
        if ($vm.State -ne 'Off') {$vm | Stop-VM -TurnOff -Force -ErrorAction Stop}
        Get-ExactOwnedVm | Remove-VM -Force -ErrorAction Stop
        if (Get-VM -Id $ownedVmId -ErrorAction SilentlyContinue) {throw 'R7_VM_DISPOSAL_UNPROVEN'}
    }
    if ($mounted) {Get-ExactOwnedOsDisk | Out-Null;Dismount-VHD -Path $osDisk -ErrorAction Stop;$mounted=$false}
    if ($archive) {$archive.Dispose()}
    if ($package) {$package.Dispose()}
    if ($wim) {$wim.Dispose()}
    if (Test-Path -LiteralPath $ownedRoot) {
        $target=(Get-Item -LiteralPath $ownedRoot).FullName
        if ($target -cne $ownedRoot -or -not $target.StartsWith($parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -cne ('r7-native-'+$identity)) {throw 'R7_DISPOSAL_PATH_OUTSIDE_OWNED_ROOT'}
        if ((Get-Item -LiteralPath $target).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or @(Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint).Count -ne 0) {throw 'R7_DISPOSAL_REPARSE_POINT_REFUSED'}
        if (Test-Path -LiteralPath $osDisk) {if ((Get-VHD -Path $osDisk).Attached) {throw 'R7_DISPOSAL_DISK_STILL_ATTACHED'}}
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $target) {throw 'R7_DISPOSAL_DIRECTORY_REMAINS'}
    }
    $cleanupCompleted=$true
}
if (-not $receipt -or -not $cleanupCompleted) {throw 'R7_NATIVE_EXPERIMENT_NOT_COMPLETED'}
$receipt['ownedGuestAndDisksDisposed']=$true
$receipt | ConvertTo-Json -Depth 16 -Compress
