// Prepared requests extend the SAME authenticated journal. No second store,
// queue, owner or key. A new request is native-generated and durably anchored
// before it can leave the native owner. Interrupted/claimed work is never reset.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Globalization;
  using System.Security.Cryptography;
  using System.Text;

  internal sealed partial class SovereignMobileInstallJournalV1 {
    sealed class PreparedRequestV1 {
      internal SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 Candidate;
      internal bool Cancelled;
    }
    readonly Dictionary<string,PreparedRequestV1> preparedRequestsV1=new Dictionary<string,PreparedRequestV1>(StringComparer.Ordinal);
    string currentPreparedV1;
    string PreparedStateForReceiptV1(string request,string digest) {
      PreparedRequestV1 value;
      return preparedRequestsV1.TryGetValue(request,out value) && value.Candidate.IsIntact() && value.Candidate.CandidateSha256==digest
        ?(value.Cancelled?"CANCELLED":"PREPARED"):"UNKNOWN";
    }
    bool PreparedCancelledV1(string request) {
      RequestState consumed;
      if(requests.TryGetValue(request,out consumed))return consumed.State=="CANCELLED";
      PreparedRequestV1 prepared;return preparedRequestsV1.TryGetValue(request,out prepared) && prepared.Cancelled;
    }
    void ApplyPreparedRecordV1(string line,bool change) {
      if(line==null || line.Length>4096)Deny("MOBILE_JOURNAL_PREPARE_BOUND");
      string[] row=line.Split('|');
      if(row.Length!=10 || row[0]!="R3" || Number(row[1],MaximumRecords)!=sequence+1 || row[2]!=head ||
         !Request(row[4]) || !Digest(row[5]) || Number(row[6],SafeInteger)!=generation || row[7]!=credential || !Digest(row[9]) ||
         Hash("stephanos.mobile-journal-prepared.v1\0"+String.Join("|",row,0,9))!=row[9])Deny("MOBILE_JOURNAL_PREPARE_INVALID");
      PreparedRequestV1 existing;
      if(row[3]=="PREPARE") {
        if(preparedRequestsV1.Count>=MaximumRequests || preparedRequestsV1.ContainsKey(row[4]) || requests.ContainsKey(row[4]) ||
           (currentPreparedV1!=null && !PreparedCancelledV1(currentPreparedV1)) || row[8].Length>3072)
          Deny("MOBILE_JOURNAL_PREPARE_REPLAY_OR_CUSTODY");
        byte[] bytes=Convert.FromBase64String(row[8]);
        if(bytes.Length>2048 || Convert.ToBase64String(bytes)!=row[8])Deny("MOBILE_JOURNAL_PREPARE_ENCODING");
        string json=Utf8.GetString(bytes);var candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1(json);
        if(candidate==null || !candidate.IsIntact() || candidate.CanonicalJson!=json || candidate.RequestId!=row[4] ||
           candidate.CandidateSha256!=row[5] || candidate.EnrollmentGeneration!=generation)Deny("MOBILE_JOURNAL_PREPARE_BINDING");
        if(change){preparedRequestsV1.Add(row[4],new PreparedRequestV1{Candidate=candidate});currentPreparedV1=row[4];}
      } else if(row[3]=="CANCEL_PREPARED") {
        if(row[8]!="-" || requests.ContainsKey(row[4]) || !preparedRequestsV1.TryGetValue(row[4],out existing) ||
           existing.Cancelled || existing.Candidate.CandidateSha256!=row[5])Deny("MOBILE_JOURNAL_PREPARE_CANCEL_INVALID");
        if(change)preparedRequestsV1[row[4]].Cancelled=true;
      } else Deny("MOBILE_JOURNAL_PREPARE_ACTION");
      if(change){sequence++;head=row[9];}
    }
    MobileInstallJournalObservationV1 AppendPreparedV1(string action,
      SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate) {
      string payload=action=="PREPARE"?Convert.ToBase64String(Utf8.GetBytes(candidate.CanonicalJson)):"-";
      string body="R3|"+(sequence+1).ToString(CultureInfo.InvariantCulture)+"|"+head+"|"+action+"|"+candidate.RequestId+"|"+
        candidate.CandidateSha256+"|"+generation.ToString(CultureInfo.InvariantCulture)+"|"+credential+"|"+payload;
      string next=Hash("stephanos.mobile-journal-prepared.v1\0"+body),line=body+"|"+next;ApplyPreparedRecordV1(line,false);
      return CommitEncodedRecordV1(line,next,candidate.RequestId,candidate.CandidateSha256);
    }
    static bool PreparedMatchesQualifiedV1(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,
      MobileInstallQualifiedEnrollmentV1 qualified) {
      return candidate!=null && candidate.IsIntact() && qualified!=null && qualified.IsIntact() &&
        candidate.MachineHash==qualified.MachineHash && candidate.OperatorSid==qualified.OperatorSid &&
        candidate.EnrollmentGeneration==qualified.Generation && candidate.SourceHead==qualified.SourceHead && candidate.SourceTree==qualified.SourceTree &&
        candidate.PackageSha256==qualified.PackageSha256 && candidate.ClosureSha256==qualified.ClosureSha256 &&
        candidate.ReleaseProofSha256==qualified.ReleaseProofSha256;
    }
    static string PreparedRandomV1(int count) {
      byte[] bytes=new byte[count];using(var random=RandomNumberGenerator.Create())random.GetBytes(bytes);
      return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();
    }
    // No browser-chosen target/source/package/path/nonce or renewal. Existing
    // uncertain, expired and terminal originals remain the reconciliation key.
    internal SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 PrepareNative(MobileInstallQualifiedEnrollmentV1 qualified) {
      lock(sync){
        Healthy();
        if(qualified==null || !qualified.IsIntact() || qualified.Generation!=generation || qualified.CredentialBindingSha256!=credential)
          Deny("MOBILE_JOURNAL_PREPARE_QUALIFIED_ENROLLMENT_REQUIRED");
        if(currentPreparedV1!=null && !PreparedCancelledV1(currentPreparedV1)) {
          var existing=LoadPreparedCandidate(currentPreparedV1);
          if(!PreparedMatchesQualifiedV1(existing,qualified))Deny("MOBILE_JOURNAL_PREPARE_RELEASE_MOVED");return existing;
        }
        // Legacy consumed claims without a prepared record remain held; they
        // cannot silently disappear merely because this source adds PREPARE.
        foreach(var old in requests)if(!preparedRequestsV1.ContainsKey(old.Key) && old.Value.State!="CANCELLED")
          Deny("MOBILE_JOURNAL_LEGACY_ORIGINAL_RECONCILIATION_REQUIRED");
        DateTime now=DateTime.UtcNow;now=new DateTime(now.Ticks-(now.Ticks%TimeSpan.TicksPerMillisecond),DateTimeKind.Utc);
        string request="mobile-install-"+PreparedRandomV1(16),nonce=PreparedRandomV1(32);
        string json="{\"schemaVersion\":\"stephanos.battle-bridge-mobile-installation-candidate.v1\",\"repository\":\"Cheekyfellastef/stephan-os\",\"issueNumber\":1814,"+
          "\"action\":\"INSTALL_SOVEREIGN_FIXED_RUNTIME_V1\",\"requestId\":\""+request+"\",\"nonce\":\""+nonce+"\",\"machineHash\":\""+qualified.MachineHash+
          "\",\"operatorSid\":\""+qualified.OperatorSid+"\",\"sourceHead\":\""+qualified.SourceHead+"\",\"sourceTree\":\""+qualified.SourceTree+
          "\",\"packageSha256\":\""+qualified.PackageSha256+"\",\"closureSha256\":\""+qualified.ClosureSha256+"\",\"releaseProofSha256\":\""+qualified.ReleaseProofSha256+
          "\",\"enrollmentGeneration\":"+qualified.Generation.ToString(CultureInfo.InvariantCulture)+",\"requestedAtUtc\":\""+
          now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)+"\",\"expiresAtUtc\":\""+
          now.AddMinutes(5).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",CultureInfo.InvariantCulture)+"\"}";
        var candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1(json);
        var durable=AppendPreparedV1("PREPARE",candidate);
        if(durable==null || !durable.JournalTransitionRecorded || durable.State!="PREPARED")Deny("MOBILE_JOURNAL_PREPARE_COMMIT_UNPROVEN");
        return candidate;
      }
    }
    internal SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 LoadPreparedCandidate(string requestId) {
      lock(sync){Healthy();PreparedRequestV1 prepared;
        if(!Request(requestId) || !preparedRequestsV1.TryGetValue(requestId,out prepared) || !prepared.Candidate.IsIntact())
          Deny("MOBILE_JOURNAL_PREPARED_REQUEST_UNPROVEN");return preparedRequestsV1[requestId].Candidate;
      }
    }
    internal MobileInstallJournalObservationV1 CancelPrepared(string requestId) {
      lock(sync){Healthy();var candidate=LoadPreparedCandidate(requestId);RequestState consumed;
        if(requests.TryGetValue(requestId,out consumed)) {
          if(consumed.State=="APPROVAL_CONSUMED" || consumed.State=="CLAIM_RECORDED" || consumed.State=="STARTING" || consumed.State=="INSTALLING")
            return Cancel(requestId,candidate.CandidateSha256);
          return ReceiptObservation(requestId,candidate.CandidateSha256);
        }
        if(preparedRequestsV1[requestId].Cancelled)return Observation("CANCELLED","MOBILE_JOURNAL_PREPARED_CANCELLED",requestId,candidate.CandidateSha256);
        return AppendPreparedV1("CANCEL_PREPARED",candidate);
      }
    }
  }
}
