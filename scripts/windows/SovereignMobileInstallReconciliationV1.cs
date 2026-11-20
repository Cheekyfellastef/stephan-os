// Same-request terminal reconciliation: signed R2 proves historical custody;
// fresh pinned readback proves current installed bytes. Neither is a live Job
// witness, execution/release/source authority, reboot permission or READY.
namespace Stephanos.Sovereign {
  using System;
  using System.Globalization;

  internal sealed partial class SovereignMobileInstallJournalV1 {
    internal sealed class TerminalWitnessV1 {
      internal readonly MobileInstallJournalReceiptSnapshotV1 Snapshot;
      internal readonly bool HistoricalRootBindingCommitted,HistoricalResumeCommitted,HistoricalZeroActiveCommitted;
      readonly SovereignMobileInstallJournalV1 owner;
      readonly string candidateJson;
      private TerminalWitnessV1(SovereignMobileInstallJournalV1 journal,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,RequestState state) {
        owner=journal;candidateJson=candidate.CanonicalJson;Snapshot=journal.ReceiptSnapshot(candidate.RequestId,candidate.CandidateSha256);
        HistoricalRootBindingCommitted=state.RootCommitted;HistoricalResumeCommitted=state.ResumeCommitted;
        // Only the native R2 producer can commit FAILED/PENDING after actual
        // zero/drain. Replay authenticates that historical fact, not a live Job.
        HistoricalZeroActiveCommitted=state.TerminalCommitted;
      }
      internal static TerminalWitnessV1 Capture(SovereignMobileInstallJournalV1 journal,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate) {
        if(journal==null || candidate==null || !candidate.IsIntact())return null;
        lock(journal.sync) {
          journal.Healthy();RequestState state;
          if(journal.LoadPreparedCandidate(candidate.RequestId).CanonicalJson!=candidate.CanonicalJson ||
             candidate.EnrollmentGeneration!=journal.generation || !journal.requests.TryGetValue(candidate.RequestId,out state) ||
             state.Candidate!=candidate.CandidateSha256 || !state.TerminalCommitted ||
             (state.State!="FAILED" && state.State!="INSTALLED_PENDING_BOOT"))return null;
          if(state.State=="INSTALLED_PENDING_BOOT" && (!state.RootCommitted || !state.ResumeCommitted || state.Pid==0 ||
             state.Birth==null || state.Started==null || !Digest(state.Helper) || !Digest(state.Boot)))return null;
          if(state.ResumeCommitted && (!state.RootCommitted || state.Pid==0 || state.Birth==null || state.Started==null))return null;
          return new TerminalWitnessV1(journal,candidate,state);
        }
      }
      internal bool IsCurrent(SovereignMobileInstallJournalV1 journal,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate) {
        try {
          if(!Object.ReferenceEquals(owner,journal) || candidate==null || !candidate.IsIntact() || candidate.CanonicalJson!=candidateJson ||
             Snapshot==null || !Snapshot.IsIntact())return false;
          var current=Capture(journal,candidate);
          return current!=null && current.Snapshot.State==Snapshot.State && current.Snapshot.ReasonCode==Snapshot.ReasonCode &&
            current.Snapshot.Sequence==Snapshot.Sequence && current.Snapshot.HeadSha256==Snapshot.HeadSha256 &&
            current.Snapshot.CredentialBindingSha256==Snapshot.CredentialBindingSha256 && current.Snapshot.EnrollmentGeneration==Snapshot.EnrollmentGeneration &&
            current.Snapshot.RootPid==Snapshot.RootPid && current.Snapshot.RootCreatedAtUtc==Snapshot.RootCreatedAtUtc &&
            current.Snapshot.ExecutionStartedAtUtc==Snapshot.ExecutionStartedAtUtc && current.Snapshot.InstalledHelperSha256==Snapshot.InstalledHelperSha256 &&
            current.Snapshot.InstallationBootId==Snapshot.InstallationBootId && current.HistoricalRootBindingCommitted==HistoricalRootBindingCommitted &&
            current.HistoricalResumeCommitted==HistoricalResumeCommitted && current.HistoricalZeroActiveCommitted==HistoricalZeroActiveCommitted;
        }catch{return false;}
      }
    }
  }

  internal static partial class SovereignMobileInstallExecutorV1 {
    internal sealed class TerminalReadbackEvidenceV1 : IDisposable {
      internal readonly MobileInstallJournalReceiptSnapshotV1 Snapshot;
      internal readonly string State,ReasonCode,RequestId,CandidateSha256,MachineHash,OperatorSid,SourceHead,SourceTree;
      internal readonly string PackageSha256,ClosureSha256,ReleaseProofSha256,CredentialBindingSha256,JournalHeadSha256;
      internal readonly string RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,InstallationBootId;
      internal readonly long EnrollmentGeneration,JournalSequence;
      internal readonly uint RootPid;
      internal readonly DateTime ObservedAtUtc;
      internal readonly bool HistoricalRootBindingCommitted,HistoricalResumeCommitted,HistoricalZeroActiveCommitted,CurrentInstalledReadbackVerified;
      internal readonly bool ExecutionAuthorityGranted=false,RebootAllowed=false;
      readonly SovereignMobileInstallJournalV1.TerminalWitnessV1 terminal;
      readonly MobileInstallQualifiedEnrollmentV1 qualified;
      readonly CoreJobCustodyV1.MobileInstallerReadBackV1 readback;
      readonly string original;
      bool disposed;
      private TerminalReadbackEvidenceV1(SovereignMobileInstallJournalV1.TerminalWitnessV1 source,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 enrollment,
        CoreJobCustodyV1.MobileInstallerReadBackV1 installed) {
        terminal=source;qualified=enrollment;readback=installed;Snapshot=source.Snapshot;
        State=Snapshot.State;ReasonCode=State=="INSTALLED_PENDING_BOOT"?"MOBILE_INSTALL_TERMINAL_READBACK_BOOT_PENDING":Snapshot.ReasonCode;
        RequestId=candidate.RequestId;CandidateSha256=candidate.CandidateSha256;MachineHash=candidate.MachineHash;OperatorSid=candidate.OperatorSid;
        SourceHead=candidate.SourceHead;SourceTree=candidate.SourceTree;PackageSha256=candidate.PackageSha256;ClosureSha256=candidate.ClosureSha256;
        ReleaseProofSha256=candidate.ReleaseProofSha256;CredentialBindingSha256=Snapshot.CredentialBindingSha256;
        EnrollmentGeneration=Snapshot.EnrollmentGeneration;JournalSequence=Snapshot.Sequence;JournalHeadSha256=Snapshot.HeadSha256;
        RootPid=Snapshot.RootPid;RootCreatedAtUtc=Snapshot.RootCreatedAtUtc;ExecutionStartedAtUtc=Snapshot.ExecutionStartedAtUtc;
        InstalledHelperSha256=Snapshot.InstalledHelperSha256;InstallationBootId=Snapshot.InstallationBootId;
        HistoricalRootBindingCommitted=source.HistoricalRootBindingCommitted;HistoricalResumeCommitted=source.HistoricalResumeCommitted;
        HistoricalZeroActiveCommitted=source.HistoricalZeroActiveCommitted;CurrentInstalledReadbackVerified=installed!=null;
        ObservedAtUtc=DateTime.UtcNow;original=Stamp();
      }
      string Stamp() {
        return String.Join("\0",new[]{State,ReasonCode,RequestId,CandidateSha256,MachineHash,OperatorSid,SourceHead,SourceTree,PackageSha256,
          ClosureSha256,ReleaseProofSha256,CredentialBindingSha256,JournalHeadSha256,RootCreatedAtUtc,ExecutionStartedAtUtc,InstalledHelperSha256,
          InstallationBootId,EnrollmentGeneration.ToString(CultureInfo.InvariantCulture),JournalSequence.ToString(CultureInfo.InvariantCulture),
          RootPid.ToString(CultureInfo.InvariantCulture),ObservedAtUtc.Ticks.ToString(CultureInfo.InvariantCulture),HistoricalRootBindingCommitted.ToString(),
          HistoricalResumeCommitted.ToString(),HistoricalZeroActiveCommitted.ToString(),CurrentInstalledReadbackVerified.ToString(),
          ExecutionAuthorityGranted.ToString(),RebootAllowed.ToString()});
      }
      internal bool IsIntact(){try{return !disposed && Snapshot.IsIntact() && original==Stamp();}catch{return false;}}
      static bool QualifiedMatches(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 enrollment) {
        return candidate!=null && candidate.IsIntact() && enrollment!=null && enrollment.IsIntact() && candidate.MachineHash==enrollment.MachineHash &&
          candidate.OperatorSid==enrollment.OperatorSid && candidate.EnrollmentGeneration==enrollment.Generation && candidate.SourceHead==enrollment.SourceHead &&
          candidate.SourceTree==enrollment.SourceTree && candidate.PackageSha256==enrollment.PackageSha256 && candidate.ClosureSha256==enrollment.ClosureSha256 &&
          candidate.ReleaseProofSha256==enrollment.ReleaseProofSha256;
      }
      internal bool IsCurrent(SovereignMobileInstallJournalV1 journal,SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate) {
        try {
          return IsIntact() && QualifiedMatches(candidate,qualified) && qualified.CredentialBindingSha256==CredentialBindingSha256 &&
            terminal.IsCurrent(journal,candidate) && HistoricalZeroActiveCommitted &&
            (State=="FAILED"?readback==null && !CurrentInstalledReadbackVerified:
              State=="INSTALLED_PENDING_BOOT" && HistoricalRootBindingCommitted && HistoricalResumeCommitted && CurrentInstalledReadbackVerified &&
              readback!=null && readback.IsRetained && readback.HelperSha256==InstalledHelperSha256 && readback.BootId==InstallationBootId);
        }catch{return false;}
      }
      // Common private binder permits reflection-only fixtures with explicit
      // native pins; no callback, path, approval or serialized proof is an input.
      private static TerminalReadbackEvidenceV1 Bind(SovereignMobileInstallJournalV1 journal,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 enrollment,
        SovereignMobileInstallJournalV1.TerminalWitnessV1 terminal,CoreJobCustodyV1.MobileInstallerReadBackV1 installed) {
        if(!QualifiedMatches(candidate,enrollment) || terminal==null || !terminal.IsCurrent(journal,candidate) ||
           terminal.Snapshot.CredentialBindingSha256!=enrollment.CredentialBindingSha256)return null;
        var result=new TerminalReadbackEvidenceV1(terminal,candidate,enrollment,installed);
        return result.IsCurrent(journal,candidate)?result:null;
      }
      internal static TerminalReadbackEvidenceV1 Read(SovereignMobileInstallJournalV1 journal,
        SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 enrollment) {
        CoreJobCustodyV1.MobileInstallerReadBackV1 installed=null;
        try {
          if(!QualifiedMatches(candidate,enrollment))return null;
          var terminal=SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(journal,candidate);
          if(terminal==null || terminal.Snapshot.CredentialBindingSha256!=enrollment.CredentialBindingSha256)return null;
          if(terminal.Snapshot.State=="INSTALLED_PENDING_BOOT")
            installed=CoreJobCustodyV1.MobileInstallerReadBackV1.OpenProtected(candidate,terminal.Snapshot.ExecutionStartedAtUtc);
          var result=Bind(journal,candidate,enrollment,terminal,installed);
          if(result!=null)installed=null;return result;
        }catch{return null;}finally{if(installed!=null)installed.Dispose();}
      }
      public void Dispose(){if(disposed)return;disposed=true;if(readback!=null)readback.Dispose();}
    }
    // Same retained journal/qualified owner; no second writer, approval consume,
    // claim, process dispatch or terminal rewrite is allowed by reconciliation.
    internal static TerminalReadbackEvidenceV1 ReconcileProtected(SovereignMobileInstallJournalV1 journal,
      SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,MobileInstallQualifiedEnrollmentV1 qualified) {
      return TerminalReadbackEvidenceV1.Read(journal,candidate,qualified);
    }
  }

  public static partial class CoreJobCustodyV1 {
    internal sealed partial class MobileInstallerReadBackV1 {
      bool disposed;
      internal bool IsRetained {
        get {
          try{return !disposed && pins.Files.Count>0 && pins.Directories.Count>0 &&
            pins.Files.TrueForAll(file=>file.CanRead && !file.SafeFileHandle.IsClosed && !file.SafeFileHandle.IsInvalid) &&
            pins.Directories.TrueForAll(handle=>!handle.IsClosed && !handle.IsInvalid);}
          catch{return false;}
        }
      }
      public void Dispose(){if(disposed)return;disposed=true;pins.Dispose();}
    }
  }
}
