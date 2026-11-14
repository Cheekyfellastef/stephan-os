// Source-only fixed installer execution adapter for existing #1814 custody.
// The private fixture path runs only closed benign scripts. No public path,
// command, environment, PID, process-count, deadline or restart input exists.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.Globalization;
  using System.IO;
  using System.Reflection;
  using System.Security.Cryptography;
  using System.Text;
  using System.Threading;
  using System.Text.RegularExpressions;
  using System.Web.Script.Serialization;

  internal static class SovereignMobileInstallExecutorV1 {
    static readonly object ownerLock=new object();
    static HeldExecution retained;
    static ActiveExecution active;
    static NativeExecutionEvidenceV1 lastEvidence;
    sealed class ActiveExecution {
      internal string RequestId;
      internal SovereignMobileInstallJournalV1 Journal;
      internal SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 Candidate;
      internal FixedRuntimeStageV1 Stage;
      internal bool Started,CancelRequested;
    }
    sealed class HeldExecution {
      internal string RequestId;
      internal MobileInstallQualifiedEnrollmentV1 Qualified;
      internal SovereignMobileInstallJournalV1 Journal;
      internal CoreJobCustodyV1.MobileInstallerNativeRunV1 Run;
      internal SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 Candidate;
    }
    internal static bool HasRetainedCustody {get{lock(ownerLock){return retained!=null;}}}
    internal static bool ReserveProtectedRequest(string requestId) {
      if(requestId==null || !Regex.IsMatch(requestId,"\\Amobile-install-[a-z0-9][a-z0-9-]{7,63}\\z"))throw new InvalidOperationException("MOBILE_EXECUTOR_REQUEST_ID_INVALID");
      lock(ownerLock){if(active!=null || retained!=null)return false;active=new ActiveExecution{RequestId=requestId};return true;}
    }
    internal static NativeExecutionEvidenceV1 RunProtected(string requestId,string assertionJson) {
      lock(ownerLock){
        if(retained!=null || (active!=null && (active.RequestId!=requestId || active.Started)))throw new InvalidOperationException("MOBILE_EXECUTOR_ORIGINAL_CUSTODY_HELD");
        if(active==null)active=new ActiveExecution{RequestId=requestId};active.Started=true;
      }
      try{var evidence=NativeExecutionEvidenceV1.Execute(requestId,assertionJson);lock(ownerLock){lastEvidence=evidence;}return evidence;}
      finally{lock(ownerLock){active=null;}}
    }
    internal static NativeExecutionEvidenceV1 ReconcileActive(string requestId){return NativeExecutionEvidenceV1.Current(requestId);}
    internal static MobileInstallReceiptV1 ReconcileActiveReceipt(string requestId) {
      lock(ownerLock){
        if(active!=null && active.RequestId==requestId && active.Journal!=null && active.Candidate!=null)
          return MobileInstallReceiptV1.FromNative(active.Journal,active.Candidate,NativeExecutionEvidenceV1.Current(requestId));
        if(retained!=null && retained.RequestId==requestId)return MobileInstallReceiptV1.FromNative(retained.Journal,retained.Candidate,lastEvidence);
        return null;
      }
    }
    internal static MobileInstallJournalObservationV1 CancelActive(string requestId) {
      lock(ownerLock){
        if(active!=null && active.RequestId==requestId){active.CancelRequested=true;return active.Journal!=null?active.Journal.CancelPrepared(requestId):null;}
        return retained!=null && retained.RequestId==requestId?retained.Journal.CancelPrepared(requestId):null;
      }
    }
    static bool CancellationRequested(string requestId){lock(ownerLock){return active!=null && active.RequestId==requestId && active.CancelRequested;}}
    internal static bool ReconcileRetainedCustody(string requestId) {
      lock(ownerLock){
        if(retained==null)return true;if(retained.RequestId!=requestId)return false;
        if(!retained.Run.TryReleaseAfterNativeDrain())return false;
        retained.Journal.Dispose();retained.Qualified.Dispose();retained=null;return true;
      }
    }
    internal sealed class NativeExecutionEvidenceV1 {
      internal readonly string State,ReasonCode,RequestId,CandidateSha256,MachineHash,SourceHead,PackageSha256;
      internal readonly string JournalHeadSha256,RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,InstallationBootId;
      internal readonly long EnrollmentGeneration,JournalSequence;
      internal readonly uint RootPid;
      internal readonly bool AssignedBeforeExecution,ResumeConfirmed,ZeroActiveProcessesObserved,ExecutionCustodyReleased;
      internal readonly bool ExecutionAuthorityGranted=false,RebootAllowed=false;
      readonly string integritySnapshot;
      private NativeExecutionEvidenceV1(string state,string reason,string request,string candidate,string machine,string source,string package,
          long generation,long sequence,string head,uint pid,string birth,string started,bool assigned,bool resumed,bool zero,bool released,
          string helper=null,string boot=null) {
        State=state;ReasonCode=reason;RequestId=request;CandidateSha256=candidate;MachineHash=machine;SourceHead=source;PackageSha256=package;
        EnrollmentGeneration=generation;JournalSequence=sequence;JournalHeadSha256=head;RootPid=pid;RootCreatedAtUtc=birth;
        ExecutionStartedAtUtc=started;AssignedBeforeExecution=assigned;ResumeConfirmed=resumed;ZeroActiveProcessesObserved=zero;
        ExecutionCustodyReleased=released;InstalledHelperSha256=helper;InstallationBootId=boot;integritySnapshot=Snapshot();
      }
      string Snapshot() {
        return String.Join("\0",new[]{State,ReasonCode,RequestId,CandidateSha256,MachineHash,SourceHead,PackageSha256,
          EnrollmentGeneration.ToString(CultureInfo.InvariantCulture),JournalSequence.ToString(CultureInfo.InvariantCulture),JournalHeadSha256,
          RootPid.ToString(CultureInfo.InvariantCulture),RootCreatedAtUtc,ExecutionStartedAtUtc,AssignedBeforeExecution.ToString(),
          ResumeConfirmed.ToString(),ZeroActiveProcessesObserved.ToString(),ExecutionCustodyReleased.ToString(),InstalledHelperSha256,
          InstallationBootId,ExecutionAuthorityGranted.ToString(),RebootAllowed.ToString()});
      }
      internal bool IsIntact() {try{return String.Equals(integritySnapshot,Snapshot(),StringComparison.Ordinal);}catch{return false;}}
      internal static NativeExecutionEvidenceV1 Current(string requestId) {
        lock(ownerLock){
          if(active!=null && active.RequestId==requestId && active.Candidate!=null && active.Journal!=null) {
            var snapshot=active.Journal.ReceiptSnapshot(requestId,active.Candidate.CandidateSha256);
            if(snapshot.State=="PREPARED" || snapshot.State=="APPROVAL_CONSUMED" || snapshot.State=="APPROVAL_RECORDED")return null;
            if(snapshot.State=="STARTING" && (active.Stage==null || snapshot.RootPid==0 || active.Stage.ResumeConfirmed))return null;
            return Evidence(active.Candidate,snapshot,active.Stage,snapshot.State=="STARTING"?"ROOT_SUSPENDED":snapshot.State,"MOBILE_NATIVE_ACTIVE_OBSERVATION");
          }
          return lastEvidence!=null && lastEvidence.RequestId==requestId?lastEvidence:null;
        }
      }
      static NativeExecutionEvidenceV1 Evidence(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,
        MobileInstallJournalReceiptSnapshotV1 journal,FixedRuntimeStageV1 stage,string state,string reason,string helper=null,string boot=null) {
        return new NativeExecutionEvidenceV1(state,reason,candidate.RequestId,candidate.CandidateSha256,candidate.MachineHash,candidate.SourceHead,
          candidate.PackageSha256,candidate.EnrollmentGeneration,journal.Sequence,journal.HeadSha256,stage==null?0u:(uint)stage.RootPid,
          stage==null || String.IsNullOrEmpty(stage.RootCreatedAtUtc)?null:stage.RootCreatedAtUtc,
          stage==null || String.IsNullOrEmpty(stage.ResumeConfirmedAtUtc)?null:stage.ResumeConfirmedAtUtc,
          stage!=null && stage.AssignedBeforeExecution,stage!=null && stage.ResumeConfirmed,stage!=null && stage.ZeroActiveProcessesObserved,
          stage!=null && stage.ExecutionCustodyReleased,helper,boot);
      }
      static void RequireRecorded(MobileInstallJournalObservationV1 result) {
        if(result==null || !result.JournalTransitionRecorded)throw new InvalidOperationException("MOBILE_EXECUTOR_DURABLE_TRANSITION_UNPROVEN");
      }
      static bool Matches(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 qualified) {
        return candidate!=null && candidate.IsIntact() && qualified.IsIntact() && candidate.MachineHash==qualified.MachineHash &&
          candidate.OperatorSid==qualified.OperatorSid && candidate.EnrollmentGeneration==qualified.Generation && candidate.SourceHead==qualified.SourceHead &&
          candidate.SourceTree==qualified.SourceTree && candidate.PackageSha256==qualified.PackageSha256 && candidate.ClosureSha256==qualified.ClosureSha256 &&
          candidate.ReleaseProofSha256==qualified.ReleaseProofSha256;
      }
      internal static NativeExecutionEvidenceV1 Execute(string requestId,string assertionJson) {
        MobileInstallQualifiedEnrollmentV1 qualified=null;SovereignMobileInstallJournalV1 journal=null;
        CoreJobCustodyV1.MobileInstallerNativeRunV1 run=null;
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate=null;
        FixedRuntimeStageV1 stage=null;bool claimed=false;
        try {
          if(requestId==null || !Regex.IsMatch(requestId,"\\Amobile-install-[a-z0-9][a-z0-9-]{7,63}\\z"))throw new InvalidOperationException("MOBILE_EXECUTOR_REQUEST_ID_INVALID");
          qualified=MobileInstallQualifiedEnrollmentV1.OpenProtected();journal=SovereignMobileInstallJournalV1.OpenProtected();
          candidate=journal.LoadPreparedCandidate(requestId);
          if(!Matches(candidate,qualified))throw new InvalidOperationException("MOBILE_EXECUTOR_QUALIFIED_CANDIDATE_MISMATCH");
          lock(ownerLock){active.Journal=journal;active.Candidate=candidate;}
          if(CancellationRequested(requestId)){journal.CancelPrepared(requestId);throw new InvalidOperationException("MOBILE_EXECUTOR_CANCELLED_BEFORE_ADMISSION");}
          var approval=SovereignMobileInstallAssertionV1.Verify(candidate.CanonicalJson,qualified.EnrollmentJson,assertionJson,DateTime.UtcNow);
          if(!approval.ApprovalVerified || !approval.IsIntact() || approval.CredentialBindingSha256!=qualified.CredentialBindingSha256)
            throw new InvalidOperationException("MOBILE_EXECUTOR_ASSERTION_UNPROVEN");
          RequireRecorded(journal.ConsumeVerifiedApproval(approval));RequireRecorded(journal.RecordClaim(requestId,candidate.CandidateSha256));claimed=true;
          run=CoreJobCustodyV1.RunMobileInstallerFixedV1(qualified,delegate(FixedRuntimeStageV1 suspended) {
            if(!qualified.IsIntact() || CancellationRequested(requestId) || candidate.ExpiresAtUtc<=DateTime.UtcNow)return false;
            var binding=Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),suspended,"ROOT_SUSPENDED","MOBILE_NATIVE_ROOT_SUSPENDED");
            lock(ownerLock){active.Stage=suspended;}
            return journal.RecordSuspendedRoot(binding).JournalTransitionRecorded;
          },delegate(FixedRuntimeStageV1 resumed) {
            stage=resumed;
            var started=Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),resumed,"INSTALLING","MOBILE_NATIVE_RESUME_CONFIRMED");
            RequireRecorded(journal.RecordStarted(started));
          },delegate {
            if(!qualified.IsIntact() || CancellationRequested(requestId))return true;
            string current=journal.ReceiptSnapshot(requestId,candidate.CandidateSha256).State;
            return current=="CANCELLED" || current=="UNKNOWN" || current=="OUTCOME_UNKNOWN" || current=="HELD";
          });
          stage=run.Stage;
          if(!stage.OperationOk || !stage.ZeroActiveProcessesObserved || !stage.ExecutionCustodyReleased) {
            string state=stage.ExecutionCustodyReleased && stage.ZeroActiveProcessesObserved?"FAILED":"UNKNOWN";
            var failed=Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,state,
              state=="FAILED"?"MOBILE_NATIVE_INSTALLER_FAILED":"MOBILE_NATIVE_EXECUTION_UNCERTAIN");
            RequireRecorded(journal.RecordFailed(failed));return Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,state,failed.ReasonCode);
          }
          using(var installed=CoreJobCustodyV1.MobileInstallerReadBackV1.OpenProtected(candidate,stage.ResumeConfirmedAtUtc)) {
            var pending=Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,"INSTALLED_PENDING_BOOT",
              "MOBILE_INSTALL_VERIFIED_BOOT_PENDING",installed.HelperSha256,installed.BootId);
            RequireRecorded(journal.RecordInstalledPendingBoot(pending));
            return Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,"INSTALLED_PENDING_BOOT",pending.ReasonCode,installed.HelperSha256,installed.BootId);
          }
        }catch {
          if(candidate==null)throw new InvalidOperationException("MOBILE_EXECUTOR_QUALIFIED_REQUEST_UNPROVEN");
          if(journal!=null && claimed) {
            var unknown=Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,"UNKNOWN","MOBILE_NATIVE_OUTCOME_UNPROVEN");
            journal.RecordFailed(unknown);return Evidence(candidate,journal.ReceiptSnapshot(requestId,candidate.CandidateSha256),stage,"UNKNOWN",unknown.ReasonCode);
          }
          throw new InvalidOperationException("MOBILE_EXECUTOR_APPROVAL_NOT_ADMITTED");
        }finally {
          if(run!=null && !run.TryReleaseAfterNativeDrain()) {
            retained=new HeldExecution {RequestId=requestId,Qualified=qualified,Journal=journal,Run=run,Candidate=candidate};qualified=null;journal=null;
          }
          if(run!=null)run.Dispose();if(journal!=null)journal.Dispose();if(qualified!=null)qualified.Dispose();
        }
      }

    }
  }

  public static partial class CoreJobCustodyV1 {
    internal sealed class MobileInstallerReadBackV1 : IDisposable {
      internal readonly string HelperSha256,BootId;
      readonly FixedRuntimeIdentityPinsV1 pins;
      private MobileInstallerReadBackV1(string helper,string boot,FixedRuntimeIdentityPinsV1 retained){HelperSha256=helper;BootId=boot;pins=retained;}
      static Dictionary<string,string> Pending(string raw) {
        string[] keys={"SchemaVersion","SourceHead","SourceTree","HelperSha256","ManifestSha256","GitClosureSha256","MachineHash",
          "CompilerCompletedAtUtc","InstalledAtUtc","OperatorSid","NodeExecutableSha256","GitExecutableSha256","PowerShellExecutableSha256",
          "NodeExecutableLinkCount","GitExecutableLinkCount","PowerShellExecutableLinkCount"};
        if(raw==null || raw.Length>32768)throw new InvalidOperationException("MOBILE_READBACK_PENDING_BOUND");
        var allowed=new HashSet<string>(keys,StringComparer.Ordinal);var values=new Dictionary<string,string>(StringComparer.Ordinal);int at=0;
        while(at<raw.Length && (raw[at]==' ' || raw[at]=='\r' || raw[at]=='\n' || raw[at]=='\t'))at++;
        if(at>=raw.Length || raw[at++]!='{')throw new InvalidOperationException("MOBILE_READBACK_PENDING_SHAPE");
        var token=new Regex("\\G[ \\t\\r\\n]*\"(?<key>[A-Za-z][A-Za-z0-9]+)\"[ \\t\\r\\n]*:[ \\t\\r\\n]*(?:\"(?<text>[A-Za-z0-9:._+\\-]+)\"|(?<number>0|[1-9][0-9]{0,9}))",RegexOptions.CultureInvariant);
        while(true) {
          Match item=token.Match(raw,at);if(!item.Success || item.Index!=at)throw new InvalidOperationException("MOBILE_READBACK_PENDING_SHAPE");at+=item.Length;
          string key=item.Groups["key"].Value;
          if(!allowed.Contains(key) || values.ContainsKey(key) || (key.EndsWith("LinkCount",StringComparison.Ordinal)!=item.Groups["number"].Success))
            throw new InvalidOperationException("MOBILE_READBACK_PENDING_KEYS");
          values.Add(key,item.Groups["number"].Success?item.Groups["number"].Value:item.Groups["text"].Value);
          while(at<raw.Length && (raw[at]==' ' || raw[at]=='\r' || raw[at]=='\n' || raw[at]=='\t'))at++;
          if(at<raw.Length && raw[at]=='}'){at++;break;}
          if(at>=raw.Length || raw[at++]!=',')throw new InvalidOperationException("MOBILE_READBACK_PENDING_SHAPE");
        }
        while(at<raw.Length && (raw[at]==' ' || raw[at]=='\r' || raw[at]=='\n' || raw[at]=='\t'))at++;
        if(at!=raw.Length || values.Count!=keys.Length)throw new InvalidOperationException("MOBILE_READBACK_PENDING_KEYS");return values;
      }
      static DateTime Time(string text,string format) {
        DateTime time;if(!DateTime.TryParseExact(text,format,CultureInfo.InvariantCulture,format=="O"?DateTimeStyles.RoundtripKind:DateTimeStyles.AssumeUniversal|DateTimeStyles.AdjustToUniversal,out time) || time.Kind!=DateTimeKind.Utc ||
          time.ToString(format,CultureInfo.InvariantCulture)!=text)throw new InvalidOperationException("MOBILE_READBACK_TIME_UNPROVEN");return time;
      }
      internal static MobileInstallerReadBackV1 OpenProtected(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,string resumeAt) {
        var pins=new FixedRuntimeIdentityPinsV1();
        try {
          if(candidate==null || !candidate.IsIntact())throw new InvalidOperationException("MOBILE_READBACK_CANDIDATE_UNPROVEN");
          DateTime resumed=Time(resumeAt,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),boot=RuntimeWindowsBootV1();
          string version=Path.Combine(RuntimeProtectedRootV1,candidate.SourceHead),helper=Path.Combine(version,"host.exe"),pendingPath=Path.Combine(version,"pending.json");
          RuntimePinParentsV1(helper,pins);RuntimeFixedAncestorAclV1(@"C:\");RuntimeFixedAncestorAclV1(@"C:\Program Files");
          RuntimeProtectedAclV1(@"C:\Program Files\Stephanos",true);RuntimeProtectedAclV1(RuntimeProtectedRootV1,true);RuntimeProtectedAclV1(version,true);
          byte[] helperBytes=RuntimeReadPinnedV1(helper,2097152,pins),pendingBytes=RuntimeReadPinnedV1(pendingPath,32768,pins);
          RuntimeProtectedAclV1(helper,false);RuntimeProtectedAclV1(pendingPath,false);
          var pending=Pending(new UTF8Encoding(false,true).GetString(pendingBytes));string digest=RuntimeHashV1(helperBytes);
          if(pending["SchemaVersion"]!="stephanos.fixed-runtime-pending.v1" || pending["SourceHead"]!=candidate.SourceHead || pending["SourceTree"]!=candidate.SourceTree ||
             pending["MachineHash"]!=candidate.MachineHash || pending["OperatorSid"]!=candidate.OperatorSid || pending["HelperSha256"]!=digest ||
             pending["GitClosureSha256"]!=candidate.ClosureSha256 || RuntimeMachineHashV1()!=candidate.MachineHash)
            throw new InvalidOperationException("MOBILE_READBACK_PENDING_BINDING_UNPROVEN");
          DateTime compiled=Time(pending["CompilerCompletedAtUtc"],"O"),installed=Time(pending["InstalledAtUtc"],"O");
          if(boot>resumed || resumed>compiled || compiled>=installed || installed>DateTime.UtcNow)throw new InvalidOperationException("MOBILE_READBACK_INSTALL_TIME_UNPROVEN");
          byte[] manifestBytes;
          // Load only already read-back protected reviewed bytes to inspect the
          // embedded manifest. No type, entry point or static member is invoked.
          using(var resource=Assembly.Load(helperBytes).GetManifestResourceStream("Stephanos.FixedRuntime.ManifestV1")) {
            if(resource==null || resource.Length<2 || resource.Length>2097152)throw new InvalidOperationException("MOBILE_READBACK_MANIFEST_UNPROVEN");
            manifestBytes=new byte[(int)resource.Length];int offset=0;
            while(offset<manifestBytes.Length){int count=resource.Read(manifestBytes,offset,manifestBytes.Length-offset);if(count<=0)throw new IOException("MOBILE_READBACK_MANIFEST_UNPROVEN");offset+=count;}
          }
          var manifest=new JavaScriptSerializer {MaxJsonLength=2097152,RecursionLimit=12}.Deserialize<FixedRuntimeManifestV1>(new UTF8Encoding(false,true).GetString(manifestBytes));
          if(manifest==null || manifest.SchemaVersion!="stephanos.fixed-runtime-manifest.v1" || manifest.SourceHead!=candidate.SourceHead || manifest.SourceTree!=candidate.SourceTree ||
             manifest.Files==null || manifest.Files.Length!=SovereignMobileInstallReleaseV1.ExpectedPathCount || pending["ManifestSha256"]!=RuntimeHashV1(manifestBytes) ||
             RuntimeGitClosureV1(manifest.Files)!=candidate.ClosureSha256)throw new InvalidOperationException("MOBILE_READBACK_MANIFEST_BINDING_UNPROVEN");
          long total=0;
          foreach(var member in manifest.Files) {
            if(!RuntimeHexV1(member.MaterializedSha256,64))throw new InvalidOperationException("MOBILE_READBACK_SOURCE_UNPROVEN");
            string path=Path.Combine(RuntimeSourceRootV1,member.Path.Replace('/',Path.DirectorySeparatorChar));RuntimePinParentsV1(path,pins);
            byte[] bytes=RuntimeReadPinnedV1(path,(int)Math.Min(2097152,8388608-total),pins);total+=bytes.Length;
            if(RuntimeHashV1(bytes)!=member.MaterializedSha256)throw new InvalidOperationException("MOBILE_READBACK_SOURCE_CHANGED");
          }
          foreach(string reference in new[]{".git/HEAD",".git/refs/heads/main"}) {
            string path=Path.Combine(RuntimeSourceRootV1,reference);RuntimePinParentsV1(path,pins);
            string value=new UTF8Encoding(false,true).GetString(RuntimeReadPinnedV1(path,4096,pins)).Trim();
            if(value!=(reference==".git/HEAD"?"ref: refs/heads/main":candidate.SourceHead))throw new InvalidOperationException("MOBILE_READBACK_MAIN_CHANGED");
          }
          string[] tools={@"C:\Program Files\nodejs\node.exe",@"C:\Program Files\Git\cmd\git.exe",@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"};
          string[] names={"Node","Git","PowerShell"};
          for(int i=0;i<tools.Length;i++)RuntimePinFixedExecutableV1(tools[i],pending[names[i]+"ExecutableSha256"],Int32.Parse(pending[names[i]+"ExecutableLinkCount"],CultureInfo.InvariantCulture),pins);
          string bootId=RuntimeHashV1(Encoding.UTF8.GetBytes("stephanos.mobile-install-boot.v1\0"+candidate.MachineHash+"\0"+boot.ToString("O",CultureInfo.InvariantCulture)));
          return new MobileInstallerReadBackV1(digest,bootId,pins);
        }catch{pins.Dispose();throw new InvalidOperationException("MOBILE_READBACK_INSTALLATION_UNPROVEN");}
      }
      public void Dispose(){pins.Dispose();}
    }
    internal sealed class MobileInstallerNativeRunV1 : IDisposable {
      internal readonly FixedRuntimeStageV1 Stage;
      internal readonly int ResumeObserverCalls;
      IntPtr job,owner,launcher;
      FixedRuntimeIdentityPinsV1 pins;
      bool disposed;
      static readonly object heldLock=new object();
      static MobileInstallerNativeRunV1 held;
      internal MobileInstallerNativeRunV1(FixedRuntimeStageV1 stage,IntPtr ownedJob,IntPtr ownerHandle,IntPtr launcherHandle,FixedRuntimeIdentityPinsV1 retained,int observed=0) {
        Stage=stage;job=ownedJob;owner=ownerHandle;launcher=launcherHandle;pins=retained;
        ResumeObserverCalls=observed;
      }
      internal static void RequireNoHeldOwner() {lock(heldLock) {if(held!=null) throw new InvalidOperationException("MOBILE_EXECUTOR_PRIOR_CUSTODY_HELD");}}
      internal bool TryReleaseAfterNativeDrain() {
        lock(heldLock) {
          if(disposed)return true;var observation=new CoreJobReceiptV1();
          try {if(job!=IntPtr.Zero && !Empty(job,observation))return false;}catch{return false;}
          disposed=true;
          if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}
          if(owner!=IntPtr.Zero){CloseHandle(owner);owner=IntPtr.Zero;}
          if(launcher!=IntPtr.Zero){CloseHandle(launcher);launcher=IntPtr.Zero;}
          if(pins!=null){pins.Dispose();pins=null;}
          if(Object.ReferenceEquals(held,this))held=null;return true;
        }
      }
      public void Dispose() {
        // An uncertain native drain retains the ORIGINAL Job and pins. Closing
        // or dropping them cannot be mistaken for proof that custody was freed.
        if(TryReleaseAfterNativeDrain())return;
        lock(heldLock) {if(held!=null && !Object.ReferenceEquals(held,this))throw new InvalidOperationException("MOBILE_EXECUTOR_HELD_OWNER_COLLISION");held=this;}
      }
    }
    // Sole production child shape: fixed Windows PowerShell, fixed protected
    // bootstrap, fixed cwd and the existing source-defined minimal environment.
    internal static MobileInstallerNativeRunV1 RunMobileInstallerFixedV1(MobileInstallQualifiedEnrollmentV1 qualified,Func<FixedRuntimeStageV1,bool> bindSuspended,Action<FixedRuntimeStageV1> resumedObserver,Func<bool> cancelled) {
      if(qualified==null || !qualified.IsIntact())throw new InvalidOperationException("MOBILE_EXECUTOR_QUALIFIED_ENROLLMENT_REQUIRED");
      if(resumedObserver==null)throw new InvalidOperationException("MOBILE_EXECUTOR_DURABLE_START_OBSERVER_REQUIRED");
      return RunMobileInstallerStageV1(false,null,bindSuspended,resumedObserver,cancelled,qualified.BootstrapSha256);
    }
    // Private fixture seam, compiled test harness only. The closed mode cannot
    // select a file, executable, arbitrary script, environment or installation.
    private static MobileInstallerNativeRunV1 MobileInstallerFixtureV1(string mode) {
      return RunMobileInstallerStageV1(true,mode,delegate(FixedRuntimeStageV1 stage) {return mode!="reject-binding";},null,delegate {return mode=="cancel-before";});
    }
    // No implementation ships; only the compiled benign test harness supplies
    // these larger fixture payloads. Production never selects a fixture mode.
    static partial void MobileExecutorFixturePayloadV1(string mode,ref string script,ref string file);
    static string MobileSealedBootstrapLoaderV1(string path,string expectedHash) {
      if(!Regex.IsMatch(expectedHash??"","\\A[a-f0-9]{64}\\z"))throw new InvalidOperationException("MOBILE_EXECUTOR_BOOTSTRAP_PIN_REQUIRED");
      return "$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';$mobileLoaderFile=[IO.FileStream]::new('"+path.Replace("'","''")+"','Open','Read','Read');try{"+
        "if($mobileLoaderFile.Length -lt 2 -or $mobileLoaderFile.Length -gt 32768){throw 'MOBILE_LOADER_BOUND'};"+
        "$mobileLoaderBytes=[byte[]]::new([int]$mobileLoaderFile.Length);$mobileLoaderAt=0;while($mobileLoaderAt -lt $mobileLoaderBytes.Length){"+
        "$mobileLoaderRead=$mobileLoaderFile.Read($mobileLoaderBytes,$mobileLoaderAt,$mobileLoaderBytes.Length-$mobileLoaderAt);if($mobileLoaderRead -le 0){throw 'MOBILE_LOADER_BYTES_CHANGED'};$mobileLoaderAt+=$mobileLoaderRead};"+
        "if($mobileLoaderFile.ReadByte() -ne -1 -or $mobileLoaderFile.Length -ne $mobileLoaderBytes.Length){throw 'MOBILE_LOADER_BYTES_CHANGED'};"+
        "$mobileLoaderSha=[Security.Cryptography.SHA256]::Create();try{$mobileLoaderDigest=([BitConverter]::ToString($mobileLoaderSha.ComputeHash($mobileLoaderBytes))).Replace('-','').ToLowerInvariant()}finally{$mobileLoaderSha.Dispose()};"+
        "if($mobileLoaderDigest -cne '"+expectedHash+"'){throw 'MOBILE_LOADER_BYTES_CHANGED'};"+
        ". ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($mobileLoaderBytes)))}finally{$mobileLoaderFile.Dispose()}";
    }
    static MobileInstallerNativeRunV1 RunMobileInstallerStageV1(bool fixture,string mode,Func<FixedRuntimeStageV1,bool> bindSuspended,Action<FixedRuntimeStageV1> resumedObserver,Func<bool> cancelled,string bootstrapHash=null) {
      MobileInstallerNativeRunV1.RequireNoHeldOwner();
      if(bindSuspended==null || cancelled==null)throw new InvalidOperationException("MOBILE_EXECUTOR_PARENT_BINDING_REQUIRED");
      const string executable=@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
      string root=@"C:\Program Files\Stephanos\SovereignMobileInstallerV1";
      string arguments=fixture?null:"-NoLogo -NoProfile -NonInteractive -EncodedCommand "+Convert.ToBase64String(Encoding.Unicode.GetBytes(MobileSealedBootstrapLoaderV1(Path.Combine(root,"runtime-bootstrap.ps1"),bootstrapHash)));
      string fixtureFile=null;
      int deadline=120000;
      if(fixture) {
        string script;
        switch(mode) {
          case "complete":case "reject-binding":case "cancel-before":case "observer-failure":script="[Console]::Write('BENIGN_MOBILE_EXECUTOR_FIXTURE')";break;
          case "failed":script="[Console]::Write('BENIGN_FAILURE');exit 7";break;
          case "overflow":script="[Console]::Write(('x'*17000))";break;
          case "deadline":script="[Threading.Thread]::Sleep(3000)";break;
          case "bounded-descendant":case "persistent-descendant":case "sealed-loader":case "sealed-loader-wrong-hash":case "compiler-child":
            script=null;MobileExecutorFixturePayloadV1(mode,ref script,ref fixtureFile);
            if(script==null)throw new InvalidOperationException("MOBILE_EXECUTOR_FIXTURE_DISABLED");break;
          default:throw new InvalidOperationException("MOBILE_EXECUTOR_FIXTURE_MODE_INVALID");
        }
        arguments="-NoLogo -NoProfile -NonInteractive -EncodedCommand "+Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        root=Path.GetTempPath();deadline=mode=="deadline"?350:mode=="persistent-descendant"?1200:10000;
      }
      IntPtr job=IntPtr.Zero,owner=IntPtr.Zero,launcher=IntPtr.Zero;var pins=new FixedRuntimeIdentityPinsV1();
      var clock=Stopwatch.StartNew();int observations=0;
      try {
        if(!fixture) {
          // Same canonical fixed-tool primitive used by the existing installer;
          // retained OS/vendor identity and ACL checks, no caller hash or path.
          RuntimeObserveFixedToolsV1(pins);
        }
        using(var current=Process.GetCurrentProcess()) {
          long birth=current.StartTime.ToUniversalTime().ToFileTimeUtc();owner=RuntimeOwnerHandleV1(current.Id,birth);launcher=RuntimeOwnerHandleV1(current.Id,birth);
        }
        job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);Require(job!=IntPtr.Zero);
        var limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000|0x400|0x8;limits.basic.activeLimit=8;
        Require(SetInformationJobObject(job,9,ref limits,(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
        var stage=RunRuntimeStageObservedV1(job,"MOBILE_FIXED_RUNTIME_INSTALL_V1",executable,arguments,root,new byte[0],clock,deadline,owner,launcher,cancelled,null,bindSuspended,null,
          delegate(FixedRuntimeStageV1 resumed){
            if(!resumed.ResumeConfirmed || String.IsNullOrEmpty(resumed.ResumeConfirmedAtUtc))throw new InvalidOperationException("MOBILE_EXECUTOR_RESUME_OBSERVER_ORDER_INVALID");
            Interlocked.Increment(ref observations);if(mode=="observer-failure")throw new InvalidOperationException("SYNTHETIC_DURABLE_START_FAILURE");
            if(resumedObserver!=null)resumedObserver(resumed);
          });
        return new MobileInstallerNativeRunV1(stage,job,owner,launcher,pins,observations);
      } catch {
        // The runtime primitive owns every launched root. If setup fails before
        // it is called, the Job is empty; otherwise retain on unproven drain.
        var stage=new FixedRuntimeStageV1 {Stage="MOBILE_FIXED_RUNTIME_INSTALL_V1",Reason="MOBILE_EXECUTOR_NATIVE_STAGE_UNPROVEN"};
        if(job!=IntPtr.Zero) {
          try {Require(TerminateJobObject(job,83));var drain=Stopwatch.StartNew();var observed=new CoreJobReceiptV1();
            while(!Empty(job,observed) && drain.ElapsedMilliseconds<5000)Thread.Sleep(10);
            stage.ZeroActiveProcessesObserved=Empty(job,observed);stage.ExecutionCustodyReleased=stage.ZeroActiveProcessesObserved;}catch{}
        } else {stage.ZeroActiveProcessesObserved=true;stage.ExecutionCustodyReleased=true;}
        return new MobileInstallerNativeRunV1(stage,job,owner,launcher,pins,observations);
      } finally {if(fixtureFile!=null){try{File.Delete(fixtureFile);}catch{}}}
    }
  }
}
