# Separate manual, exact-fingerprint preservation gate. Never an installer verb.
# The immutable approved caller authenticates this script's Git membership,
# current merged source, independent specialist review and operator decision.
param([ValidateSet('Observe','Preserve')][string]$Mode='Observe',
 [switch]$OperatorApproved,[string]$ExpectedMain='',[string]$ExpectedFingerprint='')
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$pinned=$script:MobileInstallerPartialPreservationPinnedV1
if($null -eq $pinned -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or
 $pinned.SourceHead -cne $ExpectedMain -or $pinned.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
 $pinned.OperatorSid -cnotmatch '^S-1-5-21-[0-9-]+$' -or $pinned.MachineHash -cnotmatch '^[a-f0-9]{64}$' -or
 ($Mode -ceq 'Preserve' -and (-not $OperatorApproved -or $ExpectedFingerprint -cnotmatch '^[a-f0-9]{64}$'))){
 throw 'MOBILE_PARTIAL_IMMUTABLE_GATE_REQUIRED'
}
$native=@'
namespace Stephanos.Sovereign {
 using System;
 using System.Collections.Generic;
 using System.ComponentModel;
 using System.Diagnostics;
 using System.Diagnostics.Eventing.Reader;
 using System.Globalization;
 using System.IO;
 using System.Runtime.InteropServices;
 using System.Security.AccessControl;
 using System.Security.Cryptography;
 using System.Security.Principal;
 using System.Text;
 using Microsoft.Win32;
 using Microsoft.Win32.SafeHandles;

 public static class MobilePartialPreservationV1 {
  const string Parent=@"C:\Program Files\Stephanos";
  const string Root=Parent+@"\SovereignMobileInstallerV1";
  const string Key="Stephanos.SovereignMobileInstallerV1.Receipt";
  const string Task="Stephanos Mobile Runtime Installer V1";
  const string Log="Stephanos Maintenance Custody";
  const string Admin="S-1-5-32-544",SystemSid="S-1-5-18";
  const string TrustedInstaller="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);

  const string RootName="SovereignMobileInstallerV1",DestinationPrefix="SovereignMobileInstallerV1.failed-";
  const string Operation="QUARANTINE_EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_OPAQUE";
  const int NameMissing=unchecked((int)0xc0000034);
  [StructLayout(LayoutKind.Sequential)] struct Info {
   internal uint Attributes;internal System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;
   internal uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] struct UnicodeString {internal ushort Length,MaximumLength;internal IntPtr Buffer;}
  [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes {
   internal int Length;internal IntPtr RootDirectory,ObjectName;internal uint Attributes;internal IntPtr SecurityDescriptor,SecurityQualityOfService;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoStatusBlock {internal IntPtr Status;internal UIntPtr Information;}
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetFileType(SafeFileHandle handle);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,StringBuilder label,uint size,out uint serial,out uint maximum,out uint flags,StringBuilder filesystem,uint filesystemSize);
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out IntPtr handle,uint access,ref ObjectAttributes attributes,out IoStatusBlock status,IntPtr size,uint fileAttributes,uint sharing,uint disposition,uint options,IntPtr ea,uint eaLength);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle handle,out IoStatusBlock status,IntPtr information,uint length,int informationClass);
  [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);
  [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)] static extern int NCryptOpenStorageProvider(out IntPtr provider,string name,uint flags);
  [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)] static extern int NCryptOpenKey(IntPtr provider,out IntPtr key,string name,uint legacy,uint flags);
  [DllImport("ncrypt.dll")] static extern int NCryptFreeObject(IntPtr value);
  static void Deny(string code){throw new InvalidOperationException(code);}
  static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
  static string Identity(Info i){return i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8");}

  static bool Hex(string value,int count){return value!=null && value.Length==count && System.Text.RegularExpressions.Regex.IsMatch(value,@"\A[a-f0-9]+\z");}
  static bool Part(string name){return name!=null && System.Text.RegularExpressions.Regex.IsMatch(name,@"\A[A-Za-z0-9][A-Za-z0-9._-]{0,127}\z") && !name.EndsWith(".",StringComparison.Ordinal);}
  static Info DirectoryInfo(SafeFileHandle handle) {
   Info info;if(handle==null || handle.IsInvalid || !GetFileInformationByHandle(handle,out info) || GetFileType(handle)!=1 ||
     (info.Attributes&0x10)==0 || (info.Attributes&(0x400u|0x40u))!=0)throw new InvalidOperationException("MOBILE_PARTIAL_DIRECTORY_IDENTITY_UNPROVEN");
   return info;
  }
  static string FinalPath(SafeFileHandle handle) {
   var path=new StringBuilder(2048);uint size=GetFinalPathNameByHandleW(handle,path,(uint)path.Capacity,1);
   if(size==0 || size>=path.Capacity)throw new InvalidOperationException("MOBILE_PARTIAL_FINAL_PATH_UNPROVEN");return path.ToString();
  }
  static SafeFileHandle PinDirectory(string path) {
   var handle=CreateFileW(path,0x00120089,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
   try{DirectoryInfo(handle);return handle;}catch{handle.Dispose();throw;}
  }
  static SafeFileHandle RelativeOpen(SafeFileHandle parent,string name,uint access,uint sharing,bool missing) {
   if(!Part(name))throw new InvalidOperationException("MOBILE_PARTIAL_SINGLE_NAME_REQUIRED");
   IntPtr chars=Marshal.StringToHGlobalUni(name),unicode=IntPtr.Zero;bool retained=false;
   try {
    var value=new UnicodeString {Length=checked((ushort)(name.Length*2)),MaximumLength=checked((ushort)((name.Length+1)*2)),Buffer=chars};
    unicode=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));Marshal.StructureToPtr(value,unicode,false);
    parent.DangerousAddRef(ref retained);
    var attributes=new ObjectAttributes {Length=Marshal.SizeOf(typeof(ObjectAttributes)),RootDirectory=parent.DangerousGetHandle(),ObjectName=unicode,Attributes=0x40};
    IntPtr raw;IoStatusBlock ios;int status=NtCreateFile(out raw,access,ref attributes,out ios,IntPtr.Zero,0,sharing,1,0x00200020,IntPtr.Zero,0);
    if(missing && status==NameMissing)return null;
    if(status!=0)throw new Win32Exception((int)RtlNtStatusToDosError(status));
    var handle=new SafeFileHandle(raw,true);if(handle.IsInvalid){handle.Dispose();throw new InvalidOperationException("MOBILE_PARTIAL_RELATIVE_OPEN_UNPROVEN");}return handle;
   }finally{if(retained)parent.DangerousRelease();if(unicode!=IntPtr.Zero)Marshal.FreeHGlobal(unicode);Marshal.FreeHGlobal(chars);}
  }
  // Reuses SovereignFileMoveV1's canonical SAME-PARENT primitive. Non-null
  // RootDirectory can reopen by pathname; never admit it or an absolute target.
  static void KernelRename(SafeFileHandle source,string name) {
   if(!name.StartsWith(DestinationPrefix,StringComparison.Ordinal) || !Hex(name.Substring(DestinationPrefix.Length),64))Deny("MOBILE_PARTIAL_QUARANTINE_NAME_REFUSED");
   byte[] bytes=new UnicodeEncoding(false,false,true).GetBytes(name);
   int handleOffset=IntPtr.Size==8?8:4,lengthOffset=handleOffset+IntPtr.Size,nameOffset=lengthOffset+4;
   byte[] rename=new byte[nameOffset+bytes.Length+2]; // no replace, NULL root, NUL terminator
   Buffer.BlockCopy(BitConverter.GetBytes((uint)bytes.Length),0,rename,lengthOffset,4);Buffer.BlockCopy(bytes,0,rename,nameOffset,bytes.Length);
   var pin=GCHandle.Alloc(rename,GCHandleType.Pinned);
   try{IoStatusBlock ios;int status=NtSetInformationFile(source,out ios,pin.AddrOfPinnedObject(),(uint)rename.Length,10);if(status!=0)throw new Win32Exception((int)RtlNtStatusToDosError(status));}
   finally{pin.Free();}
  }
  // Private handle fixture seam. Shipping Run supplies only the fixed parent
  // and fixed root basename. It never selects or traverses child contents.
  sealed class RootObject : IDisposable {
   internal readonly SafeFileHandle ParentHandle,Handle;
   internal readonly string OriginalName,RootIdentity,ParentIdentity,ParentPath;
   bool used;
   internal RootObject(SafeFileHandle parent,string name) {
    ParentHandle=parent;OriginalName=name;ParentIdentity=Identity(DirectoryInfo(parent));ParentPath=FinalPath(parent);
    Handle=RelativeOpen(parent,name,0x00130089,1,false);
    try {
     var info=DirectoryInfo(Handle);RootIdentity=Identity(info);
     var fs=new StringBuilder(32);uint serial,maximum,flags;
     if(!GetVolumeInformationByHandleW(parent,null,0,out serial,out maximum,out flags,fs,(uint)fs.Capacity) || fs.ToString()!="NTFS" || serial!=info.Volume || DirectoryInfo(parent).Volume!=info.Volume)Deny("MOBILE_PARTIAL_LOCAL_NTFS_REQUIRED");
     Verify(name);
    }catch{Handle.Dispose();throw;}
   }
   internal void Verify(string name) {
    if(Identity(DirectoryInfo(ParentHandle))!=ParentIdentity || FinalPath(ParentHandle)!=ParentPath || Identity(DirectoryInfo(Handle))!=RootIdentity ||
      !String.Equals(FinalPath(Handle),ParentPath+"\\"+name,StringComparison.OrdinalIgnoreCase))Deny("MOBILE_PARTIAL_PINNED_OBJECT_CHANGED");
   }
   internal string Quarantine(string fingerprint) {
    if(used || !Hex(fingerprint,64))Deny("MOBILE_PARTIAL_REQUEST_ALREADY_USED_OR_INVALID");used=true;
    string name=DestinationPrefix+fingerprint;Verify(OriginalName);
    using(var target=RelativeOpen(ParentHandle,name,0x00100080,7,true))if(target!=null)Deny("MOBILE_PARTIAL_DESTINATION_EXISTS_INSPECT_ONLY");
    KernelRename(Handle,name);Verify(name);
    // Only authentic NAME_NOT_FOUND proves absence. Denied/unknown never does.
    using(var original=RelativeOpen(ParentHandle,OriginalName,0x00100080,7,true))if(original!=null)Deny("MOBILE_PARTIAL_ORIGINAL_NAME_STILL_PRESENT");
    return name;
   }
   public void Dispose(){Handle.Dispose();}
  }
  static string Acl(string path,bool ancestor) {
   bool directory=(File.GetAttributes(path)&FileAttributes.Directory)!=0;
   FileSystemSecurity acl=directory?(FileSystemSecurity)Directory.GetAccessControl(path):File.GetAccessControl(path);
   return CheckedAcl(acl,ancestor);
  }
  static string CheckedAcl(FileSystemSecurity acl,bool ancestor) {
   var trusted=new HashSet<string>(StringComparer.Ordinal){SystemSid,Admin};if(ancestor)trusted.Add(TrustedInstaller);
   if(!trusted.Contains(acl.GetOwner(typeof(SecurityIdentifier)).Value))Deny("MOBILE_PARTIAL_OWNER_UNPROVEN");
   int mask=ancestor?0x500d0150:0x500d0156;
   foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))
    if(rule.AccessControlType==AccessControlType.Allow && ((int)rule.FileSystemRights&mask)!=0 &&
      (!ancestor || (rule.PropagationFlags&PropagationFlags.InheritOnly)==0) && !trusted.Contains(rule.IdentityReference.Value))Deny("MOBILE_PARTIAL_WRITER_UNPROVEN");
   return Hash(Utf8.GetBytes(acl.GetSecurityDescriptorSddlForm(AccessControlSections.Owner|AccessControlSections.Group|AccessControlSections.Access)));
  }
  // Task Scheduler marshals ERROR_FILE_NOT_FOUND as either managed IO or COM.
  // Only this exact HRESULT and these two interop shapes prove absence.
  static object ReadInstallerTask(dynamic folder) {
   try{return folder.GetTask(Task);}
   catch(Exception e) {
    if((e is COMException || e is FileNotFoundException) && e.HResult==unchecked((int)0x80070002))return null;
    throw;
   }
  }
  static void AbsentEnrollment() {
   IntPtr provider=IntPtr.Zero,key=IntPtr.Zero;
   try {
    if(NCryptOpenStorageProvider(out provider,"Microsoft Software Key Storage Provider",0)!=0)Deny("MOBILE_PARTIAL_KEY_PROVIDER_UNPROVEN");
    int status=NCryptOpenKey(provider,out key,Key,0,0x20);
    if(status==0)Deny("MOBILE_PARTIAL_RECEIPT_KEY_EXISTS");
    if(status!=unchecked((int)0x80090016))Deny("MOBILE_PARTIAL_KEY_ABSENCE_UNPROVEN");
   }finally{if(key!=IntPtr.Zero)NCryptFreeObject(key);if(provider!=IntPtr.Zero)NCryptFreeObject(provider);}
   object scheduler=null,folder=null,task=null;
   try {
    dynamic service=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service",true));scheduler=service;service.Connect();folder=service.GetFolder(@"\");
    task=ReadInstallerTask((dynamic)folder);
    if(task!=null)Deny("MOBILE_PARTIAL_INSTALLER_TASK_EXISTS");
   }finally{foreach(object value in new[]{task,folder,scheduler})if(value!=null && Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);}
   var query=new EventLogQuery(Log,PathType.LogName,"*[System[(EventID=62519) and Provider[@Name='StephanosMaintenanceCustody']]]");
   using(var reader=new EventLogReader(query))using(var entry=reader.ReadEvent(TimeSpan.FromSeconds(5)))if(entry!=null)Deny("MOBILE_PARTIAL_RETAINED_GENESIS_EXISTS");
  }
  static string Context(string sid,string machine,string head,string tree) {
   using(var identity=WindowsIdentity.GetCurrent())using(var process=Process.GetCurrentProcess())
    if(identity.User==null || identity.User.Value!=sid || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) ||
      !Environment.UserInteractive || process.SessionId<=0 || !String.Equals(process.MainModule.FileName,@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",StringComparison.OrdinalIgnoreCase))
      Deny("MOBILE_PARTIAL_SAME_OPERATOR_ADMIN_REQUIRED");
   using(var registry=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64))using(var key=registry.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography",false)) {
    string guid=key==null?null:key.GetValue("MachineGuid") as string;
    if(guid==null || Hash(Utf8.GetBytes(guid.ToLowerInvariant()))!=machine)Deny("MOBILE_PARTIAL_MACHINE_UNPROVEN");
   }
   return "stephanos.mobile-partial-preservation.v1\n"+sid+"\n"+machine+"\n"+head+"\n"+tree+"\n";
  }

  public static string Run(string mode,string sid,string machine,string head,string tree,string expected) {
   if((mode!="Observe" && mode!="Preserve") || !Hex(head,40) || !Hex(tree,40))Deny("MOBILE_PARTIAL_CONTEXT_REFUSED");
   string context=Context(sid,machine,head,tree);var parents=new List<SafeFileHandle>();var identities=new List<string>();
   try {
    var wire=new StringBuilder(context).Append(Operation).Append('\n').Append(DestinationPrefix).Append('\n');
    foreach(string path in new[]{@"C:\",@"C:\Program Files",Parent}) {
     var parent=PinDirectory(path);parents.Add(parent);string id=Identity(DirectoryInfo(parent));identities.Add(id);
     wire.Append(id).Append('\n').Append(Acl(path,path!=Parent)).Append('\n');
    }
    AbsentEnrollment();using(var root=new RootObject(parents[2],RootName)) {
     string acl=Acl(Root,false);
     string fingerprint=Hash(Utf8.GetBytes(wire.ToString()+root.RootIdentity+"\n"+root.ParentIdentity+"\n"+RootName+"\n"+acl+"\n"));
     if(mode=="Observe")return "{\"status\":\"OPAQUE_DIRECTORY_QUARANTINE_REVIEW_REQUIRED\",\"operation\":\""+Operation+"\",\"fingerprint\":\""+fingerprint+"\",\"rootIdentity\":\""+root.RootIdentity+"\",\"allContentsAndStreamsOpaque\":true,\"preserved\":false,\"runtimeInstalled\":false,\"restartPerformed\":false}";
     if(!String.Equals(fingerprint,expected,StringComparison.Ordinal))Deny("MOBILE_PARTIAL_EXACT_OBJECT_APPROVAL_MISMATCH");
     AbsentEnrollment();if(Acl(Root,false)!=acl)Deny("MOBILE_PARTIAL_ROOT_ACL_CHANGED");
     for(int i=0;i<parents.Count;i++)if(Identity(DirectoryInfo(parents[i]))!=identities[i])Deny("MOBILE_PARTIAL_PARENT_CHANGED");
     string name=root.Quarantine(fingerprint);
     if(Acl(Path.Combine(Parent,name),false)!=acl)Deny("MOBILE_PARTIAL_QUARANTINE_ACL_READBACK_UNPROVEN");
     AbsentEnrollment();
     return "{\"status\":\"EXACT_DIRECTORY_OPAQUELY_QUARANTINED_INSPECTION_ONLY\",\"operation\":\""+Operation+"\",\"fingerprint\":\""+fingerprint+"\",\"rootIdentity\":\""+root.RootIdentity+"\",\"allContentsAndStreamsOpaque\":true,\"preserved\":true,\"enrollmentQualified\":false,\"runtimeInstalled\":false,\"restartPerformed\":false}";
    }
   }finally{for(int i=parents.Count-1;i>=0;i--)parents[i].Dispose();}
  }
 }
}

'@
# Only this fixed reviewed implementation is compiled; the staged helper is
# opaque data and is never loaded or executed by the preservation adapter.
$provider=[Microsoft.CSharp.CSharpCodeProvider]::new()
$parameters=[CodeDom.Compiler.CompilerParameters]::new()
$parameters.GenerateExecutable=$false;$parameters.GenerateInMemory=$true;$parameters.TreatWarningsAsErrors=$true
foreach($reference in @('System.dll','System.Core.dll','Microsoft.CSharp.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
try {
 $result=$provider.CompileAssemblyFromSource($parameters,@($native))
 if($result.Errors.HasErrors){throw 'MOBILE_PARTIAL_ADAPTER_COMPILATION_FAILED'}
 $type=$result.CompiledAssembly.GetType('Stephanos.Sovereign.MobilePartialPreservationV1',$true)
 [Console]::WriteLine($type.GetMethod('Run').Invoke($null,@($Mode,$pinned.OperatorSid,$pinned.MachineHash,$ExpectedMain,$pinned.SourceTree,$ExpectedFingerprint)))
}finally{$provider.Dispose()}
