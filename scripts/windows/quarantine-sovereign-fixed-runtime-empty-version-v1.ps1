# Only the reviewed captured entry from the fixed preparation artifact may run.
param([switch]$OperatorApproved,[string]$ExpectedMain='')
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$script:emptyNative=$null
$script:emptyPins=[Collections.Generic.List[IntPtr]]::new()
$script:emptyStreams=[Collections.Generic.List[IDisposable]]::new()
$script:emptyClock=[Diagnostics.Stopwatch]::StartNew()
$sourceRoot='C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
$protectedRoot='C:\Program Files\Stephanos\SovereignFixedRuntimeV1'
$targetVersion='d390300e737265984ec5ee2b1b471f8d833aae16'
$installedVersion='f55ecf987ab20c1554ad2115b285b5eba024bd94'
$entryPath='scripts/windows/quarantine-sovereign-fixed-runtime-empty-version-v1.ps1'
$factoryPath='scripts/sovereign-fixed-runtime-empty-version-quarantine-v1.mjs'
$receiptName='empty-version-quarantine-receipt-v1.json'

function Initialize-EmptyVersionNative {
    # Run-only Reflection.Emit: no Add-Type, CodeDom, Temp compiler, DLL selector,
    # assembly save or mutable privileged script. The interop estate is closed.
    $assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly(
        [Reflection.AssemblyName]::new('StephanosEmptyVersion'+[Guid]::NewGuid().ToString('N')),
        [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $module=$assembly.DefineDynamicModule('Native')
    $builder=$module.DefineType('Stephanos.EmptyVersionNative',[Reflection.TypeAttributes]'Public,Abstract,Sealed')
    $intPtr=[IntPtr];$uint=[uint32];$int=[int32];$bool=[bool];$text=[Text.StringBuilder]
    $methods=@(
        @('CreateFileW','kernel32.dll',$intPtr,[Type[]]@([string],$uint,$uint,$intPtr,$uint,$uint,$intPtr)),
        @('CloseHandle','kernel32.dll',$bool,[Type[]]@($intPtr)),
        @('GetFileInformationByHandle','kernel32.dll',$bool,[Type[]]@($intPtr,$intPtr)),
        @('GetFileType','kernel32.dll',$uint,[Type[]]@($intPtr)),
        @('GetFinalPathNameByHandleW','kernel32.dll',$uint,[Type[]]@($intPtr,$text,$uint,$uint)),
        @('GetVolumeInformationByHandleW','kernel32.dll',$bool,[Type[]]@($intPtr,$text,$uint,$intPtr,$intPtr,$intPtr,$text,$uint)),
        @('GetKernelObjectSecurity','advapi32.dll',$bool,[Type[]]@($intPtr,$uint,$intPtr,$uint,$intPtr)),
        @('NtCreateFile','ntdll.dll',$int,[Type[]]@($intPtr,$uint,$intPtr,$intPtr,$intPtr,$uint,$uint,$uint,$uint,$intPtr,$uint)),
        @('NtQueryDirectoryFile','ntdll.dll',$int,[Type[]]@($intPtr,$intPtr,$intPtr,$intPtr,$intPtr,$intPtr,$uint,$int,[byte],$intPtr,[byte])),
        @('NtQueryInformationFile','ntdll.dll',$int,[Type[]]@($intPtr,$intPtr,$intPtr,$uint,$int)),
        @('NtSetInformationFile','ntdll.dll',$int,[Type[]]@($intPtr,$intPtr,$intPtr,$uint,$int))
    )
    foreach($spec in $methods){
        $method=$builder.DefinePInvokeMethod($spec[0],$spec[1],$spec[0],
            [Reflection.MethodAttributes]'Public,Static,PinvokeImpl',[Reflection.CallingConventions]::Standard,
            $spec[2],$spec[3],[Runtime.InteropServices.CallingConvention]::Winapi,[Runtime.InteropServices.CharSet]::Unicode)
        $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
    }
    $script:emptyNative=$builder.CreateType()
}
function Invoke-EmptyVersionNative {
    param([string]$Name,[object[]]$Arguments)
    if($Name -cnotin @('CreateFileW','CloseHandle','GetFileInformationByHandle','GetFileType',
        'GetFinalPathNameByHandleW','GetVolumeInformationByHandleW','GetKernelObjectSecurity',
        'NtCreateFile','NtQueryDirectoryFile','NtQueryInformationFile','NtSetInformationFile')){throw 'EMPTY_VERSION_NATIVE_METHOD_UNPROVEN'}
    if($Name -cne 'CloseHandle' -and $script:emptyClock.ElapsedMilliseconds -gt 10000){throw 'EMPTY_VERSION_OBSERVATION_BUDGET'}
    $method=$script:emptyNative.GetMethod($Name,[Reflection.BindingFlags]'Public,Static,DeclaredOnly')
    if($null -eq $method){throw 'EMPTY_VERSION_NATIVE_METHOD_UNPROVEN'}
    return $method.Invoke($null,$Arguments)
}
function Get-EmptyVersionDigest {
    param([byte[]]$Bytes)
    $sha=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Read-EmptyVersionUInt32 {
    param([IntPtr]$Buffer,[int]$Offset)
    # PowerShell's checked signed-to-unsigned cast rejects valid high FileIDs.
    return [BitConverter]::ToUInt32([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt32($Buffer,$Offset)),0)
}
function Get-EmptyVersionInformation {
    param([IntPtr]$Handle,[bool]$Directory)
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(52)
    try{
        if((Invoke-EmptyVersionNative 'GetFileType' @($Handle)) -ne 1 -or
            -not (Invoke-EmptyVersionNative 'GetFileInformationByHandle' @($Handle,$buffer))){throw 'EMPTY_VERSION_IDENTITY_UNPROVEN'}
        $attributes=Read-EmptyVersionUInt32 $buffer 0
        if(($attributes -band 0x400) -ne 0 -or (($attributes -band 0x10) -ne 0) -ne $Directory){throw 'EMPTY_VERSION_REDIRECTION_REFUSED'}
        $volume=Read-EmptyVersionUInt32 $buffer 28
        $high=Read-EmptyVersionUInt32 $buffer 44
        $low=Read-EmptyVersionUInt32 $buffer 48
        $links=Read-EmptyVersionUInt32 $buffer 40
        if($links -ne 1){throw 'EMPTY_VERSION_LINK_IDENTITY_UNPROVEN'}
        $path=[Text.StringBuilder]::new(1024)
        $length=Invoke-EmptyVersionNative 'GetFinalPathNameByHandleW' @($Handle,$path,[uint32]1024,[uint32]1)
        if($length -lt 1 -or $length -ge 1024 -or $path.Length -ne $length){throw 'EMPTY_VERSION_PHYSICAL_PATH_UNPROVEN'}
        return [pscustomobject]@{identity=('{0:x8}:{1:x8}{2:x8}' -f $volume,$high,$low);volume=$volume;path=$path.ToString();
            created=[Runtime.InteropServices.Marshal]::ReadInt64($buffer,4).ToString();
            written=[Runtime.InteropServices.Marshal]::ReadInt64($buffer,20).ToString();attributes=$attributes}
    }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
}
function Get-EmptyVersionSecurity {
    param([IntPtr]$Handle)
    $size=[Runtime.InteropServices.Marshal]::AllocHGlobal(4);$buffer=[IntPtr]::Zero
    try{
        [Runtime.InteropServices.Marshal]::WriteInt32($size,0)
        [void](Invoke-EmptyVersionNative 'GetKernelObjectSecurity' @($Handle,[uint32]5,[IntPtr]::Zero,[uint32]0,$size))
        $length=[Runtime.InteropServices.Marshal]::ReadInt32($size)
        if($length -lt 20 -or $length -gt 65536){throw 'EMPTY_VERSION_SECURITY_UNPROVEN'}
        $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal($length)
        if(-not (Invoke-EmptyVersionNative 'GetKernelObjectSecurity' @($Handle,[uint32]5,$buffer,[uint32]$length,$size)) -or
            [Runtime.InteropServices.Marshal]::ReadInt32($size) -ne $length){throw 'EMPTY_VERSION_SECURITY_CHANGED'}
        $bytes=[byte[]]::new($length);[Runtime.InteropServices.Marshal]::Copy($buffer,$bytes,0,$length)
        $descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($bytes,0)
        return [pscustomobject]@{descriptor=$descriptor;sha256=(Get-EmptyVersionDigest $bytes)}
    }finally{if($buffer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)};[Runtime.InteropServices.Marshal]::FreeHGlobal($size)}
}
function Assert-EmptyVersionProtectedSecurity {
    param($Security,[bool]$Ancestor=$false)
    $sd=$Security.descriptor
    $allowed=@('S-1-5-18','S-1-5-32-544')
    if($Ancestor){$allowed+='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'}
    if($sd.Owner.Value -cnotin $allowed -or $null -eq $sd.DiscretionaryAcl -or
        -not ($sd.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -or
        (-not $Ancestor -and -not ($sd.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected))){throw 'EMPTY_VERSION_PROTECTION_UNPROVEN'}
    foreach($ace in $sd.DiscretionaryAcl){
        if($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback){throw 'EMPTY_VERSION_ACL_UNPROVEN'}
        if($Ancestor -and ($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly)){continue}
        if($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
            ($ace.AccessMask -band 0x500D0156) -ne 0 -and $ace.SecurityIdentifier.Value -cnotin $allowed){throw 'EMPTY_VERSION_WRITE_AUTHORITY_UNPROVEN'}
    }
}
function Open-EmptyVersionDirectory {
    param([string]$Path,[bool]$Rename=$false)
    $access=[uint32]0x120081
    if($Rename){$access=[uint32]0x130081}
    $handle=Invoke-EmptyVersionNative 'CreateFileW' @($Path,$access,[uint32]1,[IntPtr]::Zero,[uint32]3,[uint32]0x02200000,[IntPtr]::Zero)
    if($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)){throw 'EMPTY_VERSION_OPEN_UNPROVEN'}
    $script:emptyPins.Add($handle)
    return [pscustomobject]@{handle=$handle;info=(Get-EmptyVersionInformation $handle $true)}
}
function Assert-EmptyVersionDirectory {
    param([IntPtr]$Handle)
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(4096)
    $iosb=[Runtime.InteropServices.Marshal]::AllocHGlobal(2*[IntPtr]::Size)
    $done=$false
    try{
        for($attempt=0;$attempt -lt 4;$attempt++){
            $status=Invoke-EmptyVersionNative 'NtQueryDirectoryFile' @($Handle,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,
                $iosb,$buffer,[uint32]4096,[int32]12,[byte]1,[IntPtr]::Zero,[byte]($attempt -eq 0))
            if($status -eq -2147483642){$done=$true;break} # STATUS_NO_MORE_FILES
            if($status -ne 0){throw 'EMPTY_VERSION_DIRECTORY_ENUMERATION_UNPROVEN'}
            $length=if([IntPtr]::Size -eq 8){[Runtime.InteropServices.Marshal]::ReadInt64($iosb,[IntPtr]::Size)}else{[Runtime.InteropServices.Marshal]::ReadInt32($iosb,[IntPtr]::Size)}
            if($length -lt 14 -or $length -gt 4096 -or [Runtime.InteropServices.Marshal]::ReadInt32($buffer,0) -ne 0){throw 'EMPTY_VERSION_DIRECTORY_RECORD_INVALID'}
            $nameLength=[Runtime.InteropServices.Marshal]::ReadInt32($buffer,8)
            if($nameLength -lt 2 -or ($nameLength % 2) -ne 0 -or $nameLength -gt ($length-12)){throw 'EMPTY_VERSION_DIRECTORY_RECORD_INVALID'}
            $bytes=[byte[]]::new($nameLength);[Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($buffer,12),$bytes,0,$nameLength)
            $name=[Text.UnicodeEncoding]::new($false,$false,$true).GetString($bytes)
            if($name -cnotin @('.','..')){throw 'EMPTY_VERSION_DIRECTORY_NOT_EMPTY'}
        }
        if(-not $done){throw 'EMPTY_VERSION_DIRECTORY_ENUMERATION_UNPROVEN'}
    }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer);[Runtime.InteropServices.Marshal]::FreeHGlobal($iosb)}
}
function Assert-EmptyVersionNoAlternateStreams {
    param([IntPtr]$Handle)
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(16384)
    $iosb=[Runtime.InteropServices.Marshal]::AllocHGlobal(2*[IntPtr]::Size)
    try{
        $status=Invoke-EmptyVersionNative 'NtQueryInformationFile' @($Handle,$iosb,$buffer,[uint32]16384,[int32]22)
        if($status -ne 0){throw 'EMPTY_VERSION_STREAM_ENUMERATION_UNPROVEN'}
        $length=if([IntPtr]::Size -eq 8){[Runtime.InteropServices.Marshal]::ReadInt64($iosb,[IntPtr]::Size)}else{[Runtime.InteropServices.Marshal]::ReadInt32($iosb,[IntPtr]::Size)}
        if($length -lt 0 -or $length -gt 16384){throw 'EMPTY_VERSION_STREAM_RECORD_INVALID'}
        if($length -eq 0){return}
        $offset=0;$seen=0
        while($true){
            if(++$seen -gt 8 -or $offset -gt ($length-24)){throw 'EMPTY_VERSION_STREAM_RECORD_INVALID'}
            $row=[IntPtr]::Add($buffer,$offset)
            $next=[Runtime.InteropServices.Marshal]::ReadInt32($row,0)
            $nameLength=[Runtime.InteropServices.Marshal]::ReadInt32($row,4)
            $size=[Runtime.InteropServices.Marshal]::ReadInt64($row,8)
            $allocation=[Runtime.InteropServices.Marshal]::ReadInt64($row,16)
            if($nameLength -lt 2 -or ($nameLength % 2) -ne 0 -or $nameLength -gt ($length-$offset-24) -or $size -lt 0 -or $allocation -lt 0){throw 'EMPTY_VERSION_STREAM_RECORD_INVALID'}
            $bytes=[byte[]]::new($nameLength);[Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($row,24),$bytes,0,$nameLength)
            $name=[Text.UnicodeEncoding]::new($false,$false,$true).GetString($bytes)
            # Directory index metadata is not a user data stream. Everything
            # else, including an unexpected unnamed data stream, is a refusal.
            if($name -cnotin @(':$I30:$INDEX_ALLOCATION',':$I30:$BITMAP','::$INDEX_ALLOCATION')){throw 'EMPTY_VERSION_ALTERNATE_STREAM_PRESENT'}
            if($next -eq 0){break}
            if($next -lt (24+$nameLength) -or ($next % 8) -ne 0 -or $next -gt ($length-$offset-24)){throw 'EMPTY_VERSION_STREAM_RECORD_INVALID'}
            $offset+=$next
        }
    }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer);[Runtime.InteropServices.Marshal]::FreeHGlobal($iosb)}
}
function Rename-EmptyVersionSameParent {
    param([IntPtr]$Handle,[string]$Basename)
    if($Basename -cnotmatch '^pending-compile-d390300e737265984ec5ee2b1b471f8d833aae16-[a-f0-9]{32}$'){throw 'EMPTY_VERSION_DESTINATION_REFUSED'}
    $name=[Text.Encoding]::Unicode.GetBytes($Basename)
    $rootOffset=if([IntPtr]::Size -eq 8){8}else{4}
    $lengthOffset=$rootOffset+[IntPtr]::Size;$nameOffset=$lengthOffset+4
    $length=$nameOffset+$name.Length
    $buffer=[Runtime.InteropServices.Marshal]::AllocHGlobal($length)
    $iosb=[Runtime.InteropServices.Marshal]::AllocHGlobal(2*[IntPtr]::Size)
    try{
        $zero=[byte[]]::new($length);[Runtime.InteropServices.Marshal]::Copy($zero,0,$buffer,$length)
        # ReplaceIfExists=false; RootDirectory=NULL; a single basename binds
        # this no-replace rename to the retained source's SAME parent.
        [Runtime.InteropServices.Marshal]::WriteInt32($buffer,$lengthOffset,$name.Length)
        [Runtime.InteropServices.Marshal]::Copy($name,0,[IntPtr]::Add($buffer,$nameOffset),$name.Length)
        $status=Invoke-EmptyVersionNative 'NtSetInformationFile' @($Handle,$iosb,$buffer,[uint32]$length,[int32]10)
        if($status -ne 0){throw 'EMPTY_VERSION_RENAME_UNPROVEN'}
    }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer);[Runtime.InteropServices.Marshal]::FreeHGlobal($iosb)}
}
function Assert-EmptyVersionSourceAbsent {
    param([IntPtr]$ParentHandle)
    # Positive native name absence in the retained parent, not Exists(), whose
    # false result also represents access/I/O failures. No caller-selected name.
    $name=[Text.Encoding]::Unicode.GetBytes('d390300e737265984ec5ee2b1b471f8d833aae16')
    $pointer=[IntPtr]::Size
    $unicodeLength=if($pointer -eq 8){16}else{8}
    $attributesLength=if($pointer -eq 8){48}else{24}
    $rootOffset=if($pointer -eq 8){8}else{4}
    $nameOffset=2*$rootOffset;$flagsOffset=3*$rootOffset
    $string=[Runtime.InteropServices.Marshal]::AllocHGlobal($name.Length)
    $unicode=[Runtime.InteropServices.Marshal]::AllocHGlobal($unicodeLength)
    $attributes=[Runtime.InteropServices.Marshal]::AllocHGlobal($attributesLength)
    $iosb=[Runtime.InteropServices.Marshal]::AllocHGlobal(2*$pointer)
    $opened=[Runtime.InteropServices.Marshal]::AllocHGlobal($pointer)
    try{
        foreach($pair in @(@($unicode,$unicodeLength),@($attributes,$attributesLength),@($opened,$pointer))){
            $zero=[byte[]]::new([int]$pair[1]);[Runtime.InteropServices.Marshal]::Copy($zero,0,$pair[0],$zero.Length)
        }
        [Runtime.InteropServices.Marshal]::Copy($name,0,$string,$name.Length)
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode,0,[int16]$name.Length)
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode,2,[int16]$name.Length)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($unicode,$rootOffset,$string)
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes,0,$attributesLength)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,$rootOffset,$ParentHandle)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,$nameOffset,$unicode)
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes,$flagsOffset,0x40) # OBJ_CASE_INSENSITIVE
        $status=Invoke-EmptyVersionNative 'NtCreateFile' @($opened,[uint32]0x120081,$attributes,$iosb,[IntPtr]::Zero,
            [uint32]0,[uint32]1,[uint32]1,[uint32]0x00204021,[IntPtr]::Zero,[uint32]0)
        $handle=[Runtime.InteropServices.Marshal]::ReadIntPtr($opened)
        if($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)){
            [void](Invoke-EmptyVersionNative 'CloseHandle' @($handle))
            throw 'EMPTY_VERSION_SOURCE_NAME_REAPPEARED'
        }
        if($status -ne -1073741772){throw 'EMPTY_VERSION_SOURCE_ABSENCE_UNPROVEN'} # STATUS_OBJECT_NAME_NOT_FOUND
    }finally{
        foreach($buffer in @($string,$unicode,$attributes,$iosb,$opened)){[Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)}
    }
}
function Read-EmptyVersionPinnedFile {
    param([string]$Path,[int]$Maximum,[bool]$Protected=$false)
    $stream=[IO.FileStream]::new($Path,'Open','Read','Read')
    $script:emptyStreams.Add($stream)
    $handle=$stream.SafeFileHandle.DangerousGetHandle()
    [void](Get-EmptyVersionInformation $handle $false)
    if($Protected){Assert-EmptyVersionProtectedSecurity (Get-EmptyVersionSecurity $handle)}
    $length=$stream.Length
    if($length -lt 1 -or $length -gt $Maximum){throw 'EMPTY_VERSION_FILE_BOUND'}
    $bytes=[byte[]]::new([int]$length);$offset=0
    while($offset -lt $bytes.Length){$count=$stream.Read($bytes,$offset,$bytes.Length-$offset);if($count -le 0){throw 'EMPTY_VERSION_FILE_CHANGED'};$offset+=$count}
    if($stream.ReadByte() -ne -1 -or $stream.Length -ne $length){throw 'EMPTY_VERSION_FILE_CHANGED'}
    return ,$bytes
}
function Write-EmptyVersionReceipt {
    param([string]$Path,$Record,[string]$OperatorSid)
    $acl=[Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    foreach($sid in @('S-1-5-18','S-1-5-32-544')){
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($OperatorSid),'Read','Allow'))
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Record|ConvertTo-Json -Depth 8 -Compress))
    if($bytes.Length -gt 16384){throw 'EMPTY_VERSION_RECEIPT_BOUND'}
    $file=[IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,
        [IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$acl)
    try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
}
function Invoke-EmptyVersionQuarantine {
    param($Bootstrap)
    $sourcePath=[IO.Path]::Combine($protectedRoot,$targetVersion)
    $basename='pending-compile-'+$targetVersion+'-'+$Bootstrap.OperationId
    $destinationPath=[IO.Path]::Combine($protectedRoot,$basename)
    $mutationAttempted=$false;$renamed=$false
    $record=[ordered]@{schemaVersion='stephanos.empty-runtime-version-quarantine.v1';ok=$false;state='BLOCKED';reason='';
        sourceHead=$Bootstrap.SourceHead;sourceTree=$Bootstrap.SourceTree;operationId=$Bootstrap.OperationId;
        targetVersion=$targetVersion;installedSourceHead=$installedVersion;destinationBasename=$basename;
        mutationAttempted=$false;quarantined=$false;custodyReleased=$false;sourceLeaseReleased=$false;
        runtimeQualificationGranted=$false;pcRestartAllowed=$false;deleteAllowed=$false;retryAllowed=$false;
        evidenceSemantics='BOUNDED_PRE_POST_EMPTY_OBSERVATION_WITH_PROTECTED_WRITERS';
        privilegedConcurrentWriterExclusionProven=$false}
    try{
        # Ancestors are pinned without write/delete sharing. No redirection or
        # writable-root normalization is permitted by this recovery artifact.
        $paths=@('C:\','C:\Program Files','C:\Program Files\Stephanos',$protectedRoot)
        $root=$null;$volumePath=''
        foreach($path in $paths){
            $pin=Open-EmptyVersionDirectory $path
            if(-not $root){$volumePath=$pin.info.path.TrimEnd('\')}
            $expected=if($path.Length -eq 3){$volumePath+'\'}else{$volumePath+'\'+$path.Substring(3)}
            if(-not [string]::Equals($pin.info.path.TrimEnd('\'),$expected.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)){throw 'EMPTY_VERSION_ANCESTOR_CHANGED'}
            Assert-EmptyVersionProtectedSecurity (Get-EmptyVersionSecurity $pin.handle) ($path.Length -eq 3 -or $path -ceq 'C:\Program Files')
            $root=$pin
        }
        $fs=[Text.StringBuilder]::new(64)
        if(-not (Invoke-EmptyVersionNative 'GetVolumeInformationByHandleW' @($root.handle,[Text.StringBuilder]::new(64),[uint32]64,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,$fs,[uint32]64)) -or $fs.ToString() -cne 'NTFS'){throw 'EMPTY_VERSION_NTFS_REQUIRED'}
        $installedPin=Open-EmptyVersionDirectory ([IO.Path]::Combine($protectedRoot,$installedVersion))
        Assert-EmptyVersionProtectedSecurity (Get-EmptyVersionSecurity $installedPin.handle)
        $pending=Read-EmptyVersionPinnedFile ([IO.Path]::Combine($protectedRoot,$installedVersion,'pending.json')) 32768 $true
        $p=[Text.UTF8Encoding]::new($false,$true).GetString($pending)|ConvertFrom-Json
        if((Get-EmptyVersionDigest $pending) -cne $Bootstrap.Installed.PendingSha256 -or
            $p.SchemaVersion -cne 'stephanos.fixed-runtime-pending.v1'){throw 'EMPTY_VERSION_INSTALLED_CHANGED'}
        foreach($key in @('SourceHead','SourceTree','HelperSha256','ManifestSha256','GitClosureSha256')){
            if($p.$key -cne $Bootstrap.Installed.$key){throw 'EMPTY_VERSION_INSTALLED_CHANGED'}
        }
        foreach($pair in @(@('host.exe','HelperSha256'),@('manifest.json','ManifestSha256'))){
            $bytes=Read-EmptyVersionPinnedFile ([IO.Path]::Combine($protectedRoot,$installedVersion,$pair[0])) 2097152 $true
            if((Get-EmptyVersionDigest $bytes) -cne $Bootstrap.Installed.($pair[1])){throw 'EMPTY_VERSION_INSTALLED_CHANGED'}
        }
        # Do not execute Git or load repository code with the elevated token.
        foreach($pair in @(@('.git\HEAD','ref: refs/heads/main'),@('.git\refs\heads\main',$Bootstrap.SourceHead))){
            $bytes=Read-EmptyVersionPinnedFile ([IO.Path]::Combine($sourceRoot,$pair[0])) 256
            if([Text.UTF8Encoding]::new($false,$true).GetString($bytes).Trim() -cne $pair[1]){throw 'EMPTY_VERSION_CANONICAL_SOURCE_CHANGED'}
        }
        $source=Open-EmptyVersionDirectory $sourcePath $true
        if($source.info.identity -ceq $installedPin.info.identity -or $source.info.volume -ne $root.info.volume -or
            -not [string]::Equals($source.info.path,$root.info.path.TrimEnd('\')+'\'+$targetVersion,[StringComparison]::OrdinalIgnoreCase)){throw 'EMPTY_VERSION_SOURCE_IDENTITY_UNPROVEN'}
        $security=Get-EmptyVersionSecurity $source.handle
        Assert-EmptyVersionProtectedSecurity $security
        Assert-EmptyVersionDirectory $source.handle
        Assert-EmptyVersionNoAlternateStreams $source.handle
        # No atomic-empty-CAS claim: another Administrator can still add a child.
        # Every post-rename uncertainty preserves history and returns UNKNOWN.
        $mutationAttempted=$true;$record.mutationAttempted=$true
        Rename-EmptyVersionSameParent $source.handle $basename
        $renamed=$true;$record.quarantined=$true
        $after=Get-EmptyVersionInformation $source.handle $true
        if($after.identity -cne $source.info.identity -or $after.created -cne $source.info.created -or
            -not [string]::Equals($after.path,$root.info.path.TrimEnd('\')+'\'+$basename,[StringComparison]::OrdinalIgnoreCase) -or
            (Get-EmptyVersionSecurity $source.handle).sha256 -cne $security.sha256){throw 'EMPTY_VERSION_POST_RENAME_IDENTITY_UNPROVEN'}
        Assert-EmptyVersionDirectory $source.handle
        Assert-EmptyVersionNoAlternateStreams $source.handle
        Assert-EmptyVersionSourceAbsent $root.handle
        $record.identity=$after.identity;$record.aclSha256=$security.sha256;$record.originalCreationFileTime=$source.info.created
        $record.originalWriteFileTime=$source.info.written;$record.emptyBefore=$true;$record.emptyAfterRenameBeforeReceipt=$true
        $record.observedAtUtc=[DateTime]::UtcNow.ToString('o');$record.ok=$true;$record.state='QUARANTINED'
        Write-EmptyVersionReceipt ([IO.Path]::Combine($destinationPath,$receiptName)) $record $Bootstrap.OperatorSid
        return [pscustomobject]$record
    }catch{
        $record.ok=$false;$record.state=if($mutationAttempted){'UNKNOWN'}else{'BLOCKED'}
        $record.reason=if($_.Exception.Message -cmatch '^EMPTY_VERSION_[A-Z0-9_]{1,80}$'){$_.Exception.Message}else{'EMPTY_VERSION_OPERATION_UNPROVEN'}
        $record.quarantined=$renamed
        return [pscustomobject]$record
    }
}

# ENTRY: immutable loader + current same operator's attended administrator token.
$bootstrap=$script:EmptyRuntimeVersionPinnedBootstrapV1
try{
    if(-not $OperatorApproved -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedMain -ceq $targetVersion -or
        $null -eq $bootstrap -or $bootstrap.SchemaVersion -cne 'stephanos.empty-runtime-version-input.v1' -or
        $bootstrap.SourceHead -cne $ExpectedMain -or $bootstrap.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
        $bootstrap.TargetVersion -cne $targetVersion -or $bootstrap.OperationId -cnotmatch '^[a-f0-9]{32}$' -or
        $bootstrap.OperatorSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        $bootstrap.Installed.SourceHead -cne $installedVersion -or $bootstrap.Records.Count -ne 2){throw 'EMPTY_VERSION_IMMUTABLE_APPROVAL_REQUIRED'}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    try{
        if($identity.User.Value -cne $bootstrap.OperatorSid -or
            -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'EMPTY_VERSION_SAME_OPERATOR_ADMINISTRATOR_REQUIRED'}
    }finally{$identity.Dispose()}
    $seen=@{}
    foreach($row in $bootstrap.Records){
        if($row.Path -cnotin @($entryPath,$factoryPath) -or $seen.ContainsKey($row.Path) -or
            $row.GitBlobSha -cnotmatch '^[a-f0-9]{40}$' -or $row.Sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'EMPTY_VERSION_SOURCE_RECORD_INVALID'}
        $bytes=[Convert]::FromBase64String($row.ContentBase64)
        if($bytes.Length -lt 1 -or $bytes.Length -gt 196608 -or (Get-EmptyVersionDigest $bytes) -cne $row.Sha256){throw 'EMPTY_VERSION_SOURCE_RECORD_INVALID'}
        $sha=[Security.Cryptography.SHA1]::Create()
        try{$gitBlob=([BitConverter]::ToString($sha.ComputeHash([byte[]]([Text.Encoding]::ASCII.GetBytes('blob '+$bytes.Length+[char]0)+$bytes)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
        if($gitBlob -cne $row.GitBlobSha){throw 'EMPTY_VERSION_SOURCE_RECORD_INVALID'}
        $seen[$row.Path]=$true
    }
    Initialize-EmptyVersionNative
    $script:emptyClock.Restart()
    $result=Invoke-EmptyVersionQuarantine $bootstrap
}catch{
    $result=[pscustomobject]@{schemaVersion='stephanos.empty-runtime-version-quarantine.v1';ok=$false;state='BLOCKED';
        reason=if($_.Exception.Message -cmatch '^EMPTY_VERSION_[A-Z0-9_]{1,80}$'){$_.Exception.Message}else{'EMPTY_VERSION_ENTRY_UNPROVEN'};
        mutationAttempted=$false;quarantined=$false;custodyReleased=$false;sourceLeaseReleased=$false;
        runtimeQualificationGranted=$false;pcRestartAllowed=$false;deleteAllowed=$false;retryAllowed=$false}
}finally{
    foreach($stream in $script:emptyStreams){try{$stream.Dispose()}catch{}}
    for($i=$script:emptyPins.Count-1;$i -ge 0;$i--){try{[void](Invoke-EmptyVersionNative 'CloseHandle' @($script:emptyPins[$i]))}catch{}}
}
[Console]::WriteLine('SOVEREIGN_EMPTY_RUNTIME_VERSION_QUARANTINE_V1='+($result|ConvertTo-Json -Depth 8 -Compress))
if(-not $result.ok){exit 2}
