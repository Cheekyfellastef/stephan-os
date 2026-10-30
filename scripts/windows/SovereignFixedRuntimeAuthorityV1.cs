// Read-only adapter of the existing retained custody journal and authentication.
// It cannot append, recover, clear custody, mint a grant or select another journal.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.Diagnostics.Eventing.Reader;
  using System.Globalization;
  using System.Security.AccessControl;
  using System.Security.Cryptography;
  using System.Security.Principal;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Web.Script.Serialization;
  using Microsoft.Win32;

  sealed class FixedRuntimeCustodyStateV1 {
    internal string Phase, ReservationId, OwnerId, Operation, TerminalAdmission, MachineHash, BootStartedAtUtc, RecordSha256;
    internal int OwnerPid;
    internal long NativeRecordId;
  }
  public static partial class CoreJobCustodyV1 {
    const string RuntimeWorkspaceV1 = @"C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace";
    const string RuntimeTokenV1 = @"C:\Users\Stephan Callear\Documents\OpenClaw-Standalone\mission-runner\keys\sovereign-commander-token.txt";
    const string RuntimeJournalV1 = "Stephanos Maintenance Custody";
    const string RuntimeJournalSourceV1 = "StephanosMaintenanceCustody";
    const string RuntimeJournalIdV1 = "retained-v2-production";
    static Dictionary<string,object> RuntimeObjectV1(object value) {
      var result=value as Dictionary<string,object>;
      if(result==null) throw new InvalidOperationException("RUNTIME_AUTHENTICATED_OBJECT_UNPROVEN");
      return result;
    }
    static string RuntimeStringV1(Dictionary<string,object> row,string key) {
      object value;
      if(!row.TryGetValue(key,out value) || !(value is string))
        throw new InvalidOperationException("RUNTIME_AUTHENTICATED_FIELD_UNPROVEN");
      return (string)value;
    }
    static long RuntimeIntegerV1(Dictionary<string,object> row,string key) {
      object value;
      if(!row.TryGetValue(key,out value) || (!(value is int) && !(value is long)))
        throw new InvalidOperationException("RUNTIME_AUTHENTICATED_NUMBER_UNPROVEN");
      return Convert.ToInt64(value,CultureInfo.InvariantCulture);
    }
    static bool RuntimeMacEqualV1(string expected,string actual) {
      if(!RuntimeHexV1(expected,64) || !RuntimeHexV1(actual,64)) return false;
      int changed=0; for(int i=0;i<64;i++) changed|=expected[i]^actual[i]; return changed==0;
    }
    static string RuntimeHmacV1(string key,string message) {
      using(var hmac=new HMACSHA256(Encoding.UTF8.GetBytes(key)))
        return BitConverter.ToString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message))).Replace("-","").ToLowerInvariant();
    }
    static FixedRuntimeCustodyStateV1 DecodeRuntimeCustodyV1(
      string raw,long nativeRecordId,string signingKey,string expectedScope) {
      if(raw==null || raw.Length>28000 || nativeRecordId<=0 || !RuntimeHexV1(expectedScope,64) ||
        signingKey==null || signingKey.Length<32 || signingKey.Length>4096)
        throw new InvalidOperationException("RUNTIME_CUSTODY_ENVELOPE_UNPROVEN");
      var parser=new JavaScriptSerializer { MaxJsonLength=65536,RecursionLimit=12 };
      var anchor=RuntimeObjectV1(parser.DeserializeObject(raw));
      if(anchor.Count!=7 || RuntimeStringV1(anchor,"journalId")!=RuntimeJournalIdV1 ||
        RuntimeStringV1(anchor,"scope")!=expectedScope ||
        RuntimeIntegerV1(anchor,"recordId")!=nativeRecordId)
        throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_IDENTITY_UNPROVEN");
      object previousObject;
      if(!anchor.TryGetValue("previousRecordId",out previousObject))
        throw new InvalidOperationException("RUNTIME_NATIVE_PREDECESSOR_UNPROVEN");
      string previous="NONE";
      if(previousObject!=null) {
        long previousId=RuntimeIntegerV1(anchor,"previousRecordId");
        if(previousId<=0 || previousId>=nativeRecordId) throw new InvalidOperationException("RUNTIME_NATIVE_PREDECESSOR_UNPROVEN");
        previous=previousId.ToString(CultureInfo.InvariantCulture);
      }
      string transition=RuntimeStringV1(anchor,"transitionId"),encoded=RuntimeStringV1(anchor,"stateBase64");
      Guid transitionId;
      if(!Guid.TryParseExact(transition,"D",out transitionId) || encoded.Length>20000)
        throw new InvalidOperationException("RUNTIME_NATIVE_TRANSITION_UNPROVEN");
      string signed="stephanos-maintenance-os-anchor-v3\0"+RuntimeJournalIdV1+"\0"+expectedScope+"\0"+
        nativeRecordId.ToString(CultureInfo.InvariantCulture)+"\0"+previous+"\0"+transition+"\0"+encoded;
      if(!RuntimeMacEqualV1(RuntimeHmacV1(signingKey,signed),RuntimeStringV1(anchor,"mac")))
        throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_AUTHENTICATION_FAILED");
      byte[] stateBytes=Convert.FromBase64String(encoded);
      if(Convert.ToBase64String(stateBytes)!=encoded)
        throw new InvalidOperationException("RUNTIME_CUSTODY_ENCODING_UNPROVEN");
      string state=new UTF8Encoding(false,true).GetString(stateBytes);
      var envelope=RuntimeObjectV1(parser.DeserializeObject(state));
      var capture=Regex.Match(state,@"^\{""record"":(?<record>[\s\S]+),""mac"":""(?<mac>[a-f0-9]{64})""\}\n$");
      if(envelope.Count!=2 || !capture.Success ||
        !RuntimeMacEqualV1(RuntimeHmacV1(signingKey,"stephanos-maintenance-custody-v1\0record\0"+
          capture.Groups["record"].Value),capture.Groups["mac"].Value))
        throw new InvalidOperationException("RUNTIME_CUSTODY_RECORD_AUTHENTICATION_FAILED");
      var record=RuntimeObjectV1(envelope["record"]);
      if(RuntimeStringV1(record,"schemaVersion")!="stephanos.sovereign-maintenance-custody.v1")
        throw new InvalidOperationException("RUNTIME_CUSTODY_RECORD_SCHEMA_UNPROVEN");
      string phase=RuntimeStringV1(record,"phase");
      if(phase!="ACTIVE" && phase!="IDLE") throw new InvalidOperationException("RUNTIME_CUSTODY_PHASE_UNPROVEN");
      long owner=RuntimeIntegerV1(record,"ownerPid");
      if(owner<=0 || owner>Int32.MaxValue) throw new InvalidOperationException("RUNTIME_CUSTODY_OWNER_UNPROVEN");
      object witnessValue;
      string witnessKey=phase=="IDLE" && record.ContainsKey("recoveryBootWitness")?"recoveryBootWitness":"bootWitness";
      if(!record.TryGetValue(witnessKey,out witnessValue))
        throw new InvalidOperationException("RUNTIME_CUSTODY_BOOT_UNPROVEN");
      var witness=RuntimeObjectV1(witnessValue);
      string machine=RuntimeStringV1(witness,"machineHash"),boot=RuntimeStringV1(witness,"bootStartedAtUtc");
      if(RuntimeStringV1(witness,"schemaVersion")!="stephanos.windows-boot-witness.v1" ||
        !RuntimeHexV1(machine,64)) throw new InvalidOperationException("RUNTIME_CUSTODY_BOOT_UNPROVEN");
      RuntimeInstantV1(boot);
      string terminalAdmission="";
      if(phase=="IDLE") {
        terminalAdmission=RuntimeStringV1(record,"terminalAdmission");
        if(terminalAdmission!="KNOWN_TERMINAL" && terminalAdmission!="SUCCESSOR_FULL_BOOT")
          throw new InvalidOperationException("RUNTIME_CUSTODY_TERMINAL_UNPROVEN");
        if(RuntimeInstantV1(RuntimeStringV1(record,"terminalAtUtc"))>DateTime.UtcNow)
          throw new InvalidOperationException("RUNTIME_CUSTODY_TERMINAL_UNPROVEN");
      }
      return new FixedRuntimeCustodyStateV1 {
        Phase=phase,TerminalAdmission=terminalAdmission,OwnerPid=(int)owner,ReservationId=RuntimeStringV1(record,"reservationId"),
        OwnerId=RuntimeStringV1(record,"ownerId"),Operation=RuntimeStringV1(record,"operation"),MachineHash=machine,BootStartedAtUtc=boot,
        RecordSha256=RuntimeHashV1(stateBytes),NativeRecordId=nativeRecordId };
    }
    static void RuntimeJournalPolicyV1() {
      foreach(string suffix in new string[]{"", "\\"+RuntimeJournalSourceV1}) {
        using(var key=Registry.LocalMachine.OpenSubKey(
          @"SYSTEM\CurrentControlSet\Services\EventLog\"+RuntimeJournalV1+suffix,false)) {
          if(key==null) throw new InvalidOperationException("RUNTIME_JOURNAL_MAPPING_UNPROVEN");
          var acl=key.GetAccessControl();
          string owner=((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value;
          if(owner!="S-1-5-18" && owner!="S-1-5-32-544")
            throw new InvalidOperationException("RUNTIME_JOURNAL_OWNER_UNPROVEN");
          foreach(RegistryAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
            if(rule.AccessControlType!=AccessControlType.Allow || (((int)rule.RegistryRights)&0xD0026)==0) continue;
            string sid=((SecurityIdentifier)rule.IdentityReference).Value;
            if(sid!="S-1-5-18" && sid!="S-1-5-32-544" &&
              sid!="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464")
              throw new InvalidOperationException("RUNTIME_JOURNAL_MUTATION_AUTHORITY_UNPROVEN");
          }
        }
      }
      using(var config=new EventLogConfiguration(RuntimeJournalV1)) {
        if(!config.IsEnabled || config.LogMode!=EventLogMode.Retain || !config.IsClassicLog ||
          (config.MaximumSizeInBytes!=67108864 && config.MaximumSizeInBytes!=67112960))
          throw new InvalidOperationException("RUNTIME_JOURNAL_RETENTION_UNPROVEN");
        using(var identity=WindowsIdentity.GetCurrent()) {
          var expected=new RawSecurityDescriptor("O:BAG:SYD:P(A;;0xf0007;;;SY)(A;;0xf0007;;;BA)(A;;0x3;;;"+identity.User.Value+")");
          var actual=new RawSecurityDescriptor(config.SecurityDescriptor);
          if(actual.GetSddlForm(AccessControlSections.All)!=expected.GetSddlForm(AccessControlSections.All))
            throw new InvalidOperationException("RUNTIME_JOURNAL_ACCESS_UNPROVEN");
        }
      }
      var bootstrap=new EventLogQuery(RuntimeJournalV1,PathType.LogName,
        "*[System[(EventID=62516) and Provider[@Name='"+RuntimeJournalSourceV1+"']]]");
      using(var reader=new EventLogReader(bootstrap))
      using(var row=reader.ReadEvent(TimeSpan.FromSeconds(5))) {
        if(row==null || row.RecordId!=1 || row.Properties.Count<1 ||
          row.Properties[0].Value as string!="SOVEREIGN_MAINTENANCE_BOOTSTRAP_V2=NON_AUTHORITY")
          throw new InvalidOperationException("RUNTIME_JOURNAL_BOOTSTRAP_UNPROVEN");
      }
    }
    static bool RuntimeCurrentBootFenceExistsV1(FixedRuntimeIdentityPinsV1 pins) {
      string name="sovereign-maintenance-"+RuntimeHashV1(Encoding.UTF8.GetBytes(pins.MachineHash+pins.BootStartedAtUtc))+".lock";
      string path=Path.Combine(@"C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace\status",name);
      // Any current-boot lock means held, even if an IDLE append preceded a
      // failed unlock. A lock is never deleted or recovered by this adapter.
      RuntimePinParentsV1(path,pins);
      try { File.GetAttributes(path); return true; }
      catch(FileNotFoundException) { return false; }
    }
    static FixedRuntimeCustodyStateV1 ReadRuntimeCustodyV1(FixedRuntimeIdentityPinsV1 pins) {
      RuntimeJournalPolicyV1();
      RuntimePinParentsV1(RuntimeTokenV1,pins);
      string key=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(RuntimeTokenV1,8192,pins)).Trim();
      string scope=RuntimeHashV1(Encoding.UTF8.GetBytes(RuntimeWorkspaceV1.ToLowerInvariant()));
      var query=new EventLogQuery(RuntimeJournalV1,PathType.LogName,
        "*[System[(EventID=62517) and Provider[@Name='"+RuntimeJournalSourceV1+"']]]");
      query.ReverseDirection=true;
      var clock=Stopwatch.StartNew();
      using(var reader=new EventLogReader(query)) {
        for(int i=0;i<256 && clock.ElapsedMilliseconds<5000;i++) {
          using(var row=reader.ReadEvent(TimeSpan.FromMilliseconds(Math.Max(1,5000-clock.ElapsedMilliseconds)))) {
            if(row==null || row.RecordId==null || row.Properties.Count<1)
              throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_MISSING");
            string text=row.Properties[0].Value as string;
            const string marker="SOVEREIGN_MAINTENANCE_ANCHOR_V2=";
            if(text==null || !text.StartsWith(marker,StringComparison.Ordinal) || text.Length>28100)
              throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_MALFORMED");
            string raw=text.Substring(marker.Length);
            var match=Regex.Match(raw,@"^\{""scope"":""([a-f0-9]{64})"",");
            if(!match.Success) throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_MALFORMED");
            if(match.Groups[1].Value==scope) return DecodeRuntimeCustodyV1(raw,(long)row.RecordId,key,scope);
          }
        }
      }
      throw new InvalidOperationException("RUNTIME_NATIVE_ANCHOR_SCAN_EXHAUSTED");
    }
  }
}
