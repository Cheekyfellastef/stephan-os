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
  [StructLayout(LayoutKind.Sequential)] struct Info {
   internal uint Attributes; internal System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;
   internal uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct StreamInfo {
   internal long Size;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=296)]internal string Name;
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {internal int Length;internal IntPtr Descriptor;internal int Inherit;}
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle,int kind,IntPtr information,uint bytes);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateDirectoryW(string path,ref SecurityAttributes security);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr FindFirstStreamW(string path,int level,out StreamInfo info,int flags);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool FindNextStreamW(IntPtr handle,out StreamInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool FindClose(IntPtr handle);
  [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)] static extern int NCryptOpenStorageProvider(out IntPtr provider,string name,uint flags);
  [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)] static extern int NCryptOpenKey(IntPtr provider,out IntPtr key,string name,uint legacy,uint flags);
  [DllImport("ncrypt.dll")] static extern int NCryptFreeObject(IntPtr value);
  static void Deny(string code){throw new InvalidOperationException(code);}
  static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
  static string Identity(Info i){return i.Volume.ToString("x8")+":"+i.IndexHigh.ToString("x8")+i.IndexLow.ToString("x8");}
  static SafeFileHandle Pin(string path,bool ancestor,bool renameRoot=false) {
   // Ancestors cannot be renamed/deleted while the fixed operation is running.
   var handle=CreateFileW(path,renameRoot?0x10080u:0x80u,ancestor?3u:1u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
   if(handle.IsInvalid){handle.Dispose();Deny("MOBILE_PARTIAL_PATH_PIN_UNPROVEN");}
   Info info;if(!GetFileInformationByHandle(handle,out info) || (info.Attributes&0x400)!=0){handle.Dispose();Deny("MOBILE_PARTIAL_REDIRECTION_REFUSED");}
   return handle;
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
  static void NoStreams(string path) {
   StreamInfo info;IntPtr handle=FindFirstStreamW(path,0,out info,0);
   if(handle==new IntPtr(-1)){if(Marshal.GetLastWin32Error()!=38)Deny("MOBILE_PARTIAL_STREAM_SCAN_UNPROVEN");return;}
   try {
    do {if(info.Name!="::$DATA")Deny("MOBILE_PARTIAL_EXTRA_STREAM_REFUSED");}while(FindNextStreamW(handle,out info));
    if(Marshal.GetLastWin32Error()!=38)Deny("MOBILE_PARTIAL_STREAM_SCAN_UNPROVEN");
   }finally{if(!FindClose(handle))Deny("MOBILE_PARTIAL_STREAM_HANDLE_UNPROVEN");}
  }
  // The same root/children stay open without write/delete sharing from the
  // approved snapshot through native rename and readback. No pathname reopen
  // can select a different source object at the mutation boundary.
  sealed class PartialSnapshot : IDisposable {
   internal SafeFileHandle RootHandle,StateHandle;
   internal FileStream Helper;
   internal PartialSnapshot(string path) {
    try {
     RootHandle=Pin(path,false,true);StateHandle=Pin(Path.Combine(path,"state"),false,true);
     if((File.GetAttributes(path)&FileAttributes.Directory)==0 || (File.GetAttributes(Path.Combine(path,"state"))&FileAttributes.Directory)==0 ||
       (File.GetAttributes(Path.Combine(path,"installer.exe"))&FileAttributes.Directory)!=0)Deny("MOBILE_PARTIAL_SHAPE_REFUSED");
     var helper=CreateFileW(Path.Combine(path,"installer.exe"),0x80010000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
     if(helper.IsInvalid){helper.Dispose();Deny("MOBILE_PARTIAL_HELPER_PIN_UNPROVEN");}
     try{Helper=new FileStream(helper,FileAccess.Read);}catch{helper.Dispose();throw;}
     Info info;if(!GetFileInformationByHandle(Helper.SafeFileHandle,out info) || (info.Attributes&0x400)!=0)Deny("MOBILE_PARTIAL_REDIRECTION_REFUSED");
    }catch{Dispose();throw;}
   }
   public void Dispose(){if(Helper!=null)Helper.Dispose();if(StateHandle!=null)StateHandle.Dispose();if(RootHandle!=null)RootHandle.Dispose();}
   internal string HelperWitness() {
    Helper.Position=0;Info info;
    if(!GetFileInformationByHandle(Helper.SafeFileHandle,out info) || info.Links!=1 || Helper.Length<1 || Helper.Length>2097152)Deny("MOBILE_PARTIAL_HELPER_IDENTITY_UNPROVEN");
    byte[] bytes=new byte[(int)Helper.Length];int at=0;while(at<bytes.Length){int n=Helper.Read(bytes,at,bytes.Length-at);if(n<=0)Deny("MOBILE_PARTIAL_HELPER_READ_UNPROVEN");at+=n;}
    if(Helper.ReadByte()!=-1 || Helper.Length!=bytes.Length)Deny("MOBILE_PARTIAL_HELPER_CHANGED");
    return Identity(info)+"\n"+bytes.Length.ToString(CultureInfo.InvariantCulture)+"\n"+Hash(bytes)+"\n";
   }
   internal string Shape(string path) {
    if((File.GetAttributes(path)&FileAttributes.Directory)==0 || (File.GetAttributes(Path.Combine(path,"state"))&FileAttributes.Directory)==0 ||
      (File.GetAttributes(Path.Combine(path,"installer.exe"))&FileAttributes.Directory)!=0)Deny("MOBILE_PARTIAL_SHAPE_REFUSED");
    string[] entries=Directory.GetFileSystemEntries(path);Array.Sort(entries,StringComparer.Ordinal);
    if(entries.Length!=2 || entries[0]!=Path.Combine(path,"installer.exe") || entries[1]!=Path.Combine(path,"state") || Directory.GetFileSystemEntries(Path.Combine(path,"state")).Length!=0)
      Deny("MOBILE_PARTIAL_NOT_PRE_ENROLLMENT");
    foreach(string p in new[]{path,Path.Combine(path,"state"),Path.Combine(path,"installer.exe")})NoStreams(p);
    var file=Helper;file.Position=0;
     Info info;if(!GetFileInformationByHandle(file.SafeFileHandle,out info) || info.Links!=1 || file.Length<1 || file.Length>2097152)Deny("MOBILE_PARTIAL_HELPER_IDENTITY_UNPROVEN");
     byte[] bytes=new byte[(int)file.Length];int at=0;while(at<bytes.Length){int n=file.Read(bytes,at,bytes.Length-at);if(n<=0)Deny("MOBILE_PARTIAL_HELPER_READ_UNPROVEN");at+=n;}
     if(file.ReadByte()!=-1 || file.Length!=bytes.Length)Deny("MOBILE_PARTIAL_HELPER_CHANGED");
     var result=new StringBuilder("stephanos.mobile-partial-shape.v1\n");
     foreach(var h in new[]{RootHandle,StateHandle,Helper.SafeFileHandle}) {
      Info id;if(!GetFileInformationByHandle(h,out id))Deny("MOBILE_PARTIAL_PATH_IDENTITY_UNPROVEN");result.Append(Identity(id)).Append('\n');
     }
     return result.Append(bytes.Length.ToString(CultureInfo.InvariantCulture)).Append('\n').Append(Hash(bytes)).Append('\n').ToString();
   }
  }
  // Private data-fixture entry; public operations never accept a path.
  static string Shape(string path){using(var held=new PartialSnapshot(path))return held.Shape(path);}
  static void RenamePinned(SafeFileHandle handle,string destination) {
   byte[] name=Encoding.Unicode.GetBytes(destination);
   int rootOffset=IntPtr.Size==8?8:4,lengthOffset=rootOffset+IntPtr.Size,nameOffset=lengthOffset+4;
   IntPtr buffer=Marshal.AllocHGlobal(nameOffset+name.Length+2);
   try {
    for(int i=0;i<nameOffset;i++)Marshal.WriteByte(buffer,i,0);
    // ReplaceIfExists=false, RootDirectory=NULL, exact absolute destination.
    Marshal.WriteInt32(buffer,lengthOffset,name.Length);Marshal.Copy(name,0,IntPtr.Add(buffer,nameOffset),name.Length);
    Marshal.WriteInt16(buffer,nameOffset+name.Length,0);
    if(!SetFileInformationByHandle(handle,3,buffer,(uint)(nameOffset+name.Length+2)))Deny("MOBILE_PARTIAL_HANDLE_RENAME_UNPROVEN_"+Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
   }finally{Marshal.FreeHGlobal(buffer);}
  }
  static void DeleteEmptyPinned(SafeFileHandle handle) {
   IntPtr buffer=Marshal.AllocHGlobal(1);
   try {
    Marshal.WriteByte(buffer,1);
    // Windows atomically refuses nonempty directories. No recursive deletion
    // or delete of a file is possible through this private directory-only call.
    Info info;if(!GetFileInformationByHandle(handle,out info) || (info.Attributes&0x10)==0)Deny("MOBILE_PARTIAL_EMPTY_DIRECTORY_REQUIRED");
    if(!SetFileInformationByHandle(handle,4,buffer,1))Deny("MOBILE_PARTIAL_NONEMPTY_OR_DELETE_UNPROVEN");
   }finally{Marshal.FreeHGlobal(buffer);}
  }
  static void NewPreservationDirectory(string destination,byte[] descriptor) {
   IntPtr bytes=Marshal.AllocHGlobal(descriptor.Length);
   try {
    Marshal.Copy(descriptor,0,bytes,descriptor.Length);
    var security=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=bytes,Inherit=0};
    if(!CreateDirectoryW(destination,ref security))Deny("MOBILE_PARTIAL_DESTINATION_CREATE_NEW_REQUIRED");
   }finally{Marshal.FreeHGlobal(bytes);}
  }
  // Only Run supplies these paths in production. Private native fixtures prove
  // identity pinning and kernel empty-directory refusal without touching Root.
  static void PreservePinned(PartialSnapshot held,string source,string destination,byte[] descriptor) {
   NewPreservationDirectory(destination,descriptor);
   using(var destinationPin=Pin(destination,true)) {
    string target=Path.Combine(destination,"installer.exe");
    RenamePinned(held.Helper.SafeFileHandle,target);
    var finalPath=new StringBuilder(1024);uint count=GetFinalPathNameByHandleW(held.Helper.SafeFileHandle,finalPath,(uint)finalPath.Capacity,0);
    if(count==0 || count>=finalPath.Capacity || !String.Equals(finalPath.ToString(),@"\\?\"+target,StringComparison.OrdinalIgnoreCase))Deny("MOBILE_PARTIAL_HELPER_RENAME_READBACK_UNPROVEN");
    // Never rename a directory whose live contents could have grown after the
    // approved snapshot. Each empty-only disposition is enforced by NTFS, even
    // if another administrator adds an entry between observation and this call.
    DeleteEmptyPinned(held.StateHandle);held.StateHandle.Dispose();
    DeleteEmptyPinned(held.RootHandle);held.RootHandle.Dispose();
    if(Directory.Exists(source) || File.Exists(source))Deny("MOBILE_PARTIAL_EMPTY_ROOT_REMOVAL_UNPROVEN");
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
    try{task=((dynamic)folder).GetTask(Task);}catch(COMException e){if(e.ErrorCode!=unchecked((int)0x80070002))throw;}
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
  static string Snapshot(PartialSnapshot held,string path,string context) {
   var wire=new StringBuilder(context).Append(held.Shape(path));
   foreach(string p in new[]{@"C:\",@"C:\Program Files",Parent,path,Path.Combine(path,"state"),Path.Combine(path,"installer.exe")})wire.Append(Acl(p,p==@"C:\" || p==@"C:\Program Files")).Append('\n');
   return Hash(Utf8.GetBytes(wire.ToString()));
  }
  public static string Run(string mode,string sid,string machine,string head,string tree,string expected) {
   if(mode!="Observe" && mode!="Preserve")Deny("MOBILE_PARTIAL_MODE_REFUSED");
   string context=Context(sid,machine,head,tree);var parents=new List<IDisposable>();
   try {
    foreach(string p in new[]{@"C:\",@"C:\Program Files",Parent})parents.Add(Pin(p,true));
    AbsentEnrollment();using(var held=new PartialSnapshot(Root)) {
    // Keep the validated security descriptor itself, not a later path read,
    // as the only ACL permitted on the newly created preservation directory.
    var approvedSecurity=Directory.GetAccessControl(Root);
    string rootAcl=CheckedAcl(approvedSecurity,false),helperAcl=Acl(Path.Combine(Root,"installer.exe"),false);
    string helperWitness=held.HelperWitness();
    string fingerprint=Snapshot(held,Root,context);
    if(mode=="Observe")return "{\"status\":\"PRE_ENROLLMENT_PARTIAL_OBSERVED\",\"fingerprint\":\""+fingerprint+"\",\"preserved\":false,\"runtimeInstalled\":false,\"restartPerformed\":false}";
    if(!String.Equals(fingerprint,expected,StringComparison.Ordinal))Deny("MOBILE_PARTIAL_EXACT_APPROVAL_MISMATCH");
    string destination=Parent+@"\SovereignMobileInstallerV1.failed-"+fingerprint;
    if(Directory.Exists(destination) || File.Exists(destination))Deny("MOBILE_PARTIAL_DESTINATION_EXISTS_INSPECT_ONLY");
    AbsentEnrollment();if(Snapshot(held,Root,context)!=fingerprint)Deny("MOBILE_PARTIAL_CHANGED_BEFORE_PRESERVATION");
    if(Acl(Root,false)!=rootAcl || Acl(Path.Combine(Root,"installer.exe"),false)!=helperAcl || held.HelperWitness()!=helperWitness)Deny("MOBILE_PARTIAL_APPROVED_OBJECT_CHANGED");
    byte[] security=approvedSecurity.GetSecurityDescriptorBinaryForm();
    // Preserve only the pinned helper, then remove only the two pinned empty
    // directory objects. No file deletion, recursive cleanup, overwrite, reset,
    // existing ACL/key/log/task mutation, executable load or automatic retry.
    PreservePinned(held,Root,destination,security);
    if(held.HelperWitness()!=helperWitness)Deny("MOBILE_PARTIAL_HELPER_BYTES_READBACK_UNPROVEN");
    if(Acl(destination,false)!=rootAcl || Acl(Path.Combine(destination,"installer.exe"),false)!=helperAcl)Deny("MOBILE_PARTIAL_PRESERVATION_ACL_READBACK_UNPROVEN");
    AbsentEnrollment();
    return "{\"status\":\"PARTIAL_PRESERVED_NEW_ENROLLMENT_STILL_GATED\",\"fingerprint\":\""+fingerprint+"\",\"preserved\":true,\"runtimeInstalled\":false,\"restartPerformed\":false}";
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
