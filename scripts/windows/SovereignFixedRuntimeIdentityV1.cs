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
    public string Path = "", Sha256 = "";
  }
  public sealed class FixedRuntimeManifestV1 {
    public string SchemaVersion = "", SourceHead = "", SourceTree = "";
    public FixedRuntimeManifestFileV1[] Files;
  }
  public sealed class FixedRuntimePendingV1 {
    public string SchemaVersion = "", SourceHead = "", SourceTree = "";
    public string HelperSha256 = "", ManifestSha256 = "", MachineHash = "";
    public string CompilerCompletedAtUtc = "", InstalledAtUtc = "", OperatorSid = "";
    public string NodeExecutableSha256 = "", GitExecutableSha256 = "", PowerShellExecutableSha256 = "";
    public int NodeExecutableLinkCount, GitExecutableLinkCount, PowerShellExecutableLinkCount;
  }
  sealed class FixedRuntimeIdentityPinsV1 : IDisposable {
    internal string SourceHead, SourceTree, HelperSha256, ManifestSha256, MachineHash, BootStartedAtUtc;
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
    static FixedRuntimeIdentityPinsV1 OpenFixedRuntimeIdentityV1() {
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
          manifest.Files==null || manifest.Files.Length<40 || manifest.Files.Length>256)
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
              System.Text.RegularExpressions.Regex.IsMatch(row.Path,@"^(scripts|shared|stephanos-server)/[A-Za-z0-9._/-]+$")) ||
            row.Path.Contains("..") || row.Path.Contains("//") || !RuntimeHexV1(row.Sha256,64) || !seen.Add(row.Path))
            throw new InvalidOperationException("RUNTIME_SOURCE_MEMBER_UNPROVEN");
          string path=Path.Combine(RuntimeSourceRootV1,row.Path.Replace('/',Path.DirectorySeparatorChar));
          RuntimePinParentsV1(path,pins);
          byte[] bytes=RuntimeReadPinnedV1(path,2097152,pins); total+=bytes.Length;
          if(total>8388608 || RuntimeHashV1(bytes)!=row.Sha256)
            throw new InvalidOperationException("RUNTIME_SOURCE_MEMBER_CHANGED");
        }
        foreach(string required in new string[]{
          "scripts/windows/SovereignCoreJobCustodyV1.cs","scripts/windows/SovereignFixedRuntimeJobV1.cs",
          "scripts/windows/SovereignFixedRuntimeIdentityV1.cs","scripts/windows/SovereignFixedRuntimeAuthorityV1.cs",
          "scripts/windows/SovereignFixedRuntimeHostV1.cs","scripts/windows/SovereignFixedRuntimeSourceV1.cs",
          "scripts/sovereign-fixed-runtime-source-task-v1.mjs",
          "scripts/sovereign-commander-goal-builder-repair.mjs","package.json",".gitattributes"})
          if(!seen.Contains(required)) throw new InvalidOperationException("RUNTIME_MANIFEST_CLOSURE_INCOMPLETE");
        foreach(string relative in new string[]{".git/HEAD",".git/refs/heads/main",".git/index",".git/config"}) {
          string path=Path.Combine(RuntimeSourceRootV1,relative.Replace('/',Path.DirectorySeparatorChar));
          RuntimePinParentsV1(path,pins); byte[] bytes=RuntimeReadPinnedV1(path,33554432,pins);
          if(relative==".git/HEAD" || relative==".git/refs/heads/main") {
            string expected=relative==".git/HEAD"?"ref: refs/heads/main":manifest.SourceHead;
            if(new UTF8Encoding(false,true).GetString(bytes).Trim()!=expected)
              throw new InvalidOperationException("RUNTIME_SOURCE_REF_CHANGED");
          }
        }
        string optionalConfig=Path.Combine(RuntimeSourceRootV1,@".git\config.worktree");
        if(File.Exists(optionalConfig)) RuntimeReadPinnedV1(optionalConfig,2097152,pins);
        pins.SourceHead=manifest.SourceHead; pins.SourceTree=manifest.SourceTree;
        pins.HelperSha256=pending.HelperSha256; pins.ManifestSha256=manifestDigest;
        pins.MachineHash=machine; pins.BootStartedAtUtc=boot.ToString("O");
        return pins;
      } catch { pins.Dispose(); throw; }
    }
  }
}
