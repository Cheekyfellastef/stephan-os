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
    const string Provider="Microsoft Software Key Storage Provider";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    static string Url64(byte[] bytes){return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    static void RequireSetupPrincipal() {
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
        string body=MobileInstallQualifiedEnrollmentV1.CertificateBodyForEnrollmentV1(held.Binding,permit,Hash(held.HelperBytes),DateTime.UtcNow);
        byte[] signature;
        using(var signer=new ECDsaCng(key))using(var sha=SHA256.Create())
          signature=signer.SignHash(sha.ComputeHash(Utf8.GetBytes("stephanos.mobile-install-enrollment-certificate.v1\0"+body)));
        string wire=body+"signature="+Url64(signature)+"\n";
        MobileInstallQualifiedEnrollmentV1.VerifyCertificateV1(wire,held.Binding.ReceiptPublicKeySpki,Hash(held.HelperBytes),held.Binding,permit);
        byte[] bytes=Utf8.GetBytes(wire);
        CoreJobCustodyV1.WriteNewMobileEnrollmentCertificateV1(bytes);
        return Hash(bytes);
      }
    }
  }
  public static partial class CoreJobCustodyV1 {
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
        return new MobileInstallEnrollmentFilesV1 {EnrollmentJson=raw,Binding=binding,Pins=pins,
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
    internal static void VerifyMobileEnrollmentSourceV1(string raw,string expectedHead,string expectedTree,FixedRuntimeManifestFileV1[] members) {
      RuntimeGitProofV1 proof=RuntimeVerifySourceProofV1(raw,members);
      if(proof.Head!=expectedHead || proof.Tree!=expectedTree)throw new InvalidOperationException("MOBILE_ENROLLMENT_IMMUTABLE_SOURCE_UNPROVEN");
    }
  }
}
