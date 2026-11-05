Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$hostScript=Join-Path $root 'invoke-r7-hosted-native-smoke.ps1'
$guestScript=Join-Path $root 'invoke-r7-isolated-native-guest.ps1'
$checks=0
function Expect-Refusal([scriptblock]$Operation,[string]$Expected) {
    $observed=$null
    try {& $Operation | Out-Null} catch {$observed=$_.Exception.Message}
    if (-not $observed -or $observed -notlike ('*'+$Expected+'*')) {throw ('EXPECTED_'+$Expected+'_GOT_'+$observed)}
    $script:checks++
}
$names=@('GITHUB_ACTIONS','RUNNER_ENVIRONMENT','RUNNER_OS','RUNNER_ARCH','ImageOS','GITHUB_RUN_ATTEMPT','COMPUTERNAME')
$saved=@{};foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name)}
try {
    foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$null)}
    function Get-CimInstance {throw 'UNEXPECTED_CIM_QUERY'}
    Expect-Refusal {& $hostScript -InstallWimPath 'DO_NOT_OPEN' -NativePackagePath 'DO_NOT_OPEN' -NativePackageSha256 ('a'*64) -DriverSha256 ('b'*64) -ClientSha256 ('c'*64)} 'R7_FIXED_HOSTED_WINDOWS2022_FIRST_ATTEMPT_REQUIRED'
    $env:GITHUB_ACTIONS='true';$env:RUNNER_ENVIRONMENT='github-hosted';$env:RUNNER_OS='Windows';$env:RUNNER_ARCH='X64';$env:ImageOS='win22';$env:GITHUB_RUN_ATTEMPT='2'
    Expect-Refusal {& $hostScript -InstallWimPath 'DO_NOT_OPEN' -NativePackagePath 'DO_NOT_OPEN' -NativePackageSha256 ('a'*64) -DriverSha256 ('b'*64) -ClientSha256 ('c'*64)} 'R7_FIXED_HOSTED_WINDOWS2022_FIRST_ATTEMPT_REQUIRED'
    $env:GITHUB_RUN_ATTEMPT='1';$env:COMPUTERNAME='BATTLE-BRIDGE'
    Expect-Refusal {& $hostScript -InstallWimPath 'DO_NOT_OPEN' -NativePackagePath 'DO_NOT_OPEN' -NativePackageSha256 ('a'*64) -DriverSha256 ('b'*64) -ClientSha256 ('c'*64)} 'R7_BATTLE_BRIDGE_EXECUTION_FORBIDDEN'
    $env:COMPUTERNAME='FIXTURE'
    function Get-CimInstance {[pscustomobject]@{Manufacturer='Physical fixture';Model='Physical fixture'}}
    Expect-Refusal {& $hostScript -InstallWimPath 'DO_NOT_OPEN' -NativePackagePath 'DO_NOT_OPEN' -NativePackageSha256 ('a'*64) -DriverSha256 ('b'*64) -ClientSha256 ('c'*64)} 'R7_EXISTING_HOSTED_VIRTUAL_MACHINE_REQUIRED'
    $env:COMPUTERNAME='BATTLE-BRIDGE'
    Expect-Refusal {& $guestScript -Phase Prepare} 'R7_GUEST_IDENTITY_REQUIRED'
    Expect-Refusal {& $guestScript -Phase Run} 'R7_GUEST_IDENTITY_REQUIRED'
    # Import only owned helper definitions from AST. Never dot-source the
    # operational script or call any real Hyper-V/storage/driver command.
    $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($hostScript,[ref]$tokens,[ref]$errors)
    if ($errors.Count) {throw 'HOST_PARSE_FAILED'}
    foreach($path in @($guestScript,(Join-Path $root 'package-r7-isolated-native-test.ps1'))) {
        $tokens=$null;$parseErrors=$null;[Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)|Out-Null
        if ($parseErrors.Count) {throw 'GUEST_OR_PACKAGE_PARSE_FAILED'}
        $checks++
    }
    foreach($functionName in @('Get-ExactOwnedVm','Get-ExactOwnedOsDisk')) {
        $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $functionName},$true)
        if (-not $definition) {throw 'OWNED_HELPER_MISSING'}
        . ([scriptblock]::Create($definition.Extent.Text))
    }
    $ownedVmId=[guid]'a2a2a2a2-1111-4444-8888-a2a2a2a2a2a2';$vmName='R7Native-fixture';$ownedRoot='C:\fixture\owned';$osDisk='C:\fixture\owned\os.vhdx'
    $mockVm=[pscustomobject]@{Name=$vmName;ConfigurationLocation=$ownedRoot}
    function Get-VM {param($Id,$ErrorAction) if ($Id -ne $ownedVmId){throw 'WRONG_GUID_QUERY'};return $mockVm}
    if ((Get-ExactOwnedVm).Name -cne $vmName) {throw 'OWNED_VM_NOT_RETURNED'};$checks++
    $mockVm.ConfigurationLocation='C:\fixture\owned\child';Get-ExactOwnedVm | Out-Null;$checks++
    $mockVm.ConfigurationLocation='C:\fixture\owned-sibling'
    Expect-Refusal {Get-ExactOwnedVm} 'R7_OWNED_VM_IDENTITY_CHANGED'
    $mockVm.ConfigurationLocation=$ownedRoot;$mockVm.Name='UNRELATED'
    Expect-Refusal {Get-ExactOwnedVm} 'R7_OWNED_VM_IDENTITY_CHANGED'
    $mockVhd=[pscustomobject]@{Path=$osDisk;Attached=$true;Size=64GB;DiskNumber=12}
    $mockDisk=[pscustomobject]@{Number=12;IsBoot=$false;IsSystem=$false;Size=64GB;BusType=15}
    function Get-VHD {param($Path,$ErrorAction) if($Path -cne $osDisk){throw 'WRONG_VHD_QUERY'};return $mockVhd}
    function Get-Disk {param($Number,$ErrorAction) if($Number -ne 12){throw 'WRONG_DISK_QUERY'};return $mockDisk}
    Get-ExactOwnedOsDisk | Out-Null;$checks++
    $mockDisk.IsBoot=$true;Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_DISK_IDENTITY_UNPROVEN';$mockDisk.IsBoot=$false
    $mockDisk.IsSystem=$true;Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_DISK_IDENTITY_UNPROVEN';$mockDisk.IsSystem=$false
    $mockDisk.Size=2GB;Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_DISK_IDENTITY_UNPROVEN';$mockDisk.Size=64GB
    $mockDisk.BusType=3;Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_DISK_IDENTITY_UNPROVEN';$mockDisk.BusType=15
    $mockVhd.Path='C:\fixture\unrelated.vhdx';Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_VHD_IDENTITY_CHANGED';$mockVhd.Path=$osDisk
    $mockVhd.Attached=$false;Expect-Refusal {Get-ExactOwnedOsDisk} 'R7_OWNED_VHD_IDENTITY_CHANGED'
    [pscustomobject]@{checks=$checks;failed=0;actualHyperVCommands=0;diskMutations=0;guestStarted=$false;driverLoaded=$false}|ConvertTo-Json -Compress
} finally {foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$saved[$name])}}
