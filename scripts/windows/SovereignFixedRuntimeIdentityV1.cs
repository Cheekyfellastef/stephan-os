// Fixed protected identity adapter. Compiled only by the reviewed installer.
// No public caller-selected path, manifest, executable or qualification flag.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.IO;
  using System.Reflection;
  using System.Management;
  using System.Threading.Tasks;
  using System.Runtime.InteropServices;
  using System.Security.AccessControl;
  using System.Security.Principal;
  using System.Text;
  using System.Web.Script.Serialization;
  using Microsoft.Win32;

  public sealed class FixedRuntimeManifestFileV1 {
    public string Path = "", Sha256 = "", MaterializedSha256 = "";
    public string GitBlobSha = "", GitMode = "";
  }
  public sealed class FixedRuntimeManifestV1 {
    public string SchemaVersion = "", SourceHead = "", SourceTree = "";
    public FixedRuntimeManifestFileV1[] Files;
  }
  public sealed class FixedRuntimePendingV1 {
    public string SchemaVersion = "", SourceHead = "", SourceTree = "";
    public string HelperSha256 = "", ManifestSha256 = "", MachineHash = "";
    public string GitClosureSha256 = "";
    public string CompilerCompletedAtUtc = "", InstalledAtUtc = "", OperatorSid = "";
    public string NodeExecutableSha256 = "", GitExecutableSha256 = "", PowerShellExecutableSha256 = "";
    public int NodeExecutableLinkCount, GitExecutableLinkCount, PowerShellExecutableLinkCount;
  }
  sealed class FixedRuntimeIdentityPinsV1 : IDisposable {
    internal string SourceHead, SourceTree, HelperSha256, ManifestSha256, MachineHash, BootStartedAtUtc;
    internal string ExecutionHead, ExecutionTree, SourceProofSha256, GitClosureSha256;
    internal List<FileStream> Files = new List<FileStream>();
    internal List<Microsoft.Win32.SafeHandles.SafeFileHandle> Directories =
      new List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
    public void Dispose() {
      for(int i=Files.Count-1;i>=0;i--) Files[i].Dispose();
      for(int i=Directories.Count-1;i>=0;i--) Directories[i].Dispose();
      Files.Clear(); Directories.Clear();
    }
  }
  public static partial class CoreJobCustodyV1 {
    // A capacity bound, never a replacement for exact installed membership.
    const int RuntimeSourceMemberLimitV1 = 300;
    const string RuntimeSourceRootV1 = @"C:\Users\Stephan Callear\Documents\GitHub\stephan-os";
    const string RuntimeProtectedRootV1 = @"C:\Program Files\Stephanos\SovereignFixedRuntimeV1";
    static bool RuntimeHexV1(string value,int length) {
      return value!=null && value.Length==length &&
        System.Text.RegularExpressions.Regex.IsMatch(value,"^[a-f0-9]+$");
    }
    static DateTime RuntimeInstantV1(string value) {
      DateTime result;
      if(value==null || !value.EndsWith("Z",StringComparison.Ordinal) ||
        !DateTime.TryParse(value,CultureInfo.InvariantCulture,
          DateTimeStyles.AdjustToUniversal|DateTimeStyles.AssumeUniversal,out result))
        throw new InvalidOperationException("RUNTIME_TIME_UNPROVEN");
      return result;
    }
    static bool RuntimePendingBootOrderV1(FixedRuntimePendingV1 pending,DateTime boot,DateTime now) {
      DateTime compiled=RuntimeInstantV1(pending.CompilerCompletedAtUtc);
      DateTime installed=RuntimeInstantV1(pending.InstalledAtUtc);
      return compiled<installed && installed<boot && boot<now;
    }
    static DateTime RuntimeWindowsBootV1() {
      // Same documented Windows OS property as the existing recovery witness.
      // No child process, caller path or private structure offsets.
      var query=Task.Factory.StartNew(delegate {
        var options=new EnumerationOptions {
          Timeout=TimeSpan.FromSeconds(5),ReturnImmediately=false,Rewindable=false };
        using(var searcher=new ManagementObjectSearcher(@"\\.\root\cimv2",
          "SELECT LastBootUpTime FROM Win32_OperatingSystem",options))
        using(var rows=searcher.Get()) {
          DateTime boot=DateTime.MinValue; int count=0;
          foreach(ManagementObject row in rows) using(row) {
            string value=row["LastBootUpTime"] as string;
            if(String.IsNullOrWhiteSpace(value) || ++count!=1)
              throw new InvalidOperationException("RUNTIME_WINDOWS_BOOT_UNPROVEN");
            boot=ManagementDateTimeConverter.ToDateTime(value).ToUniversalTime();
          }
          if(count!=1 || boot<=DateTime.MinValue || boot>=DateTime.UtcNow)
            throw new InvalidOperationException("RUNTIME_WINDOWS_BOOT_UNPROVEN");
          return boot;
        }
      });
      if(!query.Wait(5000)) throw new InvalidOperationException("RUNTIME_WINDOWS_BOOT_UNPROVEN");
      return query.Result;
    }
    static string RuntimeMachineHashV1() {
      using(var machine=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64))
      using(var key=machine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography",false)) {
        string guid=key==null?null:key.GetValue("MachineGuid") as string;
        if(String.IsNullOrWhiteSpace(guid) || guid.Length>128)
          throw new InvalidOperationException("RUNTIME_MACHINE_UNPROVEN");
        return RuntimeHashV1(Encoding.UTF8.GetBytes(guid.ToLowerInvariant()));
      }
    }
    static void RuntimeProtectedAclV1(string path,bool directory) {
      RuntimeAclV1(path,directory,false);
    }
    static void RuntimeSystemExecutableAclV1(string path) {
      RuntimeAclV1(path,false,true);
    }
    static void RuntimeAclV1(string path,bool directory,bool systemExecutable) {
      FileSystemSecurity acl=directory?(FileSystemSecurity)Directory.GetAccessControl(path):
        (FileSystemSecurity)File.GetAccessControl(path);
      string owner=((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value;
      var system=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null);
      var administrators=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
      // Fixed installation artifacts must have an administrative owner.
      string installer="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
      if(owner!=system.Value && owner!=administrators.Value && !(systemExecutable && owner==installer))
        throw new InvalidOperationException("RUNTIME_PROTECTED_OWNER_UNPROVEN");
      const FileSystemRights mutation=FileSystemRights.Write|FileSystemRights.Delete|
        FileSystemRights.DeleteSubdirectoriesAndFiles|FileSystemRights.ChangePermissions|
        FileSystemRights.TakeOwnership|(FileSystemRights)0x50000000;
      foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
        if(rule.AccessControlType!=AccessControlType.Allow || (rule.FileSystemRights&mutation)==0) continue;
        string sid=((SecurityIdentifier)rule.IdentityReference).Value;
        if(sid!=system.Value && sid!=administrators.Value && !(systemExecutable && sid==installer))
          throw new InvalidOperationException("RUNTIME_PROTECTED_WRITE_AUTHORITY_UNPROVEN");
      }
    }
    static void RuntimeFixedAncestorAclV1(string path) {
      // Exact OS ancestors only. Creating a NEW child does not replace any
      // existing protected route component. Delete-child/rename/ACL/reparse
      // mutation rights remain forbidden for every untrusted principal.
      if(path!=@"C:\" && path!=@"C:\Program Files")
        throw new InvalidOperationException("RUNTIME_ANCESTOR_PATH_UNPROVEN");
      var acl=Directory.GetAccessControl(path);
      string owner=((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value;
      string installer="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
      Func<string,bool> trusted=sid=>sid=="S-1-5-18" || sid=="S-1-5-32-544" || sid==installer;
      if(!trusted(owner)) throw new InvalidOperationException("RUNTIME_ANCESTOR_OWNER_UNPROVEN");
      const FileSystemRights mutation=FileSystemRights.Delete|FileSystemRights.DeleteSubdirectoriesAndFiles|
        FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership|
        FileSystemRights.WriteAttributes|FileSystemRights.WriteExtendedAttributes|(FileSystemRights)0x50000000;
      foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))
        if((rule.PropagationFlags&PropagationFlags.InheritOnly)==0 &&
          rule.AccessControlType==AccessControlType.Allow && (rule.FileSystemRights&mutation)!=0 &&
          !trusted(((SecurityIdentifier)rule.IdentityReference).Value))
          throw new InvalidOperationException("RUNTIME_ANCESTOR_WRITE_AUTHORITY_UNPROVEN");
    }
    static FileStream RuntimePinFileV1(string path,int maximum,FixedRuntimeIdentityPinsV1 pins) {
      var handle=CreateFileW(path,0x80000000u,1u,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
      if(handle.IsInvalid) { handle.Dispose(); throw new IOException("RUNTIME_SOURCE_PIN_OPEN_FAILED"); }
      FILE_INFO info;
      if(!GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 ||
        info.links!=1 || info.sizeHigh!=0 || info.sizeLow>(uint)maximum) {
        handle.Dispose(); throw new IOException("RUNTIME_SOURCE_PIN_IDENTITY_UNPROVEN");
      }
      var file=new FileStream(handle,FileAccess.Read,4096,false); pins.Files.Add(file); return file;
    }
    static byte[] RuntimeReadPinnedV1(string path,int maximum,FixedRuntimeIdentityPinsV1 pins) {
      var file=RuntimePinFileV1(path,maximum,pins);
      byte[] bytes=new byte[(int)file.Length]; int offset=0;
      while(offset<bytes.Length) {
        int count=file.Read(bytes,offset,bytes.Length-offset);
        if(count<=0) throw new IOException("RUNTIME_SOURCE_PIN_READ_FAILED");
        offset+=count;
      }
      return bytes;
    }
    // Distinct fixed vendor/OS executable case. Source, helper and receipt
    // pins still forbid every hard link. A protected pending receipt binds
    // exact bytes AND observed link count for these three fixed paths only.
    static void RuntimePinFixedExecutableV1(string path,string expected,int links,FixedRuntimeIdentityPinsV1 pins) {
      if((!String.Equals(path,@"C:\Program Files\nodejs\node.exe",StringComparison.OrdinalIgnoreCase) &&
          !String.Equals(path,@"C:\Program Files\Git\cmd\git.exe",StringComparison.OrdinalIgnoreCase) &&
          !String.Equals(path,@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",StringComparison.OrdinalIgnoreCase)) ||
        !RuntimeHexV1(expected,64) || links<1 || links>16)
        throw new InvalidOperationException("RUNTIME_FIXED_EXECUTABLE_IDENTITY_UNPROVEN");
      RuntimePinParentsV1(path,pins);
      var handle=CreateFileW(path,0x80000000u,1u,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
      if(handle.IsInvalid) { handle.Dispose(); throw new IOException("RUNTIME_FIXED_EXECUTABLE_OPEN_FAILED"); }
      FILE_INFO info;
      if(!GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 ||
        info.links!=(uint)links || info.sizeHigh!=0 || info.sizeLow>134217728) {
        handle.Dispose(); throw new IOException("RUNTIME_FIXED_EXECUTABLE_IDENTITY_UNPROVEN");
      }
      var file=new FileStream(handle,FileAccess.Read,4096,false); pins.Files.Add(file);
      RuntimeSystemExecutableAclV1(path);
      using(var sha=System.Security.Cryptography.SHA256.Create()) {
        string digest=BitConverter.ToString(sha.ComputeHash(file)).Replace("-","").ToLowerInvariant();
        if(digest!=expected) throw new IOException("RUNTIME_FIXED_EXECUTABLE_CHANGED");
      }
    }
    sealed class FixedRuntimeToolObservationV1 {
      public string Sha256="";public int LinkCount;
    }
    static FixedRuntimeToolObservationV1[] RuntimeObserveFixedToolsV1(FixedRuntimeIdentityPinsV1 pins) {
      var observations=new List<FixedRuntimeToolObservationV1>();
      foreach(string path in new string[]{@"C:\Program Files\nodejs\node.exe",@"C:\Program Files\Git\cmd\git.exe",
        @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"}) {
        RuntimePinParentsV1(path,pins);RuntimeSystemExecutableAclV1(path);
        var handle=CreateFileW(path,0x80000000u,1u,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
        if(handle.IsInvalid) {handle.Dispose();throw new IOException("RUNTIME_FIXED_TOOL_OPEN_UNPROVEN");}
        FILE_INFO info;
        if(!GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 ||
          info.links<1 || info.links>16 || info.sizeHigh!=0 || info.sizeLow>134217728) {
          handle.Dispose();throw new IOException("RUNTIME_FIXED_TOOL_IDENTITY_UNPROVEN");
        }
        var file=new FileStream(handle,FileAccess.Read,4096,false);pins.Files.Add(file);
        using(var sha=System.Security.Cryptography.SHA256.Create()) observations.Add(new FixedRuntimeToolObservationV1 {
          Sha256=BitConverter.ToString(sha.ComputeHash(file)).Replace("-","").ToLowerInvariant(),LinkCount=(int)info.links });
      }
      return observations.ToArray();
    }
    static void RuntimePinParentsV1(string path,FixedRuntimeIdentityPinsV1 pins) {
      PinDirectoryChain(Path.GetDirectoryName(path),pins.Directories);
    }
    sealed class RuntimeGitLeafV1 { internal string Mode, Sha; }
    sealed class RuntimeGitProofV1 { internal string Head, Tree, Digest, Closure; }
    static string RuntimeGitHashV1(string kind,byte[] bytes) {
      byte[] header=Encoding.ASCII.GetBytes(kind+" "+bytes.Length.ToString(CultureInfo.InvariantCulture)+"\0");
      byte[] input=new byte[header.Length+bytes.Length];
      Buffer.BlockCopy(header,0,input,0,header.Length);Buffer.BlockCopy(bytes,0,input,header.Length,bytes.Length);
      using(var sha=System.Security.Cryptography.SHA1.Create())
        return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
    }
    static byte[] RuntimeProofBytesV1(string value,int maximum) {
      if(value==null || value.Length>4*((maximum+2)/3) ||
        !System.Text.RegularExpressions.Regex.IsMatch(value,@"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"))
        throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_BASE64");
      byte[] bytes=Convert.FromBase64String(value);
      if(bytes.Length>maximum || Convert.ToBase64String(bytes)!=value)
        throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_BASE64");
      return bytes;
    }
    static int RuntimeCompareBytesV1(byte[] a,byte[] b) {
      for(int i=0;i<Math.Min(a.Length,b.Length);i++)if(a[i]!=b[i])return a[i]<b[i]?-1:1;
      return a.Length.CompareTo(b.Length);
    }
    static Dictionary<string,RuntimeGitLeafV1> RuntimeProofTreeV1(byte[] bytes,ref int entries) {
      var rows=new Dictionary<string,RuntimeGitLeafV1>(StringComparer.Ordinal);
      var folded=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      byte[] previous=null;int offset=0;var utf8=new UTF8Encoding(false,true);
      while(offset<bytes.Length) {
        if(++entries>32768)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_BOUND");
        int space=Array.IndexOf(bytes,(byte)32,offset);
        int end=space<0?-1:Array.IndexOf(bytes,(byte)0,space+1);
        if(space<offset+1 || end<=space+1 || end+21>bytes.Length)
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_SHAPE");
        string mode=utf8.GetString(bytes,offset,space-offset),name=utf8.GetString(bytes,space+1,end-space-1);
        if(mode!="40000" && mode!="100644" && mode!="100755")
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_MODE");
        if(end-space-1>255 || name=="." || name==".." ||
          System.Text.RegularExpressions.Regex.IsMatch(name,@"[\\/:<>""|?*\x00-\x1f\x7f]") ||
          name.EndsWith(".",StringComparison.Ordinal) || name.EndsWith(" ",StringComparison.Ordinal))
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_PATH");
        if(!folded.Add(name))throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_ALIAS");
        byte[] sortKey=utf8.GetBytes(name+(mode=="40000"?"/":""));
        if(previous!=null && RuntimeCompareBytesV1(previous,sortKey)>=0)
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_ORDER");
        previous=sortKey;byte[] hash=new byte[20];Buffer.BlockCopy(bytes,end+1,hash,0,20);
        rows.Add(name,new RuntimeGitLeafV1 {Mode=mode,Sha=BitConverter.ToString(hash).Replace("-","").ToLowerInvariant()});
        offset=end+21;
      }
      return rows;
    }
    static string RuntimeGitClosureV1(FixedRuntimeManifestFileV1[] members) {
      if(members==null || members.Length<1 || members.Length>RuntimeSourceMemberLimitV1)
        throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_CLOSURE");
      var rows=(FixedRuntimeManifestFileV1[])members.Clone();
      Array.Sort(rows,delegate(FixedRuntimeManifestFileV1 a,FixedRuntimeManifestFileV1 b) {
        return StringComparer.Ordinal.Compare(a==null?null:a.Path,b==null?null:b.Path); });
      var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      var text=new StringBuilder("stephanos.fixed-runtime-git-closure.v1\0");
      foreach(var row in rows) {
        if(row==null || row.Path==null || !System.Text.RegularExpressions.Regex.IsMatch(row.Path,@"^[A-Za-z0-9._/-]{1,240}$") ||
          row.Path.Contains("..") || row.Path.Contains("//") || row.Path.StartsWith("/",StringComparison.Ordinal) ||
          row.Path.EndsWith("/",StringComparison.Ordinal) || !seen.Add(row.Path) ||
          row.GitMode!="100644" || !RuntimeHexV1(row.GitBlobSha,40))
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_LEGACY_MANIFEST");
        text.Append(row.Path).Append('\0').Append(row.GitMode).Append('\0').Append(row.GitBlobSha).Append('\n');
      }
      return RuntimeHashV1(Encoding.UTF8.GetBytes(text.ToString()));
    }
    // Raw Git objects prove membership only. The original parent separately
    // authenticates canonical main, and this helper pins the matching main and
    // origin refs. Compile/boot/custody identity is never rewritten to this head.
    static RuntimeGitProofV1 RuntimeVerifySourceProofV1(string raw,FixedRuntimeManifestFileV1[] members) {
      if(raw==null || raw.Length>3145728)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_WIRE_BOUND");
      foreach(char ch in raw)if(ch<32 || ch>126)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_WIRE_BOUND");
      string[] fields=raw.Split(' ');
      if(fields.Length<4 || fields.Length>131 || fields[0]!="STEPHANOS_FIXED_RUNTIME_SOURCE_V1" || !RuntimeHexV1(fields[1],40))
        throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_WIRE_SHAPE");
      byte[] commit=RuntimeProofBytesV1(fields[2],65536);
      if(RuntimeGitHashV1("commit",commit)!=fields[1])throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_COMMIT_HASH");
      string commitText=new UTF8Encoding(false,true).GetString(commit);int separator=commitText.IndexOf("\n\n",StringComparison.Ordinal);
      if(separator<0 || !System.Text.RegularExpressions.Regex.IsMatch(commitText,@"\Atree [a-f0-9]{40}\n"))
        throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_COMMIT_TREE");
      int treeHeaders=0;
      foreach(string line in commitText.Substring(0,separator).Split('\n'))
        if(line.StartsWith("tree ",StringComparison.Ordinal))treeHeaders++;
      if(treeHeaders!=1)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_COMMIT_TREE");
      string root=commitText.Substring(5,40),previous="";int total=0,entries=0;
      var trees=new Dictionary<string,Dictionary<string,RuntimeGitLeafV1>>(StringComparer.Ordinal);
      for(int i=3;i<fields.Length;i++) {
        string field=fields[i];if(field.IndexOf(':')!=40)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_SHAPE");
        string id=field.Substring(0,40);byte[] bytes=RuntimeProofBytesV1(field.Substring(41),2097152);
        total+=bytes.Length;
        if(total>2097152)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_BOUND");
        if(!RuntimeHexV1(id,40) || StringComparer.Ordinal.Compare(id,previous)<=0 || RuntimeGitHashV1("tree",bytes)!=id)
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_HASH");
        previous=id;trees.Add(id,RuntimeProofTreeV1(bytes,ref entries));
      }
      string closure=RuntimeGitClosureV1(members);var used=new HashSet<string>(StringComparer.Ordinal);
      foreach(var row in members) {
        string id=root;string[] parts=row.Path.Split('/');RuntimeGitLeafV1 leaf=null;
        for(int i=0;i<parts.Length;i++) {
          Dictionary<string,RuntimeGitLeafV1> tree;
          if(!trees.TryGetValue(id,out tree) || !tree.TryGetValue(parts[i],out leaf))
            throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_MEMBERSHIP");
          used.Add(id);
          if(i<parts.Length-1) {
            if(leaf.Mode!="40000")throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_MEMBERSHIP");
            id=leaf.Sha;
          } else if(leaf.Mode!=row.GitMode || leaf.Sha!=row.GitBlobSha)
            throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_MEMBER_CHANGED");
        }
      }
      if(used.Count!=trees.Count)throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_TREE_UNUSED");
      return new RuntimeGitProofV1 {Head=fields[1],Tree=root,Digest=RuntimeHashV1(Encoding.ASCII.GetBytes(raw)),Closure=closure};
    }
    static FixedRuntimeIdentityPinsV1 OpenFixedRuntimeIdentityV1() {
      return OpenFixedRuntimeIdentityForSourceV1(null);
    }
    static FixedRuntimeIdentityPinsV1 OpenFixedRuntimeIdentityForSourceV1(string sourceProof) {
      var pins=new FixedRuntimeIdentityPinsV1();
      try {
        byte[] manifestBytes;
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("Stephanos.FixedRuntime.ManifestV1")) {
          if(stream==null || stream.Length<2 || stream.Length>2097152)
            throw new InvalidOperationException("RUNTIME_EMBEDDED_MANIFEST_UNPROVEN");
          manifestBytes=new byte[(int)stream.Length]; int offset=0;
          while(offset<manifestBytes.Length) {
            int read=stream.Read(manifestBytes,offset,manifestBytes.Length-offset);
            if(read<=0) throw new IOException("RUNTIME_EMBEDDED_MANIFEST_UNPROVEN"); offset+=read;
          }
        }
        var json=new JavaScriptSerializer { MaxJsonLength=2097152,RecursionLimit=12 };
        var manifest=json.Deserialize<FixedRuntimeManifestV1>(new UTF8Encoding(false,true).GetString(manifestBytes));
        if(manifest==null || manifest.SchemaVersion!="stephanos.fixed-runtime-manifest.v1" ||
          !RuntimeHexV1(manifest.SourceHead,40) || !RuntimeHexV1(manifest.SourceTree,40) ||
          manifest.Files==null || manifest.Files.Length<40 || manifest.Files.Length>RuntimeSourceMemberLimitV1)
          throw new InvalidOperationException("RUNTIME_MANIFEST_IDENTITY_UNPROVEN");
        string version=Path.Combine(RuntimeProtectedRootV1,manifest.SourceHead);
        string helper=Path.Combine(version,"host.exe"),pendingPath=Path.Combine(version,"pending.json");
        if(!String.Equals(Assembly.GetExecutingAssembly().Location,helper,StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("RUNTIME_HELPER_LOCATION_UNPROVEN");
        RuntimePinParentsV1(helper,pins);
        RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
        RuntimeProtectedAclV1(Path.GetDirectoryName(RuntimeProtectedRootV1),true);
        RuntimeProtectedAclV1(RuntimeProtectedRootV1,true);
        RuntimeProtectedAclV1(version,true);
        foreach(string file in Directory.GetFileSystemEntries(version)) {
          if(!String.Equals(file,helper,StringComparison.OrdinalIgnoreCase) &&
            !String.Equals(file,pendingPath,StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("RUNTIME_HELPER_UNEXPECTED_CONTENT");
        }
        RuntimeProtectedAclV1(helper,false); RuntimeProtectedAclV1(pendingPath,false);
        var helperBytes=RuntimeReadPinnedV1(helper,2097152,pins);
        var pendingBytes=RuntimeReadPinnedV1(pendingPath,32768,pins);
        var pending=json.Deserialize<FixedRuntimePendingV1>(new UTF8Encoding(false,true).GetString(pendingBytes));
        string machine=RuntimeMachineHashV1(),manifestDigest=RuntimeHashV1(manifestBytes);
        DateTime boot=RuntimeWindowsBootV1();
        if(pending==null || pending.SchemaVersion!="stephanos.fixed-runtime-pending.v1" ||
          pending.SourceHead!=manifest.SourceHead || pending.SourceTree!=manifest.SourceTree ||
          pending.ManifestSha256!=manifestDigest || pending.HelperSha256!=RuntimeHashV1(helperBytes) ||
          pending.MachineHash!=machine || !RuntimePendingBootOrderV1(pending,boot,DateTime.UtcNow))
          throw new InvalidOperationException("RUNTIME_PENDING_LATER_BOOT_UNPROVEN");
        using(var principal=WindowsIdentity.GetCurrent()) {
          if(principal.User.Value!=pending.OperatorSid ||
            new WindowsPrincipal(principal).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("RUNTIME_NORMAL_OPERATOR_REQUIRED");
        }
        string[] executablePaths={
          @"C:\Program Files\nodejs\node.exe",@"C:\Program Files\Git\cmd\git.exe",
          @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"};
        string[] executableHashes={
          pending.NodeExecutableSha256,pending.GitExecutableSha256,pending.PowerShellExecutableSha256};
        int[] executableLinks={
          pending.NodeExecutableLinkCount,pending.GitExecutableLinkCount,pending.PowerShellExecutableLinkCount};
        for(int i=0;i<executablePaths.Length;i++)
          RuntimePinFixedExecutableV1(executablePaths[i],executableHashes[i],executableLinks[i],pins);
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total=0;
        foreach(var row in manifest.Files) {
          if(row==null || String.IsNullOrEmpty(row.Path) || row.Path.Length>240 ||
            !(row.Path=="package.json" || row.Path==".gitattributes" ||
              row.Path=="integrations/openclaw/stephanos-builder-provider/lib/oc1-gateway-provider.mjs" ||
              row.Path=="integrations/openclaw/stephanos-builder-provider/lib/oc1-repository-scout.mjs" ||
              row.Path=="src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp" ||
              System.Text.RegularExpressions.Regex.IsMatch(row.Path,@"^(scripts|shared|stephanos-server)/[A-Za-z0-9._/-]+$")) ||
            row.Path.Contains("..") || row.Path.Contains("//") || !RuntimeHexV1(row.Sha256,64) ||
            !RuntimeHexV1(row.MaterializedSha256,64) || !seen.Add(row.Path))
            throw new InvalidOperationException("RUNTIME_SOURCE_MEMBER_UNPROVEN");
          string path=Path.Combine(RuntimeSourceRootV1,row.Path.Replace('/',Path.DirectorySeparatorChar));
          RuntimePinParentsV1(path,pins);
          byte[] bytes=RuntimeReadPinnedV1(path,2097152,pins); total+=bytes.Length;
          if(total>8388608 || RuntimeHashV1(bytes)!=row.MaterializedSha256)
            throw new InvalidOperationException("RUNTIME_SOURCE_MEMBER_CHANGED");
        }
        foreach(string required in new string[]{
          "scripts/windows/SovereignCoreJobCustodyV1.cs","scripts/windows/SovereignFixedRuntimeJobV1.cs",
          "scripts/windows/SovereignFixedRuntimeIdentityV1.cs","scripts/windows/SovereignFixedRuntimeAuthorityV1.cs",
          "scripts/windows/SovereignFixedRuntimeHostV1.cs","scripts/windows/SovereignFixedRuntimeSourceV1.cs",
          "scripts/sovereign-fixed-runtime-source-task-v1.mjs",
          "scripts/sovereign-commander-goal-builder-repair.mjs","package.json",".gitattributes"})
          if(!seen.Contains(required)) throw new InvalidOperationException("RUNTIME_MANIFEST_CLOSURE_INCOMPLETE");
        RuntimeGitProofV1 source=sourceProof==null?null:RuntimeVerifySourceProofV1(sourceProof,manifest.Files);
        if(source!=null && (!RuntimeHexV1(pending.GitClosureSha256,64) || pending.GitClosureSha256!=source.Closure))
          throw new InvalidOperationException("RUNTIME_SOURCE_PROOF_PROTECTED_CLOSURE_CHANGED");
        string executionHead=source==null?manifest.SourceHead:source.Head;
        foreach(string relative in new string[]{".git/HEAD",".git/refs/heads/main",".git/refs/remotes/origin/main",".git/index",".git/config"}) {
          string path=Path.Combine(RuntimeSourceRootV1,relative.Replace('/',Path.DirectorySeparatorChar));
          RuntimePinParentsV1(path,pins); byte[] bytes=RuntimeReadPinnedV1(path,33554432,pins);
          if(relative==".git/HEAD" || relative==".git/refs/heads/main" || relative==".git/refs/remotes/origin/main") {
            string expected=relative==".git/HEAD"?"ref: refs/heads/main":executionHead;
            if(new UTF8Encoding(false,true).GetString(bytes).Trim()!=expected)
              throw new InvalidOperationException("RUNTIME_SOURCE_REF_CHANGED");
          }
        }
        string optionalConfig=Path.Combine(RuntimeSourceRootV1,@".git\config.worktree");
        if(File.Exists(optionalConfig)) RuntimeReadPinnedV1(optionalConfig,2097152,pins);
        pins.SourceHead=manifest.SourceHead; pins.SourceTree=manifest.SourceTree;
        pins.ExecutionHead=executionHead;pins.ExecutionTree=source==null?manifest.SourceTree:source.Tree;
        pins.SourceProofSha256=source==null?"":source.Digest;pins.GitClosureSha256=source==null?"":source.Closure;
        pins.HelperSha256=pending.HelperSha256; pins.ManifestSha256=manifestDigest;
        pins.MachineHash=machine; pins.BootStartedAtUtc=boot.ToString("O");
        return pins;
      } catch { pins.Dispose(); throw; }
    }
  }
}
