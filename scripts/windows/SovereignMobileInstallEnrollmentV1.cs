// Fixed native enrollment qualification. This is not a caller-supplied grant.
// Initial provisioning is separately operator/admin approved. Routine opening
// never creates a key, task, file, journal, source permit or signed genesis.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.Globalization;
  using System.IO;
  using System.Reflection;
  using System.Runtime.InteropServices;
  using System.Security.AccessControl;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Threading.Tasks;

  internal sealed class MobileInstallQualifiedEnrollmentV1 : IDisposable {
    internal const string Root=@"C:\Program Files\Stephanos\SovereignMobileInstallerV1";
    internal const string Helper=Root+@"\installer.exe";
    internal const string TaskName="Stephanos Mobile Runtime Installer V1";
    internal const string ReceiptKeyName="Stephanos.SovereignMobileInstallerV1.Receipt";
    const string Prefix="STEPHANOS_MOBILE_INSTALL_ENROLLMENT_V1";
    const string Domain="stephanos.mobile-install-enrollment-certificate.v1\0";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static readonly string[] Keys={"repository","machineHash","operatorSid","generation","credentialBindingSha256",
      "receiptPublicKeySpki","helperSha256","sourceHead","sourceTree","packageSha256","closureSha256",
      "releaseProofSha256","bootstrapSha256","qualificationEvidenceSha256","issuedAtUtc"};
    internal readonly string MachineHash,OperatorSid,CredentialBindingSha256,SourceHead,SourceTree;
    internal readonly string PackageSha256,ClosureSha256,ReleaseProofSha256,BootstrapSha256,EnrollmentJson;
    internal readonly long Generation;
    readonly IDisposable files,release,anchor;
    readonly string snapshot;
    bool disposed;
    private MobileInstallQualifiedEnrollmentV1(MobileInstallEnrollmentFilesV1 nativeFiles,
      MobileInstallReleaseInspectionV1 nativeRelease,SovereignMobileInstallAnchorV1 nativeAnchor) {
      var binding=nativeFiles.Binding;
      MachineHash=binding.MachineHash;OperatorSid=binding.OperatorSid;Generation=binding.Generation;
      CredentialBindingSha256=binding.CredentialBindingSha256;EnrollmentJson=nativeFiles.EnrollmentJson;
      SourceHead=nativeRelease.SourceHead;SourceTree=nativeRelease.SourceTree;PackageSha256=nativeRelease.PackageSha256;
      ClosureSha256=nativeRelease.ClosureSha256;ReleaseProofSha256=nativeRelease.ReleaseProofSha256;BootstrapSha256=nativeRelease.BootstrapSha256;
      files=nativeFiles;release=nativeRelease;anchor=nativeAnchor;snapshot=Snapshot();
    }
    string Snapshot() {return MachineHash+"\0"+OperatorSid+"\0"+Generation+"\0"+CredentialBindingSha256+"\0"+
      SourceHead+"\0"+SourceTree+"\0"+PackageSha256+"\0"+ClosureSha256+"\0"+ReleaseProofSha256+"\0"+BootstrapSha256+"\0"+EnrollmentJson;}
    internal bool IsIntact() {return !disposed && Snapshot()==snapshot;}
    static void Deny(string reason) {throw new InvalidOperationException(reason);}
    static bool Is(string value,string expression) {return value!=null && Regex.IsMatch(value,expression,RegexOptions.CultureInvariant);}
    static string Hash(byte[] bytes) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    static string Url64(byte[] bytes) {return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    // Data validation only. The bootstrap separately authenticates final source,
    // review and operator approval. The native actual target is never supplied
    // by the browser, descriptor or a caller-selected path.
    internal static void ValidateSetupDescriptorForEnrollmentV1(string raw,string proposedEnrollment,
      string sourceHead,string sourceTree,string packageSha256,string releaseProofSha256,DateTime nowUtc) {
      string sid;using(var identity=WindowsIdentity.GetCurrent())sid=identity.User==null?null:identity.User.Value;
      ValidateSetupDescriptorDataV1(raw,proposedEnrollment,sourceHead,sourceTree,packageSha256,releaseProofSha256,
        CoreJobCustodyV1.MobileEnrollmentMachineHashV1(),sid,nowUtc);
    }
    internal static void ValidateSetupDescriptorDataV1(string raw,string proposedEnrollment,string sourceHead,string sourceTree,
      string packageSha256,string releaseProofSha256,string actualMachineHash,string actualSid,DateTime nowUtc) {
      var descriptor=SovereignMobileInstallAssertionV1.ReadBoundedObjectV1(raw,8192);
      string[] keys={"schemaVersion","repository","sourceHead","sourceTree","machineHash","operatorSid","enrollmentGeneration",
        "packageSha256","releaseProofSha256","proposedEnrollmentSha256","nonce","issuedAtUtc","expiresAtUtc"};
      if(descriptor.Count!=keys.Length || nowUtc.Kind!=DateTimeKind.Utc)Deny("MOBILE_ENROLLMENT_DESCRIPTOR_CONTEXT");
      foreach(string key in keys)if(!descriptor.ContainsKey(key))Deny("MOBILE_ENROLLMENT_DESCRIPTOR_KEYS");
      Func<string,string> text=delegate(string key) {var value=descriptor[key] as string;if(value==null)Deny("MOBILE_ENROLLMENT_DESCRIPTOR_TYPE");return value;};
      var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(proposedEnrollment);
      object generation=descriptor["enrollmentGeneration"];
      if(!(generation is double) || (double)generation<1 || (double)generation>9007199254740991d ||
        (double)generation!=Math.Truncate((double)generation) || (double)generation!=binding.Generation ||
        !Is(sourceHead,"\\A[a-f0-9]{40}\\z") || !Is(sourceTree,"\\A[a-f0-9]{40}\\z") ||
        !Is(packageSha256,"\\A[a-f0-9]{64}\\z") || !Is(releaseProofSha256,"\\A[a-f0-9]{64}\\z") ||
        text("schemaVersion")!="stephanos.mobile-installer-setup-descriptor.v1" || text("repository")!="Cheekyfellastef/stephan-os" ||
        text("sourceHead")!=sourceHead || text("sourceTree")!=sourceTree || text("machineHash")!=actualMachineHash ||
        text("operatorSid")!=actualSid || binding.MachineHash!=actualMachineHash || binding.OperatorSid!=actualSid ||
        text("packageSha256")!=packageSha256 || text("releaseProofSha256")!=releaseProofSha256 ||
        text("proposedEnrollmentSha256")!=Hash(Utf8.GetBytes(proposedEnrollment)) || !Is(text("nonce"),"\\A[a-f0-9]{64}\\z"))
        Deny("MOBILE_ENROLLMENT_DESCRIPTOR_BINDING");
      DateTime issued,expires;var style=DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal;
      if(!DateTime.TryParseExact(text("issuedAtUtc"),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,style,out issued) ||
         !DateTime.TryParseExact(text("expiresAtUtc"),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,style,out expires) ||
         expires<=issued || expires-issued>TimeSpan.FromMinutes(15) || issued>nowUtc.AddSeconds(5) || nowUtc>=expires)
        Deny("MOBILE_ENROLLMENT_DESCRIPTOR_NOT_FRESH");
    }
    // Public device material is independently captured from fixed protected
    // storage. A pipe response can never choose its own receipt verification key.
    // This read factory grants no install or enrollment authority.
    internal static string ReadProtectedClientEnrollmentV1() {
      using(var held=CoreJobCustodyV1.OpenMobileClientEnrollmentFilesV1())
      using(var permit=SovereignMobileInstallReleaseV1.OpenProtected()) {
        if(!permit.PermitDataVerified || !permit.ProtectedStorageObserved || held.Binding.Generation!=permit.EnrollmentGeneration ||
          held.Binding.MachineHash!=permit.MachineHash || held.Binding.OperatorSid!=permit.OperatorSid)
          Deny("MOBILE_CLIENT_PROTECTED_ENROLLMENT_UNPROVEN");
        VerifyCertificateV1(held.Certificate,held.Binding.ReceiptPublicKeySpki,Hash(held.HelperBytes),held.Binding,permit);
        return held.EnrollmentJson;
      }
    }
    internal static string CertificateBodyForEnrollmentV1(SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding,
      MobileInstallReleaseInspectionV1 permit,string helperSha256,DateTime issuedAtUtc) {
      if(binding==null || permit==null || !permit.PermitDataVerified || issuedAtUtc.Kind!=DateTimeKind.Utc ||
         !Is(helperSha256,"\\A[a-f0-9]{64}\\z") || binding.MachineHash!=permit.MachineHash || binding.OperatorSid!=permit.OperatorSid ||
         binding.Generation!=permit.EnrollmentGeneration)Deny("MOBILE_ENROLLMENT_CERTIFICATE_CONTEXT");
      var values=new Dictionary<string,string>(StringComparer.Ordinal) {
        {"repository","Cheekyfellastef/stephan-os"},{"machineHash",binding.MachineHash},{"operatorSid",binding.OperatorSid},
        {"generation",binding.Generation.ToString(CultureInfo.InvariantCulture)},{"credentialBindingSha256",binding.CredentialBindingSha256},
        {"receiptPublicKeySpki",binding.ReceiptPublicKeySpki},{"helperSha256",helperSha256},{"sourceHead",permit.SourceHead},{"sourceTree",permit.SourceTree},
        {"packageSha256",permit.PackageSha256},{"closureSha256",permit.ClosureSha256},{"releaseProofSha256",permit.ReleaseProofSha256},
        {"bootstrapSha256",permit.BootstrapSha256},{"qualificationEvidenceSha256",permit.ReleaseProofSha256},
        {"issuedAtUtc",issuedAtUtc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)}};
      string body=Prefix+"\n";foreach(string key in Keys)body+=key+"="+values[key]+"\n";return body;
    }
    static Dictionary<string,string> Certificate(string wire,out string body,out byte[] signature) {
      if(wire==null || wire.Length>8192)Deny("MOBILE_ENROLLMENT_CERTIFICATE_BOUND");
      foreach(char ch in wire)if(ch!='\n' && (ch<32 || ch>126))Deny("MOBILE_ENROLLMENT_CERTIFICATE_WIRE");
      string[] lines=wire.Split('\n');
      if(lines.Length!=Keys.Length+3 || lines[0]!=Prefix || lines[lines.Length-1]!="")Deny("MOBILE_ENROLLMENT_CERTIFICATE_WIRE");
      var fields=new Dictionary<string,string>(StringComparer.Ordinal);
      for(int i=0;i<Keys.Length;i++) {
        string prefix=Keys[i]+"=";if(!lines[i+1].StartsWith(prefix,StringComparison.Ordinal))Deny("MOBILE_ENROLLMENT_CERTIFICATE_KEYS");
        fields.Add(Keys[i],lines[i+1].Substring(prefix.Length));
      }
      if(fields["repository"]!="Cheekyfellastef/stephan-os")Deny("MOBILE_ENROLLMENT_CERTIFICATE_REPOSITORY");
      foreach(string key in new[]{"machineHash","credentialBindingSha256","helperSha256","packageSha256","closureSha256",
        "releaseProofSha256","bootstrapSha256","qualificationEvidenceSha256"})
        if(!Is(fields[key],"\\A[a-f0-9]{64}\\z"))Deny("MOBILE_ENROLLMENT_CERTIFICATE_DIGEST");
      foreach(string key in new[]{"sourceHead","sourceTree"})if(!Is(fields[key],"\\A[a-f0-9]{40}\\z"))Deny("MOBILE_ENROLLMENT_CERTIFICATE_SOURCE");
      long generation;
      if(!Is(fields["generation"],"\\A[1-9][0-9]{0,15}\\z") || !Int64.TryParse(fields["generation"],out generation) || generation>9007199254740991L ||
         !Is(fields["operatorSid"],"\\AS-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}\\z"))
        Deny("MOBILE_ENROLLMENT_CERTIFICATE_IDENTITY");
      DateTime issued;
      if(!DateTime.TryParseExact(fields["issuedAtUtc"],"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,
         DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out issued) || issued>DateTime.UtcNow.AddSeconds(5))
        Deny("MOBILE_ENROLLMENT_CERTIFICATE_TIME");
      string encoded=lines[Keys.Length+1];
      if(!encoded.StartsWith("signature=",StringComparison.Ordinal))Deny("MOBILE_ENROLLMENT_CERTIFICATE_SIGNATURE");
      encoded=encoded.Substring(10);
      if(!Is(encoded,"\\A[A-Za-z0-9_-]{86}\\z"))Deny("MOBILE_ENROLLMENT_CERTIFICATE_SIGNATURE");
      signature=Convert.FromBase64String(encoded.Replace('-','+').Replace('_','/')+"==");
      if(signature.Length!=64 || Url64(signature)!=encoded)Deny("MOBILE_ENROLLMENT_CERTIFICATE_SIGNATURE");
      body=Prefix+"\n";foreach(string key in Keys)body+=key+"="+fields[key]+"\n";
      return fields;
    }
    // Structural/signature inspection only; production qualification additionally
    // requires retained native files, actual helper identity, task and key/genesis.
    internal static void VerifyCertificateV1(string wire,string expectedSpki,string expectedHelper,
      SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding,MobileInstallReleaseInspectionV1 permit) {
      if(binding==null || permit==null || !permit.PermitDataVerified)Deny("MOBILE_ENROLLMENT_CERTIFICATE_CONTEXT");
      string body;byte[] signature;var fields=Certificate(wire,out body,out signature);
      if(fields["receiptPublicKeySpki"]!=expectedSpki || expectedSpki!=binding.ReceiptPublicKeySpki || fields["helperSha256"]!=expectedHelper ||
         fields["machineHash"]!=binding.MachineHash || fields["operatorSid"]!=binding.OperatorSid ||
         fields["generation"]!=binding.Generation.ToString(CultureInfo.InvariantCulture) || fields["credentialBindingSha256"]!=binding.CredentialBindingSha256 ||
         fields["sourceHead"]!=permit.SourceHead || fields["sourceTree"]!=permit.SourceTree || fields["packageSha256"]!=permit.PackageSha256 ||
         fields["closureSha256"]!=permit.ClosureSha256 || fields["releaseProofSha256"]!=permit.ReleaseProofSha256 ||
         fields["bootstrapSha256"]!=permit.BootstrapSha256 || fields["qualificationEvidenceSha256"]!=permit.ReleaseProofSha256)
        Deny("MOBILE_ENROLLMENT_CERTIFICATE_BINDING");
      using(var key=SovereignMobileInstallAssertionV1.ReadP256PublicKeyV1(expectedSpki))
      using(var verifier=new ECDsaCng(key))using(var sha=SHA256.Create())
        if(!verifier.VerifyHash(sha.ComputeHash(Utf8.GetBytes(Domain+body)),signature))Deny("MOBILE_ENROLLMENT_CERTIFICATE_SIGNATURE");
    }
    internal static MobileInstallQualifiedEnrollmentV1 OpenProtected() {
      MobileInstallEnrollmentFilesV1 files=null;MobileInstallReleaseInspectionV1 release=null;SovereignMobileInstallAnchorV1 anchor=null;
      try {
        files=CoreJobCustodyV1.OpenMobileEnrollmentFilesV1();
        release=SovereignMobileInstallReleaseV1.OpenProtected();
        if(!release.PermitDataVerified || !release.ProtectedStorageObserved || release.EnrollmentGeneration!=files.Binding.Generation ||
           release.MachineHash!=files.Binding.MachineHash || release.OperatorSid!=files.Binding.OperatorSid)
          Deny("MOBILE_INSTALLER_RELEASE_PERMIT_UNPROVEN");
        VerifyCertificateV1(files.Certificate,files.Binding.ReceiptPublicKeySpki,Hash(files.HelperBytes),files.Binding,release);
        anchor=SovereignMobileInstallAnchorV1.OpenProtected();
        using(var journal=SovereignMobileInstallJournalV1.OpenProtected()) { }
        return new MobileInstallQualifiedEnrollmentV1(files,release,anchor);
      }catch {
        if(anchor!=null)anchor.Dispose();if(release!=null)release.Dispose();if(files!=null)files.Dispose();
        throw new InvalidOperationException("MOBILE_INSTALLER_QUALIFIED_ENROLLMENT_REQUIRED");
      }
    }
    public void Dispose() {if(disposed)return;disposed=true;try{anchor.Dispose();}finally{try{release.Dispose();}finally{files.Dispose();}}}
  }
  internal sealed class MobileInstallEnrollmentFilesV1 : IDisposable {
    internal string Certificate,EnrollmentJson;
    internal byte[] HelperBytes;
    internal SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 Binding;
    internal FixedRuntimeIdentityPinsV1 Pins;
    public void Dispose(){if(Pins!=null){Pins.Dispose();Pins=null;}}
  }
  public static partial class CoreJobCustodyV1 {
    internal static string MobileEnrollmentMachineHashV1() {return RuntimeMachineHashV1();}
    internal static MobileInstallEnrollmentFilesV1 OpenMobileClientEnrollmentFilesV1() {
      var held=OpenMobileProvisioningFilesV1();
      try {
        string root=MobileInstallQualifiedEnrollmentV1.Root;
        RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
        RuntimeProtectedAclV1(@"C:\Program Files\Stephanos",true);RuntimeProtectedAclV1(root,true);
        string certificate=Path.Combine(root,"enrollment-certificate.v1");
        RuntimePinParentsV1(certificate,held.Pins);RuntimeProtectedAclV1(certificate,false);
        held.Certificate=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(certificate,8192,held.Pins));
        return held;
      }catch {held.Dispose();throw;}
    }
    static object MobileComGetV1(object value,string name) {return value.GetType().InvokeMember(name,BindingFlags.GetProperty,null,value,null,CultureInfo.InvariantCulture);}
    static object MobileComCallV1(object value,string name,params object[] args) {return value.GetType().InvokeMember(name,BindingFlags.InvokeMethod,null,value,args,CultureInfo.InvariantCulture);}
    static void AssertMobileTaskDaclV1(string sddl) {
      if(sddl==null || sddl.Length>8192)throw new InvalidOperationException("MOBILE_INSTALLER_TASK_UNPROVEN");
      var acl=new RawSecurityDescriptor(sddl);
      if(acl.Owner==null || (acl.Owner.Value!="S-1-5-18" && acl.Owner.Value!="S-1-5-32-544") || acl.DiscretionaryAcl==null)
        throw new InvalidOperationException("MOBILE_INSTALLER_TASK_UNPROVEN");
      foreach(GenericAce item in acl.DiscretionaryAcl) {
        var ace=item as CommonAce;
        if(ace==null || ace.IsCallback || (ace.AceFlags&AceFlags.InheritOnly)!=0 ||
           (ace.AceQualifier==AceQualifier.AccessAllowed && (ace.AccessMask&0x500d0156)!=0 &&
            ace.SecurityIdentifier.Value!="S-1-5-18" && ace.SecurityIdentifier.Value!="S-1-5-32-544"))
          throw new InvalidOperationException("MOBILE_INSTALLER_TASK_UNPROVEN");
      }
    }
    static void CheckMobileTaskV1(string sid,string account) {
      var held=new List<object>();
      try {
        object service=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service",true));held.Add(service);
        MobileComCallV1(service,"Connect");object folder=MobileComCallV1(service,"GetFolder","\\");held.Add(folder);
        object task=MobileComCallV1(folder,"GetTask",MobileInstallQualifiedEnrollmentV1.TaskName);held.Add(task);
        AssertMobileTaskDaclV1((string)MobileComCallV1(task,"GetSecurityDescriptor",7));
        object definition=MobileComGetV1(task,"Definition");held.Add(definition);
        object principal=MobileComGetV1(definition,"Principal");held.Add(principal);
        string owner=Convert.ToString(MobileComGetV1(principal,"UserId"),CultureInfo.InvariantCulture);
        object actions=MobileComGetV1(definition,"Actions");held.Add(actions);
        object triggers=MobileComGetV1(definition,"Triggers");held.Add(triggers);
        object settings=MobileComGetV1(definition,"Settings");held.Add(settings);
        if((owner!=sid && !String.Equals(owner,account,StringComparison.OrdinalIgnoreCase)) ||
           Convert.ToInt32(MobileComGetV1(principal,"LogonType"))!=3 || Convert.ToInt32(MobileComGetV1(principal,"RunLevel"))!=1 ||
           Convert.ToInt32(MobileComGetV1(actions,"Count"))!=1 || Convert.ToInt32(MobileComGetV1(triggers,"Count"))!=0 ||
           Convert.ToInt32(MobileComGetV1(settings,"MultipleInstances"))!=2 || !Convert.ToBoolean(MobileComGetV1(settings,"Enabled")))
          throw new InvalidOperationException("MOBILE_INSTALLER_TASK_UNPROVEN");
        object action=actions.GetType().InvokeMember("Item",BindingFlags.GetProperty,null,actions,new object[]{1},CultureInfo.InvariantCulture);held.Add(action);
        if(Convert.ToInt32(MobileComGetV1(action,"Type"))!=0 ||
           !String.Equals(Convert.ToString(MobileComGetV1(action,"Path")),MobileInstallQualifiedEnrollmentV1.Helper,StringComparison.OrdinalIgnoreCase) ||
           Convert.ToString(MobileComGetV1(action,"Arguments"))!="" ||
           !String.Equals(Convert.ToString(MobileComGetV1(action,"WorkingDirectory")),MobileInstallQualifiedEnrollmentV1.Root,StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("MOBILE_INSTALLER_TASK_UNPROVEN");
      }finally {for(int i=held.Count-1;i>=0;i--)if(Marshal.IsComObject(held[i]))Marshal.FinalReleaseComObject(held[i]);}
    }
    internal static MobileInstallEnrollmentFilesV1 OpenMobileEnrollmentFilesV1() {
      var pins=new FixedRuntimeIdentityPinsV1();
      try {
        using(var identity=WindowsIdentity.GetCurrent())using(var process=Process.GetCurrentProcess()) {
          if(identity.User==null || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) ||
             !Environment.UserInteractive || process.SessionId<=0 ||
             !String.Equals(process.MainModule.FileName,MobileInstallQualifiedEnrollmentV1.Helper,StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("MOBILE_INSTALLER_NATIVE_PRINCIPAL_UNPROVEN");
          string root=MobileInstallQualifiedEnrollmentV1.Root;
          foreach(string path in new[]{Path.Combine(root,"enrollment.json"),Path.Combine(root,"enrollment-certificate.v1"),MobileInstallQualifiedEnrollmentV1.Helper})
            RuntimePinParentsV1(path,pins);
          RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
          RuntimeProtectedAclV1(@"C:\Program Files\Stephanos",true);RuntimeProtectedAclV1(root,true);
          foreach(string name in new[]{"enrollment.json","enrollment-certificate.v1","installer.exe"})RuntimeProtectedAclV1(Path.Combine(root,name),false);
          string enrollment=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(Path.Combine(root,"enrollment.json"),8192,pins));
          var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(enrollment);
          if(binding.OperatorSid!=identity.User.Value || binding.MachineHash!=RuntimeMachineHashV1())
            throw new InvalidOperationException("MOBILE_INSTALLER_OPERATOR_MACHINE_UNPROVEN");
          string sid=identity.User.Value,account=identity.Name;
          var check=Task.Factory.StartNew(delegate {CheckMobileTaskV1(sid,account);});
          if(!check.Wait(5000))throw new InvalidOperationException("MOBILE_INSTALLER_TASK_OBSERVATION_TIMEOUT");
          return new MobileInstallEnrollmentFilesV1 {EnrollmentJson=enrollment,Binding=binding,
            Certificate=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(Path.Combine(root,"enrollment-certificate.v1"),8192,pins)),
            HelperBytes=RuntimeReadPinnedV1(MobileInstallQualifiedEnrollmentV1.Helper,2097152,pins),Pins=pins};
        }
      }catch {pins.Dispose();throw;}
    }
  }
}
