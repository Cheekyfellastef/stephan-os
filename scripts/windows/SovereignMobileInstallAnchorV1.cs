// Source-only binding of the mobile WAL to the EXISTING retained custody log.
// No enrollment, log/source/key creation, channel reconfiguration, executor,
// source/release grant or installation. OpenProtected requires prior qualified
// administrator enrollment, including a signed genesis for the exact WAL header.
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
  using System.Text.RegularExpressions;
  using Microsoft.Win32.SafeHandles;

  internal sealed class MobileInstallAnchorEventV1 {
    internal readonly long RecordId;
    internal readonly string Text;
    internal MobileInstallAnchorEventV1(long recordId,string text) {RecordId=recordId;Text=text;}
  }

  internal sealed class SovereignMobileInstallAnchorV1 : IDisposable {
    const string LogName="Stephanos Maintenance Custody",SourceName="StephanosMaintenanceCustody";
    const string KeyName=MobileInstallQualifiedEnrollmentV1.ReceiptKeyName;
    const string Prefix="STEPHANOS_MOBILE_INSTALL_ANCHOR_V1";
    const string Domain="stephanos.mobile-install-native-anchor.v1\0";
    const int EventId=62519,MaximumEvents=4096,ScanMilliseconds=5000;
    const long SafeInteger=9007199254740991L;
    static readonly string Zero=new string('0',64);
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    readonly string machine,sid,credential;
    readonly long generation;
    internal readonly uint MinimumSignCount;
    readonly CngKey key;
    readonly IDisposable pins;
    readonly Func<List<MobileInstallAnchorEventV1>> read;
    readonly Action<string> append;
    readonly object sync=new object();
    bool disposed,poisoned;
    sealed class Head {
      internal long Sequence,RecordId;
      internal string WalHash,EntryHash;
    }
    static void Deny(string reason) {throw new InvalidOperationException(reason);}
    static bool Is(string value,string pattern) {return value!=null && Regex.IsMatch(value,pattern,RegexOptions.CultureInvariant);}
    static bool Digest(string value) {return Is(value,"\\A[a-f0-9]{64}\\z");}
    static string Hash(string text) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    static string Url64(byte[] bytes) {return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+','-').Replace('/','_');}
    static byte[] Signature(string text) {
      if(!Is(text,"\\A[A-Za-z0-9_-]{86}\\z")) Deny("MOBILE_ANCHOR_SIGNATURE_ENCODING_UNPROVEN");
      byte[] bytes=Convert.FromBase64String(text.Replace('-','+').Replace('_','/')+"==");
      if(bytes.Length!=64 || Url64(bytes)!=text) Deny("MOBILE_ANCHOR_SIGNATURE_ENCODING_UNPROVEN");return bytes;
    }
    static long Number(string text,long maximum) {
      long value;
      if(!Is(text,"\\A(?:0|[1-9][0-9]{0,15})\\z") || !Int64.TryParse(text,NumberStyles.None,CultureInfo.InvariantCulture,out value) || value>maximum)
        throw new InvalidOperationException("MOBILE_ANCHOR_NUMBER_UNPROVEN");return value;
    }
    static string PublicSpki(CngKey value) {
      byte[] blob=value.Export(CngKeyBlobFormat.EccPublicBlob);
      if(blob.Length!=72 || blob[0]!=0x45 || blob[1]!=0x43 || blob[2]!=0x53 || blob[3]!=0x31 || blob[4]!=32 || blob[5]!=0 || blob[6]!=0 || blob[7]!=0)
        throw new InvalidOperationException("MOBILE_ANCHOR_RECEIPT_KEY_UNPROVEN");
      byte[] prefix={0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00,0x04};
      var spki=new byte[91];Buffer.BlockCopy(prefix,0,spki,0,prefix.Length);Buffer.BlockCopy(blob,8,spki,27,64);return Url64(spki);
    }
    [DllImport("ncrypt.dll",CharSet=CharSet.Unicode)] static extern int NCryptGetProperty(SafeNCryptKeyHandle handle,string property,byte[] output,int size,out int result,int flags);
    static void AssertKeySecurity(byte[] bytes) {
      if(bytes==null || bytes.Length<20 || bytes.Length>16384) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
      var acl=new RawSecurityDescriptor(bytes,0);
      if(acl.Owner==null || (acl.Owner.Value!="S-1-5-18" && acl.Owner.Value!="S-1-5-32-544") || acl.DiscretionaryAcl==null ||
         (acl.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
      bool system=false,administrators=false;
      foreach(GenericAce item in acl.DiscretionaryAcl) {
        var ace=item as CommonAce;
        if(ace==null || ace.IsCallback || (ace.AceFlags&AceFlags.InheritOnly)!=0) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
        if(ace.AceQualifier==AceQualifier.AccessAllowed) {
          if(ace.SecurityIdentifier.Value!="S-1-5-18" && ace.SecurityIdentifier.Value!="S-1-5-32-544") Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
          if(ace.AccessMask!=0) {system|=ace.SecurityIdentifier.Value=="S-1-5-18";administrators|=ace.SecurityIdentifier.Value=="S-1-5-32-544";}
        } else if(ace.AceQualifier!=AceQualifier.AccessDenied) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
      }
      if(!system || !administrators) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
    }
    static void AssertProtectedKey(CngKey value) {
      if(value==null || !value.IsMachineKey || value.Provider!=CngProvider.MicrosoftSoftwareKeyStorageProvider ||
         value.Algorithm!=CngAlgorithm.ECDsaP256 || value.KeyUsage!=CngKeyUsages.Signing || value.ExportPolicy!=CngExportPolicies.None)
        Deny("MOBILE_ANCHOR_RECEIPT_KEY_UNPROVEN");
      using(var handle=value.Handle) {
        int size;int status=NCryptGetProperty(handle,"Security Descr",null,0,out size,7);
        if(status!=0 || size<20 || size>16384) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
        byte[] bytes=new byte[size];int returned;
        if(NCryptGetProperty(handle,"Security Descr",bytes,bytes.Length,out returned,7)!=0 || returned!=size) Deny("MOBILE_ANCHOR_KEY_ACL_UNPROVEN");
        AssertKeySecurity(bytes);
      }
    }
    // Trusted initial-setup code only. No runtime command exposes this key
    // capability; provisioning/overwrite/export and caller key names are absent.
    internal static CngKey OpenReceiptKeyForEnrollmentV1() {
      CngKey value=null;
      try {
        using(var identity=WindowsIdentity.GetCurrent())
          if(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))Deny("MOBILE_ANCHOR_ADMINISTRATOR_REQUIRED");
        value=CngKey.Open(KeyName,CngProvider.MicrosoftSoftwareKeyStorageProvider,CngKeyOpenOptions.MachineKey);
        AssertProtectedKey(value);return value;
      } catch {if(value!=null)value.Dispose();throw new InvalidOperationException("MOBILE_ANCHOR_RECEIPT_KEY_UNPROVEN");}
    }
    static string ValidateGenesisHeader(string wire,string enrolledCredential,long enrolledGeneration,uint baseline) {
      if(wire==null || wire.Length>512 || !wire.EndsWith("\n",StringComparison.Ordinal) || wire.IndexOf('\n')!=wire.Length-1 || wire.IndexOf('\r')>=0)
        throw new InvalidOperationException("MOBILE_ANCHOR_GENESIS_HEADER_UNPROVEN");
      string[] fields=wire.Substring(0,wire.Length-1).Split('|');
      if(fields.Length!=5 || fields[0]!="STEPHANOS-MOBILE-JOURNAL-V1" || fields[1]!=enrolledCredential ||
         Number(fields[2],SafeInteger)!=enrolledGeneration || Number(fields[3],UInt32.MaxValue)!=baseline || !Digest(fields[4]) ||
         Hash("stephanos.mobile-journal-header.v1\0"+String.Join("|",fields,0,4))!=fields[4])
        throw new InvalidOperationException("MOBILE_ANCHOR_GENESIS_HEADER_UNPROVEN");return fields[4];
    }
    // Initial setup only; the runtime entry has no ENROLL operation. This cannot
    // provision, reset, migrate or repair anything. The existing exact protected
    // WAL must contain only the enrolled header, and the mobile event subset
    // must be genuinely empty. A partial/uncertain append is never retried here.
    internal static string AppendEnrollmentGenesisV1(string expectedHeaderWire) {
      CoreJobCustodyV1.MobileInstallJournalStorageV1 storage=null;MobileInstallAnchorProtectedContextV1 context=null;
      CngKey receiptKey=null;SovereignMobileInstallAnchorV1 anchor=null;
      try {
        using(var process=Process.GetCurrentProcess())
          if(!Environment.UserInteractive || process.SessionId<=0)Deny("MOBILE_ANCHOR_INTERACTIVE_ENROLLMENT_REQUIRED");
        storage=CoreJobCustodyV1.PinMobileInstallJournalStorageV1();
        if(storage.File.Length<1 || storage.File.Length>512)Deny("MOBILE_ANCHOR_GENESIS_WAL_UNPROVEN");
        var bytes=new byte[(int)storage.File.Length];storage.File.Position=0;int at=0;
        while(at<bytes.Length){int count=storage.File.Read(bytes,at,bytes.Length-at);if(count<=0)Deny("MOBILE_ANCHOR_GENESIS_WAL_UNPROVEN");at+=count;}
        if(storage.File.ReadByte()!=-1 || storage.File.Length!=bytes.Length)Deny("MOBILE_ANCHOR_GENESIS_WAL_UNPROVEN");
        string actual=Utf8.GetString(bytes);
        if(!String.Equals(actual,expectedHeaderWire,StringComparison.Ordinal))Deny("MOBILE_ANCHOR_GENESIS_WAL_CHANGED");
        context=CoreJobCustodyV1.OpenMobileAnchorContextV1();
        string head=ValidateGenesisHeader(actual,context.CredentialBindingSha256,context.Generation,context.MinimumSignCount);
        receiptKey=OpenReceiptKeyForEnrollmentV1();
        anchor=new SovereignMobileInstallAnchorV1(context.MachineHash,context.OperatorSid,context.Generation,context.MinimumSignCount,
          context.CredentialBindingSha256,context.ReceiptPublicKeySpki,receiptKey,context,ReadNativeEvents,AppendNativeEvent);
        if(ReadNativeEvents().Count!=0)Deny("MOBILE_ANCHOR_ENROLLMENT_ALREADY_ANCHORED_OR_CONFLICTED");
        string entry=anchor.SignEntry(0,head,Zero);AppendNativeEvent(entry);Head observed=anchor.ReadSnapshot();
        if(observed.Sequence!=0 || observed.WalHash!=head || observed.EntryHash!=Hash(entry))Deny("MOBILE_ANCHOR_GENESIS_READBACK_UNPROVEN");
        return anchor.HeadText(observed);
      } catch(Exception error) {
        if(error is InvalidOperationException && error.Message.StartsWith("MOBILE_ANCHOR_",StringComparison.Ordinal))throw;
        throw new InvalidOperationException("MOBILE_ANCHOR_ENROLLMENT_GENESIS_UNPROVEN");
      } finally {
        if(anchor!=null)anchor.Dispose();else {if(receiptKey!=null)receiptKey.Dispose();if(context!=null)context.Dispose();}
        if(storage!=null)storage.Dispose();
      }
    }
    // Private callback seam is used only by compiled synthetic fixtures. No
    // shipping factory accepts a caller-selected key, path, channel or callback.
    private SovereignMobileInstallAnchorV1(string machineHash,string operatorSid,long enrolledGeneration,uint minimumSignCount,string credentialBinding,
      string receiptPublicKey,CngKey receiptKey,IDisposable retainedPins,
      Func<List<MobileInstallAnchorEventV1>> authenticatedRead,Action<string> authenticatedAppend) {
      if(!Digest(machineHash) || !Is(operatorSid,"\\AS-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}\\z") ||
         enrolledGeneration<1 || enrolledGeneration>SafeInteger || !Digest(credentialBinding) || receiptKey==null || retainedPins==null ||
         authenticatedRead==null || authenticatedAppend==null || receiptKey.Algorithm!=CngAlgorithm.ECDsaP256 || PublicSpki(receiptKey)!=receiptPublicKey)
        Deny("MOBILE_ANCHOR_BINDING_UNPROVEN");
      machine=machineHash;sid=operatorSid;generation=enrolledGeneration;credential=credentialBinding;
      MinimumSignCount=minimumSignCount;
      key=receiptKey;pins=retainedPins;read=authenticatedRead;append=authenticatedAppend;
    }
    internal static SovereignMobileInstallAnchorV1 OpenProtected() {
      MobileInstallAnchorProtectedContextV1 context=null;CngKey receipt=null;SovereignMobileInstallAnchorV1 result=null;
      try {
        context=CoreJobCustodyV1.OpenMobileAnchorContextV1();
        receipt=CngKey.Open(KeyName,CngProvider.MicrosoftSoftwareKeyStorageProvider,CngKeyOpenOptions.MachineKey);
        AssertProtectedKey(receipt);
        result=new SovereignMobileInstallAnchorV1(context.MachineHash,context.OperatorSid,context.Generation,context.MinimumSignCount,context.CredentialBindingSha256,
          context.ReceiptPublicKeySpki,receipt,context,ReadNativeEvents,AppendNativeEvent);
        // Prior qualified enrollment must already have anchored the exact header.
        // Absence is never treated as a fresh journal or an invitation to create.
        result.ReadHead();return result;
      } catch(Exception error) {
        if(result!=null) result.Dispose();else {if(receipt!=null) receipt.Dispose();if(context!=null) context.Dispose();}
        if(error is InvalidOperationException && error.Message.StartsWith("MOBILE_ANCHOR_",StringComparison.Ordinal))
          throw new InvalidOperationException(error.Message);
        throw new InvalidOperationException("MOBILE_ANCHOR_QUALIFIED_ENROLLMENT_REQUIRED");
      }
    }
    static List<MobileInstallAnchorEventV1> ReadNativeEvents() {
      CoreJobCustodyV1.CheckMobileAnchorLogPolicyV1();
      var result=new List<MobileInstallAnchorEventV1>();var clock=Stopwatch.StartNew();
      // Scan the complete MOBILE subset forward. Stopping at the newest signed
      // genesis would permit an ordinary log writer to replay genesis over a
      // newer true chain. The existing retained record-one bootstrap is checked.
      var query=new EventLogQuery(LogName,PathType.LogName,"*[System[(EventID=62519) and Provider[@Name='StephanosMaintenanceCustody']]]");
      query.ReverseDirection=false;
      using(var reader=new EventLogReader(query)) {
        for(int index=0;index<=MaximumEvents;index++) {
          long left=ScanMilliseconds-clock.ElapsedMilliseconds;
          if(left<=0) Deny("MOBILE_ANCHOR_SCAN_BUDGET_EXHAUSTED");
          using(var row=reader.ReadEvent(TimeSpan.FromMilliseconds(left))) {
            if(row==null) return result;
            if(index==MaximumEvents) Deny("MOBILE_ANCHOR_SCAN_CAPACITY_EXHAUSTED");
            if(row.RecordId==null || row.RecordId<=1 || row.Id!=EventId || row.ProviderName!=SourceName || row.LogName!=LogName || row.Properties.Count!=1)
              Deny("MOBILE_ANCHOR_NATIVE_EVENT_UNPROVEN");
            string text=row.Properties[0].Value as string;
            if(text==null || text.Length>1024) Deny("MOBILE_ANCHOR_NATIVE_EVENT_UNPROVEN");
            result.Add(new MobileInstallAnchorEventV1(row.RecordId.Value,text));
          }
        }
      }
      throw new InvalidOperationException("MOBILE_ANCHOR_SCAN_INCOMPLETE");
    }
    [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr RegisterEventSourceW(string server,string source);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool DeregisterEventSource(IntPtr handle);
    [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool ReportEventW(IntPtr handle,ushort type,ushort category,uint eventId,IntPtr userSid,ushort count,uint dataSize,[MarshalAs(UnmanagedType.LPArray,ArraySubType=UnmanagedType.LPWStr)] string[] strings,IntPtr data);
    static void AppendNativeEvent(string text) {
      CoreJobCustodyV1.CheckMobileAnchorLogPolicyV1();
      if(text==null || text.Length>1024) Deny("MOBILE_ANCHOR_NATIVE_EVENT_UNPROVEN");
      // ReportEvent never creates/reconfigures a source, unlike the convenience
      // EventLog.WriteEntry path. Missing/moved mapping fails exact log read-back.
      IntPtr handle=RegisterEventSourceW(null,SourceName);
      if(handle==IntPtr.Zero) Deny("MOBILE_ANCHOR_APPEND_UNPROVEN");
      try {if(!ReportEventW(handle,4,0,EventId,IntPtr.Zero,1,0,new[]{text},IntPtr.Zero)) Deny("MOBILE_ANCHOR_APPEND_UNPROVEN");}
      finally {if(!DeregisterEventSource(handle)) Deny("MOBILE_ANCHOR_APPEND_CUSTODY_UNPROVEN");}
    }
    string Body(long sequence,string walHash,string previous) {
      return Prefix+"|"+machine+"|"+sid+"|"+credential+"|"+generation.ToString(CultureInfo.InvariantCulture)+"|"+
        sequence.ToString(CultureInfo.InvariantCulture)+"|"+walHash+"|"+previous;
    }
    string SignEntry(long sequence,string walHash,string previous) {
      string body=Body(sequence,walHash,previous);byte[] digest;
      using(var sha=SHA256.Create()) digest=sha.ComputeHash(Utf8.GetBytes(Domain+body));
      using(var signer=new ECDsaCng(key))return body+"|"+Url64(signer.SignHash(digest));
    }
    Head ReadSnapshot() {
      if(disposed || poisoned) Deny("MOBILE_ANCHOR_HELD");
      List<MobileInstallAnchorEventV1> rows=read();
      if(rows==null || rows.Count==0) Deny("MOBILE_ANCHOR_ENROLLED_GENESIS_REQUIRED");
      if(rows.Count>MaximumEvents) Deny("MOBILE_ANCHOR_SCAN_CAPACITY_EXHAUSTED");
      Head previous=null;var clock=Stopwatch.StartNew();
      foreach(var row in rows) {
        if(clock.ElapsedMilliseconds>=ScanMilliseconds) Deny("MOBILE_ANCHOR_SCAN_BUDGET_EXHAUSTED");
        if(row==null || row.RecordId<=1 || (previous!=null && row.RecordId<=previous.RecordId) || row.Text==null || row.Text.Length>1024)
          Deny("MOBILE_ANCHOR_NATIVE_EVENT_UNPROVEN");
        string[] fields=row.Text.Split('|');
        if(fields.Length!=9 || fields[0]!=Prefix || fields[1]!=machine || fields[2]!=sid || fields[3]!=credential ||
           Number(fields[4],SafeInteger)!=generation || !Digest(fields[6]) || !Digest(fields[7])) Deny("MOBILE_ANCHOR_BINDING_UNPROVEN");
        long sequence=Number(fields[5],2048);
        if((previous==null && (sequence!=0 || fields[7]!=Zero)) ||
           (previous!=null && (sequence!=previous.Sequence+1 || fields[7]!=previous.EntryHash))) Deny("MOBILE_ANCHOR_CHAIN_UNPROVEN");
        string body=String.Join("|",fields,0,8);byte[] digest;
        using(var sha=SHA256.Create())digest=sha.ComputeHash(Utf8.GetBytes(Domain+body));
        using(var verifier=new ECDsaCng(key))if(!verifier.VerifyHash(digest,Signature(fields[8]))) Deny("MOBILE_ANCHOR_SIGNATURE_UNPROVEN");
        previous=new Head {Sequence=sequence,RecordId=row.RecordId,WalHash=fields[6],EntryHash=Hash(row.Text)};
      }
      return previous;
    }
    string HeadText(Head value) {
      return "STEPHANOS-MOBILE-JOURNAL-HEAD-V1|"+credential+"|"+generation.ToString(CultureInfo.InvariantCulture)+"|"+
        value.Sequence.ToString(CultureInfo.InvariantCulture)+"|"+value.WalHash;
    }
    internal string ReadHead() {lock(sync) {return HeadText(ReadSnapshot());}}
    internal string SignReceipt(MobileInstallReceiptV1 receipt) {
      lock(sync) {
        Head observed=ReadSnapshot();
        if(receipt==null || !receipt.MatchesProtectedAnchor(machine,sid,generation,credential,observed.Sequence,observed.WalHash,DateTime.UtcNow))
          Deny("MOBILE_ANCHOR_RECEIPT_BINDING_UNPROVEN");
        // The closed receipt schema/canonical JSON is its protocol domain. The
        // existing shared verifier signs these exact bytes. Anchors use their
        // distinct non-JSON prefix/domain; signatures cannot cross protocols.
        byte[] digest;using(var sha=SHA256.Create())digest=sha.ComputeHash(Utf8.GetBytes(receipt.CanonicalPayload));
        using(var signer=new ECDsaCng(key))return receipt.EnvelopeFromNativeSignature(signer.SignHash(digest));
      }
    }
    // The protected enrollment counter is a floor, separate from the stable
    // credential identity. A valid old WAL/header/anchor must not lower it.
    internal void AssertMinimumSignCount(uint observedWatermark) {
      lock(sync) {
        if(disposed || poisoned) Deny("MOBILE_ANCHOR_HELD");
        if(observedWatermark<MinimumSignCount) Deny("MOBILE_ANCHOR_SIGN_COUNTER_FLOOR_UNPROVEN");
      }
    }
    internal void CommitHead(string expectedNextHead) {
      lock(sync) {
        Head before=ReadSnapshot();string[] fields=expectedNextHead==null?new string[0]:expectedNextHead.Split('|');
        if(fields.Length!=5 || fields[0]!="STEPHANOS-MOBILE-JOURNAL-HEAD-V1" || fields[1]!=credential ||
           Number(fields[2],SafeInteger)!=generation || Number(fields[3],2048)!=before.Sequence+1 || !Digest(fields[4]))
          Deny("MOBILE_ANCHOR_NEXT_HEAD_UNPROVEN");
        string entry=SignEntry(before.Sequence+1,fields[4],before.EntryHash);
        try {
          append(entry);Head observed=ReadSnapshot();
          if(observed.Sequence!=before.Sequence+1 || observed.WalHash!=fields[4] || observed.EntryHash!=Hash(entry) || observed.RecordId<=before.RecordId)
            Deny("MOBILE_ANCHOR_APPEND_READBACK_UNPROVEN");
        } catch {poisoned=true;throw new InvalidOperationException("MOBILE_ANCHOR_COMMIT_UNCERTAIN_NO_REPLAY");}
      }
    }
    public void Dispose() {lock(sync) {if(disposed)return;disposed=true;try{key.Dispose();}finally{pins.Dispose();}}}
  }

  internal sealed class MobileInstallAnchorProtectedContextV1 : IDisposable {
    internal string MachineHash,OperatorSid,CredentialBindingSha256,ReceiptPublicKeySpki;
    internal long Generation;
    internal uint MinimumSignCount;
    internal IDisposable Pins;
    public void Dispose() {if(Pins!=null) {Pins.Dispose();Pins=null;}}
  }
  public static partial class CoreJobCustodyV1 {
    internal static void CheckMobileAnchorLogPolicyV1() {
      RuntimeJournalPolicyV1();
      if(EventLog.LogNameFromSourceName("StephanosMaintenanceCustody",".")!="Stephanos Maintenance Custody")
        throw new InvalidOperationException("MOBILE_ANCHOR_LOG_MAPPING_UNPROVEN");
    }
    internal static MobileInstallAnchorProtectedContextV1 OpenMobileAnchorContextV1() {
      const string root=@"C:\Program Files\Stephanos\SovereignMobileInstallerV1";
      string path=Path.Combine(root,"enrollment.json");var pins=new FixedRuntimeIdentityPinsV1();
      try {
        using(var identity=WindowsIdentity.GetCurrent()) {
          if(identity.User==null || !new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("MOBILE_ANCHOR_ADMINISTRATOR_REQUIRED");
          RuntimePinParentsV1(path,pins);RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
          RuntimeProtectedAclV1(@"C:\Program Files\Stephanos",true);RuntimeProtectedAclV1(root,true);RuntimeProtectedAclV1(path,false);
          string raw=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(path,8192,pins));
          var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(raw);
          string machine=RuntimeMachineHashV1();
          if(binding.MachineHash!=machine || binding.OperatorSid!=identity.User.Value)
            throw new InvalidOperationException("MOBILE_ANCHOR_OPERATOR_MACHINE_UNPROVEN");
          CheckMobileAnchorLogPolicyV1();
          return new MobileInstallAnchorProtectedContextV1 {MachineHash=machine,OperatorSid=identity.User.Value,
            Generation=binding.Generation,CredentialBindingSha256=binding.CredentialBindingSha256,
            ReceiptPublicKeySpki=binding.ReceiptPublicKeySpki,MinimumSignCount=binding.LastSignCount,Pins=pins};
        }
      } catch {pins.Dispose();throw;}
    }
  }
}
