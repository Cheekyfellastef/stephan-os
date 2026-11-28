# Separate manual exact-key retirement. Never a runtime verb or enrollment reset.
# The immutable caller authenticates all captured Git members, review and approval.
param([ValidateSet('Observe','Retire')][string]$Mode='Observe',[switch]$OperatorApproved,
 [string]$ExpectedMain='',[string]$ExpectedFingerprint='',[string]$ExpectedKeySha256='')
$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None'
$pinned=$script:MobileInstallerKeyRetirementPinnedV1
if($null -eq $pinned -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or $pinned.SourceHead -cne $ExpectedMain -or
 $pinned.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or $pinned.Records.Count -ne 20 -or $pinned.Mode -cne $Mode -or
 $pinned.KeySha256 -cne $ExpectedKeySha256 -or $ExpectedKeySha256 -cnotmatch '^[a-f0-9]{64}$' -or
 ($Mode -ceq 'Retire' -and (-not $OperatorApproved -or $ExpectedFingerprint -cnotmatch '^[a-f0-9]{64}$' -or
 $pinned.Fingerprint -cne $ExpectedFingerprint))){throw 'MOBILE_RETIRE_IMMUTABLE_GATE_REQUIRED'}
$records=@{}
foreach($row in $pinned.Records) {
 if($records.ContainsKey($row.Path) -or $row.Sha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'MOBILE_RETIRE_RECORD_REFUSED'}
 $bytes=[Convert]::FromBase64String($row.ContentBase64);$sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($bytes.Length -lt 1 -or $bytes.Length -gt 32768 -or $actual -cne $row.Sha256){throw 'MOBILE_RETIRE_RECORD_CHANGED'}
 $records[$row.Path]=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
}
$declaration=$records['shared/agents/sovereignMobileInstallerNativeClosureV1.json']|ConvertFrom-Json
if($declaration.schemaVersion -cne 'stephanos.mobile-installer-native-closure.v1' -or $declaration.paths.Count -ne 17){throw 'MOBILE_RETIRE_CLOSURE_REFUSED'}
$source=($declaration.paths|ForEach-Object{if(-not $records.ContainsKey($_)){throw 'MOBILE_RETIRE_SOURCE_MISSING'};$records[$_]}) -join [Environment]::NewLine
$preserve=$records['scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1']
$start=$preserve.IndexOf("`$native=@'`n",[StringComparison]::Ordinal);$end=$preserve.IndexOf("`n'@`n",$start,[StringComparison]::Ordinal)
if($start -lt 0 -or $end -le $start){throw 'MOBILE_RETIRE_PRESERVATION_SOURCE_REFUSED'}
$source+=[Environment]::NewLine+$preserve.Substring($start+11,$end-$start-11)
$native=@'
namespace Stephanos.Sovereign {
 using System;using System.Collections.Generic;using System.IO;using System.Security.Cryptography;using Microsoft.Win32.SafeHandles;
 public static partial class MobilePartialPreservationV1 {
  const string RetirementOperation="RETIRE_UNQUALIFIED_MOBILE_RECEIPT_KEY_V1";
  static string PublicFingerprint(CngKey key) {
   byte[] blob=key.Export(CngKeyBlobFormat.EccPublicBlob);
   if(blob.Length!=72 || blob[0]!=0x45 || blob[1]!=0x43 || blob[2]!=0x53 || blob[3]!=0x31 || BitConverter.ToUInt32(blob,4)!=32)Deny("MOBILE_RETIRE_PUBLIC_KEY_UNPROVEN");
   byte[] prefix={0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04};
   byte[] bytes=new byte[91];Buffer.BlockCopy(prefix,0,bytes,0,prefix.Length);Buffer.BlockCopy(blob,8,bytes,27,64);return Hash(bytes);
  }
  static string KeyOnlySnapshot(RootObject root,SafeFileHandle state,FileStream helper,string acl) {
   root.Verify(RootName);DirectoryInfo(state);
   string stateIdentity=Identity(DirectoryInfo(state));
   if(!String.Equals(FinalPath(state),FinalPath(root.Handle)+"\\state",StringComparison.OrdinalIgnoreCase))Deny("MOBILE_RETIRE_STATE_CHANGED");
   string[] entries=Directory.GetFileSystemEntries(Root);Array.Sort(entries,StringComparer.Ordinal);
   if(entries.Length!=2 || entries[0]!=Path.Combine(Root,"installer.exe") || entries[1]!=Path.Combine(Root,"state") ||
      Directory.GetFileSystemEntries(Path.Combine(Root,"state")).Length!=0)Deny("MOBILE_RETIRE_KEY_ONLY_PHASE_REQUIRED");
   Info info;if(!GetFileInformationByHandle(helper.SafeFileHandle,out info) || GetFileType(helper.SafeFileHandle)!=1 ||
      (info.Attributes&(0x400u|0x40u|0x10u))!=0 || info.Links!=1 || helper.Length<1 || helper.Length>2097152 ||
      !String.Equals(FinalPath(helper.SafeFileHandle),FinalPath(root.Handle)+"\\installer.exe",StringComparison.OrdinalIgnoreCase))Deny("MOBILE_RETIRE_HELPER_IDENTITY_UNPROVEN");
   byte[] bytes=new byte[(int)helper.Length];helper.Position=0;int at=0;
   while(at<bytes.Length){int n=helper.Read(bytes,at,bytes.Length-at);if(n<=0)Deny("MOBILE_RETIRE_HELPER_READ_UNPROVEN");at+=n;}
   if(helper.ReadByte()!=-1 || helper.Length!=bytes.Length || Acl(Root,false)!=acl)Deny("MOBILE_RETIRE_ROOT_CHANGED");
   // This is an exact current-object comparison, never compiled-source provenance.
   return root.RootIdentity+"\n"+root.ParentIdentity+"\n"+acl+"\n"+stateIdentity+"\n"+Acl(Path.Combine(Root,"state"),false)+"\n"+
     Identity(info)+"\n"+Acl(Path.Combine(Root,"installer.exe"),false)+"\n"+Hash(bytes)+"\n";
  }
  public static string RetireUnqualifiedKeyV1(string mode,string sid,string machine,string head,string tree,string expectedFingerprint,string expectedKey) {
   if((mode!="Observe" && mode!="Retire") || !Hex(head,40) || !Hex(tree,40) || !Hex(expectedKey,64) ||
      (mode=="Retire" && !Hex(expectedFingerprint,64)))Deny("MOBILE_RETIRE_EXACT_CONTEXT_REQUIRED");
   string context=Context(sid,machine,head,tree);var parents=new List<SafeFileHandle>();
   using(var exclusion=SovereignMobileInstallProvisioningV1.OpenManualBoundaryV2()) {
    try {
     var wire=new System.Text.StringBuilder(context).Append(RetirementOperation).Append('\n');
     foreach(string path in new[]{@"C:\",@"C:\Program Files",Parent}) {
      var pin=PinDirectory(path);parents.Add(pin);wire.Append(Identity(DirectoryInfo(pin))).Append('\n').Append(Acl(path,path!=Parent)).Append('\n');
     }
     CoreJobCustodyV1.RequireMobileTaskAbsentV2();SovereignMobileInstallAnchorV1.AssertMobileGenesisAbsentV2();
     using(var root=new RootObject(parents[2],RootName))
     using(var state=RelativeOpen(root.Handle,"state",0x00120089,1,false))
     using(var handle=RelativeOpen(root.Handle,"installer.exe",0x00120089,1,false))
     using(var helper=new FileStream(handle,FileAccess.Read))
     using(var key=SovereignMobileInstallAnchorV1.OpenReceiptKeyForEnrollmentV1()) {
      string publicHash=PublicFingerprint(key);if(publicHash!=expectedKey)Deny("MOBILE_RETIRE_EXACT_KEY_MISMATCH");
      string acl=Acl(Root,false),snapshot=KeyOnlySnapshot(root,state,helper,acl);
      string fingerprint=Hash(Utf8.GetBytes(wire.ToString()+publicHash+"\n"+snapshot));
      if(mode=="Observe")return "{\"status\":\"EXACT_UNQUALIFIED_KEY_RETIREMENT_REVIEW_REQUIRED\",\"operation\":\""+RetirementOperation+"\",\"fingerprint\":\""+fingerprint+"\",\"publicKeySha256\":\""+publicHash+"\",\"rootIdentity\":\""+root.RootIdentity+"\",\"keyRetired\":false,\"enrollmentQualified\":false,\"runtimeInstalled\":false,\"restartPerformed\":false}";
      if(fingerprint!=expectedFingerprint)Deny("MOBILE_RETIRE_EXACT_OBJECT_APPROVAL_MISMATCH");
      CoreJobCustodyV1.RequireMobileTaskAbsentV2();SovereignMobileInstallAnchorV1.AssertMobileGenesisAbsentV2();
      if(PublicFingerprint(key)!=publicHash || KeyOnlySnapshot(root,state,helper,acl)!=snapshot)Deny("MOBILE_RETIRE_CONTEXT_CHANGED");
      SovereignMobileInstallProvisioningV1.AssertManualBoundaryV2();
      // Same retained and compared object. No name re-resolution or overwrite.
      // After dispatch ANY exception is UNKNOWN/inspect-only, never blind retry.
      try {
       key.Delete();SovereignMobileInstallProvisioningV1.AssertFreshEnrollmentBoundaryV2();
       if(KeyOnlySnapshot(root,state,helper,acl)!=snapshot)Deny("MOBILE_RETIRE_FILES_CHANGED");
      }catch{throw new InvalidOperationException("MOBILE_RETIRE_UNKNOWN_INSPECT_ONLY_NO_RETRY");}
      return "{\"status\":\"EXACT_UNQUALIFIED_KEY_RETIRED_FILES_PRESERVED\",\"operation\":\""+RetirementOperation+"\",\"fingerprint\":\""+fingerprint+"\",\"publicKeySha256\":\""+publicHash+"\",\"rootIdentity\":\""+root.RootIdentity+"\",\"keyRetired\":true,\"filesPreserved\":true,\"enrollmentQualified\":false,\"runtimeInstalled\":false,\"restartPerformed\":false}";
     }
    }finally{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();}
   }
  }
 }
}
'@
$provider=[Microsoft.CSharp.CSharpCodeProvider]::new();$parameters=[CodeDom.Compiler.CompilerParameters]::new()
$parameters.GenerateInMemory=$true;$parameters.GenerateExecutable=$false;$parameters.TreatWarningsAsErrors=$true
foreach($reference in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll','Microsoft.CSharp.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
try {
 $compiled=$provider.CompileAssemblyFromSource($parameters,@($source+[Environment]::NewLine+$native))
 if($compiled.Errors.HasErrors){throw 'MOBILE_RETIRE_COMPILATION_FAILED'}
 $type=$compiled.CompiledAssembly.GetType('Stephanos.Sovereign.MobilePartialPreservationV1',$true)
 [Console]::WriteLine($type.GetMethod('RetireUnqualifiedKeyV1').Invoke($null,@($Mode,$pinned.OperatorSid,$pinned.MachineHash,
  $ExpectedMain,$pinned.SourceTree,$ExpectedFingerprint,$ExpectedKeySha256)))
}finally{$provider.Dispose()}
