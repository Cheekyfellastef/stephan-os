// Source-only exact release-pin inspection for #1814. No signer, enrollment,
// journal, task, network, child process or installer. Administrative enrollment
// must separately seal release.pin and the four fixed protected files. Even a
// successful inspection supplies NO release/enrollment/execution qualification.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Security.AccessControl;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;
  using System.Text.RegularExpressions;
  using Microsoft.Win32.SafeHandles;

  internal sealed class MobileInstallReleaseInspectionV1 : IDisposable {
    internal readonly bool PermitDataVerified, ProtectedStorageObserved;
    internal readonly bool ExecutionAuthorityGranted=false, EnrollmentQualified=false, ReleaseEligibilityVerified=false;
    internal readonly string ReasonCode, MachineHash, OperatorSid, SourceHead, SourceTree;
    internal readonly string PackageSha256, ClosureSha256, ReleaseProofSha256, BootstrapSha256;
    internal readonly long EnrollmentGeneration;
    FixedRuntimeIdentityPinsV1 pins;
    internal MobileInstallReleaseInspectionV1(bool verified,string reason,Dictionary<string,string> fields,
        FixedRuntimeIdentityPinsV1 retained=null) {
      PermitDataVerified=verified;ReasonCode=reason;ProtectedStorageObserved=verified && retained!=null;pins=retained;
      if(verified) {
        MachineHash=fields["machineHash"];OperatorSid=fields["operatorSid"];
        SourceHead=fields["sourceHead"];SourceTree=fields["sourceTree"];
        PackageSha256=fields["packageSha256"];ClosureSha256=fields["closureSha256"];
        ReleaseProofSha256=fields["releaseProofSha256"];BootstrapSha256=fields["bootstrapSha256"];
        EnrollmentGeneration=Int64.Parse(fields["enrollmentGeneration"],CultureInfo.InvariantCulture);
      }
    }
    public void Dispose() { if(pins!=null) {pins.Dispose();pins=null;} }
  }

  internal static class SovereignMobileInstallReleaseV1 {
    internal const string ProtectedRoot=@"C:\Program Files\Stephanos\SovereignMobileInstallerV1";
    internal const int PackageLimit=16777216, EvidenceLimit=1048576, BootstrapLimit=32768;
    // Exact reviewed membership, independent of a caller's captured manifest.
    // Source changes deliberately update this pin; capacity alone admits nothing.
    internal const int ExpectedPathCount=300;
    internal const string ExpectedPathSetSha256="74a0678decb20799761e21bc4ed78dc120a01c20803532429ce01d5187b6057e";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static readonly string[] PinKeys={"repository","action","machineHash","operatorSid","enrollmentGeneration",
      "sourceHead","sourceTree","packageSha256","closureSha256","releaseProofSha256","bootstrapSha256"};
    sealed class Refusal : Exception { internal Refusal(string reason):base(reason) {} }
    static void Deny(string reason) {throw new Refusal(reason);}
    static bool Match(string value,string expression) {
      return value!=null && Regex.IsMatch(value,expression,RegexOptions.CultureInvariant);
    }
    static string Hash(byte[] bytes) {
      using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
    }
    static string GitBlob(byte[] bytes) {
      byte[] header=Encoding.ASCII.GetBytes("blob "+bytes.Length.ToString(CultureInfo.InvariantCulture)+"\0");
      byte[] input=new byte[header.Length+bytes.Length];Buffer.BlockCopy(header,0,input,0,header.Length);
      Buffer.BlockCopy(bytes,0,input,header.Length,bytes.Length);
      using(var sha=SHA1.Create())return BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
    }
    static string TextBytes(byte[] bytes,int maximum) {
      if(bytes==null || bytes.Length==0 || bytes.Length>maximum)Deny("RELEASE_INPUT_BOUND");
      return Utf8.GetString(bytes);
    }
    internal static Dictionary<string,string> Permit(string wire) {
      if(wire==null || wire.Length>4096)Deny("RELEASE_PIN_BOUND");
      foreach(char ch in wire) if(ch!='\n' && (ch<32 || ch>126))Deny("RELEASE_PIN_ASCII_REQUIRED");
      string[] lines=wire.Split('\n');
      if(lines.Length!=PinKeys.Length+2 || lines[0]!="STEPHANOS_MOBILE_INSTALL_RELEASE_PIN_V1" ||
          lines[lines.Length-1]!="")Deny("RELEASE_PIN_SHAPE");
      var fields=new Dictionary<string,string>(StringComparer.Ordinal);
      for(int i=0;i<PinKeys.Length;i++) {
        string prefix=PinKeys[i]+"=";
        if(!lines[i+1].StartsWith(prefix,StringComparison.Ordinal))Deny("RELEASE_PIN_KEYS");
        fields.Add(PinKeys[i],lines[i+1].Substring(prefix.Length));
      }
      if(fields["repository"]!="Cheekyfellastef/stephan-os" || fields["action"]!="INSTALL_SOVEREIGN_FIXED_RUNTIME_V1")
        Deny("RELEASE_PIN_OPERATION");
      foreach(string key in new[]{"machineHash","packageSha256","closureSha256","releaseProofSha256","bootstrapSha256"})
        if(!Match(fields[key],"\\A[a-f0-9]{64}\\z"))Deny("RELEASE_PIN_DIGEST");
      foreach(string key in new[]{"sourceHead","sourceTree"})
        if(!Match(fields[key],"\\A[a-f0-9]{40}\\z"))Deny("RELEASE_PIN_SOURCE");
      if(fields["operatorSid"].Length>180 || !Match(fields["operatorSid"],"\\AS-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+\\z"))
        Deny("RELEASE_PIN_OPERATOR");
      long generation;
      if(!Match(fields["enrollmentGeneration"],"\\A[1-9][0-9]{0,15}\\z") ||
          !Int64.TryParse(fields["enrollmentGeneration"],NumberStyles.None,CultureInfo.InvariantCulture,out generation) ||
          generation>9007199254740991L)Deny("RELEASE_PIN_GENERATION");
      return fields;
    }
    static Dictionary<string,object> Record(object value,string[] keys) {
      var row=value as Dictionary<string,object>;
      if(row==null || row.Count!=keys.Length)Deny("RELEASE_PACKAGE_KEYS");
      foreach(string key in keys)if(!row.ContainsKey(key))Deny("RELEASE_PACKAGE_KEYS");return row;
    }
    static string Text(Dictionary<string,object> row,string key) {
      object value;if(!row.TryGetValue(key,out value) || !(value is string))Deny("RELEASE_PACKAGE_FIELD");return (string)value;
    }
    static List<object> Array(object value) {
      var rows=value as List<object>;if(rows==null || rows.Count>ExpectedPathCount)Deny("RELEASE_PACKAGE_ARRAY");return rows;
    }
    static string PathSet(List<string> paths) {
      paths.Sort(StringComparer.Ordinal);
      return Hash(Utf8.GetBytes("stephanos.mobile-install-release-path-set.v1\0"+String.Join("\n",paths.ToArray())+"\n"));
    }
    static void Package(byte[] bytes,Dictionary<string,string> pin) {
      var package=Record(new Json(TextBytes(bytes,PackageLimit)).Read(),
        new[]{"SchemaVersion","SourceHead","SourceTree","OperatorSid","Records"});
      if(Text(package,"SchemaVersion")!="stephanos.fixed-runtime-install-input.v1" ||
          Text(package,"SourceHead")!=pin["sourceHead"] || Text(package,"SourceTree")!=pin["sourceTree"] ||
          Text(package,"OperatorSid")!=pin["operatorSid"])Deny("RELEASE_PACKAGE_BINDING");
      var records=Array(package["Records"]);
      if(records.Count!=ExpectedPathCount)Deny("RELEASE_PACKAGE_MEMBERSHIP");
      var paths=new List<string>();var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      var members=new List<FixedRuntimeManifestFileV1>();byte[] closure=null;long total=0;
      foreach(object value in records) {
        var row=Record(value,new[]{"Path","GitBlobSha","GitMode","Sha256","MaterializedSha256","ContentBase64"});
        string path=Text(row,"Path"),blob=Text(row,"GitBlobSha"),mode=Text(row,"GitMode"),sha=Text(row,"Sha256");
        if(!Match(path,"\\A[A-Za-z0-9._/-]{1,240}\\z") || path.Contains("..") || path.Contains("//") ||
            path.StartsWith("/",StringComparison.Ordinal) || path.EndsWith("/",StringComparison.Ordinal) || !seen.Add(path) ||
            mode!="100644" || !Match(blob,"\\A[a-f0-9]{40}\\z") || !Match(sha,"\\A[a-f0-9]{64}\\z") ||
            !Match(Text(row,"MaterializedSha256"),"\\A[a-f0-9]{64}\\z"))Deny("RELEASE_PACKAGE_MEMBER");
        string encoded=Text(row,"ContentBase64");
        if(encoded.Length>2796204 || !Match(encoded,"\\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\\z"))
          Deny("RELEASE_PACKAGE_BASE64");
        byte[] content=Convert.FromBase64String(encoded);total+=content.Length;
        if(content.Length>2097152 || total>8388608 || Convert.ToBase64String(content)!=encoded ||
            Hash(content)!=sha || GitBlob(content)!=blob)Deny("RELEASE_PACKAGE_CONTENT");
        Utf8.GetString(content);paths.Add(path);
        members.Add(new FixedRuntimeManifestFileV1{Path=path,GitMode=mode,GitBlobSha=blob});
        if(path=="shared/agents/sovereignFixedRuntimeSourceClosureV1.json")closure=content;
      }
      if(PathSet(paths)!=ExpectedPathSetSha256 || closure==null)Deny("RELEASE_PACKAGE_MEMBERSHIP");
      var declared=Record(new Json(Utf8.GetString(closure)).Read(),new[]{"schemaVersion","paths"});
      if(Text(declared,"schemaVersion")!="stephanos.fixed-runtime-source-closure.v1")Deny("RELEASE_CLOSURE_SCHEMA");
      var declaredPaths=new List<string>();var distinct=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach(object path in Array(declared["paths"])) {
        if(!(path is string) || !distinct.Add((string)path))Deny("RELEASE_CLOSURE_MEMBERSHIP");declaredPaths.Add((string)path);
      }
      if(declaredPaths.Count!=ExpectedPathCount || PathSet(declaredPaths)!=ExpectedPathSetSha256 ||
          CoreJobCustodyV1.MobileReleaseGitClosureV1(members.ToArray())!=pin["closureSha256"])Deny("RELEASE_CLOSURE_BINDING");
    }
    // Pure fixture/data boundary. Target bindings must come from the future
    // protected host, never a browser's claim. Success remains UNQUALIFIED.
    internal static MobileInstallReleaseInspectionV1 InspectCaptured(string pinWire,byte[] payload,byte[] bootstrap,
        byte[] evidence,string expectedMachine,string expectedOperator,long expectedGeneration) {
      try {
        var pin=Permit(pinWire);
        if(pin["machineHash"]!=expectedMachine || pin["operatorSid"]!=expectedOperator || expectedGeneration<1 ||
            pin["enrollmentGeneration"]!=expectedGeneration.ToString(CultureInfo.InvariantCulture))Deny("RELEASE_TARGET_BINDING");
        TextBytes(payload,PackageLimit);TextBytes(bootstrap,BootstrapLimit);TextBytes(evidence,EvidenceLimit);
        if(Hash(payload)!=pin["packageSha256"] || Hash(bootstrap)!=pin["bootstrapSha256"] ||
            Hash(evidence)!=pin["releaseProofSha256"])Deny("RELEASE_BYTES_CHANGED");
        Package(payload,pin);
        return new MobileInstallReleaseInspectionV1(true,"RELEASE_PIN_DATA_VERIFIED_ENROLLMENT_UNPROVEN",pin);
      }catch(Refusal failure) {return new MobileInstallReleaseInspectionV1(false,failure.Message,null);}
      catch(Exception) {return new MobileInstallReleaseInspectionV1(false,"RELEASE_DATA_INVALID",null);}
    }
    internal static MobileInstallReleaseInspectionV1 OpenProtected() {return CoreJobCustodyV1.MobileReleaseOpenProtectedV1();}

    // This captured package schema contains only objects, arrays and strings.
    // Reject duplicate/escaped duplicate keys before any deserializer discards
    // them; refuse unknown primitive types, depth, trailing bytes and controls.
    sealed class Json {
      readonly string input;int at;
      internal Json(string text) {input=text;}
      void Space() {while(at<input.Length && (input[at]==' ' || input[at]=='\t' || input[at]=='\r' || input[at]=='\n'))at++;}
      internal object Read() {object value=Value(0);Space();if(at!=input.Length)Deny("RELEASE_JSON_TRAILING");return value;}
      object Value(int depth) {
        Space();if(depth>8 || at>=input.Length)Deny("RELEASE_JSON_BOUND");char ch=input[at];
        if(ch=='"')return String();
        if(ch=='{') {
          at++;Space();var row=new Dictionary<string,object>(StringComparer.Ordinal);
          if(at<input.Length && input[at]=='}'){at++;return row;}
          while(true) {
            Space();string key=String();if(row.ContainsKey(key) || row.Count>=8)Deny("RELEASE_JSON_DUPLICATE_OR_BOUND");
            Space();if(at>=input.Length || input[at++]!=':')Deny("RELEASE_JSON_INVALID");row.Add(key,Value(depth+1));Space();
            if(at<input.Length && input[at]=='}'){at++;return row;}
            if(at>=input.Length || input[at++]!=',')Deny("RELEASE_JSON_INVALID");
          }
        }
        if(ch=='[') {
          at++;Space();var rows=new List<object>();if(at<input.Length && input[at]==']'){at++;return rows;}
          while(true) {
            if(rows.Count>=ExpectedPathCount)Deny("RELEASE_JSON_BOUND");rows.Add(Value(depth+1));Space();
            if(at<input.Length && input[at]==']'){at++;return rows;}
            if(at>=input.Length || input[at++]!=',')Deny("RELEASE_JSON_INVALID");
          }
        }
        Deny("RELEASE_JSON_TYPE");return null;
      }
      string String() {
        if(at>=input.Length || input[at++]!='"')Deny("RELEASE_JSON_STRING");var result=new StringBuilder();
        while(at<input.Length) {
          char ch=input[at++];if(ch=='"') {string value=result.ToString();Utf8.GetByteCount(value);return value;}
          if(ch<32)Deny("RELEASE_JSON_STRING");
          if(ch=='\\') {
            if(at>=input.Length)Deny("RELEASE_JSON_STRING");ch=input[at++];
            if(ch=='"' || ch=='\\' || ch=='/')result.Append(ch);
            else if(ch=='b')result.Append('\b');else if(ch=='f')result.Append('\f');
            else if(ch=='n')result.Append('\n');else if(ch=='r')result.Append('\r');else if(ch=='t')result.Append('\t');
            else if(ch=='u') {
              if(at+4>input.Length)Deny("RELEASE_JSON_STRING");int code;
              if(!Int32.TryParse(input.Substring(at,4),NumberStyles.AllowHexSpecifier,CultureInfo.InvariantCulture,out code))
                Deny("RELEASE_JSON_STRING");at+=4;result.Append((char)code);
            } else Deny("RELEASE_JSON_STRING");
          }else result.Append(ch);
        }
        Deny("RELEASE_JSON_STRING");return null;
      }
    }
  }

  public static partial class CoreJobCustodyV1 {
    internal static string MobileReleaseGitClosureV1(FixedRuntimeManifestFileV1[] members) {return RuntimeGitClosureV1(members);}
    [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,int objectType,
      uint securityInformation,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    // Security is read from the retained handle, not stat-then-reopen paths.
    static void MobileReleaseProtectedAclV1(SafeFileHandle handle,bool fixedOsAncestor) {
      IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
      try {
        if(GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)!=0 || descriptor==IntPtr.Zero)
          throw new IOException("RELEASE_PROTECTED_SECURITY_UNPROVEN");
        uint length=GetSecurityDescriptorLength(descriptor);
        if(length<20 || length>65536)throw new IOException("RELEASE_PROTECTED_SECURITY_UNPROVEN");
        byte[] bytes=new byte[(int)length];Marshal.Copy(descriptor,bytes,0,bytes.Length);var security=new RawSecurityDescriptor(bytes,0);
        Func<string,bool> trusted=sid=>sid=="S-1-5-18" || sid=="S-1-5-32-544" ||
          (fixedOsAncestor && sid=="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
        if(security.Owner==null || !trusted(security.Owner.Value) || security.DiscretionaryAcl==null)
          throw new IOException("RELEASE_PROTECTED_OWNER_UNPROVEN");
        // OS roots may allow creating a NEW child. They must still prevent
        // untrusted deletion/renaming/ACL/reparse mutation of this pinned route.
        int mutation=fixedOsAncestor?unchecked((int)0x500D0150):unchecked((int)0x500D0156);
        foreach(GenericAce ace in security.DiscretionaryAcl) {
          var common=ace as CommonAce;
          if(common==null || common.IsCallback)throw new IOException("RELEASE_PROTECTED_ACL_SHAPE");
          if((common.AceFlags&AceFlags.InheritOnly)!=0)continue;
          if(common.AceQualifier==AceQualifier.AccessAllowed && (common.AccessMask&mutation)!=0 &&
              !trusted(common.SecurityIdentifier.Value))throw new IOException("RELEASE_PROTECTED_WRITE_AUTHORITY_UNPROVEN");
        }
      } finally {if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
    }
    internal static MobileInstallReleaseInspectionV1 MobileReleaseOpenProtectedV1() {
      var pins=new FixedRuntimeIdentityPinsV1();
      try {
        string root=SovereignMobileInstallReleaseV1.ProtectedRoot;
        PinDirectoryChain(root,pins.Directories);
        for(int i=0;i<pins.Directories.Count;i++)MobileReleaseProtectedAclV1(pins.Directories[i],i<2);
        string[] names={"release.pin","runtime-package.json","runtime-bootstrap.ps1","release-evidence.json"};
        int[] limits={4096,SovereignMobileInstallReleaseV1.PackageLimit,SovereignMobileInstallReleaseV1.BootstrapLimit,
          SovereignMobileInstallReleaseV1.EvidenceLimit};var captured=new byte[4][];
        for(int i=0;i<names.Length;i++) {
          var file=RuntimePinFileV1(Path.Combine(root,names[i]),limits[i],pins);
          MobileReleaseProtectedAclV1(file.SafeFileHandle,false);long size=file.Length;
          captured[i]=new byte[(int)size];int offset=0;
          while(offset<captured[i].Length) {int count=file.Read(captured[i],offset,captured[i].Length-offset);
            if(count<=0)throw new IOException("RELEASE_PROTECTED_READ_UNPROVEN");offset+=count;}
          if(file.ReadByte()!=-1 || file.Length!=size)throw new IOException("RELEASE_PROTECTED_READ_UNPROVEN");
        }
        string wire=new UTF8Encoding(false,true).GetString(captured[0]);var permit=SovereignMobileInstallReleaseV1.Permit(wire);
        string sid;using(var identity=WindowsIdentity.GetCurrent())sid=identity.User.Value;
        long observedGeneration=Int64.Parse(permit["enrollmentGeneration"],CultureInfo.InvariantCulture);
        using(var inspection=SovereignMobileInstallReleaseV1.InspectCaptured(wire,captured[1],captured[2],captured[3],
            RuntimeMachineHashV1(),sid,observedGeneration)) {
          if(!inspection.PermitDataVerified) {pins.Dispose();return new MobileInstallReleaseInspectionV1(false,inspection.ReasonCode,null);}
        }
        // Permit generation is OBSERVED, never compared to enrollment.json here.
        // The future native owner must independently bind protected enrollment.
        return new MobileInstallReleaseInspectionV1(true,"RELEASE_PROTECTED_DATA_VERIFIED_ENROLLMENT_UNPROVEN",permit,pins);
      }catch(Exception) {pins.Dispose();return new MobileInstallReleaseInspectionV1(false,"RELEASE_PROTECTED_STORAGE_UNPROVEN",null);}
    }
  }
}
