[CmdletBinding()]
param(
    [ValidateSet('Watch','Reconcile','Status','ObserveAdmission','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch',
    [int]$PollMilliseconds = 500,
    [int]$ReleaseGraceSeconds = 45,
    [int]$CooldownSeconds = 90,
    [string]$ProcessName = '',
    [string]$ProfileName = ''
)

if ($MyInvocation.InvocationName -ne '.') {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
    $workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
    $stateRoot = Join-Path $workspaceRoot 'vr'
    $statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'
    $overridePath = Join-Path $stateRoot 'gaming-resource-override.json'
    $preparePath = Join-Path $stateRoot 'gaming-resource-prepare.json'
    $profilesPath = Join-Path $stateRoot 'gaming-resource-profiles.json'
    $telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'
    $simAirLinkStatePath = Join-Path $stateRoot 'starfield-vr-sim-air-link.json'
    $lightweightModel = 'llama3.2:3b'
    $script:governorDependencyHealthy = $true
    $script:governorNativeClock = $null
    $script:governorNativeProbeOwnedHold = $false
    $script:governorNativeAttemptDigest = ''
    $script:governorMutationOwner = $null
}

function Get-GovernorNativeMetadataApiV1 {
    # Definition-only import never invokes this. No compiler/metadata child is
    # created: fixed P/Invoke declarations are emitted entirely in this process.
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        if ($identity.ImpersonationLevel -ne [Security.Principal.TokenImpersonationLevel]::None -or
            ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
            [IntPtr]::Size -ne 8 -or -not [Environment]::Is64BitProcess) { throw 'GOVERNOR_NATIVE_CONTEXT_UNPROVEN' }
    } finally { $identity.Dispose() }
    $existing = 'Stephanos.GovernorNativeMetadataV1' -as [type]
    if ($existing) { return $existing }
    $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
        [Reflection.AssemblyName]::new('Stephanos.GovernorNativeMetadataV1'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $builder = $assembly.DefineDynamicModule('Native').DefineType('Stephanos.GovernorNativeMetadataV1',
        [Reflection.TypeAttributes]'Public,Abstract,Sealed')
    $kernel = 'C:\Windows\System32\kernel32.dll'
    $ntdll = 'C:\Windows\System32\ntdll.dll'
    $u32ref = [uint32].MakeByRefType(); $i64ref = [long].MakeByRefType()
    # Every name, library and signature is literal; no caller-selected API.
    $declarations = @(
        @('CreateToolhelp32Snapshot',$kernel,[IntPtr],[type[]]@([uint32],[uint32])),
        @('Process32FirstW',$kernel,[bool],[type[]]@([IntPtr],[IntPtr])),
        @('Process32NextW',$kernel,[bool],[type[]]@([IntPtr],[IntPtr])),
        @('OpenProcess',$kernel,[IntPtr],[type[]]@([uint32],[bool],[uint32])),
        @('GetProcessTimes',$kernel,[bool],[type[]]@([IntPtr],$i64ref,$i64ref,$i64ref,$i64ref)),
        @('QueryFullProcessImageNameW',$kernel,[bool],[type[]]@([IntPtr],[uint32],[Text.StringBuilder],$u32ref)),
        @('WaitForSingleObject',$kernel,[uint32],[type[]]@([IntPtr],[uint32])),
        @('GetProcessId',$kernel,[uint32],[type[]]@([IntPtr])),
        @('GetCurrentProcess',$kernel,[IntPtr],[type[]]@()),
        @('GetCurrentProcessId',$kernel,[uint32],[type[]]@()),
        @('CloseHandle',$kernel,[bool],[type[]]@([IntPtr])),
        @('CreateFileW',$kernel,[IntPtr],[type[]]@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr])),
        @('GetFileInformationByHandle',$kernel,[bool],[type[]]@([IntPtr],[IntPtr])),
        @('GetFinalPathNameByHandleW',$kernel,[uint32],[type[]]@([IntPtr],[Text.StringBuilder],[uint32],[uint32])),
        @('NtQueryInformationProcess',$ntdll,[int],[type[]]@([IntPtr],[int],[IntPtr],[uint32],$u32ref)),
        @('NtQuerySystemInformation',$ntdll,[int],[type[]]@([int],[IntPtr],[uint32],$u32ref))
    )
    foreach ($row in $declarations) {
        $method = $builder.DefinePInvokeMethod($row[0],$row[1],$row[0],
            [Reflection.MethodAttributes]'Public,Static,PinvokeImpl',[Reflection.CallingConventions]::Standard,
            $row[2],$row[3],[Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Unicode)
        $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
        $attribute = [Runtime.InteropServices.DllImportAttribute]
        $fields = [Reflection.FieldInfo[]]@($attribute.GetField('SetLastError'),$attribute.GetField('ExactSpelling'),$attribute.GetField('CharSet'),$attribute.GetField('CallingConvention'))
        $method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new(
            $attribute.GetConstructor([type[]]@([string])),[object[]]@($row[1]),$fields,[object[]]@($true,$true,[Runtime.InteropServices.CharSet]::Unicode,[Runtime.InteropServices.CallingConvention]::Winapi)))
    }
    return $builder.CreateType()
}

function Assert-GovernorRecoveryDeadlineV1 {
    param($Clock)
    $elapsed = $Clock.Elapsed.TotalMilliseconds
    if ($elapsed -isnot [double] -or [double]::IsNaN($elapsed) -or [double]::IsInfinity($elapsed) -or
        $elapsed -lt $script:governorRecoveryLastElapsed -or $elapsed -gt 5000) { throw 'GOVERNOR_RECOVERY_OBSERVATION_UNPROVEN' }
    $script:governorRecoveryLastElapsed = $elapsed
}

function Get-GovernorNativeEpochV1 {
    $api = Get-GovernorNativeMetadataApiV1
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal(32)
    try {
        for ($i=0;$i -lt 32;$i+=8) { [Runtime.InteropServices.Marshal]::WriteInt64($buffer,$i,0) }
        [uint32]$returned=0
        # Fixed x64 SYSTEM_BOOT_ENVIRONMENT_INFORMATION, opaque boot GUID only.
        # phnt ntexapi.h@53fbbdc5b5d2b08761db1c7b26bfa8c820924356: class90.
        if ($api::NtQuerySystemInformation(90,$buffer,32,[ref]$returned) -ne 0 -or $returned -ne 32 -or
            [Runtime.InteropServices.Marshal]::ReadInt32($buffer,16) -notin @(1,2)) { throw 'GOVERNOR_NATIVE_BOOT_UNPROVEN' }
        $bytes = New-Object byte[] 16
        [Runtime.InteropServices.Marshal]::Copy($buffer,$bytes,0,16)
        $boot = [Guid]::new($bytes)
        if ($boot -eq [Guid]::Empty) { throw 'GOVERNOR_NATIVE_BOOT_UNPROVEN' }
        $machine = [Microsoft.Win32.Registry]::GetValue('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography','MachineGuid',$null)
        [Guid]$machineGuid=[Guid]::Empty
        if ($machine -isnot [string] -or -not [Guid]::TryParse($machine,[ref]$machineGuid) -or $machineGuid -eq [Guid]::Empty) { throw 'GOVERNOR_NATIVE_BOOT_UNPROVEN' }
        $sha=[Security.Cryptography.SHA256]::Create()
        try { $machineHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($machine.ToLowerInvariant())))).Replace('-','').ToLowerInvariant() }
        finally { $sha.Dispose() }
        [long]$born=0;[long]$exited=0;[long]$kernel=0;[long]$user=0
        if (-not $api::GetProcessTimes($api::GetCurrentProcess(),[ref]$born,[ref]$exited,[ref]$kernel,[ref]$user) -or $born -le 0 -or
            $api::GetCurrentProcessId() -ne $PID) { throw 'GOVERNOR_NATIVE_OWNER_UNPROVEN' }
        return [pscustomobject]@{machineHash=$machineHash;bootIdentifier=$boot.ToString('N');ownerProcessId=$PID;ownerCreationFileTime=$born}
    } finally { for ($i=0;$i -lt 32;$i+=8) { [Runtime.InteropServices.Marshal]::WriteInt64($buffer,$i,0) };[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
}

function Assert-GovernorNativeEpochV1 {
    param($Epoch)
    if($null -eq $Epoch -or $Epoch.GetType().FullName -cne 'System.Management.Automation.PSCustomObject' -or
        (($Epoch.PSObject.Properties.Name|Sort-Object) -join ',') -cne 'bootIdentifier,machineHash,ownerCreationFileTime,ownerProcessId' -or
        $Epoch.machineHash -isnot [string] -or $Epoch.machineHash -cnotmatch '^[a-f0-9]{64}$' -or
        $Epoch.bootIdentifier -isnot [string] -or $Epoch.bootIdentifier -cnotmatch '^[a-f0-9]{32}$' -or $Epoch.bootIdentifier -ceq ('0'*32) -or
        ($Epoch.ownerProcessId -isnot [int] -and $Epoch.ownerProcessId -isnot [long]) -or $Epoch.ownerProcessId -ne $PID -or
        $Epoch.ownerCreationFileTime -isnot [long] -or $Epoch.ownerCreationFileTime -le 0 -or $Epoch.ownerCreationFileTime -gt [DateTime]::UtcNow.ToFileTimeUtc()){
        throw 'GOVERNOR_NATIVE_OWNER_UNPROVEN'
    }
}

function Get-GovernorProbeCandidatesV1 {
    param($Clock)
    $api=Get-GovernorNativeMetadataApiV1
    Assert-GovernorRecoveryDeadlineV1 $Clock
    $snapshot=$api::CreateToolhelp32Snapshot(2,0)
    if ($snapshot -eq [IntPtr]::Zero -or $snapshot -eq [IntPtr](-1)) { throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN' }
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(568)
    try {
        for($i=0;$i -lt 568;$i+=8){[Runtime.InteropServices.Marshal]::WriteInt64($buffer,$i,0)}
        [Runtime.InteropServices.Marshal]::WriteInt32($buffer,568)
        $more=$api::Process32FirstW($snapshot,$buffer)
        if(-not $more){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
        $rows=@();$seen=@{};$count=0;$self=$false
        while($more){
            Assert-GovernorRecoveryDeadlineV1 $Clock
            if(++$count -gt 4096 -or [Runtime.InteropServices.Marshal]::ReadInt32($buffer) -ne 568){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
            $pidValue=[uint32][Runtime.InteropServices.Marshal]::ReadInt32($buffer,8)
            $name=[Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($buffer,44),260)
            $end=$name.IndexOf([char]0)
            if($end -lt 1 -or $seen.ContainsKey([string]$pidValue)){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
            $name=$name.Substring(0,$end)
            if($name -match '[\x00-\x1f\x7f\\/:]'){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
            $seen[[string]$pidValue]=$true
            if($pidValue -eq $PID){
                $self=$name -ieq 'powershell.exe'
                if(-not $self){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
            }
            if($name -ieq 'nvidia-smi.exe' -or $name -ieq 'ollama.exe'){
                if($pidValue -eq 0 -or $rows.Count -ge 64){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
                $rows+=,[pscustomobject]@{processId=$pidValue;name=$name.ToLowerInvariant()}
            }
            $more=$api::Process32NextW($snapshot,$buffer)
            if(-not $more -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 18){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
        }
        if(-not $self){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
        Assert-GovernorRecoveryDeadlineV1 $Clock
        return @($rows | Sort-Object processId)
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
        if(-not $api::CloseHandle($snapshot)){throw 'GOVERNOR_RECOVERY_CENSUS_UNPROVEN'}
    }
}

function Read-GovernorNativeCommandV1 {
    param([IntPtr]$Handle)
    $api=Get-GovernorNativeMetadataApiV1
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(65536)
    try {
        for($i=0;$i -lt 65536;$i+=8){[Runtime.InteropServices.Marshal]::WriteInt64($buffer,$i,0)}
        [uint32]$actual=0
        if($api::NtQueryInformationProcess($Handle,60,$buffer,65536,[ref]$actual) -ne 0 -or $actual -lt 16 -or $actual -gt 65536){throw 'GOVERNOR_RECOVERY_COMMAND_UNPROVEN'}
        $length=[uint16][Runtime.InteropServices.Marshal]::ReadInt16($buffer)
        $maximum=[uint16][Runtime.InteropServices.Marshal]::ReadInt16($buffer,2)
        $start=[uint64]$buffer.ToInt64();$pointer=[uint64][Runtime.InteropServices.Marshal]::ReadIntPtr($buffer,8).ToInt64()
        if($length -lt 2 -or ($length % 2) -ne 0 -or ($maximum % 2) -ne 0 -or $length -gt $maximum -or
            [Runtime.InteropServices.Marshal]::ReadInt32($buffer,4) -ne 0 -or $start -gt ([uint64]::MaxValue-$actual) -or
            $pointer -lt ($start+16) -or $pointer -gt ($start+$actual) -or $maximum -gt ($start+$actual-$pointer)) {throw 'GOVERNOR_RECOVERY_COMMAND_UNPROVEN'}
        $bytes=New-Object byte[] $length
        [Runtime.InteropServices.Marshal]::Copy([IntPtr]([long]$pointer),$bytes,0,$length)
        $command=[Text.UnicodeEncoding]::new($false,$false,$true).GetString($bytes)
        if([string]::IsNullOrWhiteSpace($command) -or $command.IndexOf([char]0) -ge 0){throw 'GOVERNOR_RECOVERY_COMMAND_UNPROVEN'}
        return $command
    } finally {
        if($null -ne (Get-Variable bytes -ErrorAction SilentlyContinue)){[Array]::Clear($bytes,0,$bytes.Length)}
        for($i=0;$i -lt 65536;$i+=8){[Runtime.InteropServices.Marshal]::WriteInt64($buffer,$i,0)}
        [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
}

function Assert-GovernorServePinV1 {
    param($Pin)
    $api=Get-GovernorNativeMetadataApiV1
    [long]$birth=0;[long]$exitTime=0;[long]$kernel=0;[long]$user=0
    $image=[Text.StringBuilder]::new(1024);[uint32]$size=1024
    if($api::GetProcessId($Pin.handle) -ne $Pin.processId -or $api::WaitForSingleObject($Pin.handle,0) -ne 258 -or
        -not $api::GetProcessTimes($Pin.handle,[ref]$birth,[ref]$exitTime,[ref]$kernel,[ref]$user) -or $birth -le 0 -or
        ($Pin.birth -ne 0 -and $Pin.birth -ne $birth) -or
        -not $api::QueryFullProcessImageNameW($Pin.handle,0,$image,[ref]$size) -or $size -lt 1 -or $size -ge 1024){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
    $allowed=@((Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),(Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe'))
    $path=$image.ToString()
    if($path -inotmatch '\\ollama\.exe$' -or $allowed -inotcontains $path -or ($Pin.image -and $Pin.image -ine $path)){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
    $command=Read-GovernorNativeCommandV1 $Pin.handle
    if($command -cne ('"'+$path+'" serve') -and $command -cne ($path+' serve')){throw 'GOVERNOR_RECOVERY_ACTIVE_PROBE'}
    if($Pin.command -and $Pin.command -cne $command){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
    $Pin.birth=$birth;$Pin.image=$path;$Pin.command=$command
}

function Get-GovernorBytesDigestV1 {
    param([byte[]]$Bytes)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}
    finally{$sha.Dispose()}
}

function Get-GovernorPinnedFileInfoV1 {
    param([IntPtr]$Handle)
    $api=Get-GovernorNativeMetadataApiV1
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(52)
    try{
        if(-not $api::GetFileInformationByHandle($Handle,$buffer)){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        $attributes=[Runtime.InteropServices.Marshal]::ReadInt32($buffer)
        if(($attributes -band 0x400) -ne 0){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        return [pscustomobject]@{attributes=$attributes;links=[Runtime.InteropServices.Marshal]::ReadInt32($buffer,40);
            high=[uint32][Runtime.InteropServices.Marshal]::ReadInt32($buffer,32);low=[uint32][Runtime.InteropServices.Marshal]::ReadInt32($buffer,36)}
    }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
}

function Open-GovernorRecoveryParentPinsV1 {
    param([string]$Directory)
    $api=Get-GovernorNativeMetadataApiV1
    $pins=@();$path=[IO.Path]::GetFullPath($Directory)
    try{
        for($count=0;$count -lt 32;$count++){
            # Attribute read, no write/delete authority; share neither rename
            # nor deletion while original/archive paths are used.
            $handle=$api::CreateFileW($path,0x80,3,[IntPtr]::Zero,3,0x02200000,[IntPtr]::Zero)
            if($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
            $pins+=,$handle
            $info=Get-GovernorPinnedFileInfoV1 $handle
            if(($info.attributes -band 0x10) -eq 0){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
            $parent=[IO.Path]::GetDirectoryName($path)
            if(-not $parent -or $parent -eq $path){return @($pins)}
            $path=$parent
        }
        throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'
    }catch{foreach($pin in $pins){[void]$api::CloseHandle($pin)};throw}
}

function Assert-GovernorRecoveryStateHandleV1 {
    param($Stream)
    $api=Get-GovernorNativeMetadataApiV1
    $handle=$Stream.SafeFileHandle.DangerousGetHandle()
    $info=Get-GovernorPinnedFileInfoV1 $handle
    $path=[Text.StringBuilder]::new(1024)
    $length=$api::GetFinalPathNameByHandleW($handle,$path,1024,0)
    if($length -lt 1 -or $length -ge 1024 -or $path.ToString() -ine ('\\?\'+[IO.Path]::GetFullPath($statePath)) -or
        ($info.attributes -band 0x10) -ne 0 -or $info.links -ne 1 -or $info.high -ne 0 -or $info.low -lt 2 -or $info.low -gt 32768 -or
        $Stream.Length -ne $info.low){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
}

function Invoke-GovernorHeldProbeRecoveryV1 {
    Assert-GovernorMutationOwner
    $script:governorRecoveryLastElapsed=0.0
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $pins=@();$parentPins=@();$stream=$null;$api=$null
    try {
        $epoch=Get-GovernorNativeEpochV1
        Assert-GovernorNativeEpochV1 $epoch
        $api=Get-GovernorNativeMetadataApiV1
        $parentPins=@(Open-GovernorRecoveryParentPinsV1 $stateRoot)
        $info=Get-Item -LiteralPath $statePath -ErrorAction Stop
        if($info.PSIsContainer -or $info.Length -lt 2 -or $info.Length -gt 32768 -or
            ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        $stream=[IO.FileStream]::new($statePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        Assert-GovernorRecoveryStateHandleV1 $stream
        $original=New-Object byte[] ([int]$stream.Length)
        if($stream.Read($original,0,$original.Length) -ne $original.Length -or $stream.ReadByte() -ne -1){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        $state=[Text.UTF8Encoding]::new($false,$true).GetString($original)|ConvertFrom-Json -ErrorAction Stop
        if($state.schemaVersion -cne 'stephanos.vr-resource-governor.v1' -or $state.governorVersion -ne 3 -or
            $state.nativeProbeCustodyHeld -isnot [bool] -or $state.nativeProbeCustodyHeld -ne $true){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        if($state.PSObject.Properties['nativeProbeAttempt']){
            $attempt=$state.nativeProbeAttempt
            if($null -eq $attempt -or $attempt.GetType().FullName -cne 'System.Management.Automation.PSCustomObject' -or
                (($attempt.PSObject.Properties.Name|Sort-Object) -join ',') -cne 'attemptId,bootIdentifier,commandSha256,machineHash,operation,ownerCreationFileTime,ownerProcessId,phase,preparedAtUtc,schemaVersion' -or
                $attempt.schemaVersion -cne 'stephanos.governor-probe-attempt.v1' -or $attempt.attemptId -cnotmatch '^[a-f0-9]{32}$' -or
                @('schemaVersion','attemptId','operation','commandSha256','phase','machineHash','bootIdentifier','preparedAtUtc').Where({$attempt.$_ -isnot [string]}).Count -ne 0 -or
                $attempt.commandSha256 -cnotmatch '^[a-f0-9]{64}$' -or
                $attempt.operation -cnotin @('GpuSnapshot','OllamaInventory','OllamaStop','GovernorRecycle','OwnerAbandoned') -or
                $attempt.phase -cnotin @('PREPARING','BOUND') -or ($attempt.ownerProcessId -isnot [int] -and $attempt.ownerProcessId -isnot [long]) -or $attempt.ownerProcessId -le 0 -or
                ($attempt.ownerCreationFileTime -isnot [int] -and $attempt.ownerCreationFileTime -isnot [long]) -or
                $attempt.preparedAtUtc -cnotmatch 'Z$' -or
                ($attempt.phase -ceq 'PREPARING' -and ($attempt.machineHash -cne 'UNOBSERVED' -or $attempt.bootIdentifier -cne 'UNOBSERVED' -or $attempt.ownerCreationFileTime -ne 0)) -or
                ($attempt.phase -ceq 'BOUND' -and ($attempt.machineHash -cnotmatch '^[a-f0-9]{64}$' -or $attempt.bootIdentifier -cnotmatch '^[a-f0-9]{32}$' -or $attempt.ownerCreationFileTime -le 0))){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        }
        $digest=Get-GovernorBytesDigestV1 $original
        $first=@(Get-GovernorProbeCandidatesV1 $clock)
        $api=Get-GovernorNativeMetadataApiV1
        foreach($row in $first){
            if($row.name -cne 'ollama.exe'){throw 'GOVERNOR_RECOVERY_ACTIVE_PROBE'}
            $handle=$api::OpenProcess(0x101000,$false,$row.processId)
            if($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
            $pin=[pscustomobject]@{handle=$handle;processId=$row.processId;birth=[long]0;image='';command='';file=$null;hash=''}
            $pins+=,$pin
            Assert-GovernorServePinV1 $pin
            $fileInfo=Get-Item -LiteralPath $pin.image -ErrorAction Stop
            if($fileInfo.PSIsContainer -or $fileInfo.Length -lt 1 -or $fileInfo.Length -gt 134217728 -or $fileInfo.LastWriteTimeUtc.ToFileTimeUtc() -gt $pin.birth -or
                ($fileInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
            $pin.file=[IO.FileStream]::new($pin.image,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
            $sha=[Security.Cryptography.SHA256]::Create()
            try{$pin.hash=([BitConverter]::ToString($sha.ComputeHash($pin.file))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
            # Actual 0.40.14 Ollama Inc image independently observed 2026-11-18.
            # This pin restricts legacy serve exclusion only; no online trust or
            # revocation request can stall the existing watcher.
            if($pin.hash -cne '4ccefcbfecc50fb6526471adabbc20869dd614e29e351120b15083cb174b0b8a'){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
            Assert-GovernorRecoveryDeadlineV1 $clock
        }
        $second=@(Get-GovernorProbeCandidatesV1 $clock)
        if(($first|ConvertTo-Json -Compress) -cne ($second|ConvertTo-Json -Compress)){throw 'GOVERNOR_RECOVERY_CENSUS_CHANGED'}
        foreach($pin in $pins){
            Assert-GovernorServePinV1 $pin
            $pin.file.Position=0;$sha=[Security.Cryptography.SHA256]::Create()
            try{if($pin.hash -cne ([BitConverter]::ToString($sha.ComputeHash($pin.file))).Replace('-','').ToLowerInvariant()){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}}finally{$sha.Dispose()}
        }
        $currentEpoch=Get-GovernorNativeEpochV1
        Assert-GovernorNativeEpochV1 $currentEpoch
        if(($epoch|ConvertTo-Json -Compress) -cne ($currentEpoch|ConvertTo-Json -Compress)){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
        Assert-GovernorMutationOwner
        Assert-GovernorRecoveryDeadlineV1 $clock
        $stream.Position=0;$check=New-Object byte[] ([int]$stream.Length)
        if($stream.Read($check,0,$check.Length) -ne $check.Length -or (Get-GovernorBytesDigestV1 $check) -cne $digest){throw 'GOVERNOR_RECOVERY_STATE_CHANGED'}
        $archive=Join-Path $stateRoot 'governor-custody-recovery'
        if(Test-Path -LiteralPath $archive){if((Get-Item -LiteralPath $archive).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'GOVERNOR_RECOVERY_ARCHIVE_UNPROVEN'}}
        else{[void][IO.Directory]::CreateDirectory($archive)}
        $parentPins+=@(Open-GovernorRecoveryParentPinsV1 $archive)
        $receipt=[ordered]@{schemaVersion='stephanos.governor-probe-custody-recovery.v1';originalSha256=$digest;originalBytesBase64=[Convert]::ToBase64String($original);
            epoch=$epoch;historicalOutcome='UNKNOWN';exclusion='CURRENT_CLOSED_PROBE_DOMAIN_EXCLUDED';observedServeCount=$pins.Count;
            phase='ORIGINAL_ARCHIVED';restrictionRetired=$false;observedAtUtc=[DateTime]::UtcNow.ToString('o');localModelAllowed=$false;heavyModelAllowed=$false;dependencyObservationKnown=$false;sourceMutationAllowed=$false}
        $receiptPath=Join-Path $archive ($digest+'-'+[Guid]::NewGuid().ToString('N')+'.json')
        $receiptBytes=[Text.UTF8Encoding]::new($false).GetBytes(($receipt|ConvertTo-Json -Depth 8 -Compress))
        $audit=[IO.FileStream]::new($receiptPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$audit.Write($receiptBytes,0,$receiptBytes.Length);$audit.Flush($true)}finally{$audit.Dispose()}
        $final=@(Get-GovernorProbeCandidatesV1 $clock)
        if(($first|ConvertTo-Json -Compress) -cne ($final|ConvertTo-Json -Compress)){throw 'GOVERNOR_RECOVERY_CENSUS_CHANGED'}
        foreach($pin in $pins){Assert-GovernorServePinV1 $pin}
        $finalEpoch=Get-GovernorNativeEpochV1
        Assert-GovernorNativeEpochV1 $finalEpoch
        if(($epoch|ConvertTo-Json -Compress) -cne ($finalEpoch|ConvertTo-Json -Compress)){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
        Assert-GovernorRecoveryStateHandleV1 $stream
        $stream.Position=0;$check=New-Object byte[] ([int]$stream.Length)
        if($stream.Read($check,0,$check.Length) -ne $check.Length -or (Get-GovernorBytesDigestV1 $check) -cne $digest){throw 'GOVERNOR_RECOVERY_STATE_CHANGED'}
        foreach($pin in $pins){
            $pin.file.Dispose();$pin.file=$null
            if(-not $api::CloseHandle($pin.handle)){throw 'GOVERNOR_RECOVERY_IDENTITY_UNPROVEN'}
            $pin.handle=[IntPtr]::Zero
        }
        Assert-GovernorRecoveryDeadlineV1 $clock
        foreach($pair in @(@('nativeProbeCustodyHeld',$false),@('heavyModelAllowed',$false),@('localModelAllowed',$false),@('evictionHealthy',$false),@('zeroLocalModelInvariant',$false),@('dependencyObservationKnown',$false),@('ollamaLoadMode','unknown'),@('nativeProbeRecoveryReceiptSha256',(Get-GovernorBytesDigestV1 $receiptBytes)))){
            $state|Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1] -Force
        }
        $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($state|ConvertTo-Json -Depth 10))
        if($bytes.Length -lt 2 -or $bytes.Length -gt 32768){throw 'GOVERNOR_RECOVERY_STATE_UNPROVEN'}
        $stream.Position=0;$stream.Write($bytes,0,$bytes.Length);$stream.SetLength($bytes.Length);$stream.Flush($true)
        return $true
    } catch {return $false}
    finally{
        foreach($pin in $pins){if($pin.file){$pin.file.Dispose()};if($pin.handle -ne [IntPtr]::Zero){[void]$api::CloseHandle($pin.handle)}}
        if($stream){$stream.Dispose()}
        if($api){foreach($pin in $parentPins){[void]$api::CloseHandle($pin)}}
    }
}

# One cross-process owner for the existing governor, including caretaker
# replacement. The name and protected DACL derive only from the actual user.
function New-GovernorMutationMutex {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $userSid = $identity.User } finally { $identity.Dispose() }
    if ($userSid.Value -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$') { throw 'GOVERNOR_MUTEX_IDENTITY_UNPROVEN' }
    $security = [Security.AccessControl.MutexSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($userSid)
    foreach ($sid in @($userSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid,
            [Security.AccessControl.MutexRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    }
    $created = $false
    $mutex = [Threading.Mutex]::new($false, ('Global\Stephanos.VrResourceGovernor.V1.' + $userSid.Value), [ref]$created, $security)
    try {
        $actual = $mutex.GetAccessControl()
        $rules = @($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        if (-not $actual.AreAccessRulesProtected -or -not $actual.AreAccessRulesCanonical -or
            $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $userSid.Value -or $rules.Count -ne 2) { throw 'GOVERNOR_MUTEX_SECURITY_UNPROVEN' }
        foreach ($rule in $rules) {
            if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
                $rule.MutexRights -ne [Security.AccessControl.MutexRights]::FullControl -or
                $rule.IdentityReference.Value -notin @($userSid.Value,'S-1-5-18')) { throw 'GOVERNOR_MUTEX_SECURITY_UNPROVEN' }
        }
        return $mutex
    } catch { $mutex.Dispose(); throw }
}

function Enter-GovernorMutationOwner {
    $mutex = New-GovernorMutationMutex
    $acquired = $false; $abandoned = $false
    try {
        try { $acquired = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $acquired = $true; $abandoned = $true }
        if (-not $acquired) { $mutex.Dispose(); return [pscustomobject]@{ acquired = $false; abandoned = $false; mutex = $null } }
        return [pscustomobject]@{ acquired = $true; abandoned = $abandoned; mutex = $mutex }
    } catch { $mutex.Dispose(); throw }
}

function Exit-GovernorMutationOwner {
    param($Owner)
    if ($Owner -and $Owner.acquired) {
        try { $Owner.mutex.ReleaseMutex(); $Owner.acquired = $false }
        finally { $Owner.mutex.Dispose() }
    }
}

function Assert-GovernorMutationOwner {
    param([switch]$AllowAbandoned)
    if (-not $script:governorMutationOwner -or -not $script:governorMutationOwner.acquired -or
        ($script:governorMutationOwner.abandoned -and -not $AllowAbandoned)) { throw 'GOVERNOR_MUTATION_OWNER_UNPROVEN' }
}

# Closed native probes only. Keep both pipes bounded and drained while the
# retained direct child runs; neither a timeout nor a failed inventory is empty.
function Invoke-GovernorNativeProbe {
    param([ValidateSet('GpuSnapshot','OllamaInventory','OllamaStop')][string]$Operation, [string]$Model = '')
    Assert-GovernorMutationOwner
    $executable = ''
    $arguments = ''
    if ($Operation -eq 'GpuSnapshot') {
        $command = Get-Command nvidia-smi.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { $executable = [string]$command.Source }
        $arguments = '--query-gpu=memory.free,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits'
    } else {
        $executable = Resolve-OllamaExecutable
        if ($Operation -eq 'OllamaInventory') { $arguments = 'ps' }
        else {
            if ($Model -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$') {
                return [pscustomobject]@{ ok = $false; output = ''; reason = 'MODEL_IDENTITY_INVALID' }
            }
            $arguments = 'stop ' + $Model
        }
    }
    if (-not $executable) { return [pscustomobject]@{ ok = $false; output = ''; reason = 'EXECUTABLE_UNAVAILABLE' } }
    $remaining = if ($script:governorNativeClock) { [int][math]::Min(1000, 5000 - $script:governorNativeClock.Elapsed.TotalMilliseconds) } else { 0 }
    if ($remaining -le 0) { return [pscustomobject]@{ ok = $false; output = ''; reason = 'CYCLE_DEADLINE' } }
    # Persist exclusion before launch. A crash or cleanup API failure cannot
    # leave an uncertain child behind an apparently healthy permission record.
    $commandSha256=Get-GovernorBytesDigestV1 ([Text.Encoding]::UTF8.GetBytes($Operation+[char]0+$executable+[char]0+$arguments))
    Set-GovernorNativeCustodyHold -Held $true -Operation $Operation -CommandSha256 $commandSha256
    $script:governorNativeProbeExitProven = $false
    $child = New-Object System.Diagnostics.Process
    $started = $false
    $startAttempted = $false
    $reason = 'PROBE_FAILED'
    try {
        $child.StartInfo.FileName = $executable
        $child.StartInfo.Arguments = $arguments
        $child.StartInfo.UseShellExecute = $false
        $child.StartInfo.CreateNoWindow = $true
        $child.StartInfo.RedirectStandardOutput = $true
        $child.StartInfo.RedirectStandardError = $true
        # Binding/epoch/state IO is inside this same cycle. Never spend the
        # earlier timeout after those operations have consumed its budget.
        $remaining = if ($script:governorNativeClock) { [int][math]::Min(1000, 5000 - $script:governorNativeClock.Elapsed.TotalMilliseconds) } else { 0 }
        if ($remaining -le 0) {
            $reason='CYCLE_DEADLINE'
            return [pscustomobject]@{ok=$false;output='';reason=$reason}
        }
        # Start/setup consume the same per-probe and cycle allowance. The
        # retained-child cleanup below remains mandatory after a late Start.
        $probeClock = [Diagnostics.Stopwatch]::StartNew()
        $startAttempted = $true
        $started = $child.Start()
        if (-not $started) { throw 'PROBE_START_FAILED' }
        if ($probeClock.Elapsed.TotalMilliseconds -ge $remaining -or
            $script:governorNativeClock.Elapsed.TotalMilliseconds -ge 5000) {
            $reason='PROBE_TIMEOUT'
            return [pscustomobject]@{ok=$false;output='';reason=$reason}
        }
        $outBuffer = New-Object char[] 4097
        $errBuffer = New-Object char[] 4097
        $outTask = $child.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
        $errTask = $child.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
        $outText = New-Object Text.StringBuilder
        $outDone = $false; $errDone = $false; $total = 0
        while ($probeClock.Elapsed.TotalMilliseconds -lt $remaining -and
            $script:governorNativeClock.Elapsed.TotalMilliseconds -lt 5000) {
            if (-not $outDone -and $outTask.IsCompleted) {
                $count = $outTask.GetAwaiter().GetResult(); $total += $count
                if ($total -gt 32768) { $reason = 'OUTPUT_LIMIT'; break }
                if ($count -eq 0) { $outDone = $true }
                else { [void]$outText.Append($outBuffer, 0, $count); $outTask = $child.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length) }
            }
            if (-not $errDone -and $errTask.IsCompleted) {
                $count = $errTask.GetAwaiter().GetResult(); $total += $count
                if ($total -gt 32768) { $reason = 'OUTPUT_LIMIT'; break }
                if ($count -eq 0) { $errDone = $true }
                else { $errTask = $child.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length) }
            }
            if ($child.HasExited -and $outDone -and $errDone) {
                if ($probeClock.Elapsed.TotalMilliseconds -ge $remaining -or
                    $script:governorNativeClock.Elapsed.TotalMilliseconds -ge 5000) { $reason='PROBE_TIMEOUT';break }
                if ($child.ExitCode -ne 0) { $reason = 'NONZERO_EXIT'; break }
                return [pscustomobject]@{ ok = $true; output = $outText.ToString(); reason = '' }
            }
            [void]$child.WaitForExit(10)
        }
        if ($reason -eq 'PROBE_FAILED') { $reason = 'PROBE_TIMEOUT' }
    } catch { $reason = 'PROBE_FAILED' }
    finally {
        $exitProven = -not $startAttempted
        if ($startAttempted) {
            try { $exitProven = $child.HasExited } catch {}
            if (-not $exitProven) {
                try { $child.Kill() } catch {}
                try { $exitProven = $child.WaitForExit(500) } catch {}
            }
        }
        if (-not $exitProven) {
            try { Set-GovernorNativeCustodyHold -Held $true } catch {}
            try { $child.Dispose() } catch {}
            throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
        }
        $child.Dispose()
        $script:governorNativeProbeExitProven = $true
        try { Set-GovernorNativeCustodyHold -Held $false }
        catch { throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN' }
    }
    return [pscustomobject]@{ ok = $false; output = ''; reason = $reason }
}

function Set-GovernorNativeCustodyHold {
    param([bool]$Held = $true, [ValidateSet('GpuSnapshot','OllamaInventory','OllamaStop','GovernorRecycle','OwnerAbandoned')][string]$Operation='OwnerAbandoned',
        [ValidatePattern('^[a-f0-9]{64}$')][string]$CommandSha256=('0'*64))
    Assert-GovernorMutationOwner -AllowAbandoned:$Held
    $heldState = Read-GovernorState
    if ($Held -and -not $script:governorNativeProbeOwnedHold -and $heldState -and
        $heldState.PSObject.Properties['nativeProbeCustodyHeld'] -and
        ($heldState.nativeProbeCustodyHeld -isnot [bool] -or $heldState.nativeProbeCustodyHeld -ne $false)) {
        throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
    }
    if (-not $heldState -or $heldState -isnot [pscustomobject]) {
        $heldState = [pscustomobject]@{ schemaVersion = 'stephanos.vr-resource-governor.v1'; governorVersion = 3; phase = 'UNKNOWN'; active = $true }
    }
    if (-not $Held) {
        if (-not $script:governorNativeProbeOwnedHold -or
            -not (Get-Variable -Name governorNativeProbeExitProven -Scope Script -ErrorAction SilentlyContinue) -or
            $script:governorNativeProbeExitProven -ne $true -or
            -not $heldState.PSObject.Properties['nativeProbeAttempt'] -or
            (Get-GovernorBytesDigestV1 ([Text.UTF8Encoding]::new($false).GetBytes(($heldState.nativeProbeAttempt|ConvertTo-Json -Depth 8 -Compress)))) -cne $script:governorNativeAttemptDigest) {
            throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
        }
        $epoch=Get-GovernorNativeEpochV1
        Assert-GovernorNativeEpochV1 $epoch
        if($heldState.nativeProbeAttempt.machineHash -cne $epoch.machineHash -or $heldState.nativeProbeAttempt.bootIdentifier -cne $epoch.bootIdentifier -or
            $heldState.nativeProbeAttempt.ownerProcessId -ne $epoch.ownerProcessId -or $heldState.nativeProbeAttempt.ownerCreationFileTime -ne $epoch.ownerCreationFileTime){throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'}
    } elseif (-not $script:governorNativeProbeOwnedHold) {
        # Restrict first, then bind actual native identity before any launch.
        # A failed observation leaves PREPARING/UNOBSERVED custody restrictive.
        $attempt=[ordered]@{schemaVersion='stephanos.governor-probe-attempt.v1';attemptId=[Guid]::NewGuid().ToString('N');operation=$Operation;commandSha256=$CommandSha256;
            phase='PREPARING';ownerProcessId=$PID;ownerCreationFileTime=[long]0;machineHash='UNOBSERVED';bootIdentifier='UNOBSERVED';preparedAtUtc=[DateTime]::UtcNow.ToString('o')}
        $heldState|Add-Member -NotePropertyName nativeProbeAttempt -NotePropertyValue ([pscustomobject]$attempt) -Force
    }
    foreach ($pair in @(@('nativeProbeCustodyHeld',$Held),@('heavyModelAllowed',$false),@('localModelAllowed',$false),@('evictionHealthy',$false),@('zeroLocalModelInvariant',$false),@('dependencyObservationKnown',$false),@('ollamaLoadMode','unknown'))) {
        $heldState | Add-Member -NotePropertyName $pair[0] -NotePropertyValue $pair[1] -Force
    }
    Ensure-StateRoot
    [IO.File]::WriteAllText($statePath, ($heldState | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    if($Held -and -not $script:governorNativeProbeOwnedHold){
        $epoch=Get-GovernorNativeEpochV1
        Assert-GovernorNativeEpochV1 $epoch
        foreach($key in @('machineHash','bootIdentifier','ownerProcessId','ownerCreationFileTime')){$heldState.nativeProbeAttempt.$key=$epoch.$key}
        $heldState.nativeProbeAttempt.phase='BOUND'
        [IO.File]::WriteAllText($statePath, ($heldState|ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        $script:governorNativeAttemptDigest=Get-GovernorBytesDigestV1 ([Text.UTF8Encoding]::new($false).GetBytes(($heldState.nativeProbeAttempt|ConvertTo-Json -Depth 8 -Compress)))
        $script:governorNativeProbeExitProven=$false
    }
    $script:governorNativeProbeOwnedHold = $Held
}

function Assert-GovernorNativeCustodyUnheld {
    $state = Read-GovernorState
    if ($state -and $state.PSObject.Properties['nativeProbeCustodyHeld'] -and
        ($state.nativeProbeCustodyHeld -isnot [bool] -or $state.nativeProbeCustodyHeld -ne $false)) {
        throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
    }
}

function Ensure-StateRoot {
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }
}

function Add-MissingGovernorProperty {
    param($Object, [string]$Name, $Value)
    if ($null -eq $Object) { return }
    if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Normalize-GovernorState {
    param($State)
    if ($null -eq $State) { return $null }

    # Governor state is durable workspace data and can outlive the script version
    # that wrote it. Normalize older shapes before StrictMode reads any field.
    Add-MissingGovernorProperty -Object $State -Name 'phase' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'active' -Value $false
    Add-MissingGovernorProperty -Object $State -Name 'cooldownUntilUtc' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'profile' -Value $null
    Add-MissingGovernorProperty -Object $State -Name 'reappearanceCount' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'localModelAllowed' -Value $true
    Add-MissingGovernorProperty -Object $State -Name 'reason' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'overrideMode' -Value 'AUTO'
    Add-MissingGovernorProperty -Object $State -Name 'gameProcessName' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeHardBlocked' -Value $false
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeProcessCountBefore' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeProcessCountAfter' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeStoppedCount' -Value 0

    if ($null -ne $State.profile) {
        Add-MissingGovernorProperty -Object $State.profile -Name 'name' -Value 'generic-safe'
        Add-MissingGovernorProperty -Object $State.profile -Name 'processName' -Value ''
        Add-MissingGovernorProperty -Object $State.profile -Name 'minFreeVramMiB' -Value 8192
        Add-MissingGovernorProperty -Object $State.profile -Name 'lightweightOnly' -Value $true
        Add-MissingGovernorProperty -Object $State.profile -Name 'parkAllModels' -Value $false
        Add-MissingGovernorProperty -Object $State.profile -Name 'cooldownSeconds' -Value ([Math]::Max([Math]::Max(30, $CooldownSeconds), [Math]::Max(5, $ReleaseGraceSeconds)))
        Add-MissingGovernorProperty -Object $State.profile -Name 'customProfileApplied' -Value $false
    }

    return $State
}

function Resolve-OllamaExecutable {
    $command = Get-Command ollama.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return [string]$command.Source }
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe')
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return ''
}

function Get-GpuSnapshot {
    $command = Get-Command nvidia-smi.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        $script:governorDependencyHealthy = $false
        return [pscustomobject]@{
            available = $false
            memoryFreeMiB = $null
            memoryUsedMiB = $null
            memoryTotalMiB = $null
            utilizationGpuPercent = $null
        }
    }
    try {
        $probe = Invoke-GovernorNativeProbe -Operation GpuSnapshot
        if (-not $probe.ok) { throw 'GPU_OBSERVATION_UNKNOWN' }
        $line = @($probe.output -split '\r?\n' | Where-Object { $_ }) | Select-Object -First 1
        if (-not $line) { throw 'nvidia-smi returned no rows' }
        $parts = @(([string]$line).Split(',') | ForEach-Object { $_.Trim() })
        if ($parts.Count -lt 4) { throw 'nvidia-smi returned an incomplete row' }
        return [pscustomobject]@{
            available = $true
            memoryFreeMiB = [int]$parts[0]
            memoryUsedMiB = [int]$parts[1]
            memoryTotalMiB = [int]$parts[2]
            utilizationGpuPercent = [int]$parts[3]
        }
    }
    catch {
        if ($_.Exception.Message -eq 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN') { throw }
        $script:governorDependencyHealthy = $false
        return [pscustomobject]@{
            available = $false
            memoryFreeMiB = $null
            memoryUsedMiB = $null
            memoryTotalMiB = $null
            utilizationGpuPercent = $null
        }
    }
}

function Test-StaleOculusDashAfterCrash {
    # Never infer disconnection from OculusDash alone. Fail closed if the
    # evidence is missing or ambiguous, including while the Quest is in VR.
    if (Get-Process -Name 'Starfield', 'vrcompositor', 'vrdashboard' -ErrorAction SilentlyContinue | Select-Object -First 1) { return $false }
    $log = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Oculus') -Filter 'Service_*.txt' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $log -or $log.LastWriteTimeUtc -lt [datetime]::UtcNow.AddSeconds(-35)) { return $false }
    try {
        $stream = [IO.File]::Open($log.FullName, 'Open', 'Read', 'ReadWrite')
        try {
            $count = [int][math]::Min($stream.Length, 1048576)
            [void]$stream.Seek(-$count, 'End')
            $bytes = [byte[]]::new($count)
            $read = $stream.Read($bytes, 0, $count)
            $tail = [Text.Encoding]::UTF8.GetString($bytes, 0, $read)
        } finally { $stream.Dispose() }
        $hmd = [regex]::Matches($tail, "(?m)(\d{2}/\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?HMD Reporting state change: \{'State':'([^']+)','IsDetected':([01])")
        if ($hmd.Count -lt 2) { return $false }
        foreach ($item in $hmd) {
            if ($item.Groups[2].Value -ne 'NotDetected' -or $item.Groups[3].Value -ne '0') { return $false }
        }
        $year = [datetime]::Now.Year
        $first = [datetime]::ParseExact("$year/$($hmd[0].Groups[1].Value)", 'yyyy/dd/MM HH:mm:ss.fff', [globalization.cultureinfo]::InvariantCulture)
        $last = [datetime]::ParseExact("$year/$($hmd[$hmd.Count - 1].Groups[1].Value)", 'yyyy/dd/MM HH:mm:ss.fff', [globalization.cultureinfo]::InvariantCulture)
        if (($last - $first).TotalMinutes -lt 10 -or $last -lt [datetime]::Now.AddSeconds(-35)) { return $false }
        # Any live wireless streaming transition keeps the VR guard engaged.
        $session = [regex]::Matches($tail, 'oculus_xrs_session_state_transition previous_state: \w+ current_state: (\w+)[^\r\n]*?current_session_type: (\w+)')
        if ($session.Count -eq 0) { return $false }
        $latest = $session[$session.Count - 1]
        if ($latest.Groups[2].Value -eq 'streaming') { return $false }
        if ($latest.Groups[1].Value -notin @('Connected', 'Disconnected')) { return $false }
        return $latest.Groups[2].Value -in @('basic', 'none')
    } catch { return $false }
}

function Test-RealAirLinkActive {
    # SteamVR processes always win. OculusDash alone can persist after a crash.
    foreach ($name in @('vrcompositor', 'vrdashboard')) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1) { return $true }
    }
    if (Get-Process -Name 'OculusDash' -ErrorAction SilentlyContinue | Select-Object -First 1) {
        return -not (Test-StaleOculusDashAfterCrash)
    }
    return $false
}

function Test-VirtualAirLinkTestActive {
    if (-not (Test-Path -LiteralPath $simAirLinkStatePath -PathType Leaf)) { return $false }
    try {
        $state = Get-Content -LiteralPath $simAirLinkStatePath -Raw | ConvertFrom-Json
        if (
            $state.schemaVersion -ne 'stephanos.starfield-vr-sim-air-link.v1' -or
            $state.enabled -ne $true -or
            $state.purpose -ne 'readiness-only'
        ) {
            return $false
        }
        $updated = [DateTime]::MinValue
        if ([DateTime]::TryParse([string]$state.updatedAtUtc, [ref]$updated)) {
            if (((Get-Date).ToUniversalTime() - $updated.ToUniversalTime()).TotalMinutes -gt 30) {
                return $false
            }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Get-AirLinkSignal {
    $real = Test-RealAirLinkActive
    $virtual = Test-VirtualAirLinkTestActive
    return [pscustomobject]@{
        active = [bool]($real -or $virtual)
        real = [bool]$real
        virtual = [bool]$virtual
        reason = if ($real) {
            'vr-runtime-active'
        } elseif ($virtual) {
            'virtual-air-link-test-active'
        } else {
            'vr-runtime-inactive'
        }
    }
}

function Test-WindowsGamePresenceActive {
    return $null -ne (Get-Process -Name 'GameBarPresenceWriter' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-ParentProcessInfo {
    param([int]$ProcessId)

    try {
        $row = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ProcessId) -ErrorAction Stop
        $parentId = [int]$row.ParentProcessId
        if ($parentId -le 0) {
            return [pscustomobject]@{ processId = 0; processName = ''; executablePath = '' }
        }
        $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
        $path = ''
        if ($parent) {
            try { $path = [string]$parent.Path } catch { $path = '' }
        }
        return [pscustomobject]@{
            processId = $parentId
            processName = if ($parent) { [string]$parent.ProcessName } else { '' }
            executablePath = $path
        }
    }
    catch {
        return [pscustomobject]@{ processId = 0; processName = ''; executablePath = '' }
    }
}

function Get-FlatGameSignal {
    $knownProcessNames = @(
        'Starfield',
        'Cyberpunk2077',
        'SkyrimSE',
        'SkyrimVR',
        'Fallout4',
        'Fallout4VR'
    )
    $extraNames = @(
        ([string]$env:STEPHANOS_GAME_PROCESS_NAMES -split '[,;]' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ })
    )
    $allKnownNames = @($knownProcessNames + $extraNames | Select-Object -Unique)

    $libraryPatterns = New-Object System.Collections.Generic.List[string]
    foreach ($pattern in @(
        '\\steamapps\\common\\',
        '\\SteamLibrary\\steamapps\\common\\',
        '\\XboxGames\\',
        '\\Epic Games\\',
        '\\GOG Games\\',
        '\\EA Games\\',
        '\\Ubisoft\\Ubisoft Game Launcher\\games\\',
        '\\Rockstar Games\\',
        '\\Battle.net\\',
        '\\itch\\apps\\'
    )) {
        $libraryPatterns.Add($pattern)
    }

    foreach ($root in @(
        ([string]$env:STEPHANOS_GAME_LIBRARY_ROOTS -split ';' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ })
    )) {
        $normalizedRoot = $root.TrimEnd('\')
        if ($normalizedRoot) {
            $libraryPatterns.Add(([regex]::Escape($normalizedRoot) + '\\'))
        }
    }

    $excludedNames = @(
        'steam',
        'steamwebhelper',
        'EpicGamesLauncher',
        'GalaxyClient',
        'GalaxyClientService',
        'Battle.net',
        'EADesktop',
        'XboxPcApp',
        'GamingServices',
        'UbisoftConnect',
        'upc',
        'RockstarService',
        'RockstarErrorHandler'
    )

    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
        $name = [string]$process.ProcessName
        if (-not $name -or $excludedNames -contains $name) { continue }

        $known = $allKnownNames -contains $name
        $path = ''
        try { $path = [string]$process.Path } catch { $path = '' }

        $inGameLibrary = $false
        if ($path) {
            foreach ($pattern in $libraryPatterns) {
                if ($path -match $pattern) {
                    $inGameLibrary = $true
                    break
                }
            }
        }

        $hasGameWindow = $false
        try { $hasGameWindow = [int64]$process.MainWindowHandle -ne 0 } catch { $hasGameWindow = $false }

        if ($known -or ($inGameLibrary -and $hasGameWindow)) {
            $parent = Get-ParentProcessInfo -ProcessId ([int]$process.Id)
            return [pscustomobject]@{
                active = $true
                processId = [int]$process.Id
                processName = $name
                executablePath = $path
                parentProcessId = [int]$parent.processId
                parentProcessName = [string]$parent.processName
                parentExecutablePath = [string]$parent.executablePath
                reason = if ($known) { 'known-game-process-active' } else { 'game-library-process-active' }
            }
        }
    }

    if (Test-WindowsGamePresenceActive) {
        return [pscustomobject]@{
            active = $true
            processId = 0
            processName = 'GameBarPresenceWriter'
            executablePath = ''
            parentProcessId = 0
            parentProcessName = ''
            parentExecutablePath = ''
            reason = 'windows-game-presence-active'
        }
    }

    return [pscustomobject]@{
        active = $false
        processId = 0
        processName = ''
        executablePath = ''
        parentProcessId = 0
        parentProcessName = ''
        parentExecutablePath = ''
        reason = 'flat-game-inactive'
    }
}

function Get-GamingSignal {
    param([switch]$ThrottleFlatGameScan)

    $airLink = Get-AirLinkSignal

    # Headset detection is the highest-priority signal. Do not spend the first
    # protection cycle walking every desktop process before evicting local AI.
    if ($airLink.active) {
        # Never reuse a stale desktop game scan after a headset transition.
        if ($ThrottleFlatGameScan) { $script:cachedFlatGameSignal = $null }
        return [pscustomobject]@{
            active = $true
            airLinkActive = $true
            realAirLinkActive = [bool]$airLink.real
            virtualAirLinkTestActive = [bool]$airLink.virtual
            flatGameActive = $false
            gameProcessId = 0
            gameProcessName = ''
            gameExecutablePath = ''
            parentProcessId = 0
            parentProcessName = ''
            parentExecutablePath = ''
            reason = [string]$airLink.reason
        }
    }

    # Only Watch may reuse a bounded idle inventory. Explicit reconcile/prepare
    # actions always obtain fresh process proof.
    if ($ThrottleFlatGameScan) {
        $scanAt = Get-Date
        if ($null -eq $script:cachedFlatGameSignal -or
            ($scanAt - $script:lastFlatGameScanAt).TotalSeconds -ge $script:flatGameScanIntervalSeconds) {
            $script:cachedFlatGameSignal = Get-FlatGameSignal
            $script:lastFlatGameScanAt = Get-Date
        }
        $flatGame = $script:cachedFlatGameSignal
    } else {
        $flatGame = Get-FlatGameSignal
    }
    return [pscustomobject]@{
        active = [bool]$flatGame.active
        airLinkActive = $false
        realAirLinkActive = $false
        virtualAirLinkTestActive = $false
        flatGameActive = [bool]$flatGame.active
        gameProcessId = [int]$flatGame.processId
        gameProcessName = [string]$flatGame.processName
        gameExecutablePath = [string]$flatGame.executablePath
        parentProcessId = [int]$flatGame.parentProcessId
        parentProcessName = [string]$flatGame.parentProcessName
        parentExecutablePath = [string]$flatGame.parentExecutablePath
        reason = if ($flatGame.active) {
            [string]$flatGame.reason
        } else {
            'gaming-session-inactive'
        }
    }
}

function Read-OverrideMode {
    if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) { return 'AUTO' }
    try {
        $state = Get-Content -LiteralPath $overridePath -Raw | ConvertFrom-Json
        $mode = [string]$state.mode
        if ($mode -in @('AUTO','FORCE_ON','FORCE_OFF')) { return $mode }
    } catch {}
    return 'AUTO'
}

function Write-OverrideMode {
    param([ValidateSet('AUTO','FORCE_ON','FORCE_OFF')][string]$Mode)
    Assert-GovernorMutationOwner
    Ensure-StateRoot
    $payload = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-override.v1'
        mode = $Mode
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $overridePath,
        ($payload | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Write-PrepareLease {
    param([string]$RequestedProcessName, [string]$RequestedProfileName)
    Assert-GovernorMutationOwner
    Ensure-StateRoot
    $now = (Get-Date).ToUniversalTime()
    $payload = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-prepare.v1'
        active = $true
        processName = if ($RequestedProcessName) { $RequestedProcessName } else { 'StephanosLaunch' }
        profileName = [string]$RequestedProfileName
        createdAtUtc = $now.ToString('o')
        expiresAtUtc = $now.AddMinutes(2).ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $preparePath,
        ($payload | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Clear-PrepareLease {
    Assert-GovernorMutationOwner
    if (Test-Path -LiteralPath $preparePath -PathType Leaf) {
        Remove-Item -LiteralPath $preparePath -Force -ErrorAction SilentlyContinue
    }
}

function Read-PrepareLease {
    if (-not (Test-Path -LiteralPath $preparePath -PathType Leaf)) {
        return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
    }
    try {
        $lease = Get-Content -LiteralPath $preparePath -Raw | ConvertFrom-Json
        if ($lease.schemaVersion -ne 'stephanos.gaming-resource-prepare.v1' -or $lease.active -ne $true) {
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        $expiry = [DateTime]::MinValue
        if (-not [DateTime]::TryParse([string]$lease.expiresAtUtc, [ref]$expiry)) {
            Clear-PrepareLease
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        if ((Get-Date).ToUniversalTime() -ge $expiry.ToUniversalTime()) {
            Clear-PrepareLease
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        return [pscustomobject]@{
            active = $true
            processName = [string]$lease.processName
            profileName = [string]$lease.profileName
            expiresAtUtc = [string]$lease.expiresAtUtc
        }
    }
    catch {
        Clear-PrepareLease
        return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
    }
}

function Get-ProfileOverride {
    param([string]$RequestedProcessName)
    if (-not $RequestedProcessName -or -not (Test-Path -LiteralPath $profilesPath -PathType Leaf)) { return $null }
    try {
        $config = Get-Content -LiteralPath $profilesPath -Raw | ConvertFrom-Json
        if ($config.schemaVersion -ne 'stephanos.gaming-resource-profiles.v1') { return $null }
        foreach ($profile in @($config.profiles)) {
            if (-not $profile) { continue }
            $processProperty = $profile.PSObject.Properties['processName']
            if (-not $processProperty) { continue }
            if ([string]::Equals([string]$processProperty.Value, $RequestedProcessName, [System.StringComparison]::OrdinalIgnoreCase)) {
                # Normalize legacy/custom profile shapes before StrictMode consumers
                # read optional fields added by newer governor versions.
                return [pscustomobject]@{
                    name = if ($profile.PSObject.Properties['name']) { [string]$profile.PSObject.Properties['name'].Value } else { '' }
                    processName = [string]$processProperty.Value
                    minFreeVramMiB = if ($profile.PSObject.Properties['minFreeVramMiB']) { $profile.PSObject.Properties['minFreeVramMiB'].Value } else { $null }
                    lightweightOnly = if ($profile.PSObject.Properties['lightweightOnly']) { $profile.PSObject.Properties['lightweightOnly'].Value } else { $null }
                    parkAllModels = if ($profile.PSObject.Properties['parkAllModels']) { $profile.PSObject.Properties['parkAllModels'].Value } else { $null }
                    cooldownSeconds = if ($profile.PSObject.Properties['cooldownSeconds']) { $profile.PSObject.Properties['cooldownSeconds'].Value } else { $null }
                }
            }
        }
    } catch {}
    return $null
}

function Resolve-GamingProfile {
    param(
        $Signal,
        [string]$RequestedProcessName = '',
        [string]$RequestedProfileName = ''
    )

    $process = if ($RequestedProcessName) { $RequestedProcessName } else { [string]$Signal.gameProcessName }
    $name = 'generic-safe'
    $minFree = 8192
    $lightweightOnly = $true
    $parkAllModels = $false
    $cooldown = [Math]::Max([Math]::Max(30, $CooldownSeconds), [Math]::Max(5, $ReleaseGraceSeconds))

    if ($Signal.airLinkActive) {
        $name = 'vr-maximum'
        $minFree = 12288
        $parkAllModels = $true
        $cooldown = [Math]::Max(90, $CooldownSeconds)
    }
    elseif ($process -in @('Starfield','Cyberpunk2077','SkyrimVR','Fallout4VR')) {
        $name = 'heavy-game-maximum'
        $minFree = 10240
    }

    if ($RequestedProfileName) {
        $name = $RequestedProfileName
        if ($RequestedProfileName -eq 'vr-maximum') {
            $minFree = 12288
            $parkAllModels = $true
        }
        if ($RequestedProfileName -eq 'heavy-game-maximum') { $minFree = 10240 }
    }

    $custom = Get-ProfileOverride -RequestedProcessName $process
    if ($custom) {
        if ([string]$custom.name) { $name = [string]$custom.name }
        if ($null -ne $custom.minFreeVramMiB) {
            $minFree = [Math]::Max(2048, [Math]::Min(24576, [int]$custom.minFreeVramMiB))
        }
        if ($null -ne $custom.lightweightOnly) { $lightweightOnly = [bool]$custom.lightweightOnly }
        if ($null -ne $custom.parkAllModels) { $parkAllModels = [bool]$custom.parkAllModels }
        if ($null -ne $custom.cooldownSeconds) {
            $cooldown = [Math]::Max(15, [Math]::Min(600, [int]$custom.cooldownSeconds))
        }
    }

    return [pscustomobject]@{
        name = $name
        processName = $process
        minFreeVramMiB = [int]$minFree
        lightweightOnly = [bool]$lightweightOnly
        parkAllModels = [bool]$parkAllModels
        cooldownSeconds = [int]$cooldown
        customProfileApplied = [bool]($null -ne $custom)
    }
}

function Get-LoadedOllamaModels {
    param([string]$OllamaExecutable)
    try {
        if (-not $OllamaExecutable) { throw 'OLLAMA_OBSERVATION_UNKNOWN' }
        $probe = Invoke-GovernorNativeProbe -Operation OllamaInventory
        if (-not $probe.ok) { throw 'OLLAMA_OBSERVATION_UNKNOWN' }
        $lines = @($probe.output -split '\r?\n' | Where-Object { $_.Trim() })
        if ($lines.Count -lt 1 -or [string]$lines[0] -cnotmatch '^NAME\s+ID\s+SIZE\s+PROCESSOR\s+') { throw 'OLLAMA_INVENTORY_INVALID' }
        if ($lines.Count -gt 65) { throw 'OLLAMA_INVENTORY_INVALID' }
        return @(
            $lines |
                Select-Object -Skip 1 |
                ForEach-Object {
                    $line = [string]$_
                    if (-not $line.Trim()) { return }
                    $parts = @($line.Trim() -split '\s+')
                    if ($parts.Count -lt 5 -or $parts[0] -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$') { throw 'OLLAMA_INVENTORY_INVALID' }
                    [string]$parts[0]
                } |
                Where-Object { $_ } |
                Select-Object -Unique
        )
    }
    catch {
        if ($_.Exception.Message -eq 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN') { throw }
        $script:governorDependencyHealthy = $false
        return @()
    }
}

function Get-HeavyModels {
    param([string[]]$Models = @())
    return @(
        $Models |
            Where-Object {
                $_ -and -not [string]::Equals(
                    [string]$_,
                    $lightweightModel,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

function Stop-OllamaModel {
    param([string]$OllamaExecutable, [string]$Model)
    if (-not $OllamaExecutable -or -not $Model) { return $false }
    try {
        $probe = Invoke-GovernorNativeProbe -Operation OllamaStop -Model $Model
        if (-not $probe.ok) { $script:governorDependencyHealthy = $false }
        return $probe.ok
    }
    catch {
        if ($_.Exception.Message -eq 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN') { throw }
        $script:governorDependencyHealthy = $false
        return $false
    }
}

function Get-OllamaVrRuntimeProcesses {
    $ollamaRoot = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
    try { return @(
        Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
                $name = [string]$_.Name
                $path = [string]$_.ExecutablePath
                $commandLine = [string]$_.CommandLine
                $underOllamaRoot = [bool](
                    $path -and
                    $path.StartsWith($ollamaRoot, [System.StringComparison]::OrdinalIgnoreCase)
                )
                $isRuntime = [bool](
                    $name -ieq 'llama-server.exe' -or
                    $name -ieq 'ollama app.exe' -or
                    ($name -ieq 'ollama.exe' -and $commandLine -match '(?i)(?:^|\s)serve(?:\s|$)')
                )
                $underOllamaRoot -and $isRuntime
            }
    ) } catch { $script:governorDependencyHealthy = $false; return @() }
}

function Stop-OllamaRuntimeForRealVr {
    param([bool]$Enabled)
    Assert-GovernorMutationOwner
    $result = [ordered]@{
        enabled = $Enabled
        processCountBefore = 0
        stoppedProcessCount = 0
        processCountAfter = 0
        suppressed = (-not $Enabled)
    }
    if (-not $Enabled) { return [pscustomobject]$result }

    $before = @(Get-OllamaVrRuntimeProcesses)
    $result.processCountBefore = $before.Count
    $stoppedPids = @{}
    $quietSince = $null
    $deadline = (Get-Date).AddSeconds(2)

    do {
        $current = @(Get-OllamaVrRuntimeProcesses)
        if ($current.Count -eq 0) {
            if (-not $quietSince) { $quietSince = Get-Date }
            if (((Get-Date) - $quietSince).TotalMilliseconds -ge 250) { break }
        }
        else {
            $quietSince = $null
            foreach ($name in @('llama-server.exe','ollama.exe','ollama app.exe')) {
                foreach ($process in @($current | Where-Object { [string]$_.Name -ieq $name })) {
                    try {
                        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                        $key = [string]$process.ProcessId
                        if (-not $stoppedPids.ContainsKey($key)) {
                            $stoppedPids[$key] = $true
                            $result.stoppedProcessCount += 1
                        }
                    }
                    catch {}
                }
            }
        }
        Start-Sleep -Milliseconds 50
    } while ((Get-Date) -lt $deadline)

    $after = @(Get-OllamaVrRuntimeProcesses)
    $result.processCountAfter = $after.Count
    $result.suppressed = $result.processCountAfter -eq 0
    return [pscustomobject]$result
}

function Invoke-ImmediateVrModelEviction {
    # Real headset presence is a hard local-AI boundary. Stopping only the loaded
    # model is insufficient because Ollama can immediately respawn it; suppress
    # the bounded Ollama runtime tree instead, before the slower reconcile pass.
    if (-not (Test-RealAirLinkActive)) { return $false }
    $suppression = Stop-OllamaRuntimeForRealVr -Enabled $true
    return [bool]($suppression.stoppedProcessCount -gt 0)
}

function Read-GovernorState {
    try {
        if (-not (Test-Path -LiteralPath $statePath -ErrorAction Stop)) { return $null }
        $info = Get-Item -LiteralPath $statePath -ErrorAction Stop
        if ($info.PSIsContainer -or $info.Length -lt 2 -or $info.Length -gt 32768 -or
            ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'STATE_UNPROVEN' }
        $state = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $state -or $state.GetType().FullName -cne 'System.Management.Automation.PSCustomObject') { throw 'STATE_UNPROVEN' }
        return Normalize-GovernorState -State $state
    } catch {
        # An existing unreadable record can conceal an unresolved native child.
        # Only a genuinely absent record permits first-start initialization.
        throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
    }
}

function Append-TelemetryEvent {
    param($Payload)
    Ensure-StateRoot
    $event = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-governor-event.v1'
        writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        phase = [string]$Payload.phase
        active = [bool]$Payload.active
        reason = [string]$Payload.reason
        transition = [string]$Payload.transition
        overrideMode = [string]$Payload.overrideMode
        profileName = [string]$Payload.profile.name
        gameProcessName = [string]$Payload.gameProcessName
        parentProcessName = [string]$Payload.parentProcessName
        vramPressure = [bool]$Payload.vramPressure
        vramReleasedMiB = $Payload.vramReleasedMiB
        parkedModels = @($Payload.parkedModels)
        loadedModelsBefore = @($Payload.loadedModelsBefore)
        heavyModelsAfter = @($Payload.heavyModelsAfter)
        loadedModelsAfter = @($Payload.loadedModelsAfter)
        localModelAllowed = [bool]$Payload.localModelAllowed
        zeroLocalModelInvariant = [bool]$Payload.zeroLocalModelInvariant
        reappearanceDetected = [bool]$Payload.reappearanceDetected
        reappearanceCount = [int]$Payload.reappearanceCount
        ollamaRuntimeHardBlocked = [bool]$Payload.ollamaRuntimeHardBlocked
        ollamaRuntimeProcessCountBefore = [int]$Payload.ollamaRuntimeProcessCountBefore
        ollamaRuntimeProcessCountAfter = [int]$Payload.ollamaRuntimeProcessCountAfter
    }
    $line = $event | ConvertTo-Json -Compress -Depth 6
    $existing = @()
    if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
        $existing = @(Get-Content -LiteralPath $telemetryPath -ErrorAction SilentlyContinue | Select-Object -Last 199)
    }
    @($existing + $line) | Set-Content -LiteralPath $telemetryPath -Encoding UTF8
}

function Write-GovernorState {
    param(
        [string]$Phase,
        [bool]$Active,
        [bool]$AirLinkActive,
        [bool]$RealAirLinkActive,
        [bool]$VirtualAirLinkTestActive,
        [bool]$FlatGameActive,
        [int]$GameProcessId,
        [string]$GameProcessName,
        [string]$GameExecutablePath,
        [int]$ParentProcessId,
        [string]$ParentProcessName,
        [string]$ParentExecutablePath,
        [string[]]$ParkedModels,
        [string[]]$LoadedModelsBefore,
        [string[]]$HeavyModelsBefore,
        [string[]]$HeavyModelsAfter,
        [string[]]$LoadedModelsAfter,
        [bool]$ZeroLocalModelInvariant,
        [bool]$ReappearanceDetected,
        [int]$ReappearanceCount,
        [bool]$OllamaRuntimeHardBlocked,
        [int]$OllamaRuntimeProcessCountBefore,
        [int]$OllamaRuntimeProcessCountAfter,
        [int]$OllamaRuntimeStoppedCount,
        [string]$OllamaExecutable,
        [string]$Reason,
        [string]$OverrideMode,
        $Profile,
        $GpuBefore,
        $GpuAfter,
        [bool]$VramPressure,
        [Nullable[int]]$VramReleasedMiB,
        [long]$EvictionDurationMs,
        [string]$CooldownUntilUtc,
        [bool]$PrepareLeaseActive,
        [string]$PrepareExpiresAtUtc,
        [string]$Transition,
        [bool]$ShouldParkHeavy,
        [bool]$ParkAllModels
    )
    Assert-GovernorMutationOwner
    Assert-GovernorNativeCustodyUnheld
    Ensure-StateRoot
    $publisher = [Diagnostics.Process]::GetCurrentProcess()
    try { $publisherStartedAtUtc = $publisher.StartTime.ToUniversalTime().ToString('o') }
    finally { $publisher.Dispose() }
    $payload = [ordered]@{
        schemaVersion = 'stephanos.vr-resource-governor.v1'
        governorVersion = 3
        phase = $Phase
        active = [bool]$Active
        airLinkActive = [bool]$AirLinkActive
        realAirLinkActive = [bool]$RealAirLinkActive
        virtualAirLinkTestActive = [bool]$VirtualAirLinkTestActive
        flatGameActive = [bool]$FlatGameActive
        gameProcessId = [int]$GameProcessId
        gameProcessName = $GameProcessName
        gameExecutablePath = $GameExecutablePath
        parentProcessId = [int]$ParentProcessId
        parentProcessName = $ParentProcessName
        parentExecutablePath = $ParentExecutablePath
        preferredModel = $lightweightModel
        ollamaLoadMode = if (-not $script:governorDependencyHealthy) { 'unknown' } elseif ($ParkAllModels) { 'off' } elseif ($ShouldParkHeavy) { 'cool' } else { 'balanced' }
        heavyModelAllowed = [bool]($script:governorDependencyHealthy -and -not $ShouldParkHeavy)
        localModelAllowed = [bool]($script:governorDependencyHealthy -and -not ($Active -and $ParkAllModels))
        dependencyObservationKnown = [bool]$script:governorDependencyHealthy
        nativeProbeCustodyHeld = $false
        parkedModels = @($ParkedModels)
        loadedModelsBefore = @($LoadedModelsBefore)
        heavyModelsBefore = @($HeavyModelsBefore)
        heavyModelsAfter = @($HeavyModelsAfter)
        loadedModelsAfter = @($LoadedModelsAfter)
        zeroLocalModelInvariant = [bool]($script:governorDependencyHealthy -and $ZeroLocalModelInvariant)
        reappearanceDetected = [bool]$ReappearanceDetected
        reappearanceCount = [int]$ReappearanceCount
        ollamaRuntimeHardBlocked = [bool]$OllamaRuntimeHardBlocked
        ollamaRuntimeProcessCountBefore = [int]$OllamaRuntimeProcessCountBefore
        ollamaRuntimeProcessCountAfter = [int]$OllamaRuntimeProcessCountAfter
        ollamaRuntimeStoppedCount = [int]$OllamaRuntimeStoppedCount
        evictionHealthy = [bool](
            $script:governorDependencyHealthy -and
            (-not $ShouldParkHeavy -or $HeavyModelsAfter.Count -eq 0) -and
            $ZeroLocalModelInvariant
        )
        ollamaAvailable = [bool]$OllamaExecutable
        reason = $Reason
        overrideMode = $OverrideMode
        profile = $Profile
        gpuBefore = $GpuBefore
        gpuAfter = $GpuAfter
        vramPressure = [bool]$VramPressure
        vramReleasedMiB = $VramReleasedMiB
        evictionDurationMs = [long]$EvictionDurationMs
        cooldownUntilUtc = $CooldownUntilUtc
        prepareLeaseActive = [bool]$PrepareLeaseActive
        prepareExpiresAtUtc = $PrepareExpiresAtUtc
        transition = $Transition
        telemetryPath = $telemetryPath
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        publisherProcessId = [int]$PID
        publisherStartedAtUtc = $publisherStartedAtUtc
    }
    [System.IO.File]::WriteAllText(
        $statePath,
        ($payload | ConvertTo-Json -Depth 8),
        (New-Object System.Text.UTF8Encoding($false))
    )
    Append-TelemetryEvent -Payload ([pscustomobject]$payload)
    return [pscustomobject]$payload
}

function Resolve-EffectiveState {
    param($Signal, $PriorState)

    $override = Read-OverrideMode
    $lease = Read-PrepareLease
    $requestedProcess = if ($Signal.gameProcessName) { [string]$Signal.gameProcessName } elseif ($lease.active) { [string]$lease.processName } else { '' }
    $requestedProfile = if ($lease.active) { [string]$lease.profileName } else { '' }
    $profile = Resolve-GamingProfile -Signal $Signal -RequestedProcessName $requestedProcess -RequestedProfileName $requestedProfile
    $priorParkAllModels = $false
    if (
        $PriorState -and
        $PriorState.profile -and
        $null -ne $PriorState.profile.PSObject.Properties['parkAllModels']
    ) {
        $priorParkAllModels = [bool]$PriorState.profile.parkAllModels
    }
    if (
        $Signal.active -and
        -not $lease.active -and
        $PriorState -and
        [bool]$PriorState.active -and
        $priorParkAllModels
    ) {
        # An explicitly prepared VR session must not silently downgrade to the
        # flat-game lightweight lane merely because the headset/runtime signal
        # flickers after the game process becomes authoritative.
        $profile = $PriorState.profile
    }
    elseif (-not $Signal.active -and -not $lease.active -and $PriorState -and $PriorState.profile) {
        $profile = $PriorState.profile
    }
    $nowUtc = (Get-Date).ToUniversalTime()

    if ($override -eq 'FORCE_OFF') {
        return [pscustomobject]@{
            phase = 'NORMAL'
            active = $false
            reason = 'operator-force-off'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($override -eq 'FORCE_ON') {
        return [pscustomobject]@{
            phase = 'GAMING'
            active = $true
            reason = 'operator-force-on'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($Signal.active) {
        if ($lease.active) { Clear-PrepareLease; $lease = Read-PrepareLease }
        return [pscustomobject]@{
            phase = 'GAMING'
            active = $true
            reason = [string]$Signal.reason
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($lease.active) {
        return [pscustomobject]@{
            phase = 'PREPARING'
            active = $true
            reason = 'pre-launch-resource-gate'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    $cooldownUntil = [DateTime]::MinValue
    $priorWasProtected = $false
    if ($PriorState) {
        $priorWasProtected = [string]$PriorState.phase -in @('PREPARING','GAMING','COOLDOWN')
        if ([string]$PriorState.cooldownUntilUtc) {
            [void][DateTime]::TryParse([string]$PriorState.cooldownUntilUtc, [ref]$cooldownUntil)
        }
        if (
            $priorWasProtected -and
            [string]$PriorState.phase -ne 'COOLDOWN' -and
            $cooldownUntil -eq [DateTime]::MinValue
        ) {
            $cooldownUntil = $nowUtc.AddSeconds([int]$profile.cooldownSeconds)
        }
    }

    if ($cooldownUntil -ne [DateTime]::MinValue -and $nowUtc -lt $cooldownUntil.ToUniversalTime()) {
        return [pscustomobject]@{
            phase = 'COOLDOWN'
            active = $true
            reason = 'gaming-session-cooldown'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = $cooldownUntil.ToUniversalTime().ToString('o')
        }
    }

    return [pscustomobject]@{
        phase = 'NORMAL'
        active = $false
        reason = 'gaming-session-inactive'
        overrideMode = $override
        profile = $profile
        lease = $lease
        cooldownUntilUtc = ''
    }
}

function Invoke-Reconcile {
    param($Signal, $Effective, $PriorState)

    Assert-GovernorMutationOwner
    Assert-GovernorNativeCustodyUnheld
    $script:governorDependencyHealthy = $true
    $script:governorNativeClock = [Diagnostics.Stopwatch]::StartNew()
    $gpuBefore = Get-GpuSnapshot
    $parkAllModels = [bool]($Effective.active -and $Effective.profile.parkAllModels)
    $hardBlockRealVr = [bool]($parkAllModels -and $Signal.realAirLinkActive)
    $started = Get-Date
    $runtimeSuppression = Stop-OllamaRuntimeForRealVr -Enabled $hardBlockRealVr
    $ollamaExecutable = Resolve-OllamaExecutable

    # Do not call Ollama's control API while its runtime is intentionally blocked.
    # A synchronous 'ollama stop' can itself stall for minutes while a model is
    # loading, which is exactly how Qwen escaped the previous guard.
    if ($hardBlockRealVr) {
        $loadedBefore = @()
    }
    else {
        $loadedBefore = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
    }
    $heavyBefore = @(Get-HeavyModels -Models $loadedBefore)
    $vramPressure = [bool](
        $Effective.active -and
        $gpuBefore.available -and
        [int]$gpuBefore.memoryFreeMiB -lt [int]$Effective.profile.minFreeVramMiB
    )
    $shouldPark = [bool](
        $Effective.active -and
        ($Effective.profile.lightweightOnly -or $vramPressure)
    )
    $modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }

    # Plain PowerShell array avoids the Windows PowerShell 5.1 generic-list
    # binder failure seen during post-crash reconcile.
    $parked = @()
    if (($shouldPark -or $parkAllModels) -and $ollamaExecutable -and -not $hardBlockRealVr) {
        foreach ($model in $modelsToPark) {
            if (Stop-OllamaModel -OllamaExecutable $ollamaExecutable -Model $model) {
                $parked += [string]$model
            }
        }
    }
    $evictionDuration = [long]((Get-Date) - $started).TotalMilliseconds
    if ($hardBlockRealVr) {
        $loadedAfter = @()
        $runtimeProcessesAfter = @(Get-OllamaVrRuntimeProcesses)
    }
    else {
        $loadedAfter = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
        $runtimeProcessesAfter = @()
    }
    $heavyAfter = @(Get-HeavyModels -Models $loadedAfter)
    $zeroLocalModelInvariant = [bool](
        $script:governorDependencyHealthy -and
        (-not ($Effective.active -and $parkAllModels) -or
        ($loadedAfter.Count -eq 0 -and (-not $hardBlockRealVr -or $runtimeProcessesAfter.Count -eq 0)))
    )
    $priorReappearanceCount = 0
    if ($PriorState -and $null -ne $PriorState.PSObject.Properties['reappearanceCount']) {
        $priorReappearanceCount = [int]$PriorState.reappearanceCount
    }
    $runtimeReappearanceDetected = [bool](
        $hardBlockRealVr -and
        [int]$runtimeSuppression.processCountBefore -gt 0 -and
        $PriorState -and
        [bool]$PriorState.active -and
        $null -ne $PriorState.PSObject.Properties['localModelAllowed'] -and
        $PriorState.localModelAllowed -eq $false
    )
    $modelReappearanceDetected = [bool](
        $parkAllModels -and
        $loadedBefore.Count -gt 0 -and
        $PriorState -and
        [bool]$PriorState.active -and
        $null -ne $PriorState.PSObject.Properties['localModelAllowed'] -and
        $PriorState.localModelAllowed -eq $false
    )
    $reappearanceDetected = [bool]($runtimeReappearanceDetected -or $modelReappearanceDetected)
    $reappearanceCount = $priorReappearanceCount
    if ($reappearanceDetected) { $reappearanceCount += 1 }
    $gpuAfter = Get-GpuSnapshot
    $vramReleased = $null
    if ($gpuBefore.available -and $gpuAfter.available) {
        $vramReleased = [int]($gpuAfter.memoryFreeMiB - $gpuBefore.memoryFreeMiB)
    }

    $priorPhase = if ($PriorState) { [string]$PriorState.phase } else { '' }
    $transition = if (-not $priorPhase) {
        'START->' + [string]$Effective.phase
    } elseif ($priorPhase -ne [string]$Effective.phase) {
        $priorPhase + '->' + [string]$Effective.phase
    } else {
        $priorPhase + '->' + $priorPhase
    }

    $effectiveProcessName = if ($Signal.gameProcessName) {
        [string]$Signal.gameProcessName
    } else {
        [string]$Effective.profile.processName
    }
    $writeParams = @{
        Phase = [string]$Effective.phase
        Active = [bool]$Effective.active
        AirLinkActive = [bool]$Signal.airLinkActive
        RealAirLinkActive = [bool]$Signal.realAirLinkActive
        VirtualAirLinkTestActive = [bool]$Signal.virtualAirLinkTestActive
        FlatGameActive = [bool]$Signal.flatGameActive
        GameProcessId = [int]$Signal.gameProcessId
        GameProcessName = $effectiveProcessName
        GameExecutablePath = [string]$Signal.gameExecutablePath
        ParentProcessId = [int]$Signal.parentProcessId
        ParentProcessName = [string]$Signal.parentProcessName
        ParentExecutablePath = [string]$Signal.parentExecutablePath
        ParkedModels = @($parked)
        LoadedModelsBefore = @($loadedBefore)
        HeavyModelsBefore = @($heavyBefore)
        HeavyModelsAfter = @($heavyAfter)
        LoadedModelsAfter = @($loadedAfter)
        ZeroLocalModelInvariant = $zeroLocalModelInvariant
        ReappearanceDetected = $reappearanceDetected
        ReappearanceCount = $reappearanceCount
        OllamaRuntimeHardBlocked = $hardBlockRealVr
        OllamaRuntimeProcessCountBefore = [int]$runtimeSuppression.processCountBefore
        OllamaRuntimeProcessCountAfter = [int]$runtimeProcessesAfter.Count
        OllamaRuntimeStoppedCount = [int]$runtimeSuppression.stoppedProcessCount
        OllamaExecutable = $ollamaExecutable
        Reason = [string]$Effective.reason
        OverrideMode = [string]$Effective.overrideMode
        Profile = $Effective.profile
        GpuBefore = $gpuBefore
        GpuAfter = $gpuAfter
        VramPressure = $vramPressure
        VramReleasedMiB = $vramReleased
        EvictionDurationMs = $evictionDuration
        CooldownUntilUtc = [string]$Effective.cooldownUntilUtc
        PrepareLeaseActive = [bool]$Effective.lease.active
        PrepareExpiresAtUtc = [string]$Effective.lease.expiresAtUtc
        Transition = $transition
        ShouldParkHeavy = $shouldPark
        ParkAllModels = $parkAllModels
    }
    return Write-GovernorState @writeParams
}

function Invoke-CurrentReconcile {
    Assert-GovernorMutationOwner
    $signal = Get-GamingSignal
    $prior = Read-GovernorState
    $effective = Resolve-EffectiveState -Signal $signal -PriorState $prior
    return Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $prior
}

if ($MyInvocation.InvocationName -ne '.' -and $Action -eq 'ObserveAdmission') {
    # Fresh read-only admission for cooperative CPU workers. Leave the sole
    # watcher/reconciler in charge of persisted state, leases and model actions.
    # Do not call Resolve-EffectiveState: it can clear prepare-lease evidence.
    $signal = Get-GamingSignal
    [pscustomobject]@{
        schemaVersion = 'stephanos.gaming-resource-admission-observation.v1'
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        signalActive = [bool]$signal.active
        overrideMode = [string](Read-OverrideMode)
        preparePending = [bool](Test-Path -LiteralPath $preparePath)
        readOnly = $true
    } | ConvertTo-Json -Depth 4
    exit 0
}

function Invoke-GovernorOneShot {
    $script:governorMutationOwner = Enter-GovernorMutationOwner
    if (-not $script:governorMutationOwner.acquired) {
        return [pscustomobject]@{ exitCode = 4; state = [pscustomobject]@{ ok = $false; blocker = 'GOVERNOR_MUTATION_BUSY' } }
    }
    try {
        if ($script:governorMutationOwner.abandoned) {
            Set-GovernorNativeCustodyHold -Held $true
            throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
        }
        Assert-GovernorNativeCustodyUnheld
        if ($Action -eq 'SetAuto') { Write-OverrideMode -Mode 'AUTO' | Out-Null }
        elseif ($Action -eq 'ForceOn') { Write-OverrideMode -Mode 'FORCE_ON' | Out-Null }
        elseif ($Action -eq 'ForceOff') {
            Write-OverrideMode -Mode 'FORCE_OFF' | Out-Null
            Clear-PrepareLease
        }
        elseif ($Action -eq 'PrepareGaming') {
            if ((Read-OverrideMode) -eq 'FORCE_OFF') { throw 'GAMING_RESOURCE_PREPARE_BLOCKED_BY_FORCE_OFF' }
            Write-PrepareLease -RequestedProcessName $ProcessName -RequestedProfileName $ProfileName | Out-Null
        }
        elseif ($Action -eq 'CancelPrepare') { Clear-PrepareLease }
        elseif ($Action -notin @('Status','Reconcile')) { throw 'GOVERNOR_ACTION_UNPROVEN' }

        $state = if ($Action -eq 'Status') { Read-GovernorState } else { $null }
        if (-not $state) { $state = Invoke-CurrentReconcile }
        $exitCode = 0
        if ($Action -eq 'Reconcile' -and -not $state.evictionHealthy) { $exitCode = 2 }
        if ($Action -eq 'PrepareGaming') {
            if (-not $state.evictionHealthy -or $state.heavyModelAllowed -ne $false) { $exitCode = 2 }
            elseif ($state.profile.parkAllModels -eq $true -and
                ($state.localModelAllowed -ne $false -or @($state.loadedModelsAfter).Count -gt 0 -or
                 $state.zeroLocalModelInvariant -ne $true)) { $exitCode = 3 }
        }
        return [pscustomobject]@{ exitCode = $exitCode; state = $state }
    } finally {
        Exit-GovernorMutationOwner -Owner $script:governorMutationOwner
        $script:governorMutationOwner = $null
    }
}

function Invoke-GovernorWatchTick {
    $script:governorMutationOwner = Enter-GovernorMutationOwner
    if (-not $script:governorMutationOwner.acquired) { return 'GOVERNOR_MUTATION_BUSY' }
    try {
    if ($script:governorMutationOwner.abandoned) {
        Set-GovernorNativeCustodyHold -Held $true
        throw 'GOVERNOR_NATIVE_CHILD_EXIT_UNPROVEN'
    }
    Assert-GovernorNativeCustodyUnheld
    # First bite: headset presence wins over every other workload. If any Ollama
    # runner has appeared, evict it immediately before the slower inventory pass.
    [void](Invoke-ImmediateVrModelEviction)

    $prior = Read-GovernorState
    $signal = Get-GamingSignal -ThrottleFlatGameScan
    $effective = Resolve-EffectiveState -Signal $signal -PriorState $prior
    $now = Get-Date
    $phaseChanged = -not $prior -or [string]$prior.phase -ne [string]$effective.phase
    $reasonChanged = -not $prior -or [string]$prior.reason -ne [string]$effective.reason
    $overrideChanged = -not $prior -or [string]$prior.overrideMode -ne [string]$effective.overrideMode
    $processChanged = -not $prior -or [string]$prior.gameProcessName -ne [string]$signal.gameProcessName
    $guardIntervalSeconds = if ($effective.active -and $effective.profile.parkAllModels) { 0.5 } else { 5 }
    $guardDue = $effective.active -and ($now - $script:lastGuardAt).TotalSeconds -ge $guardIntervalSeconds
    # Keep an independently observed idle-state heartbeat fresh for bounded
    # GPU/CPU model admission. Without this, Watch refreshes its JSON only on
    # transitions. Core expires evidence at 15s (the reviewer at 30s), so
    # refresh at 5s to leave room for observation and reconciliation latency.
    # Do not extend consumer freshness limits or reuse an unobserved idle state.
    # The watcher still scans game/headset signals on every tick BEFORE this.
    $idleHeartbeatDue = $false
    if (-not $effective.active) {
        try {
            $observedUtc = [DateTime]::Parse(
                [string]$prior.updatedAtUtc,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            ).ToUniversalTime()
            $idleHeartbeatDue = ($now.ToUniversalTime() - $observedUtc).TotalSeconds -ge 5
        } catch {
            $idleHeartbeatDue = $true
        }
    }

    if ($phaseChanged -or $reasonChanged -or $overrideChanged -or $processChanged -or $guardDue -or $idleHeartbeatDue) {
        $state = Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $prior
        if ($state.active) { $script:lastGuardAt = $now }
    }
    return 'GOVERNOR_WATCH_TICK_COMPLETE'
    } finally {
        Exit-GovernorMutationOwner -Owner $script:governorMutationOwner
        $script:governorMutationOwner = $null
    }
}

if ($MyInvocation.InvocationName -eq '.') { return }

if ($Action -ne 'Watch') {
    $result = Invoke-GovernorOneShot
    $result.state | ConvertTo-Json -Depth 8
    exit $result.exitCode
}

$poll = [Math]::Max(250, $PollMilliseconds)
$script:lastGuardAt = [DateTime]::MinValue
# Retain fast real-headset detection. Expensive flat-game discovery is capped.
$script:flatGameScanIntervalSeconds = 3
$script:lastFlatGameScanAt = [DateTime]::MinValue
$script:cachedFlatGameSignal = $null
while ($true) {
    [void](Invoke-GovernorWatchTick)
    Start-Sleep -Milliseconds $poll
}
