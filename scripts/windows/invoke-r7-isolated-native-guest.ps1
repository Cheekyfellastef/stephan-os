# This script is copied only into a newly created, network-disconnected guest.
# Its caller must use PowerShell Direct with the exact owned VM GUID. It has no
# host path, remote-command, mission, claim, production key or lease interface.
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Prepare','Run')][string]$Phase)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:COMPUTERNAME -cne 'R7NATIVE-LAB' -or -not (Test-Path -LiteralPath 'C:\R7Lab\nonce.txt')) { throw 'R7_GUEST_IDENTITY_REQUIRED' }
$nonce=[IO.File]::ReadAllText('C:\R7Lab\nonce.txt')
if ($nonce -cnotmatch '^[a-f0-9]{64}$') { throw 'R7_GUEST_NONCE_REQUIRED' }
$computer=Get-CimInstance Win32_ComputerSystem
if ($computer.Manufacturer -cne 'Microsoft Corporation' -or $computer.Model -cne 'Virtual Machine') { throw 'R7_GUEST_HYPERV_REQUIRED' }
if (@(Get-NetAdapter -IncludeHidden | Where-Object {$_.HardwareInterface}).Count -ne 0) { throw 'R7_GUEST_NETWORK_ADAPTER_FORBIDDEN' }
$driver='C:\R7Lab\R7NativeQualification.sys'
$client='C:\R7Lab\R7NativeQualificationClient.exe'
# Pins are fixed data from the separately approved hosted invocation; this
# guest file supplies consistency checks, never production authority.
$pins=Get-Content -LiteralPath 'C:\R7Lab\input-pins.json' -Raw | ConvertFrom-Json
$driverUnsignedHash=$pins.unsignedDriverSha256
$clientHash=$pins.clientSha256
if ($driverUnsignedHash -cnotmatch '^[a-f0-9]{64}$' -or $clientHash -cnotmatch '^[a-f0-9]{64}$') {throw 'R7_GUEST_INPUT_PINS_INVALID'}
if ((Get-FileHash -LiteralPath $client -Algorithm SHA256).Hash.ToLowerInvariant() -cne $clientHash) { throw 'R7_GUEST_CLIENT_HASH' }
function Invoke-FixedTool([string]$Name,[string[]]$Arguments) {
    $output=& (Join-Path $env:windir ('System32/'+$Name)) @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('R7_GUEST_TOOL_FAILED_'+$Name+'_'+$LASTEXITCODE) }
    return $output
}
function Write-NewJson([string]$Path,$Value) {
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 12))
    $file=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$file.Write($bytes,0,$bytes.Length);$file.Flush($true)} finally {$file.Dispose()}
}
if ($Phase -ceq 'Prepare') {
    if ((Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant() -cne $driverUnsignedHash -or
        (Get-AuthenticodeSignature -LiteralPath $driver).Status -ne 'NotSigned' -or
        (Test-Path -LiteralPath 'C:\R7Lab\prepared.json')) { throw 'R7_GUEST_FRESH_UNSIGNED_INPUT_REQUIRED' }
    $cert=New-SelfSignedCertificate -Type CodeSigningCert -Subject ('CN=R7 Disposable Test '+$nonce) -CertStoreLocation Cert:\LocalMachine\My -KeyExportPolicy NonExportable -NotAfter ([DateTime]::UtcNow.AddDays(1)) -HashAlgorithm SHA256
    $public=Export-Certificate -Cert $cert -FilePath 'C:\R7Lab\guest-test.cer'
    Import-Certificate -FilePath $public.FullName -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Import-Certificate -FilePath $public.FullName -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
    $signed=Set-AuthenticodeSignature -FilePath $driver -Certificate $cert -HashAlgorithm SHA256
    if ($signed.Status -ne 'Valid' -or $signed.SignerCertificate.Thumbprint -cne $cert.Thumbprint) { throw 'R7_GUEST_TEST_SIGNATURE_FAILED' }
    Invoke-FixedTool bcdedit.exe @('/set','{current}','testsigning','on') | Out-Null
    Invoke-FixedTool verifier.exe @('/standard','/driver','R7NativeQualification.sys') | Out-Null
    Invoke-FixedTool verifier.exe @('/bootmode','oneboot') | Out-Null
    $record=[ordered]@{schemaVersion='stephanos.r7-isolated-guest-prepared.v1';nonce=$nonce;bootUtc=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o');unsignedDriverSha256=$driverUnsignedHash;signedDriverSha256=(Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant();clientSha256=$clientHash;testCertificateThumbprint=$cert.Thumbprint;productionAuthority=$false;leaseChanged=$false}
    Write-NewJson 'C:\R7Lab\prepared.json' $record
    [pscustomobject]$record
    # Reboot is requested by the host separately after this durable record is read.
    return
}
$prepared=Get-Content -LiteralPath 'C:\R7Lab\prepared.json' -Raw | ConvertFrom-Json
$boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
if ($prepared.nonce -cne $nonce -or $boot -ceq $prepared.bootUtc -or
    (Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant() -cne $prepared.signedDriverSha256 -or
    (Get-AuthenticodeSignature -LiteralPath $driver).Status -ne 'Valid' -or
    (Get-AuthenticodeSignature -LiteralPath $driver).SignerCertificate.Thumbprint -cne $prepared.testCertificateThumbprint) { throw 'R7_GUEST_REBOOT_OR_SIGNATURE_UNPROVEN' }
$bcd=Invoke-FixedTool bcdedit.exe @('/enum','{current}')
if (($bcd -join "`n") -notmatch '(?m)^testsigning\s+Yes\s*$') { throw 'R7_GUEST_TEST_MODE_UNPROVEN' }
$verifier=Invoke-FixedTool verifier.exe @('/querysettings')
if (($verifier -join "`n") -notmatch '(?i)R7NativeQualification\.sys') { throw 'R7_GUEST_VERIFIER_TARGET_UNPROVEN' }
if (Test-Path -LiteralPath 'C:\R7Lab\native-attempt.json') { throw 'R7_GUEST_SINGLE_ATTEMPT_ALREADY_CONSUMED' }
Write-NewJson 'C:\R7Lab\native-attempt.json' @{nonce=$nonce;bootUtc=$boot;startedAtUtc=[DateTime]::UtcNow.ToString('o')}
# Create and attach a fresh guest-local data VHD. Diskpart receives only these
# fixed commands; disk selection/formatting uses independently observed identity.
if (Test-Path -LiteralPath 'C:\R7Lab\data.vhd') { throw 'R7_GUEST_DATA_VHD_EXISTS' }
$before=@(Get-Disk | ForEach-Object {$_.Number})
[IO.File]::WriteAllText('C:\R7Lab\create-data.txt',"create vdisk file=`"C:\R7Lab\data.vhd`" maximum=2048 type=expandable`r`nselect vdisk file=`"C:\R7Lab\data.vhd`"`r`nattach vdisk`r`nexit`r`n")
Invoke-FixedTool diskpart.exe @('/s','C:\R7Lab\create-data.txt') | Out-Null
$new=@(Get-Disk | Where-Object {$_.Number -notin $before})
if ($new.Count -ne 1 -or $new[0].IsBoot -or $new[0].IsSystem -or $new[0].PartitionStyle -ne 'RAW' -or $new[0].Size -ne 2GB -or [int]$new[0].BusType -ne 15) { throw 'R7_GUEST_NEW_DATA_DISK_IDENTITY_UNPROVEN' }
$disk=$new[0] | Initialize-Disk -PartitionStyle GPT -PassThru
$partition=$disk | New-Partition -UseMaximumSize -AssignDriveLetter
$volume=$partition | Get-Volume | Format-Volume -FileSystem NTFS -NewFileSystemLabel 'R7_NATIVE_TEST_ONLY' -Confirm:$false
if ($volume.FileSystemLabel -cne 'R7_NATIVE_TEST_ONLY' -or $volume.FileSystem -cne 'NTFS') { throw 'R7_GUEST_NTFS_VOLUME_UNPROVEN' }
$volumeName=[string]$partition.DriveLetter+':'
if (Get-Service -Name R7NativeQualification -ErrorAction SilentlyContinue) { throw 'R7_GUEST_FILTER_SERVICE_ALREADY_EXISTS' }
Invoke-FixedTool sc.exe @('create','R7NativeQualification','type=','filesys','start=','demand','error=','normal','binPath=',$driver,'group=','FSFilter Activity Monitor','depend=','FltMgr') | Out-Null
$instances='HKLM:\SYSTEM\CurrentControlSet\Services\R7NativeQualification\Instances'
New-Item -Path $instances -Force | Out-Null
New-ItemProperty -Path $instances -Name DefaultInstance -Value 'R7NativeQualificationLab' -PropertyType String | Out-Null
$instance=New-Item -Path ($instances+'\R7NativeQualificationLab')
New-ItemProperty -Path $instance.PSPath -Name Altitude -Value '385999.3123' -PropertyType String | Out-Null
New-ItemProperty -Path $instance.PSPath -Name Flags -Value 1 -PropertyType DWord | Out-Null
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class R7LabAttach {
 [DllImport("C:\\Windows\\System32\\fltlib.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
 public static extern int FilterAttachAtAltitude(string filter, string volume, string altitude, string instance, uint length, StringBuilder created);
}
"@
$loaded=$false
try {
    Invoke-FixedTool fltmc.exe @('load','R7NativeQualification') | Out-Null
    $loaded=$true
    $activeVerifier=Invoke-FixedTool verifier.exe @('/query')
    if (($activeVerifier -join "`n") -notmatch '(?i)R7NativeQualification\.sys') {throw 'R7_GUEST_ACTIVE_VERIFIER_UNPROVEN'}
    $name=[Text.StringBuilder]::new(128)
    $hr=[R7LabAttach]::FilterAttachAtAltitude('R7NativeQualification',$volumeName,'385999.3123','R7NativeQualificationLab',128,$name)
    if ($hr -ne 0) { throw ('R7_GUEST_MANUAL_ATTACHMENT_FAILED_'+$hr) }
    # Exactly one invocation. The host bounds this whole call and destroys the
    # owned VM after a hang/crash; it never retries an unknown kernel operation.
    $line=& $client
    if ($LASTEXITCODE -ne 0 -or @($line).Count -ne 1 -or $line -cnotmatch '^R7_NATIVE_QUALIFICATION_RESULT=') { throw 'R7_GUEST_NATIVE_CLIENT_FAILED' }
    $result=$line.Substring('R7_NATIVE_QUALIFICATION_RESULT='.Length) | ConvertFrom-Json
    if ($result.version -ne 1 -or $result.status -cne '00000000' -or $result.completedStages -ne 511 -or $result.causalPassCallbacks -ne 6 -or $result.causalDeniedCallbacks -ne 2 -or $result.testOnly -ne $true -or $result.custodyProven -ne $false -or $result.leaseChanged -ne $false) { throw 'R7_GUEST_CAUSAL_NATIVE_RESULT_INCOMPLETE' }
    Invoke-FixedTool fltmc.exe @('unload','R7NativeQualification') | Out-Null
    $loaded=$false
    $receipt=[ordered]@{schemaVersion='stephanos.r7-isolated-native-smoke.v1';nonce=$nonce;bootUtc=$boot;prepared=$prepared;nativeResult=$result;normalUnloadSucceeded=$true;driverVerifierTarget='R7NativeQualification.sys';productionCustodyProven=$false;leaseChanged=$false;unexercised=@('production-writer-exclusion','namespace','paging-MDL','TxF','allocation-failure','partial-enrolment','unload-races','issuer-revocation','journal-recovery')}
    Write-NewJson 'C:\R7Lab\result.json' $receipt
    [pscustomobject]$receipt
} finally {
    if ($loaded) { Invoke-FixedTool fltmc.exe @('unload','R7NativeQualification') | Out-Null }
}
