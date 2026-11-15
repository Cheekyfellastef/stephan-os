// Initial setup only. The closed runtime protocol exposes no provisioning verb.
// Called from the separately approved immutable-source administrator bootstrap.
// No overwrite, key export, task choice, source choice, reset or recovery path.
namespace Stephanos.Sovereign {
  using System;
  using System.Diagnostics;
  using System.Globalization;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Security.AccessControl;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;

  internal static class SovereignMobileInstallProvisioningV1 {
    [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)]static extern int NCryptOpenStorageProvider(out IntPtr provider,string name,uint flags);
    [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)]static extern int NCryptCreatePersistedKey(IntPtr provider,out IntPtr key,string algorithm,string name,uint legacy,uint flags);
    [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)]static extern int NCryptSetProperty(IntPtr key,string name,byte[] bytes,int size,uint flags);
    [DllImport("ncrypt.dll")]static extern int NCryptFinalizeKey(IntPtr key,uint flags);
    [DllImport("ncrypt.dll")]static extern int NCryptFreeObject(IntPtr value);
    [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)]static extern int NCryptOpenKey(IntPtr provider,out IntPtr key,string name,uint legacy,uint flags);
    const string Provider="Microsoft Software Key Storage Provider";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    static string Url64(byte[] bytes){return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    static System.IO.Pipes.NamedPipeServerStream manualBoundary;
    static void RequireManualPrincipal() {
      using(var identity=WindowsIdentity.GetCurrent())using(var process=Process.GetCurrentProcess()) {
        if(identity.User==null || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) ||
            !Environment.UserInteractive || process.SessionId<=0 ||
            !String.Equals(process.MainModule.FileName,@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("MOBILE_ENROLLMENT_APPROVED_ADMIN_BOOTSTRAP_REQUIRED");
      }
    }
    internal static IDisposable OpenManualBoundaryV2() {
      RequireManualPrincipal();
      if(manualBoundary!=null)throw new InvalidOperationException("MOBILE_ENROLLMENT_MANUAL_BOUNDARY_ALREADY_HELD");
      using(var identity=WindowsIdentity.GetCurrent())manualBoundary=SovereignMobileInstallEntryV1.OpenManualEnrollmentExclusionV2(identity.User.Value);
      return new ManualBoundaryV2();
    }
    sealed class ManualBoundaryV2:IDisposable {
      public void Dispose(){var held=manualBoundary;manualBoundary=null;if(held!=null)held.Dispose();}
    }
    internal static void AssertManualBoundaryV2() {
      RequireManualPrincipal();
      if(manualBoundary==null || manualBoundary.SafePipeHandle.IsClosed || manualBoundary.SafePipeHandle.IsInvalid)
        throw new InvalidOperationException("MOBILE_ENROLLMENT_MANUAL_BOUNDARY_REQUIRED");
    }
    internal static void AssertFreshEnrollmentBoundaryV2() {
      AssertManualBoundaryV2();CoreJobCustodyV1.CheckMobileAnchorLogPolicyV1();
      IntPtr provider=IntPtr.Zero,key=IntPtr.Zero;
      try {
        if(NCryptOpenStorageProvider(out provider,Provider,0)!=0)throw new InvalidOperationException("MOBILE_ENROLLMENT_KEY_PROVIDER_UNPROVEN");
        int result=NCryptOpenKey(provider,out key,MobileInstallQualifiedEnrollmentV1.ReceiptKeyName,0,0x20);
        if(result!=unchecked((int)0x80090016))throw new InvalidOperationException("MOBILE_ENROLLMENT_KEY_ABSENCE_UNPROVEN");
      }finally{if(key!=IntPtr.Zero)NCryptFreeObject(key);if(provider!=IntPtr.Zero)NCryptFreeObject(provider);}
      CoreJobCustodyV1.RequireMobileTaskAbsentV2();SovereignMobileInstallAnchorV1.AssertMobileGenesisAbsentV2();
    }
    static void RequireSetupPrincipal() {
      AssertManualBoundaryV2();
      using(var identity=WindowsIdentity.GetCurrent())using(var process=Process.GetCurrentProcess()) {
        if(identity.User==null || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) || !Environment.UserInteractive || process.SessionId<=0 ||
           !String.Equals(process.MainModule.FileName,@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("MOBILE_ENROLLMENT_APPROVED_ADMIN_BOOTSTRAP_REQUIRED");
      }
      CoreJobCustodyV1.CheckMobileProvisioningRootV1();
    }
    static string PublicSpki(CngKey key) {
      byte[] blob=key.Export(CngKeyBlobFormat.EccPublicBlob);
      if(blob.Length!=72 || blob[0]!=0x45 || blob[1]!=0x43 || blob[2]!=0x53 || blob[3]!=0x31 || blob[4]!=32 || blob[5]!=0 || blob[6]!=0 || blob[7]!=0)
        throw new InvalidOperationException("MOBILE_ENROLLMENT_RECEIPT_KEY_UNPROVEN");
      byte[] prefix={0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04};
      var bytes=new byte[91];Buffer.BlockCopy(prefix,0,bytes,0,prefix.Length);Buffer.BlockCopy(blob,8,bytes,27,64);return Url64(bytes);
    }
    // Security is supplied BEFORE finalization. Success returns only after the
    // same strict fixed-key public/ACL/policy check used by ordinary native open.
    // A failure never deletes/recreates a possibly persisted key or widens ACLs.
    internal static string CreateReceiptKeyForEnrollmentV1() {
      RequireSetupPrincipal();CoreJobCustodyV1.CheckMobileAnchorLogPolicyV1();
      if(CngKey.Exists(MobileInstallQualifiedEnrollmentV1.ReceiptKeyName,CngProvider.MicrosoftSoftwareKeyStorageProvider,CngKeyOpenOptions.MachineKey))
        throw new InvalidOperationException("MOBILE_ENROLLMENT_KEY_ALREADY_EXISTS_INSPECT_ONLY");
      IntPtr provider=IntPtr.Zero,key=IntPtr.Zero;
      try {
        if(NCryptOpenStorageProvider(out provider,Provider,0)!=0 ||
           NCryptCreatePersistedKey(provider,out key,"ECDSA_P256",MobileInstallQualifiedEnrollmentV1.ReceiptKeyName,0,0x20)!=0)
          throw new InvalidOperationException("MOBILE_ENROLLMENT_KEY_CREATION_UNPROVEN");
        byte[] usage=BitConverter.GetBytes(2u),export=BitConverter.GetBytes(0u);
        var descriptor=new RawSecurityDescriptor("O:BAG:SYD:P(A;;GA;;;SY)(A;;GA;;;BA)");
        var security=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(security,0);
        if(NCryptSetProperty(key,"Key Usage",usage,usage.Length,0)!=0 || NCryptSetProperty(key,"Export Policy",export,export.Length,0)!=0 ||
           NCryptSetProperty(key,"Security Descr",security,security.Length,0x80000007u)!=0 || NCryptFinalizeKey(key,0)!=0)
          throw new InvalidOperationException("MOBILE_ENROLLMENT_KEY_POLICY_OR_FINALIZE_UNPROVEN");
        using(var reopened=SovereignMobileInstallAnchorV1.OpenReceiptKeyForEnrollmentV1())return PublicSpki(reopened);
      } finally {
        if(key!=IntPtr.Zero)NCryptFreeObject(key);if(provider!=IntPtr.Zero)NCryptFreeObject(provider);
      }
    }
    internal static string SealEnrollmentCertificateV1() {
      RequireSetupPrincipal();
      using(var held=CoreJobCustodyV1.OpenMobileProvisioningFilesV1())
      using(var permit=SovereignMobileInstallReleaseV1.OpenProtected())
      using(var key=SovereignMobileInstallAnchorV1.OpenReceiptKeyForEnrollmentV1()) {
        if(!permit.PermitDataVerified || !permit.ProtectedStorageObserved || PublicSpki(key)!=held.Binding.ReceiptPublicKeySpki)
          throw new InvalidOperationException("MOBILE_ENROLLMENT_SEAL_CONTEXT_UNPROVEN");
        if(held.Authorization==null)throw new InvalidOperationException("MOBILE_ENROLLMENT_AUTHORIZATION_REQUIRED");
        held.Authorization.EnsureFresh();
        string body=MobileInstallQualifiedEnrollmentV1.CertificateBodyForEnrollmentV2(held.Binding,permit,Hash(held.HelperBytes),held.Authorization,DateTime.UtcNow);
        byte[] signature;
        using(var signer=new ECDsaCng(key))using(var sha=SHA256.Create())
          signature=signer.SignHash(sha.ComputeHash(Utf8.GetBytes("stephanos.mobile-install-enrollment-certificate.v2\0"+body)));
        held.Authorization.EnsureFresh();
        string wire=body+"signature="+Url64(signature)+"\n";
        MobileInstallQualifiedEnrollmentV1.VerifyCertificateV2(wire,held.Binding.ReceiptPublicKeySpki,Hash(held.HelperBytes),held.Binding,permit,held.Authorization);
        byte[] bytes=Utf8.GetBytes(wire);
        held.Authorization.EnsureFresh();
        CoreJobCustodyV1.WriteNewMobileEnrollmentCertificateV1(bytes);
        held.Authorization.EnsureFresh();
        return Hash(bytes);
      }
    }
  }
  public static partial class CoreJobCustodyV1 {
    internal static void ReadAbsentMobileTaskV2(object folder) {
      object existing=null;
      try {existing=MobileComCallV1(folder,"GetTask",MobileInstallQualifiedEnrollmentV1.TaskName);}
      catch(System.Reflection.TargetInvocationException wrapper) {
        Exception error=wrapper.InnerException;
        if(error!=null && (error is System.Runtime.InteropServices.COMException || error is FileNotFoundException) &&
            error.HResult==unchecked((int)0x80070002))return;
        throw;
      }
      catch(Exception error) {
        if((error is System.Runtime.InteropServices.COMException || error is FileNotFoundException) &&
            error.HResult==unchecked((int)0x80070002))return;
        throw;
      }
      finally{if(existing!=null && Marshal.IsComObject(existing))Marshal.FinalReleaseComObject(existing);}
      throw new InvalidOperationException("MOBILE_ENROLLMENT_TASK_ALREADY_EXISTS_INSPECT_ONLY");
    }
    internal static void RequireMobileTaskAbsentV2() {
      var task=System.Threading.Tasks.Task.Factory.StartNew(delegate {
        object service=null,folder=null;
        try {
          service=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service",true));MobileComCallV1(service,"Connect");
          folder=MobileComCallV1(service,"GetFolder","\\");ReadAbsentMobileTaskV2(folder);
        }finally{foreach(object value in new[]{folder,service})if(value!=null && Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);}
      });
      if(!task.Wait(5000))throw new InvalidOperationException("MOBILE_ENROLLMENT_TASK_ABSENCE_TIMEOUT");
    }
    internal static void CheckMobileProvisioningRootV1() {
      string root=MobileInstallQualifiedEnrollmentV1.Root;var pins=new FixedRuntimeIdentityPinsV1();
      try {
        RuntimePinParentsV1(Path.Combine(root,"installer.exe"),pins);
        RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
        RuntimeProtectedAclV1(@"C:\Program Files\Stephanos",true);RuntimeProtectedAclV1(root,true);
        RuntimeProtectedAclV1(Path.Combine(root,"installer.exe"),false);
        RuntimeReadPinnedV1(Path.Combine(root,"installer.exe"),2097152,pins);
      }finally{pins.Dispose();}
    }
    internal static void VerifyManualEnrollmentReadbackV2() {
      SovereignMobileInstallProvisioningV1.AssertManualBoundaryV2();
      using(var held=OpenMobileClientEnrollmentFilesV1())
      using(var permit=SovereignMobileInstallReleaseV1.OpenProtected())
      using(var anchor=SovereignMobileInstallAnchorV1.OpenProtected())
      using(var journal=SovereignMobileInstallJournalV1.OpenProtected())
      using(var identity=WindowsIdentity.GetCurrent()) {
        string sid=identity.User.Value,account=identity.Name;
        var checkedTask=System.Threading.Tasks.Task.Factory.StartNew(delegate {CheckMobileTaskV1(sid,account);});
        if(!checkedTask.Wait(5000))throw new InvalidOperationException("MOBILE_ENROLLMENT_TASK_READBACK_TIMEOUT");
        using(var sha=SHA256.Create())MobileInstallQualifiedEnrollmentV1.VerifyCertificateV2(held.Certificate,
          held.Binding.ReceiptPublicKeySpki,BitConverter.ToString(sha.ComputeHash(held.HelperBytes)).Replace("-","").ToLowerInvariant(),
          held.Binding,permit,held.Authorization);
        held.Authorization.EnsureFresh();
      }
    }
    internal static MobileInstallEnrollmentFilesV1 OpenMobileProvisioningFilesV1() {
      var pins=new FixedRuntimeIdentityPinsV1();
      try {
        string root=MobileInstallQualifiedEnrollmentV1.Root;
        foreach(string name in new[]{"installer.exe","enrollment.json"}) {
          string path=Path.Combine(root,name);RuntimePinParentsV1(path,pins);RuntimeProtectedAclV1(path,false);
        }
        string raw=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(Path.Combine(root,"enrollment.json"),8192,pins));
        var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(raw);
        using(var identity=WindowsIdentity.GetCurrent())if(identity.User==null || binding.OperatorSid!=identity.User.Value || binding.MachineHash!=RuntimeMachineHashV1())
          throw new InvalidOperationException("MOBILE_ENROLLMENT_SETUP_TARGET_CHANGED");
        MobileInstallEnrollmentAuthorizationV2 authorization;using(var permit=SovereignMobileInstallReleaseV1.OpenProtected())
          authorization=ReadMobileAuthorizationV2(binding,permit,pins);
        return new MobileInstallEnrollmentFilesV1 {EnrollmentJson=raw,Binding=binding,Pins=pins,Authorization=authorization,
          HelperBytes=RuntimeReadPinnedV1(Path.Combine(root,"installer.exe"),2097152,pins)};
      }catch{pins.Dispose();throw;}
    }
    internal static void WriteNewMobileEnrollmentCertificateV1(byte[] bytes) {
      if(bytes==null || bytes.Length<256 || bytes.Length>8192)throw new InvalidOperationException("MOBILE_ENROLLMENT_CERTIFICATE_BOUND");
      string path=Path.Combine(MobileInstallQualifiedEnrollmentV1.Root,"enrollment-certificate.v1");var pins=new FixedRuntimeIdentityPinsV1();
      try {
        RuntimePinParentsV1(path,pins);RuntimeProtectedAclV1(MobileInstallQualifiedEnrollmentV1.Root,true);
        using(var stream=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)) {
          stream.Write(bytes,0,bytes.Length);stream.Flush(true);
        }
        RuntimeProtectedAclV1(path,false);byte[] actual=RuntimeReadPinnedV1(path,8192,pins);
        if(actual.Length!=bytes.Length || RuntimeHashV1(actual)!=RuntimeHashV1(bytes))throw new InvalidOperationException("MOBILE_ENROLLMENT_CERTIFICATE_READBACK_UNPROVEN");
      }finally{pins.Dispose();}
    }
    internal static MobileInstallEnrollmentAuthorizationV2 ReadMobileAuthorizationV2(
      SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding,MobileInstallReleaseInspectionV1 permit,
      FixedRuntimeIdentityPinsV1 pins) {
      string path=Path.Combine(MobileInstallQualifiedEnrollmentV1.Root,MobileInstallEnrollmentAuthorizationV2.FileName);
      RuntimePinParentsV1(path,pins);RuntimeProtectedAclV1(path,false);
      string raw=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(path,MobileInstallEnrollmentAuthorizationV2.MaximumBytes,pins));
      return MobileInstallEnrollmentAuthorizationV2.ReadHistorical(raw,binding,permit);
    }
    internal static void VerifyMobileEnrollmentSourceV1(string raw,string expectedHead,string expectedTree,FixedRuntimeManifestFileV1[] members) {
      RuntimeGitProofV1 proof=RuntimeVerifySourceProofV1(raw,members);
      if(proof.Head!=expectedHead || proof.Tree!=expectedTree)throw new InvalidOperationException("MOBILE_ENROLLMENT_IMMUTABLE_SOURCE_UNPROVEN");
    }
  }
}

// Canonical enrollment authorization data. It becomes durable authority only
// when the existing protected anchor and certificate bind its exact digest.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;
  using System.Web.Script.Serialization;

  internal sealed class MobileInstallEnrollmentAuthorizationV2 {
    internal const string FileName="enrollment-authorization.v2";
    internal const int MaximumBytes=65536;
    const string Schema="stephanos.mobile-installer-enrollment-authorization.v2";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static readonly string[] Keys={"schemaVersion","sourceHead","sourceTree","packageSha256","releaseProofSha256",
      "setupDescriptor","proposedEnrollment","deviceAssertion","actualEnrollment","acceptedAtUtc"};
    internal readonly string Raw,Digest,SourceHead,SourceTree,PackageSha256,ReleaseProofSha256;
    internal readonly string Descriptor,Proposed,Assertion,ActualEnrollment;
    internal readonly DateTime AcceptedAtUtc,ExpiresAtUtc;
    internal readonly SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 Binding;
    static void Deny(string code){throw new InvalidOperationException("MOBILE_ENROLLMENT_AUTHORIZATION_"+code);}
    static string Hash(string text){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    static DateTime Instant(string text) {
      DateTime value;
      if(!DateTime.TryParseExact(text,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,
          DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out value))Deny("TIME_INVALID");
      return value;
    }
    static string Text(Dictionary<string,object> row,string key) {
      object value;if(!row.TryGetValue(key,out value) || !(value is string))Deny("FIELD_INVALID");return (string)value;
    }
    private MobileInstallEnrollmentAuthorizationV2(string raw) {
      if(raw==null || Utf8.GetByteCount(raw)>MaximumBytes)Deny("BOUND");
      var row=SovereignMobileInstallAssertionV1.ReadEnrollmentAuthorizationObjectV2(raw);
      if(row.Count!=Keys.Length)Deny("KEYS");foreach(string key in Keys)if(!row.ContainsKey(key))Deny("KEYS");
      if(Text(row,"schemaVersion")!=Schema)Deny("SCHEMA");
      Raw=raw;Digest=Hash(raw);SourceHead=Text(row,"sourceHead");SourceTree=Text(row,"sourceTree");
      PackageSha256=Text(row,"packageSha256");ReleaseProofSha256=Text(row,"releaseProofSha256");
      Descriptor=Text(row,"setupDescriptor");Proposed=Text(row,"proposedEnrollment");Assertion=Text(row,"deviceAssertion");
      ActualEnrollment=Text(row,"actualEnrollment");AcceptedAtUtc=Instant(Text(row,"acceptedAtUtc"));
      var descriptor=SovereignMobileInstallAssertionV1.ReadBoundedObjectV1(Descriptor,8192);
      ExpiresAtUtc=Instant(Text(descriptor,"expiresAtUtc"));
      Binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(ActualEnrollment);
      ValidateAt(AcceptedAtUtc);
    }
    void ValidateAt(DateTime at) {
      if(at.Kind!=DateTimeKind.Utc || at<AcceptedAtUtc)Deny("CLOCK");
      MobileInstallQualifiedEnrollmentV1.ValidateSetupDescriptorDataV1(Descriptor,Proposed,SourceHead,SourceTree,
        PackageSha256,ReleaseProofSha256,Binding.MachineHash,Binding.OperatorSid,at);
      var proof=SovereignMobileInstallAssertionV1.VerifyEnrollmentProofV1(Proposed,Assertion,Descriptor,at);
      if(!proof.DevicePossessionVerified || Binding.LastSignCount!=proof.SignCount)Deny("DEVICE_PROOF");
      var proposed=SovereignMobileInstallAssertionV1.ReadBoundedObjectV1(Proposed,8192);
      var actual=SovereignMobileInstallAssertionV1.ReadBoundedObjectV1(ActualEnrollment,8192);
      if(proposed.Count!=actual.Count)Deny("ENROLLMENT_BINDING");
      foreach(var field in proposed) {
        if(field.Key=="receiptPublicKeySpki" || field.Key=="lastSignCount")continue;
        object value;if(!actual.TryGetValue(field.Key,out value) || !Object.Equals(field.Value,value))Deny("ENROLLMENT_BINDING");
      }
    }
    internal void EnsureFresh() {
      using(var identity=WindowsIdentity.GetCurrent())
        if(identity.User==null || identity.User.Value!=Binding.OperatorSid ||
          CoreJobCustodyV1.MobileEnrollmentMachineHashV1()!=Binding.MachineHash)Deny("ACTUAL_TARGET");
      ValidateAt(DateTime.UtcNow);
    }
    internal void VerifySigningTime(DateTime signedAtUtc) {ValidateAt(signedAtUtc);}
    internal void VerifyBinding(SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding,
        MobileInstallReleaseInspectionV1 permit) {
      if(binding==null || permit==null || !permit.PermitDataVerified ||
          binding.CredentialBindingSha256!=Binding.CredentialBindingSha256 || binding.LastSignCount!=Binding.LastSignCount ||
          binding.ReceiptPublicKeySpki!=Binding.ReceiptPublicKeySpki || binding.MachineHash!=Binding.MachineHash ||
          binding.OperatorSid!=Binding.OperatorSid || binding.Generation!=Binding.Generation ||
          permit.SourceHead!=SourceHead || permit.SourceTree!=SourceTree || permit.PackageSha256!=PackageSha256 ||
          permit.ReleaseProofSha256!=ReleaseProofSha256 || permit.EnrollmentGeneration!=Binding.Generation ||
          permit.MachineHash!=Binding.MachineHash || permit.OperatorSid!=Binding.OperatorSid)Deny("SOURCE_BINDING");
    }
    internal static MobileInstallEnrollmentAuthorizationV2 CreateForEnrollment(string descriptor,string proposed,string assertion,
        string actualEnrollment,string head,string tree,string package,string release) {
      var values=new Dictionary<string,string>(StringComparer.Ordinal) {
        {"schemaVersion",Schema},{"sourceHead",head},{"sourceTree",tree},{"packageSha256",package},{"releaseProofSha256",release},
        {"setupDescriptor",descriptor},{"proposedEnrollment",proposed},{"deviceAssertion",assertion},
        {"actualEnrollment",actualEnrollment},{"acceptedAtUtc",DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)}};
      var json=new JavaScriptSerializer {MaxJsonLength=MaximumBytes,RecursionLimit=16};
      var context=new MobileInstallEnrollmentAuthorizationV2(json.Serialize(values));context.EnsureFresh();return context;
    }
    internal static MobileInstallEnrollmentAuthorizationV2 ReadHistorical(string raw,
        SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding,MobileInstallReleaseInspectionV1 permit) {
      var context=new MobileInstallEnrollmentAuthorizationV2(raw);context.VerifyBinding(binding,permit);return context;
    }
  }
}
