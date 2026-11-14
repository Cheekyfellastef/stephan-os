// Source-only durable one-use preparation state for existing #1814 requests.
// No controller, queue, executor, enrollment, task registration or installation.
// A hash-chain alone cannot detect rollback to a valid earlier prefix. Every
// committed head therefore requires a separately authenticated durable anchor.
// Production open requires the EXISTING protected anchor's pre-enrolled signed
// genesis/current head. No bootstrap or repair is inferred from missing proof.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Security.Cryptography;
  using System.Text;
  using System.Text.RegularExpressions;
  using Microsoft.Win32.SafeHandles;

  internal sealed class MobileInstallJournalObservationV1 {
    internal readonly string State,ReasonCode,RequestId,CandidateSha256,HeadSha256;
    internal readonly string RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,InstallationBootId;
    internal readonly uint RootPid;
    internal readonly long Sequence;
    internal readonly bool JournalTransitionRecorded;
    internal readonly bool ExecutionAuthorityGranted=false,ReleaseEligibilityVerified=false,InstallationVerified=false,ReplayAllowed=false;
    internal MobileInstallJournalObservationV1(string state,string reason,string request,string candidate,long sequence,string head,bool recorded,
      uint pid=0,string birth=null,string started=null,string helper=null,string boot=null) {
      State=state;ReasonCode=reason;RequestId=request;CandidateSha256=candidate;Sequence=sequence;HeadSha256=head;JournalTransitionRecorded=recorded;
      RootPid=pid;RootCreatedAtUtc=birth;ExecutionStartedAtUtc=started;InstalledHelperSha256=helper;InstallationBootId=boot;
    }
  }
  internal sealed class MobileInstallJournalReceiptSnapshotV1 {
    internal readonly string State,ReasonCode,RequestId,CandidateSha256,HeadSha256,CredentialBindingSha256;
    internal readonly string RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,InstallationBootId;
    internal readonly uint RootPid;
    internal readonly long Sequence,EnrollmentGeneration;
    readonly string original;
    private MobileInstallJournalReceiptSnapshotV1(MobileInstallJournalObservationV1 view,long generation,string credential) {
      State=view.State;ReasonCode=view.ReasonCode;RequestId=view.RequestId;CandidateSha256=view.CandidateSha256;
      Sequence=view.Sequence;HeadSha256=view.HeadSha256;EnrollmentGeneration=generation;CredentialBindingSha256=credential;
      RootPid=view.RootPid;RootCreatedAtUtc=view.RootCreatedAtUtc;ExecutionStartedAtUtc=view.ExecutionStartedAtUtc;
      InstalledHelperSha256=view.InstalledHelperSha256;InstallationBootId=view.InstallationBootId;original=Stamp();
    }
    string Stamp() {return String.Join("\0",new[]{State,ReasonCode,RequestId,CandidateSha256,HeadSha256,CredentialBindingSha256,
      Sequence.ToString(CultureInfo.InvariantCulture),EnrollmentGeneration.ToString(CultureInfo.InvariantCulture),RootPid.ToString(CultureInfo.InvariantCulture),
      RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,InstallationBootId});}
    internal bool IsIntact() {return String.Equals(original,Stamp(),StringComparison.Ordinal);}
    internal static MobileInstallJournalReceiptSnapshotV1 Capture(SovereignMobileInstallJournalV1 journal,string request,string digest) {
      return new MobileInstallJournalReceiptSnapshotV1(journal.ReceiptObservation(request,digest),journal.EnrollmentGeneration,journal.CredentialBindingSha256);
    }
  }

  internal sealed partial class SovereignMobileInstallJournalV1 : IDisposable {
    const int MaximumBytes=1048576,MaximumRecords=2048,MaximumRequests=1024;
    const long SafeInteger=9007199254740991L;
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    readonly FileStream file;
    readonly IDisposable heldPins;
    readonly AnchorChannel anchor;
    readonly object sync=new object();
    readonly Dictionary<string,RequestState> requests=new Dictionary<string,RequestState>(StringComparer.Ordinal);
    readonly HashSet<string> liveClaims=new HashSet<string>(StringComparer.Ordinal);
    string credential,head;
    long generation,sequence,knownLength;
    uint watermark;
    bool poisoned,disposed;
    sealed class RequestState { internal string Candidate,State,Birth,Started,Helper,Boot,Reason;internal uint Counter,Pid;internal DateTime Expires; }
    internal long EnrollmentGeneration {get{return generation;}}
    internal string CredentialBindingSha256 {get{return credential;}}
    sealed class Refusal : Exception { internal Refusal(string code) : base(code) { } }
    static void Deny(string code) { throw new Refusal(code); }
    static bool Is(string value,string pattern) { return value!=null && Regex.IsMatch(value,pattern,RegexOptions.CultureInvariant); }
    static bool Digest(string value) { return Is(value,"\\A[a-f0-9]{64}\\z"); }
    static bool Request(string value) { return Is(value,"\\Amobile-install-[a-z0-9][a-z0-9-]{7,63}\\z"); }
    static string Hash(string input) { using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(input))).Replace("-","").ToLowerInvariant(); }
    internal static string CreateEnrollmentHeaderV1(SovereignMobileInstallAssertionV1.MobileInstallEnrollmentBindingV1 binding) {
      if(binding==null || !Digest(binding.CredentialBindingSha256) || binding.Generation<1 || binding.Generation>SafeInteger)
        throw new InvalidOperationException("MOBILE_JOURNAL_ENROLLMENT_BINDING_REQUIRED");
      string body="STEPHANOS-MOBILE-JOURNAL-V1|"+binding.CredentialBindingSha256+"|"+binding.Generation.ToString(CultureInfo.InvariantCulture)+"|"+
        binding.LastSignCount.ToString(CultureInfo.InvariantCulture);
      return body+"|"+Hash("stephanos.mobile-journal-header.v1\0"+body)+"\n";
    }
    static long Number(string text,long maximum) {
      long result=0;
      if(!Is(text,"\\A(?:0|[1-9][0-9]{0,15})\\z") || !Int64.TryParse(text,NumberStyles.None,CultureInfo.InvariantCulture,out result) || result>maximum)
        Deny("MOBILE_JOURNAL_NUMBER_INVALID");
      return result;
    }
    sealed class AnchorHead {
      internal readonly string Credential,Hash;
      internal readonly long Generation,Sequence;
      internal AnchorHead(string credential,long generation,long sequence,string hash) {Credential=credential;Generation=generation;Sequence=sequence;Hash=hash;}
    }
    // Private constructor is a fixture/integration seam. The shipping factory
    // accepts only the concrete protected native anchor, never caller JSON,
    // arbitrary callbacks or an unauthenticated local head file.
    internal sealed class AnchorChannel {
      readonly Func<string> read;
      readonly Action<string> commit;
      private AnchorChannel(Func<string> authenticatedRead,Action<string> authenticatedCommit) {
        if(authenticatedRead==null || authenticatedCommit==null) Deny("MOBILE_JOURNAL_ANCHOR_REQUIRED");read=authenticatedRead;commit=authenticatedCommit;
      }
      internal static AnchorChannel BindProtected(SovereignMobileInstallAnchorV1 nativeAnchor) {
        if(nativeAnchor==null) Deny("MOBILE_JOURNAL_ANCHOR_REQUIRED");
        return new AnchorChannel(nativeAnchor.ReadHead,nativeAnchor.CommitHead);
      }
      internal string Read() {return read();}
      internal void Commit(string value) {commit(value);}
    }
    static AnchorHead ParseAnchor(string value) {
      if(value==null || value.Length>256) Deny("MOBILE_JOURNAL_ANCHOR_INVALID");
      string[] fields=value.Split('|');
      if(fields.Length!=5 || fields[0]!="STEPHANOS-MOBILE-JOURNAL-HEAD-V1" || !Digest(fields[1]) || !Digest(fields[4]))
        Deny("MOBILE_JOURNAL_ANCHOR_INVALID");
      long gen=Number(fields[2],SafeInteger),seq=Number(fields[3],MaximumRecords);
      if(gen==0) Deny("MOBILE_JOURNAL_ANCHOR_INVALID");return new AnchorHead(fields[1],gen,seq,fields[4]);
    }
    string AnchorText(long seq,string hash) {
      return "STEPHANOS-MOBILE-JOURNAL-HEAD-V1|"+credential+"|"+generation.ToString(CultureInfo.InvariantCulture)+"|"+
        seq.ToString(CultureInfo.InvariantCulture)+"|"+hash;
    }
    void CheckAnchor() {
      AnchorHead observed=ParseAnchor(anchor.Read());
      if(observed.Credential!=credential || observed.Generation!=generation || observed.Sequence!=sequence || observed.Hash!=head)
        Deny("MOBILE_JOURNAL_AUTHENTICATED_HEAD_MISMATCH");
    }
    // No path/flag/approval arguments and no fallback to unauthenticated WAL.
    internal static SovereignMobileInstallJournalV1 OpenProtected() {
      CoreJobCustodyV1.MobileInstallJournalStorageV1 storage=null;SovereignMobileInstallAnchorV1 nativeAnchor=null;
      SovereignMobileInstallJournalV1 journal=null;
      try {
        // The exact WAL remains exclusively held while native anchor state is
        // observed, compared and later advanced. No second native writer lane.
        storage=CoreJobCustodyV1.PinMobileInstallJournalStorageV1();
        nativeAnchor=SovereignMobileInstallAnchorV1.OpenProtected();
        journal=new SovereignMobileInstallJournalV1(storage.File,new ProtectedLifetime(storage,nativeAnchor),AnchorChannel.BindProtected(nativeAnchor));
        // A signed header authenticates its bytes, including its baseline. It
        // does not establish that the reconstructed counter meets the CURRENT
        // protected enrollment floor. Enrollment remains pinned for this owner.
        nativeAnchor.AssertMinimumSignCount(journal.watermark);
        return journal;
      } catch {
        if(journal!=null) journal.Dispose();else {if(nativeAnchor!=null) nativeAnchor.Dispose();if(storage!=null) storage.Dispose();}
        throw new InvalidOperationException("MOBILE_JOURNAL_PROTECTED_OPEN_UNPROVEN");
      }
    }
    sealed class ProtectedLifetime : IDisposable {
      readonly IDisposable storage,anchor;
      internal ProtectedLifetime(IDisposable pinnedStorage,IDisposable pinnedAnchor) {storage=pinnedStorage;anchor=pinnedAnchor;}
      public void Dispose() {try{anchor.Dispose();}finally{storage.Dispose();}}
    }
    private SovereignMobileInstallJournalV1(FileStream retainedFile,IDisposable retainedPins,AnchorChannel authenticatedAnchor) {
      file=retainedFile;heldPins=retainedPins;anchor=authenticatedAnchor;
      try {
        if(file==null || heldPins==null || anchor==null || !file.CanRead || !file.CanWrite || !file.CanSeek) Deny("MOBILE_JOURNAL_STORAGE_REQUIRED");
        knownLength=file.Length;
        if(knownLength<1 || knownLength>MaximumBytes) Deny("MOBILE_JOURNAL_SIZE_INVALID");
        var bytes=new byte[(int)knownLength];file.Position=0;int at=0;
        while(at<bytes.Length) {int count=file.Read(bytes,at,bytes.Length-at);if(count<=0) Deny("MOBILE_JOURNAL_SHORT_READ");at+=count;}
        if(file.Length!=knownLength || file.ReadByte()!=-1 || bytes[bytes.Length-1]!=10) Deny("MOBILE_JOURNAL_TRUNCATED");
        string text=Utf8.GetString(bytes);
        if(!Is(text,"\\A[ -~\\n]+\\z")) Deny("MOBILE_JOURNAL_ENCODING_INVALID");
        string[] lines=text.Split('\n');
        if(lines.Length<2 || lines.Length-2>MaximumRecords || lines[lines.Length-1]!="") Deny("MOBILE_JOURNAL_RECORD_BOUND");
        string[] header=lines[0].Split('|');
        if(header.Length!=5 || header[0]!="STEPHANOS-MOBILE-JOURNAL-V1" || !Digest(header[1]) || !Digest(header[4])) Deny("MOBILE_JOURNAL_HEADER_INVALID");
        credential=header[1];generation=Number(header[2],SafeInteger);watermark=(uint)Number(header[3],UInt32.MaxValue);
        if(generation==0 || Hash("stephanos.mobile-journal-header.v1\0"+String.Join("|",header,0,4))!=header[4]) Deny("MOBILE_JOURNAL_HEADER_INVALID");
        head=header[4];sequence=0;
        for(int index=1;index<lines.Length-1;index++) Apply(lines[index],true);
        CheckAnchor();file.Position=knownLength;
      } catch(Refusal error) {Dispose();throw new InvalidOperationException(error.Message);}
        catch {Dispose();throw new InvalidOperationException("MOBILE_JOURNAL_STORAGE_UNPROVEN");}
    }
    void Apply(string line,bool change) {
      if(line.StartsWith("R3|",StringComparison.Ordinal)){ApplyPreparedRecordV1(line,change);return;}
      if(line.StartsWith("R2|",StringComparison.Ordinal)){ApplyExecution(line,change);return;}
      if(line.Length>768) Deny("MOBILE_JOURNAL_RECORD_BOUND");string[] row=line.Split('|');
      if(row.Length!=11 || row[0]!="R1" || Number(row[1],MaximumRecords)!=sequence+1 || row[2]!=head || !Digest(row[2]) ||
         !Request(row[4]) || !Digest(row[5]) || Number(row[6],SafeInteger)!=generation || row[7]!=credential || !Digest(row[10]) ||
         Hash("stephanos.mobile-journal-record.v1\0"+String.Join("|",row,0,10))!=row[10]) Deny("MOBILE_JOURNAL_RECORD_INVALID");
      DateTime expires=DateTime.ParseExact(row[9],"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal);
      if(expires.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)!=row[9]) Deny("MOBILE_JOURNAL_EXPIRY_INVALID");
      uint count=(uint)Number(row[8],UInt32.MaxValue);RequestState state;bool exists=requests.TryGetValue(row[4],out state);
      if(row[3]=="CONSUME") {
        PreparedRequestV1 prepared;if(preparedRequestsV1.TryGetValue(row[4],out prepared) && (prepared.Cancelled || prepared.Candidate.CandidateSha256!=row[5]))Deny("MOBILE_JOURNAL_PREPARED_BINDING_INVALID");
        if(exists || requests.Count>=MaximumRequests || ((watermark!=0 || count!=0) && count<=watermark)) Deny("MOBILE_JOURNAL_COUNTER_OR_REPLAY_INVALID");
        if(change) {requests.Add(row[4],new RequestState {Candidate=row[5],Counter=count,Expires=expires,State="APPROVAL_CONSUMED"});watermark=count;}
      } else {
        if(!exists || state.Candidate!=row[5] || state.Counter!=count || state.Expires!=expires) Deny("MOBILE_JOURNAL_REQUEST_BINDING_INVALID");
        string next=null;
        if(row[3]=="CLAIM" && state.State=="APPROVAL_CONSUMED") next="CLAIM_RECORDED";
        if(row[3]=="CANCEL" && state.State=="APPROVAL_CONSUMED") next="CANCELLED";
        if(row[3]=="UNCERTAIN" && (state.State=="CLAIM_RECORDED" || state.State=="STARTING" || state.State=="INSTALLING")) next="OUTCOME_UNKNOWN";
        if(next==null) Deny("MOBILE_JOURNAL_TRANSITION_INVALID");if(change) state.State=next;
      }
      if(change) {sequence++;head=row[10];}
    }
    static DateTime WireTime(string value,bool birth=false) {
      DateTime result;string format=birth?"O":"yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
      if(!DateTime.TryParseExact(value,format,CultureInfo.InvariantCulture,birth?DateTimeStyles.RoundtripKind:DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out result) || result.Kind!=DateTimeKind.Utc ||
         result.ToString(format,CultureInfo.InvariantCulture)!=value) Deny("MOBILE_JOURNAL_EXECUTION_TIME_INVALID");return result;
    }
    void ApplyExecution(string line,bool change) {
      if(line.Length>1024) Deny("MOBILE_JOURNAL_RECORD_BOUND");string[] row=line.Split('|');RequestState state=null;
      if(row.Length!=17 || Number(row[1],MaximumRecords)!=sequence+1 || row[2]!=head || !requests.TryGetValue(row[4],out state) ||
         row[5]!=state.Candidate || Number(row[6],SafeInteger)!=generation || row[7]!=credential || Number(row[8],UInt32.MaxValue)!=state.Counter ||
         row[9]!=state.Expires.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture) || !Digest(row[16]) ||
         Hash("stephanos.mobile-journal-execution.v1\0"+String.Join("|",row,0,16))!=row[16] || !Is(row[15],"\\A[A-Z][A-Z0-9_]{0,79}\\z"))
        Deny("MOBILE_JOURNAL_EXECUTION_RECORD_INVALID");
      uint pid=(uint)Number(row[10],UInt32.MaxValue);string birth=row[11]=="-"?null:row[11],started=row[12]=="-"?null:row[12];
      string helper=row[13]=="-"?null:row[13],boot=row[14]=="-"?null:row[14],next=null;
      if(birth!=null)WireTime(birth,true);if(started!=null)WireTime(started);
      if(row[3]=="ROOT" && state.State=="CLAIM_RECORDED" && pid>0 && birth!=null && started==null && helper==null && boot==null)next="STARTING";
      if(row[3]=="STARTED" && state.State=="STARTING" && pid==state.Pid && birth==state.Birth && started!=null && helper==null && boot==null)next="INSTALLING";
      if(row[3]=="PENDING" && state.State=="INSTALLING" && pid==state.Pid && birth==state.Birth && started==state.Started && Digest(helper) && Digest(boot))next="INSTALLED_PENDING_BOOT";
      if((row[3]=="FAILED" || row[3]=="UNKNOWN") && (state.State=="CLAIM_RECORDED" || state.State=="STARTING" || state.State=="INSTALLING" || state.State=="OUTCOME_UNKNOWN") &&
         (state.Pid==0 || (pid==state.Pid && birth==state.Birth)) && helper==null && boot==null)next=row[3]=="FAILED"?"FAILED":"OUTCOME_UNKNOWN";
      if(next==null)Deny("MOBILE_JOURNAL_EXECUTION_TRANSITION_INVALID");
      if(change){state.State=next;state.Pid=pid;state.Birth=birth;state.Started=started;state.Helper=helper;state.Boot=boot;state.Reason=row[15];sequence++;head=row[16];}
    }
    void Healthy() {
      if(disposed || poisoned) Deny("MOBILE_JOURNAL_HELD");
      if(file.Length!=knownLength) {poisoned=true;Deny("MOBILE_JOURNAL_LENGTH_CHANGED");}
      try {CheckAnchor();}catch {poisoned=true;throw;}
    }
    MobileInstallJournalObservationV1 Observation(string state,string reason,string request,string digest,bool recorded=false) {
      return new MobileInstallJournalObservationV1(state,reason,request,digest,sequence,head,recorded);
    }
    MobileInstallJournalObservationV1 Append(string action,string request,string digest,uint count,DateTime expires) {
      if(sequence>=MaximumRecords) return Observation("HELD","MOBILE_JOURNAL_CAPACITY_REACHED",request,digest);
      string body="R1|"+(sequence+1).ToString(CultureInfo.InvariantCulture)+"|"+head+"|"+action+"|"+request+"|"+digest+"|"+
        generation.ToString(CultureInfo.InvariantCulture)+"|"+credential+"|"+count.ToString(CultureInfo.InvariantCulture)+"|"+
        expires.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture);
      string next=Hash("stephanos.mobile-journal-record.v1\0"+body),line=body+"|"+next;Apply(line,false);
      return CommitEncodedRecordV1(line,next,request,digest);
    }
    MobileInstallJournalObservationV1 CommitEncodedRecordV1(string line,string next,string request,string digest) {
      if(sequence>=MaximumRecords)return Observation("HELD","MOBILE_JOURNAL_CAPACITY_REACHED",request,digest);
      byte[] bytes=Utf8.GetBytes(line+"\n");
      if(knownLength+bytes.Length>MaximumBytes) return Observation("HELD","MOBILE_JOURNAL_CAPACITY_REACHED",request,digest);
      // Commit order is deliberately WAL -> durable flush -> authenticated head
      // -> exact read-back -> caller response. Any uncertainty poisons this owner.
      try {
        file.Position=knownLength;file.Write(bytes,0,bytes.Length);file.Flush(true);
        anchor.Commit(AnchorText(sequence+1,next));
        AnchorHead observed=ParseAnchor(anchor.Read());
        if(observed.Credential!=credential || observed.Generation!=generation || observed.Sequence!=sequence+1 || observed.Hash!=next)
          Deny("MOBILE_JOURNAL_ANCHOR_COMMIT_UNPROVEN");
        Apply(line,true);knownLength+=bytes.Length;
        RequestState committed;string state=requests.TryGetValue(request,out committed)?committed.State:PreparedStateForReceiptV1(request,digest);
        return Observation(state,"MOBILE_JOURNAL_TRANSITION_DURABLE_NO_EXECUTION_AUTHORITY",request,digest,true);
      } catch {poisoned=true;return Observation("UNKNOWN","MOBILE_JOURNAL_COMMIT_UNCERTAIN_NO_REPLAY",request,digest);}
    }
    MobileInstallJournalObservationV1 RecordExecution(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence,string operation) {
      lock(sync) {
        try {
          Healthy();RequestState state;
          if(evidence==null || !evidence.IsIntact() || !Request(evidence.RequestId) || !requests.TryGetValue(evidence.RequestId,out state) ||
             evidence.CandidateSha256!=state.Candidate || evidence.EnrollmentGeneration!=generation || evidence.JournalSequence!=sequence || evidence.JournalHeadSha256!=head)
            return Observation("HELD","MOBILE_JOURNAL_EXECUTION_BINDING_UNPROVEN",null,null);
          bool proof=operation=="ROOT"?evidence.State=="ROOT_SUSPENDED" && evidence.AssignedBeforeExecution && !evidence.ResumeConfirmed:
            operation=="STARTED"?evidence.State=="INSTALLING" && evidence.AssignedBeforeExecution && evidence.ResumeConfirmed:
            operation=="PENDING"?evidence.State=="INSTALLED_PENDING_BOOT" && evidence.AssignedBeforeExecution && evidence.ResumeConfirmed && evidence.ZeroActiveProcessesObserved && evidence.ExecutionCustodyReleased:
            operation=="FAILED"?evidence.State=="FAILED" && evidence.ZeroActiveProcessesObserved && evidence.ExecutionCustodyReleased:evidence.State=="UNKNOWN";
          if(!proof)return Observation("HELD","MOBILE_JOURNAL_EXECUTION_PROOF_UNPROVEN",evidence.RequestId,evidence.CandidateSha256);
          string body="R2|"+(sequence+1).ToString(CultureInfo.InvariantCulture)+"|"+head+"|"+operation+"|"+evidence.RequestId+"|"+evidence.CandidateSha256+"|"+
            generation.ToString(CultureInfo.InvariantCulture)+"|"+credential+"|"+state.Counter.ToString(CultureInfo.InvariantCulture)+"|"+
            state.Expires.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)+"|"+evidence.RootPid.ToString(CultureInfo.InvariantCulture)+"|"+
            (evidence.RootCreatedAtUtc??"-")+"|"+(evidence.ExecutionStartedAtUtc??"-")+"|"+(evidence.InstalledHelperSha256??"-")+"|"+(evidence.InstallationBootId??"-")+"|"+evidence.ReasonCode;
          if(sequence>=MaximumRecords)return Observation("HELD","MOBILE_JOURNAL_CAPACITY_REACHED",evidence.RequestId,evidence.CandidateSha256);
          string next=Hash("stephanos.mobile-journal-execution.v1\0"+body),line=body+"|"+next;Apply(line,false);
          return CommitEncodedRecordV1(line,next,evidence.RequestId,evidence.CandidateSha256);
        }catch{poisoned=true;return Observation("HELD","MOBILE_JOURNAL_EXECUTION_HELD",null,null);}
      }
    }
    internal MobileInstallJournalObservationV1 RecordSuspendedRoot(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence){return RecordExecution(evidence,"ROOT");}
    internal MobileInstallJournalObservationV1 RecordStarted(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence){return RecordExecution(evidence,"STARTED");}
    internal MobileInstallJournalObservationV1 RecordInstalledPendingBoot(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence){return RecordExecution(evidence,"PENDING");}
    internal MobileInstallJournalObservationV1 RecordFailed(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 evidence){return RecordExecution(evidence,evidence!=null && evidence.State=="UNKNOWN"?"UNKNOWN":"FAILED");}
    internal MobileInstallJournalReceiptSnapshotV1 ReceiptSnapshot(string request,string digest){return MobileInstallJournalReceiptSnapshotV1.Capture(this,request,digest);}
    internal MobileInstallJournalObservationV1 ReceiptObservation(string request,string digest) {
      lock(sync){
        try{Healthy();RequestState state;if(!Request(request) || !Digest(digest))return Observation("UNKNOWN","MOBILE_JOURNAL_RECEIPT_BINDING_UNPROVEN",request,digest);
          if(!requests.TryGetValue(request,out state))return Observation(PreparedStateForReceiptV1(request,digest),"MOBILE_JOURNAL_PREPARED_OBSERVED",request,digest);
          if(state.Candidate!=digest)return Observation("UNKNOWN","MOBILE_JOURNAL_RECEIPT_BINDING_UNPROVEN",request,digest);
          string view=state.State;if(view=="CLAIM_RECORDED")view=liveClaims.Contains(request)?"STARTING":"UNKNOWN";
          if((view=="STARTING" || view=="INSTALLING") && !liveClaims.Contains(request))view="UNKNOWN";
          if(view=="OUTCOME_UNKNOWN")view="UNKNOWN";
          return new MobileInstallJournalObservationV1(view,state.Reason??"MOBILE_JOURNAL_RECEIPT_OBSERVED",request,digest,sequence,head,false,
            state.Pid,state.Birth,state.Started,state.Helper,state.Boot);
        }catch{return Observation("UNKNOWN","MOBILE_JOURNAL_RECEIPT_HELD",request,digest);}
      }
    }
    internal MobileInstallJournalObservationV1 ConsumeVerifiedApproval(SovereignMobileInstallAssertionV1.MobileInstallAssertionResultV1 approval) {
      lock(sync) {
        try {
          Healthy();
          if(approval==null || !approval.IsIntact() || !approval.ApprovalVerified || approval.ExecutionAuthorityGranted || approval.ReleaseEligibilityVerified)
            return Observation("BLOCKED","MOBILE_JOURNAL_LIVE_VERIFIED_ASSERTION_REQUIRED",null,null);
          if(approval.EnrollmentGeneration!=generation || approval.CredentialBindingSha256!=credential)
            return Observation("BLOCKED","MOBILE_JOURNAL_ENROLLMENT_BINDING_MISMATCH",approval.RequestId,approval.CandidateSha256);
          PreparedRequestV1 prepared;if(preparedRequestsV1.TryGetValue(approval.RequestId,out prepared) && (prepared.Cancelled || prepared.Candidate.CandidateSha256!=approval.CandidateSha256))
            return Observation("BLOCKED","MOBILE_JOURNAL_PREPARED_BINDING_INVALID",approval.RequestId,approval.CandidateSha256);
          if(approval.ExpiresAtUtc.Kind!=DateTimeKind.Utc || approval.ExpiresAtUtc<=DateTime.UtcNow)
            return Observation("BLOCKED","MOBILE_JOURNAL_APPROVAL_EXPIRED",approval.RequestId,approval.CandidateSha256);
          RequestState existing;
          if(requests.TryGetValue(approval.RequestId,out existing)) return Observation("HELD",existing.Candidate==approval.CandidateSha256?
            "MOBILE_JOURNAL_ALREADY_CONSUMED_NO_REPLAY":"MOBILE_JOURNAL_REQUEST_CANDIDATE_COLLISION",approval.RequestId,approval.CandidateSha256);
          if((watermark!=0 || approval.SignCount!=0) && approval.SignCount<=watermark)
            return Observation("BLOCKED","MOBILE_JOURNAL_SIGN_COUNTER_ROLLBACK",approval.RequestId,approval.CandidateSha256);
          if(requests.Count>=MaximumRequests) return Observation("HELD","MOBILE_JOURNAL_CAPACITY_REACHED",approval.RequestId,approval.CandidateSha256);
          return Append("CONSUME",approval.RequestId,approval.CandidateSha256,approval.SignCount,approval.ExpiresAtUtc);
        } catch {poisoned=true;return Observation("HELD","MOBILE_JOURNAL_HELD",null,null);}
      }
    }
    MobileInstallJournalObservationV1 Transition(string request,string digest,string action) {
      lock(sync) {
        try {
          Healthy();if(!Request(request) || !Digest(digest)) return Observation("BLOCKED","MOBILE_JOURNAL_REQUEST_INVALID",null,null);
          RequestState state;
          if(!requests.TryGetValue(request,out state)) return Observation("BLOCKED","MOBILE_JOURNAL_REQUEST_NOT_CONSUMED",request,digest);
          if(state.Candidate!=digest) return Observation("HELD","MOBILE_JOURNAL_REQUEST_CANDIDATE_COLLISION",request,digest);
          if((action=="CLAIM" || action=="READ") && state.State=="APPROVAL_CONSUMED" && state.Expires<=DateTime.UtcNow)
            return Observation("BLOCKED","MOBILE_JOURNAL_APPROVAL_EXPIRED",request,digest);
          if(action=="READ") return Observation(state.State=="CLAIM_RECORDED"?"OUTCOME_UNKNOWN":state.State,
            state.State=="CLAIM_RECORDED" || state.State=="OUTCOME_UNKNOWN"?"MOBILE_JOURNAL_CLAIM_UNCERTAIN_NO_REPLAY":"MOBILE_JOURNAL_OBSERVED_NO_EXECUTION_AUTHORITY",request,digest);
          if(state.State=="CANCELLED") return Observation("CANCELLED","MOBILE_JOURNAL_CANCELLED_NO_REPLAY",request,digest);
          if(state.State=="FAILED" || state.State=="INSTALLED_PENDING_BOOT")return Observation(state.State,"MOBILE_JOURNAL_TERMINAL_NO_REPLAY",request,digest);
          if(state.State=="OUTCOME_UNKNOWN" || ((state.State=="CLAIM_RECORDED" || state.State=="STARTING" || state.State=="INSTALLING") && action=="CLAIM"))
            return Observation("OUTCOME_UNKNOWN","MOBILE_JOURNAL_CLAIM_UNCERTAIN_NO_REPLAY",request,digest);
          if(action=="UNCERTAIN" && state.State!="CLAIM_RECORDED" && state.State!="STARTING" && state.State!="INSTALLING") return Observation("BLOCKED","MOBILE_JOURNAL_CLAIM_REQUIRED",request,digest);
          if(action=="CANCEL" && (state.State=="CLAIM_RECORDED" || state.State=="STARTING" || state.State=="INSTALLING")) action="UNCERTAIN";
          var result=Append(action,request,digest,state.Counter,state.Expires);if(action=="CLAIM" && result.JournalTransitionRecorded)liveClaims.Add(request);return result;
        } catch {poisoned=true;return Observation("HELD","MOBILE_JOURNAL_HELD",request,digest);}
      }
    }
    internal MobileInstallJournalObservationV1 RecordClaim(string request,string digest) {return Transition(request,digest,"CLAIM");}
    internal MobileInstallJournalObservationV1 Cancel(string request,string digest) {return Transition(request,digest,"CANCEL");}
    internal MobileInstallJournalObservationV1 RecordUncertain(string request,string digest) {return Transition(request,digest,"UNCERTAIN");}
    internal MobileInstallJournalObservationV1 Reconcile(string request,string digest) {return Transition(request,digest,"READ");}
    public void Dispose() {
      lock(sync) {if(disposed) return;disposed=true;try {if(file!=null) file.Dispose();}finally {if(heldPins!=null) heldPins.Dispose();}}
    }
  }

  // Reuse existing retained native directory/file identity and ACL primitives.
  // This fixed storage pin alone is never enrollment or authenticated anchoring.
  public static partial class CoreJobCustodyV1 {
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
    static extern bool GetVolumeInformationByHandleW(SafeFileHandle file,StringBuilder name,uint nameSize,out uint serial,out uint componentLength,out uint flags,StringBuilder fileSystem,uint fileSystemSize);
    internal sealed class MobileInstallJournalStorageV1 : IDisposable {
      internal readonly FileStream File;readonly List<SafeFileHandle> pins;
      internal MobileInstallJournalStorageV1(FileStream file,List<SafeFileHandle> parents) {File=file;pins=parents;}
      public void Dispose() {try {File.Dispose();}finally {for(int i=pins.Count-1;i>=0;i--) pins[i].Dispose();}}
    }
    internal static MobileInstallJournalStorageV1 PinMobileInstallJournalStorageV1() {
      const string path=@"C:\Program Files\Stephanos\SovereignMobileInstallerV1\state\approval-journal.wal";
      var pins=new List<SafeFileHandle>();SafeFileHandle handle=null;FileStream file=null;
      try {
        PinDirectoryChain(Path.GetDirectoryName(path),pins);
        RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
        foreach(string directory in new[]{@"C:\Program Files\Stephanos",@"C:\Program Files\Stephanos\SovereignMobileInstallerV1",Path.GetDirectoryName(path)})
          RuntimeProtectedAclV1(directory,true);
        handle=CreateFileW(path,0xc0000000u,0u,IntPtr.Zero,3u,0x80200000u,IntPtr.Zero);
        FILE_INFO info;
        if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 || info.links!=1 ||
           info.sizeHigh!=0 || info.sizeLow<1 || info.sizeLow>1048576) throw new IOException("MOBILE_JOURNAL_STORAGE_IDENTITY_UNPROVEN");
        var fs=new StringBuilder(16);uint serial,component,flags;
        if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out component,out flags,fs,16) || fs.ToString()!="NTFS")
          throw new IOException("MOBILE_JOURNAL_NTFS_REQUIRED");
        file=new FileStream(handle,FileAccess.ReadWrite,4096,false);handle=null;
        RuntimeProtectedAclV1(path,false);
        return new MobileInstallJournalStorageV1(file,pins);
      } catch {if(file!=null) file.Dispose();if(handle!=null) handle.Dispose();for(int i=pins.Count-1;i>=0;i--) pins[i].Dispose();
        throw new InvalidOperationException("MOBILE_JOURNAL_PROTECTED_STORAGE_UNPROVEN");}
    }
  }
}
