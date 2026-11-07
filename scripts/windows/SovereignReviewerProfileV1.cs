// A reviewer-specific installed-code observation, not maintenance authority or
// independent reviewer enrollment. No keys, accounts, services or leases here.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.IO;
  using System.Reflection;
  using System.Security.AccessControl;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Web.Script.Serialization;
  using Microsoft.Win32;
  using Microsoft.Win32.SafeHandles;

  public sealed class ReviewerProfileFileV1 {
    public string Path, GitBlobSha1, Sha256;
  }
  public sealed class ReviewerProfileManifestV1 {
    public string SchemaVersion, SourceHead, SourceTree;
    public ReviewerProfileFileV1[] Files;
  }
  public sealed class ReviewerInstallationV1 {
    public string SchemaVersion, SourceHead, ManifestSha256, HelperSha256, MachineHash;
    public string ReviewerSid, InstallerSid, InstalledAtUtc;
    public string NodeSha256, GitSha256;
    public int NodeLinkCount, GitLinkCount;
  }
  sealed class ReviewerProfilePinsV1 : IDisposable {
    internal readonly List<FileStream> Files = new List<FileStream>();
    internal readonly List<SafeFileHandle> Directories = new List<SafeFileHandle>();
    internal ReviewerProfileManifestV1 Manifest;
    internal ReviewerInstallationV1 Installation;
    internal string VersionRoot, ActualSid;
    internal bool Administrator, FullClosureObserved;
    public void Dispose() {
      for(int i=Files.Count-1;i>=0;i--)Files[i].Dispose();
      for(int i=Directories.Count-1;i>=0;i--)Directories[i].Dispose();
    }
  }
  public static partial class CoreJobCustodyV1 {
    const string ReviewerRootV1 = @"C:\Program Files\Stephanos\SovereignReviewerV1";
    const string ReviewerHostV1 = ReviewerRootV1 + @"\host.exe";
    const string ReviewerNodeV1 = @"C:\Program Files\nodejs\node.exe";
    const string ReviewerGitV1 = @"C:\Program Files\Git\cmd\git.exe";
    const string ReviewerDataRootV1 = @"C:\Users\Stephan Callear\Documents\GitHub\stephan-os";
    const string ReviewerWorkspaceV1 = @"C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace";
    const string ReviewerSystemV1 = "S-1-5-18", ReviewerAdminsV1 = "S-1-5-32-544";
    const string ReviewerTrustedInstallerV1 = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    static string ReviewerHashV1(byte[] bytes) {
      using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
    }
    static bool ReviewerHexV1(string text,int length) {
      return text!=null && Regex.IsMatch(text,"\\A[a-f0-9]{"+length+"}\\z");
    }
    static JavaScriptSerializer ReviewerJsonV1() { return new JavaScriptSerializer { MaxJsonLength=2097152, RecursionLimit=16 }; }
    static bool ReviewerTrustedOwnerV1(string sid,bool tool) {
      return sid==ReviewerSystemV1 || sid==ReviewerAdminsV1 || (tool && sid==ReviewerTrustedInstallerV1);
    }
    static void ReviewerProtectedAclV1(string path,bool tool) {
      FileSystemSecurity acl=Directory.Exists(path) ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
      if(!ReviewerTrustedOwnerV1(acl.GetOwner(typeof(SecurityIdentifier)).Value,tool))
        throw new IOException("REVIEWER_PROTECTED_OWNER_UNPROVEN");
      const uint mutate=0x500D0156u;
      foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
        if(rule.AccessControlType==AccessControlType.Allow && (unchecked((uint)rule.FileSystemRights)&mutate)!=0
          && !ReviewerTrustedOwnerV1(rule.IdentityReference.Value,tool))
          throw new IOException("REVIEWER_PROTECTED_WRITE_AUTHORITY_UNPROVEN");
      }
    }
    static void ReviewerAncestorAclV1(string path) {
      var acl=Directory.GetAccessControl(path);
      if(!ReviewerTrustedOwnerV1(acl.GetOwner(typeof(SecurityIdentifier)).Value,true))
        throw new IOException("REVIEWER_ANCESTOR_OWNER_UNPROVEN");
      // Fixed C:\ and Program Files may permit creating new children. They may
      // not let an ordinary principal rename/delete an existing protected child.
      const uint mutate=0x500D0140u;
      foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
        if(rule.AccessControlType==AccessControlType.Allow
          && (rule.PropagationFlags&PropagationFlags.InheritOnly)==0
          && (unchecked((uint)rule.FileSystemRights)&mutate)!=0
          && !ReviewerTrustedOwnerV1(rule.IdentityReference.Value,true))
          throw new IOException("REVIEWER_ANCESTOR_WRITE_AUTHORITY_UNPROVEN");
      }
    }
    static void ReviewerPinParentsV1(string path,ReviewerProfilePinsV1 pins) {
      PinDirectoryChain(Path.GetDirectoryName(path),pins.Directories);
    }
    static byte[] ReviewerReadPinnedV1(string path,int maximum,ReviewerProfilePinsV1 pins,int links=1) {
      var handle=CreateFileW(path,0x80000000u,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
      if(handle.IsInvalid) {handle.Dispose();throw new IOException("REVIEWER_FILE_PIN_UNAVAILABLE");}
      FILE_INFO info;
      if(!GetFileInformationByHandle(handle,out info) || (info.attributes&(0x400u|0x10u))!=0
        || info.links!=links || info.sizeHigh!=0 || info.sizeLow<1 || info.sizeLow>maximum) {
        handle.Dispose();throw new IOException("REVIEWER_FILE_IDENTITY_UNPROVEN");
      }
      var file=new FileStream(handle,FileAccess.Read,4096,false);pins.Files.Add(file);
      byte[] bytes=new byte[info.sizeLow];int offset=0;
      while(offset<bytes.Length) {int count=file.Read(bytes,offset,bytes.Length-offset);if(count<=0)throw new IOException("REVIEWER_FILE_READ_INCOMPLETE");offset+=count;}
      if(file.ReadByte()!=-1)throw new IOException("REVIEWER_FILE_READ_CHANGED");
      return bytes;
    }
    static string ReviewerMachineHashV1() {
      using(var root=RegistryKey.OpenBaseKey(RegistryHive.LocalMachine,RegistryView.Registry64))
      using(var key=root.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography",false)) {
        string value=key==null?null:key.GetValue("MachineGuid") as string;
        if(String.IsNullOrWhiteSpace(value))throw new IOException("REVIEWER_MACHINE_UNPROVEN");
        return ReviewerHashV1(Encoding.UTF8.GetBytes(value.ToLowerInvariant()));
      }
    }
    static int ReviewerObserveToolLinksV1(string path) {
      if(path!=ReviewerNodeV1 && path!=ReviewerGitV1)throw new IOException("REVIEWER_FIXED_TOOL_REQUIRED");
      using(var handle=CreateFileW(path,0x80000000u,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) {
        FILE_INFO info;
        if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info) || (info.attributes&(0x400u|0x10u))!=0
          || info.links<1 || info.links>16)throw new IOException("REVIEWER_TOOL_LINK_IDENTITY_UNPROVEN");
        return (int)info.links;
      }
    }
    static void ReviewerPinToolV1(string path,string digest,int links,ReviewerProfilePinsV1 pins) {
      if((path!=ReviewerNodeV1 && path!=ReviewerGitV1)||!ReviewerHexV1(digest,64)||links<1||links>16)
        throw new IOException("REVIEWER_FIXED_TOOL_REQUIRED");
      ReviewerPinParentsV1(path,pins);
      for(string parent=Path.GetDirectoryName(path);parent!=null&&!String.Equals(parent,@"C:\Program Files",StringComparison.OrdinalIgnoreCase);parent=Path.GetDirectoryName(parent))
        ReviewerProtectedAclV1(parent,true);
      ReviewerProtectedAclV1(path,true);
      if(ReviewerHashV1(ReviewerReadPinnedV1(path,268435456,pins,links))!=digest)
        throw new IOException("REVIEWER_FIXED_TOOL_BYTES_CHANGED");
    }
    static ReviewerProfilePinsV1 OpenReviewerProfileV1(bool includeSource=true) {
      var pins=new ReviewerProfilePinsV1();
      try {
        byte[] embedded;
        using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("Stephanos.ReviewerProfile.ManifestV1")) {
          if(resource==null||resource.Length<2||resource.Length>131072)throw new IOException("REVIEWER_EMBEDDED_MANIFEST_UNPROVEN");
          using(var memory=new MemoryStream()){resource.CopyTo(memory);embedded=memory.ToArray();}
        }
        var manifest=ReviewerJsonV1().Deserialize<ReviewerProfileManifestV1>(new UTF8Encoding(false,true).GetString(embedded));
        if(manifest==null||manifest.SchemaVersion!="stephanos.reviewer-profile-manifest.v1"
          ||!ReviewerHexV1(manifest.SourceHead,40)||!ReviewerHexV1(manifest.SourceTree,40)
          ||manifest.Files==null||manifest.Files.Length!=25)throw new IOException("REVIEWER_MANIFEST_IDENTITY_UNPROVEN");
        pins.Manifest=manifest;pins.VersionRoot=Path.Combine(ReviewerRootV1,manifest.SourceHead);
        if(!String.Equals(Path.GetFullPath(Assembly.GetExecutingAssembly().Location),ReviewerHostV1,StringComparison.OrdinalIgnoreCase))
          throw new IOException("REVIEWER_PROTECTED_HOST_LOCATION_REQUIRED");
        ReviewerPinParentsV1(ReviewerHostV1,pins);ReviewerPinParentsV1(Path.Combine(pins.VersionRoot,"manifest.json"),pins);
        ReviewerAncestorAclV1(@"C:\");ReviewerAncestorAclV1(@"C:\Program Files");
        foreach(string path in new string[]{@"C:\Program Files\Stephanos",ReviewerRootV1,pins.VersionRoot})ReviewerProtectedAclV1(path,false);
        ReviewerProtectedAclV1(ReviewerHostV1,false);
        byte[] helper=ReviewerReadPinnedV1(ReviewerHostV1,4194304,pins);
        string manifestPath=Path.Combine(pins.VersionRoot,"manifest.json"), installationPath=Path.Combine(pins.VersionRoot,"installation.json");
        ReviewerProtectedAclV1(manifestPath,false);ReviewerProtectedAclV1(installationPath,false);
        byte[] installedManifest=ReviewerReadPinnedV1(manifestPath,131072,pins);
        if(ReviewerHashV1(installedManifest)!=ReviewerHashV1(embedded))throw new IOException("REVIEWER_INSTALLED_MANIFEST_CHANGED");
        var installation=ReviewerJsonV1().Deserialize<ReviewerInstallationV1>(new UTF8Encoding(false,true).GetString(ReviewerReadPinnedV1(installationPath,16384,pins)));
        DateTime installed;
        if(installation==null||installation.SchemaVersion!="stephanos.reviewer-installation.v1"
          ||installation.SourceHead!=manifest.SourceHead||installation.ManifestSha256!=ReviewerHashV1(embedded)
          ||installation.HelperSha256!=ReviewerHashV1(helper)||installation.MachineHash!=ReviewerMachineHashV1()
          ||!Regex.IsMatch(installation.ReviewerSid??"","\\AS-1-5-21-[0-9-]{8,100}\\z")
          ||!Regex.IsMatch(installation.InstallerSid??"","\\AS-1-5-21-[0-9-]{8,100}\\z")
          ||!DateTime.TryParse(installation.InstalledAtUtc,null,System.Globalization.DateTimeStyles.RoundtripKind,out installed)
          ||installed.Kind!=DateTimeKind.Utc||installed>DateTime.UtcNow)
          throw new IOException("REVIEWER_INSTALLATION_IDENTITY_UNPROVEN");
        pins.Installation=installation;
        using(var identity=WindowsIdentity.GetCurrent()) {
          pins.ActualSid=identity.User.Value;
          pins.Administrator=new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        // A governor observation is only a fresh physical fixed-path read. The
        // outer executing host retains its complete source/tool pins. Do not
        // rehash large OS binaries on every 500ms gaming cancellation poll.
        if(!includeSource)return pins;
        ReviewerPinToolV1(ReviewerNodeV1,installation.NodeSha256,installation.NodeLinkCount,pins);
        ReviewerPinToolV1(ReviewerGitV1,installation.GitSha256,installation.GitLinkCount,pins);
        var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);int total=0;
        foreach(var row in manifest.Files) {
          if(row==null||!Regex.IsMatch(row.Path??"","\\A(?:scripts|shared)/[A-Za-z0-9._/-]+\\z")
            ||row.Path.Contains("..")||row.Path.Contains("//")||!paths.Add(row.Path)
            ||!ReviewerHexV1(row.Sha256,64)||!ReviewerHexV1(row.GitBlobSha1,40))
            throw new IOException("REVIEWER_SOURCE_CLOSURE_INVALID");
          string path=Path.Combine(pins.VersionRoot,"source",row.Path.Replace('/',Path.DirectorySeparatorChar));
          ReviewerPinParentsV1(path,pins);
          for(string parent=Path.GetDirectoryName(path);parent.StartsWith(pins.VersionRoot+"\\",StringComparison.OrdinalIgnoreCase);parent=Path.GetDirectoryName(parent))
            ReviewerProtectedAclV1(parent,false);
          ReviewerProtectedAclV1(path,false);
          byte[] bytes=ReviewerReadPinnedV1(path,2097152,pins);total+=bytes.Length;
          if(total>4194304||ReviewerHashV1(bytes)!=row.Sha256)throw new IOException("REVIEWER_SOURCE_BYTES_CHANGED");
        }
        pins.FullClosureObserved=true;return pins;
      }catch{pins.Dispose();throw;}
    }
    static object ReviewerObservationV1(ReviewerProfilePinsV1 pins) {
      return new {schemaVersion="stephanos.reviewer-profile-observation.v1",sourceHead=pins.Manifest.SourceHead,
        sourceTree=pins.Manifest.SourceTree,sourceFileCount=pins.Manifest.Files.Length,codeCustodyObserved=pins.FullClosureObserved,
        principalMatchesProfile=pins.ActualSid==pins.Installation.ReviewerSid,
        principalDiffersFromInstaller=pins.ActualSid!=pins.Installation.InstallerSid,
        principalAdministrator=pins.Administrator,
        principalHash=ReviewerHashV1(Encoding.UTF8.GetBytes(pins.ActualSid)),
        independentPrincipalObserved=false,qualified=false,signingAuthority=false,reviewerEnrollmentAuthority=false,
        protectedMergeAuthority=false,physicalCommissioningProven=false};
    }
    static bool ReviewerInferencePrincipalV1(ReviewerProfilePinsV1 pins) {
      return pins.ActualSid==pins.Installation.ReviewerSid&&!pins.Administrator;
    }
    static bool ReviewerGovernorStateV1(string raw,DateTime now) {
      try {
        if(String.IsNullOrEmpty(raw)||Encoding.UTF8.GetByteCount(raw)>32768)return false;
        var state=ReviewerJsonV1().Deserialize<Dictionary<string,object>>(raw);
        string[] flags={"active","flatGameActive","airLinkActive","realAirLinkActive","virtualAirLinkTestActive","prepareLeaseActive","localModelAllowed","heavyModelAllowed"};
        var critical=new HashSet<string>(flags,StringComparer.Ordinal);
        foreach(string name in new string[]{"schemaVersion","governorVersion","ollamaLoadMode","updatedAtUtc"})critical.Add(name);
        var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(Match match in Regex.Matches(raw,"\"(?:[^\"\\\\]|\\\\.)*\"\\s*:")) {
          string key=ReviewerJsonV1().Deserialize<string>(match.Value.Substring(0,match.Value.LastIndexOf(':')).Trim());
          if(critical.Contains(key)&&!seen.Add(key))return false;
        }
        if(seen.Count!=critical.Count||state==null||!Equals(state["schemaVersion"],"stephanos.vr-resource-governor.v1")
          ||!(state["governorVersion"] is int)||(int)state["governorVersion"]!=3||!Equals(state["ollamaLoadMode"],"balanced"))return false;
        foreach(string flag in flags)if(!(state[flag] is bool))return false;
        for(int i=0;i<6;i++)if((bool)state[flags[i]])return false;
        if(!(bool)state["localModelAllowed"]||!(bool)state["heavyModelAllowed"])return false;
        DateTime updated;
        if(!(state["updatedAtUtc"] is string)||!DateTime.TryParse((string)state["updatedAtUtc"],null,System.Globalization.DateTimeStyles.RoundtripKind,out updated)
          ||updated.Kind!=DateTimeKind.Utc)return false;
        return now>=updated.AddSeconds(-5)&&now<=updated.AddSeconds(30);
      }catch{return false;}
    }
    static bool ReviewerGamingSafeV1() {
      try {
        using(var pins=new ReviewerProfilePinsV1()) {
          string path=Path.Combine(ReviewerWorkspaceV1,"vr","vr-resource-governor-current.json");
          ReviewerPinParentsV1(path,pins);
          byte[] bytes=ReviewerReadPinnedV1(path,32768,pins);
          return ReviewerGovernorStateV1(new UTF8Encoding(false,true).GetString(bytes),DateTime.UtcNow);
        }
      }catch{return false;}
    }
  }
}
