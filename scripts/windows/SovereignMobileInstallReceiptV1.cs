// Native receipt projection for the existing #1814 request/journal chain.
// This type has no public constructor, generic signer, enrollment, execution,
// installation or reboot operation. READY is deliberately not producible here.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.Text;
  using System.Text.RegularExpressions;

  internal sealed class MobileInstallReceiptV1 {
    const string Schema="stephanos.battle-bridge-mobile-installation-receipt.v1";
    const long SafeInteger=9007199254740991L;
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    readonly SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate;
    internal readonly string State,ReasonCode,JournalHeadSha256,CredentialBindingSha256,CanonicalPayload;
    internal readonly long Sequence;
    internal readonly DateTime ObservedAtUtc;
    readonly uint? rootPid;
    readonly string started,helper,installationBoot;
    readonly string integritySnapshot;
    static void Deny(string reason) {throw new InvalidOperationException(reason);}
    static bool Is(string value,string pattern) {return value!=null && Regex.IsMatch(value,pattern,RegexOptions.CultureInvariant);}
    static bool Digest(string value) {return Is(value,"\\A[a-f0-9]{64}\\z");}
    static string Instant(DateTime value) {return value.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);}
    static DateTime ExactInstant(string value) {
      DateTime parsed;
      if(value==null || value.Length!=24 || !DateTime.TryParseExact(value,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,
          DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out parsed) || Instant(parsed)!=value)
        throw new InvalidOperationException("MOBILE_RECEIPT_TIME_UNPROVEN");return parsed;
    }
    // Native producers sometimes retain full FILETIME precision. Reduce only
    // after an exact UTC parse; no caller-local timezone or loose date is used.
    static DateTime NativeTime(string value) {
      DateTime parsed;
      if(value==null || !value.EndsWith("Z",StringComparison.Ordinal) || !DateTime.TryParseExact(value,
          new[]{"yyyy-MM-dd'T'HH:mm:ss.fff'Z'","O"},CultureInfo.InvariantCulture,
          DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out parsed))
        throw new InvalidOperationException("MOBILE_RECEIPT_NATIVE_TIME_UNPROVEN");return parsed;
    }
    private MobileInstallReceiptV1(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 boundCandidate,string credentialBinding,
      string state,string reason,long journalSequence,string journalHead,DateTime observedAtUtc,
      uint? retainedProcessId,string executionStartedAtUtc,string installedHelperSha256,string installationBootId) {
      if(boundCandidate==null || !boundCandidate.IsIntact() || !Digest(credentialBinding) || journalSequence<1 || journalSequence>SafeInteger || !Digest(journalHead) ||
         observedAtUtc.Kind!=DateTimeKind.Utc || observedAtUtc<boundCandidate.RequestedAtUtc ||
         !Is(reason,"\\A[A-Z][A-Z0-9_]{0,79}\\z")) Deny("MOBILE_RECEIPT_BINDING_UNPROVEN");
      if(state!="AWAITING_APPROVAL" && state!="APPROVAL_RECORDED" && state!="STARTING" && state!="INSTALLING" &&
         state!="INSTALLED_PENDING_BOOT" && state!="FAILED" && state!="CANCELLED" && state!="BLOCKED" && state!="UNKNOWN")
        Deny("MOBILE_RECEIPT_STATE_UNPROVEN");
      if(retainedProcessId.HasValue && retainedProcessId.Value==0) Deny("MOBILE_RECEIPT_PROCESS_UNPROVEN");
      if(executionStartedAtUtc!=null && (!retainedProcessId.HasValue || ExactInstant(executionStartedAtUtc)<boundCandidate.RequestedAtUtc ||
          ExactInstant(executionStartedAtUtc)>observedAtUtc)) Deny("MOBILE_RECEIPT_EXECUTION_UNPROVEN");
      if((state=="INSTALLING" || state=="INSTALLED_PENDING_BOOT") && (!retainedProcessId.HasValue || executionStartedAtUtc==null))
        Deny("MOBILE_RECEIPT_EXECUTION_UNPROVEN");
      if(state=="INSTALLED_PENDING_BOOT") {
        if(!Digest(installedHelperSha256) || !Digest(installationBootId)) Deny("MOBILE_RECEIPT_INSTALLATION_UNPROVEN");
      } else if(installedHelperSha256!=null || installationBootId!=null) Deny("MOBILE_RECEIPT_INSTALLATION_STATE_UNPROVEN");
      if((state=="AWAITING_APPROVAL" || state=="APPROVAL_RECORDED" || state=="CANCELLED" || state=="BLOCKED") &&
         (retainedProcessId.HasValue || executionStartedAtUtc!=null)) Deny("MOBILE_RECEIPT_PREEXECUTION_STATE_UNPROVEN");
      if(state=="STARTING" && executionStartedAtUtc!=null) Deny("MOBILE_RECEIPT_STARTING_IS_NOT_EXECUTION");
      if(state=="AWAITING_APPROVAL" && (observedAtUtc<boundCandidate.RequestedAtUtc || observedAtUtc>=boundCandidate.ExpiresAtUtc))
        Deny("MOBILE_RECEIPT_APPROVAL_EXPIRED");
      candidate=boundCandidate;State=state;ReasonCode=reason;Sequence=journalSequence;JournalHeadSha256=journalHead;CredentialBindingSha256=credentialBinding;
      ObservedAtUtc=observedAtUtc;rootPid=retainedProcessId;started=executionStartedAtUtc;helper=installedHelperSha256;installationBoot=installationBootId;
      CanonicalPayload=Canonical();integritySnapshot=Snapshot();
      if(Utf8.GetByteCount(CanonicalPayload)>4096) Deny("MOBILE_RECEIPT_BOUND");
    }
    static string Reason(string reason) {return Is(reason,"\\A[A-Z][A-Z0-9_]{0,79}\\z")?reason:"MOBILE_INSTALL_RECEIPT_STATE_UNPROVEN";}
    // Production state is read from the retained journal itself. An arbitrary
    // observation, state string, approval flag or child stdout is not accepted.
    internal static MobileInstallReceiptV1 FromNative(SovereignMobileInstallJournalV1 journal,
      SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 boundCandidate,
      SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence=null) {
      if(journal==null || boundCandidate==null || !boundCandidate.IsIntact())Deny("MOBILE_RECEIPT_NATIVE_SOURCE_REQUIRED");
      var snapshot=journal.ReceiptSnapshot(boundCandidate.RequestId,boundCandidate.CandidateSha256);
      if(snapshot==null || !snapshot.IsIntact() || snapshot.RequestId!=boundCandidate.RequestId ||
         snapshot.CandidateSha256!=boundCandidate.CandidateSha256 || snapshot.EnrollmentGeneration!=boundCandidate.EnrollmentGeneration ||
         !Digest(snapshot.CredentialBindingSha256))Deny("MOBILE_RECEIPT_JOURNAL_BINDING_UNPROVEN");
      DateTime now=DateTime.UtcNow;string state,reason=Reason(snapshot.ReasonCode),start=null,installed=null,boot=null;uint? pid=null;
      switch(snapshot.State) {
        case "PREPARED":case "AWAITING_APPROVAL":
          state=now<boundCandidate.ExpiresAtUtc?"AWAITING_APPROVAL":"BLOCKED";
          if(state=="BLOCKED")reason="MOBILE_INSTALL_CANDIDATE_EXPIRED";break;
        case "APPROVAL_CONSUMED":case "APPROVAL_RECORDED":state="APPROVAL_RECORDED";break;
        case "STARTING":state="STARTING";break;
        case "INSTALLING":case "INSTALLED_PENDING_BOOT":case "FAILED":state=snapshot.State;break;
        case "CANCELLED":state="CANCELLED";break;
        case "BLOCKED":case "HELD":state="BLOCKED";break;
        default:state="UNKNOWN";break;
      }
      bool requiresEvidence=state=="INSTALLING" || state=="INSTALLED_PENDING_BOOT" || state=="FAILED";
      bool valid=evidence!=null && evidence.IsIntact() && !evidence.ExecutionAuthorityGranted && !evidence.RebootAllowed &&
        evidence.RequestId==boundCandidate.RequestId && evidence.CandidateSha256==boundCandidate.CandidateSha256 &&
        evidence.MachineHash==boundCandidate.MachineHash && evidence.SourceHead==boundCandidate.SourceHead &&
        evidence.PackageSha256==boundCandidate.PackageSha256 && evidence.EnrollmentGeneration==boundCandidate.EnrollmentGeneration &&
        evidence.JournalSequence==snapshot.Sequence && evidence.JournalHeadSha256==snapshot.HeadSha256 &&
        evidence.RootPid==snapshot.RootPid && evidence.RootCreatedAtUtc==snapshot.RootCreatedAtUtc &&
        evidence.ExecutionStartedAtUtc==snapshot.ExecutionStartedAtUtc && evidence.InstalledHelperSha256==snapshot.InstalledHelperSha256 &&
        evidence.InstallationBootId==snapshot.InstallationBootId;
      if((evidence!=null && !valid) || (requiresEvidence && !valid)) {state="UNKNOWN";reason="MOBILE_INSTALL_NATIVE_EVIDENCE_UNPROVEN";}
      else if(valid) {
        try {
          bool knownRoot=evidence.RootPid>0 && evidence.AssignedBeforeExecution;
          DateTime birth=DateTime.MinValue;
          if(knownRoot) {
            birth=NativeTime(evidence.RootCreatedAtUtc);
            if(birth<boundCandidate.RequestedAtUtc || birth>now)Deny("MOBILE_RECEIPT_ROOT_BIRTH_UNPROVEN");
          }
          bool knownStart=knownRoot && evidence.ResumeConfirmed && evidence.ExecutionStartedAtUtc!=null;
          if(knownStart) {
            DateTime at=NativeTime(evidence.ExecutionStartedAtUtc);start=Instant(at);
            if(at<birth || at>now)Deny("MOBILE_RECEIPT_RESUME_TIME_UNPROVEN");
          }
          if(state=="STARTING") {
            if(evidence.State!="ROOT_SUSPENDED" || !knownRoot || evidence.ResumeConfirmed || evidence.ExecutionStartedAtUtc!=null)
              Deny("MOBILE_RECEIPT_SUSPENDED_ROOT_UNPROVEN");pid=evidence.RootPid;
          } else if(state=="INSTALLING") {
            if(evidence.State!="INSTALLING" || !knownStart)Deny("MOBILE_RECEIPT_RESUME_UNPROVEN");pid=evidence.RootPid;
          } else if(state=="INSTALLED_PENDING_BOOT") {
            if(evidence.State!="INSTALLED_PENDING_BOOT" || !knownStart || !evidence.ZeroActiveProcessesObserved || !evidence.ExecutionCustodyReleased ||
               !Digest(evidence.InstalledHelperSha256) || !Digest(evidence.InstallationBootId))Deny("MOBILE_RECEIPT_PROTECTED_READBACK_UNPROVEN");
            pid=evidence.RootPid;installed=evidence.InstalledHelperSha256;boot=evidence.InstallationBootId;
          } else if(state=="FAILED") {
            if(evidence.State!="FAILED" || !evidence.ZeroActiveProcessesObserved || !evidence.ExecutionCustodyReleased ||
               (evidence.RootPid>0 && !knownRoot) || (evidence.ResumeConfirmed && !knownStart))Deny("MOBILE_RECEIPT_FAILURE_CUSTODY_UNPROVEN");
            if(knownRoot)pid=evidence.RootPid;reason=Reason(evidence.ReasonCode);
          } else if(state=="UNKNOWN") {
            if(evidence.State!="UNKNOWN")Deny("MOBILE_RECEIPT_UNCERTAIN_STATE_UNPROVEN");
            if(knownRoot)pid=evidence.RootPid;reason=Reason(evidence.ReasonCode);
          } else Deny("MOBILE_RECEIPT_PREEXECUTION_EVIDENCE_UNEXPECTED");
        } catch {state="UNKNOWN";reason="MOBILE_INSTALL_NATIVE_EVIDENCE_UNPROVEN";pid=null;start=null;installed=null;boot=null;}
      }
      return new MobileInstallReceiptV1(boundCandidate,snapshot.CredentialBindingSha256,state,reason,snapshot.Sequence,snapshot.HeadSha256,now,pid,start,installed,boot);
    }
    // Every value is a native-validated ASCII grammar. Explicit field order is
    // the shared canonicalMobileInstallationReceiptV1 order, not dictionary order.
    string Canonical() {
      var text=new StringBuilder("{");
      Add(text,"schemaVersion",Schema);Add(text,"requestId",candidate.RequestId);Add(text,"candidateSha256",candidate.CandidateSha256);
      Add(text,"machineHash",candidate.MachineHash);Number(text,"enrollmentGeneration",candidate.EnrollmentGeneration);Number(text,"sequence",Sequence);
      Add(text,"state",State);Add(text,"observedAtUtc",Instant(ObservedAtUtc));Add(text,"sourceHead",candidate.SourceHead);Add(text,"packageSha256",candidate.PackageSha256);
      if(rootPid.HasValue)Number(text,"retainedProcessId",rootPid.Value);else Add(text,"retainedProcessId",null);
      Add(text,"executionStartedAtUtc",started);Add(text,"installedHelperSha256",helper);Add(text,"installationBootId",installationBoot);
      Add(text,"qualifiedBootId",null);Add(text,"reasonCode",ReasonCode);return text.Append('}').ToString();
    }
    static void Key(StringBuilder text,string name) {if(text.Length>1)text.Append(',');text.Append('"').Append(name).Append("\":");}
    static void Add(StringBuilder text,string name,string value) {
      Key(text,name);if(value==null)text.Append("null");else {
        foreach(char c in value)if(c<32 || c>126 || c=='"' || c=='\\')Deny("MOBILE_RECEIPT_STRING_UNPROVEN");
        text.Append('"').Append(value).Append('"');
      }
    }
    static void Number(StringBuilder text,string name,long value) {Key(text,name);text.Append(value.ToString(CultureInfo.InvariantCulture));}
    string Snapshot() {
      return CanonicalPayload+"|"+JournalHeadSha256+"|"+CredentialBindingSha256+"|"+candidate.OperatorSid+"|"+candidate.CandidateSha256+"|"+
        ObservedAtUtc.Ticks.ToString(CultureInfo.InvariantCulture);
    }
    internal bool MatchesProtectedAnchor(string machineHash,string operatorSid,long generation,string credentialBinding,long sequence,string walHash,DateTime nowUtc) {
      try {
        return candidate.IsIntact() && String.Equals(integritySnapshot,Snapshot(),StringComparison.Ordinal) &&
          String.Equals(CanonicalPayload,Canonical(),StringComparison.Ordinal) && machineHash==candidate.MachineHash && operatorSid==candidate.OperatorSid &&
          generation==candidate.EnrollmentGeneration && credentialBinding==CredentialBindingSha256 && sequence==Sequence && walHash==JournalHeadSha256 &&
          nowUtc.Kind==DateTimeKind.Utc && ObservedAtUtc<=nowUtc && (nowUtc-ObservedAtUtc).TotalMilliseconds<=120000;
      } catch {return false;}
    }
    static byte[] DerSignature(byte[] raw) {
      if(raw==null || raw.Length!=64) Deny("MOBILE_RECEIPT_NATIVE_SIGNATURE_UNPROVEN");
      var body=new List<byte>();
      for(int part=0;part<2;part++) {
        int at=part*32,end=at+32;while(at<end-1 && raw[at]==0)at++;
        if(at==end-1 && raw[at]==0)Deny("MOBILE_RECEIPT_NATIVE_SIGNATURE_UNPROVEN");
        bool prefix=(raw[at]&0x80)!=0;body.Add(2);body.Add((byte)(end-at+(prefix?1:0)));if(prefix)body.Add(0);
        while(at<end)body.Add(raw[at++]);
      }
      var result=new List<byte>();result.Add(0x30);result.Add((byte)body.Count);result.AddRange(body);return result.ToArray();
    }
    // Called by the fixed native key owner only AFTER MatchesProtectedAnchor.
    // This formats an existing native signature; it cannot sign arbitrary data.
    internal string EnvelopeFromNativeSignature(byte[] rawSignature) {
      string signature=Convert.ToBase64String(DerSignature(rawSignature)).TrimEnd('=').Replace('+','-').Replace('/','_');
      return "{\"payload\":"+CanonicalPayload+",\"signature\":\""+signature+"\"}";
    }
  }
}
