import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';
import { canonicalMobileInstallationReceiptV1, mobileInstallationCandidateDigestV1, mobileInstallationChallengeV1,
  projectMobileInstallationV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';

const runner = String.raw`
namespace Stephanos.Sovereign {
  public static class MobileInstallReceiptFixtureRunnerV1 {
    const System.Reflection.BindingFlags Hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.Instance;
    sealed class Pins:System.IDisposable {public void Dispose(){}}
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
    static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string path,uint access,uint sharing,System.IntPtr security,uint creation,uint flags,System.IntPtr template);
    static string Hash(string text) {using(var sha=System.Security.Cryptography.SHA256.Create())return System.BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    sealed class JournalFixture:System.IDisposable {
      internal readonly SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 Candidate;
      internal readonly SovereignMobileInstallAnchorV1 Anchor;
      internal readonly object Enrollment;
      internal SovereignMobileInstallJournalV1 Journal;
      internal readonly string Birth,Started;
      readonly string path;
      readonly System.Collections.Generic.List<string> readbackFiles=new System.Collections.Generic.List<string>();
      internal JournalFixture(System.Collections.Generic.Dictionary<string,object> input,System.Web.Script.Serialization.JavaScriptSerializer parser) {
        var first=(System.Collections.Generic.Dictionary<string,object>)((object[])input["rows"])[0];
        Candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1((string)first["candidateJson"]);
        var key=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256);
        if(!key.IsEphemeral)throw new System.Exception("FIXTURE_KEY_NOT_EPHEMERAL");
        string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",Hidden).Invoke(null,new object[]{key});
        Enrollment=new System.Collections.Generic.Dictionary<string,object> {
          {"schemaVersion","stephanos.battle-bridge-mobile-installation-enrollment.v1"},{"machineHash",Candidate.MachineHash},
          {"operatorSid",Candidate.OperatorSid},{"generation",Candidate.EnrollmentGeneration},{"rpId","stephanos.example"},
          {"origin","https://bridge.stephanos.example"},{"credentialId","BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH"},
          {"publicKeySpki",input["deviceSpki"]},{"userHandle","b3BlcmF0b3I"},{"lastSignCount",0},{"revoked",false},{"receiptPublicKeySpki",spki}};
        var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(parser.Serialize(Enrollment));
        var events=new System.Collections.Generic.List<MobileInstallAnchorEventV1>();
        Anchor=(SovereignMobileInstallAnchorV1)typeof(SovereignMobileInstallAnchorV1).GetConstructors(Hidden)[0].Invoke(new object[]{
          Candidate.MachineHash,Candidate.OperatorSid,Candidate.EnrollmentGeneration,0u,binding.CredentialBindingSha256,spki,key,new Pins(),
          new System.Func<System.Collections.Generic.List<MobileInstallAnchorEventV1>>(()=>new System.Collections.Generic.List<MobileInstallAnchorEventV1>(events)),
          new System.Action<string>(text=>events.Add(new MobileInstallAnchorEventV1(events.Count+2,text)))});
        string header="STEPHANOS-MOBILE-JOURNAL-V1|"+binding.CredentialBindingSha256+"|1|0";
        string head=Hash("stephanos.mobile-journal-header.v1\0"+header);
        string genesis=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("SignEntry",Hidden).Invoke(Anchor,new object[]{0L,head,new string('0',64)});
        events.Add(new MobileInstallAnchorEventV1(2,genesis));
        path=System.IO.Path.Combine((string)input["fixtureRoot"],"receipt-journal-"+System.Guid.NewGuid().ToString("N")+".wal");
        System.IO.File.WriteAllText(path,header+"|"+head+"\n",new System.Text.UTF8Encoding(false));Reopen();
        var prepared=(MobileInstallJournalObservationV1)typeof(SovereignMobileInstallJournalV1).GetMethod("AppendPreparedV1",Hidden)
          .Invoke(Journal,new object[]{"PREPARE",Candidate});Check(prepared.JournalTransitionRecorded,"PREPARE_NOT_RECORDED");
        var approval=SovereignMobileInstallAssertionV1.Verify(Candidate.CanonicalJson,parser.Serialize(Enrollment),(string)input["assertionJson"],System.DateTime.UtcNow);
        Check(approval.ApprovalVerified,"REAL_ASSERTION_NOT_VERIFIED");Check(Journal.ConsumeVerifiedApproval(approval).JournalTransitionRecorded,"CONSUME_NOT_RECORDED");
        var birth=System.DateTime.UtcNow;Birth=birth.ToString("O",System.Globalization.CultureInfo.InvariantCulture);
        Started=birth.AddMilliseconds(1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture);
      }
      internal void Reopen() {
        if(Journal!=null)Journal.Dispose();
        var file=new System.IO.FileStream(path,System.IO.FileMode.Open,System.IO.FileAccess.ReadWrite,System.IO.FileShare.None);
        Journal=(SovereignMobileInstallJournalV1)typeof(SovereignMobileInstallJournalV1).GetConstructors(Hidden)[0].Invoke(new object[]{
          file,new Pins(),SovereignMobileInstallJournalV1.AnchorChannel.BindProtected(Anchor)});
      }
      internal SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 Evidence(string state,bool resumed=false,bool zero=false,bool released=false,
        string helper=null,string boot=null,string machine=null,long? sequence=null,uint pid=123) {
        var snapshot=Journal.ReceiptSnapshot(Candidate.RequestId,Candidate.CandidateSha256);
        return (SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1)typeof(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1)
          .GetConstructors(Hidden)[0].Invoke(new object[]{state,"MOBILE_INSTALL_EXECUTOR_FIXTURE",Candidate.RequestId,Candidate.CandidateSha256,
          machine??Candidate.MachineHash,Candidate.SourceHead,Candidate.PackageSha256,Candidate.EnrollmentGeneration,sequence??snapshot.Sequence,
          snapshot.HeadSha256,pid,pid==0?null:Birth,resumed?Started:null,true,resumed,zero,released,helper,boot});
      }
      internal MobileInstallQualifiedEnrollmentV1 Qualified(System.Web.Script.Serialization.JavaScriptSerializer parser,string sourceTree=null) {
        // Private data fixture only. No production qualifier or protected root is opened.
        var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(parser.Serialize(Enrollment));
        var fields=new System.Collections.Generic.Dictionary<string,string> {
          {"machineHash",Candidate.MachineHash},{"operatorSid",Candidate.OperatorSid},{"enrollmentGeneration","1"},
          {"sourceHead",Candidate.SourceHead},{"sourceTree",sourceTree??Candidate.SourceTree},{"packageSha256",Candidate.PackageSha256},
          {"closureSha256",Candidate.ClosureSha256},{"releaseProofSha256",Candidate.ReleaseProofSha256},{"bootstrapSha256",new string('6',64)}};
        var permit=new MobileInstallReleaseInspectionV1(true,"SYNTHETIC_RECEIPT_DATA_NOT_QUALIFICATION",fields);
        var files=new MobileInstallEnrollmentFilesV1 {EnrollmentJson=parser.Serialize(Enrollment),Binding=binding};
        return (MobileInstallQualifiedEnrollmentV1)typeof(MobileInstallQualifiedEnrollmentV1).GetConstructors(Hidden)[0]
          .Invoke(new object[]{files,permit,null});
      }
      internal SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1 Terminal(
        System.Web.Script.Serialization.JavaScriptSerializer parser,string helper=null,string boot=null,string sourceTree=null) {
        var terminal=SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(Journal,Candidate);
        CoreJobCustodyV1.MobileInstallerReadBackV1 readback=null;
        if(terminal!=null && terminal.Snapshot.State=="INSTALLED_PENDING_BOOT") {
          // Actual private workspace handles support the data-only readback seam;
          // these synthetic bytes are never claimed to be a protected install.
          string file=System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path),"receipt-readback-"+System.Guid.NewGuid().ToString("N")+".bin");
          System.IO.File.WriteAllText(file,"SYNTHETIC_READBACK_DATA_ONLY");readbackFiles.Add(file);
          var pins=new FixedRuntimeIdentityPinsV1();
          try {
            pins.Files.Add(new System.IO.FileStream(file,System.IO.FileMode.Open,System.IO.FileAccess.Read,System.IO.FileShare.Read));
            var directory=CreateFileW(System.IO.Path.GetDirectoryName(path),0x80,7,System.IntPtr.Zero,3,0x02000000,System.IntPtr.Zero);
            if(directory.IsInvalid){int error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();directory.Dispose();throw new System.Exception("FIXTURE_DIRECTORY_PIN:"+error);}
            pins.Directories.Add(directory);
            readback=(CoreJobCustodyV1.MobileInstallerReadBackV1)typeof(CoreJobCustodyV1.MobileInstallerReadBackV1).GetConstructors(Hidden)[0]
              .Invoke(new object[]{helper??terminal.Snapshot.InstalledHelperSha256,boot??terminal.Snapshot.InstallationBootId,pins});
          }catch{pins.Dispose();throw;}
        }
        var result=(SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1)typeof(SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1)
          .GetMethod("Bind",Hidden).Invoke(null,new object[]{Journal,Candidate,Qualified(parser,sourceTree),terminal,readback});
        if(result==null && readback!=null)readback.Dispose();return result;
      }
      public void Dispose(){try{if(Journal!=null)Journal.Dispose();}finally{Anchor.Dispose();System.IO.File.Delete(path);foreach(string file in readbackFiles)System.IO.File.Delete(file);}}
    }
    static void Check(bool value,string reason){if(!value)throw new System.Exception(reason);}
    static object[] FactoryCases(System.Collections.Generic.Dictionary<string,object> input,System.Web.Script.Serialization.JavaScriptSerializer parser) {
      var rows=new System.Collections.Generic.List<object>();
      using(var f=new JournalFixture(input,parser)) {
        System.Action<string,string,SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1> capture=(name,expected,evidence)=>{
          var receipt=MobileInstallReceiptV1.FromNative(f.Journal,f.Candidate,evidence);Check(receipt.State==expected,"FACTORY_STATE:"+name+":"+receipt.State);
          rows.Add(new{name,expectedState=expected,envelope=f.Anchor.SignReceipt(receipt),enrollment=f.Enrollment,candidateJson=f.Candidate.CanonicalJson});};
        capture("actual journal approval consumption","APPROVAL_RECORDED",null);
        Check(f.Journal.RecordClaim(f.Candidate.RequestId,f.Candidate.CandidateSha256).JournalTransitionRecorded,"CLAIM_NOT_RECORDED");
        capture("actual retained live claim","STARTING",null);
        var suspended=f.Evidence("ROOT_SUSPENDED");Check(f.Journal.RecordSuspendedRoot(suspended).JournalTransitionRecorded,"ROOT_NOT_RECORDED");
        capture("pretransition evidence cannot borrow new head","UNKNOWN",suspended);
        capture("durably bound suspended root","STARTING",f.Evidence("ROOT_SUSPENDED"));
        System.Threading.Thread.Sleep(3);
        var start=f.Evidence("INSTALLING",true);Check(f.Journal.RecordStarted(start).JournalTransitionRecorded,"START_NOT_RECORDED");
        capture("journal start alone is not fresh native execution","UNKNOWN",null);
        capture("exact started native evidence","INSTALLING",f.Evidence("INSTALLING",true));
        capture("wrong machine producer cannot borrow a sequence","UNKNOWN",f.Evidence("INSTALLING",true,false,false,null,null,new string('f',64)));
        var weak=f.Evidence("INSTALLED_PENDING_BOOT",true,false,false,new string('8',64),new string('9',64));
        Check(!f.Journal.RecordInstalledPendingBoot(weak).JournalTransitionRecorded,"UNPROVEN_INSTALL_RECORDED");
        capture("missing native zero-active and custody proof","UNKNOWN",weak);
        var installed=f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('8',64),new string('9',64));
        Check(f.Journal.RecordInstalledPendingBoot(installed).JournalTransitionRecorded,"INSTALL_READBACK_NOT_RECORDED");
        capture("terminal WAL alone is not fresh installed readback","UNKNOWN",null);
        capture("exact terminal native readback remains pending boot","INSTALLED_PENDING_BOOT",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('8',64),new string('9',64)));
        capture("different retained PID cannot borrow signed WAL head","UNKNOWN",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('8',64),new string('9',64),null,null,124));
        capture("different helper digest cannot borrow signed WAL head","UNKNOWN",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('f',64),new string('9',64)));
        capture("different boot identity cannot borrow signed WAL head","UNKNOWN",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('8',64),new string('f',64)));
        capture("installed receipt requires current helper digest","UNKNOWN",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,null,new string('9',64)));
        capture("installed receipt requires installation boot identity","UNKNOWN",f.Evidence("INSTALLED_PENDING_BOOT",true,true,true,new string('8',64),null));
        f.Reopen();capture("reloaded terminal requires fresh native evidence","UNKNOWN",null);
        System.Action<string,string,SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1> recovered=(name,expected,evidence)=>{
          var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,evidence);Check(receipt.State==expected,"READBACK_STATE:"+name+":"+receipt.State);
          rows.Add(new{name,expectedState=expected,envelope=f.Anchor.SignReceipt(receipt),enrollment=f.Enrollment,candidateJson=f.Candidate.CanonicalJson});};
        using(var proof=f.Terminal(parser)) {
          Check(proof!=null,"REPLAYED_TERMINAL_BINDER_REFUSED");
          recovered("replayed R2 plus retained synthetic readback signs pending","INSTALLED_PENDING_BOOT",proof);
          var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);proof.Dispose();
          recovered("disposed readback cannot refresh terminal truth","UNKNOWN",proof);
          bool denied=false;try{f.Anchor.SignReceipt(receipt);}catch(System.InvalidOperationException){denied=true;}
          Check(denied,"DISPOSED_PROOF_SIGNED_AFTER_PROJECTION");
        }
        recovered("different current helper cannot recover terminal","UNKNOWN",f.Terminal(parser,new string('f',64)));
        recovered("different installation boot cannot recover terminal","UNKNOWN",f.Terminal(parser,null,new string('f',64)));
        recovered("different qualified release cannot recover terminal","UNKNOWN",f.Terminal(parser,null,null,new string('f',40)));
        foreach(int seconds in new[]{-121,5})using(var proof=f.Terminal(parser)) {
          var type=typeof(SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1);
          type.GetField("ObservedAtUtc",Hidden).SetValue(proof,System.DateTime.UtcNow.AddSeconds(seconds));
          // Exercise receipt freshness independently of the private proof stamp.
          type.GetField("original",Hidden).SetValue(proof,type.GetMethod("Stamp",Hidden).Invoke(proof,null));
          recovered(seconds<0?"old readback does not renew itself":"future readback cannot be projected","UNKNOWN",proof);
        }
        using(var proof=f.Terminal(parser)) {
          var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);f.Reopen();
          recovered("reopened journal cannot borrow prior owner's readback","UNKNOWN",proof);
          bool denied=false;try{f.Anchor.SignReceipt(receipt);}catch(System.InvalidOperationException){denied=true;}
          Check(denied,"PRIOR_OWNER_PROOF_SIGNED_AFTER_REOPEN");
        }
      }
      foreach(bool boundRoot in new[]{false,true})using(var f=new JournalFixture(input,parser)) {
        Check(f.Journal.RecordClaim(f.Candidate.RequestId,f.Candidate.CandidateSha256).JournalTransitionRecorded,"FAILED_CLAIM_NOT_RECORDED");
        if(boundRoot)Check(f.Journal.RecordSuspendedRoot(f.Evidence("ROOT_SUSPENDED")).JournalTransitionRecorded,"FAILED_ROOT_NOT_RECORDED");
        Check(f.Journal.RecordFailed(f.Evidence("FAILED",false,true,true)).JournalTransitionRecorded,"FAILED_TERMINAL_NOT_RECORDED");f.Reopen();
        using(var proof=f.Terminal(parser)) {
          Check(proof!=null,"FAILED_REPLAY_BINDER_REFUSED");var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);
          Check(receipt.State=="FAILED","FAILED_REPLAY_LOST");
          Check(receipt.CanonicalPayload.Contains(boundRoot?"\"retainedProcessId\":123":"\"retainedProcessId\":null"),"UNCOMMITTED_ROOT_PROJECTED_AS_KNOWN");
          rows.Add(new{name=boundRoot?"replayed failure retains only committed root":"replayed failure does not invent root binding",expectedState="FAILED",
            envelope=f.Anchor.SignReceipt(receipt),enrollment=f.Enrollment,candidateJson=f.Candidate.CanonicalJson});
        }
      }
      return rows.ToArray();
    }
    public static string Run(string wire) {
      var parser=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=1048576,RecursionLimit=16};
      var input=(System.Collections.Generic.Dictionary<string,object>)parser.DeserializeObject(wire);
      var output=new System.Collections.Generic.List<object>();
      foreach(object item in (object[])input["rows"]) {
        var row=(System.Collections.Generic.Dictionary<string,object>)item;string envelope=null,canonical=null,reason="";
        string digest=null,challenge=null;object enrolled=null;
        try {
          var candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1((string)row["candidateJson"]);
          digest=candidate.CandidateSha256;challenge=candidate.Challenge;
          using(var key=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256)) {
            if(!key.IsEphemeral)throw new System.Exception("FIXTURE_KEY_NOT_EPHEMERAL");
            string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",Hidden).Invoke(null,new object[]{key});
            var enrollment=new System.Collections.Generic.Dictionary<string,object> {
              {"schemaVersion","stephanos.battle-bridge-mobile-installation-enrollment.v1"},{"machineHash",candidate.MachineHash},
              {"operatorSid",candidate.OperatorSid},{"generation",candidate.EnrollmentGeneration},{"rpId","stephanos.example"},
              {"origin","https://bridge.stephanos.example"},{"credentialId","BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH"},
              {"publicKeySpki",input["deviceSpki"]},{"userHandle","b3BlcmF0b3I"},{"lastSignCount",0},{"revoked",false},{"receiptPublicKeySpki",spki}};
            enrolled=enrollment;var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(parser.Serialize(enrollment));
            var events=new System.Collections.Generic.List<MobileInstallAnchorEventV1>();
            string machine=(string)row["anchorMachine"],sid=(string)row["anchorSid"];long generation=System.Convert.ToInt64(row["anchorGeneration"]);
            var anchor=(SovereignMobileInstallAnchorV1)typeof(SovereignMobileInstallAnchorV1).GetConstructors(Hidden)[0].Invoke(new object[]{
              machine,sid,generation,0u,binding.CredentialBindingSha256,spki,key,new Pins(),
              new System.Func<System.Collections.Generic.List<MobileInstallAnchorEventV1>>(()=>new System.Collections.Generic.List<MobileInstallAnchorEventV1>(events)),
              new System.Action<string>(text=>{throw new System.Exception("UNEXPECTED_EVENT_WRITE");})});
            using(anchor) {
              string previous=new string('0',64);long last=System.Convert.ToInt64(row["anchorSequence"]);
              for(long seq=0;seq<=last;seq++) {
                string head=seq==last?(string)row["anchorHead"]:Hash("receipt-fixture-head-"+seq);
                string entry=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("SignEntry",Hidden).Invoke(anchor,new object[]{seq,head,previous});
                events.Add(new MobileInstallAnchorEventV1(seq+2,entry));previous=Hash(entry);
              }
              var now=System.DateTime.ParseExact((string)row["observedAtUtc"],"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal|System.Globalization.DateTimeStyles.AdjustToUniversal);
              uint? pid=row["pid"]==null?(uint?)null:System.Convert.ToUInt32(row["pid"]);
              System.Reflection.ConstructorInfo receiptConstructor=null;
              foreach(var ctor in typeof(MobileInstallReceiptV1).GetConstructors(Hidden))if(ctor.GetParameters().Length==11)receiptConstructor=ctor;
              Check(receiptConstructor!=null,"RECEIPT_FIXTURE_CONSTRUCTOR_UNPROVEN");
              var receipt=(MobileInstallReceiptV1)receiptConstructor.Invoke(new object[]{candidate,binding.CredentialBindingSha256,
                row["state"],row["reason"],System.Convert.ToInt64(row["sequence"]),row["head"],now,pid,row["started"],row["helper"],row["boot"]});
              if((string)row["tamper"]=="payload")typeof(MobileInstallReceiptV1).GetField("CanonicalPayload",Hidden).SetValue(receipt,receipt.CanonicalPayload.Replace("APPROVAL_RECORDED","AWAITING_APPROVAL"));
              if((string)row["tamper"]=="candidate")typeof(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1).GetField("CandidateSha256",Hidden).SetValue(candidate,new string('f',64));
              canonical=receipt.CanonicalPayload;envelope=anchor.SignReceipt(receipt);
            }
          }
        } catch(System.Exception error) {
          while(error is System.Reflection.TargetInvocationException && error.InnerException!=null)error=error.InnerException;
          reason=error is System.InvalidOperationException?error.Message:error.GetType().Name;
        }
        output.Add(new {name=(string)row["name"],envelope,canonical,reason,candidateSha256=digest,challenge,enrollment=enrolled});
      }
      var receiptType=typeof(MobileInstallReceiptV1);
      foreach(var ctor in receiptType.GetConstructors(Hidden))if(!ctor.IsPrivate)throw new System.Exception("RECEIPT_CONSTRUCTION_EXPOSED");
      return parser.Serialize(new {rows=output,factory=FactoryCases(input,parser)});
    }
  }
}`;

function fixtures() {
  const now = Date.now(), iso = ms => new Date(ms).toISOString();
  const candidate = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-candidate.v1',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1814, action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1',
    requestId: 'mobile-install-receipt-fixture-1234', nonce: '1'.repeat(64), machineHash: '2'.repeat(64),
    operatorSid: 'S-1-5-21-1-2-3-1001', sourceHead: 'a'.repeat(40), sourceTree: 'b'.repeat(40),
    packageSha256: '3'.repeat(64), closureSha256: '4'.repeat(64), releaseProofSha256: '5'.repeat(64),
    enrollmentGeneration: 1, requestedAtUtc: iso(now - 10_000), expiresAtUtc: iso(now + 240_000) };
  const rows = [];
  const add = (name, mutate = () => {}, valid = false, state = 'APPROVAL_RECORDED') => {
    const row = { name, candidate: structuredClone(candidate), state, reason: 'MOBILE_INSTALL_NATIVE_FIXTURE',
      sequence: 3, head: '7'.repeat(64), anchorSequence: 3, anchorHead: '7'.repeat(64),
      anchorMachine: candidate.machineHash, anchorSid: candidate.operatorSid, anchorGeneration: 1,
      observedAtUtc: iso(now), pid: null, started: null, helper: null, boot: null, tamper: null, valid };
    mutate(row); row.candidateJson ??= JSON.stringify(row.candidate); rows.push(row);
  };
  add('native approval recorded', () => {}, true);
  add('native awaiting approval', () => {}, true, 'AWAITING_APPROVAL');
  add('native starting without execution claim', r => { r.pid = 123; }, true, 'STARTING');
  add('native installing requires actual resume fields', r => { r.pid = 123; r.started = iso(now - 1000); }, true, 'INSTALLING');
  add('native installed remains pending later boot', r => { r.pid = 123; r.started = iso(now - 1000); r.helper = '8'.repeat(64); r.boot = '9'.repeat(64); }, true, 'INSTALLED_PENDING_BOOT');
  add('native failed with proven start', r => { r.pid = 123; r.started = iso(now - 1000); }, true, 'FAILED');
  add('native cancelled before execution', () => {}, true, 'CANCELLED');
  add('native blocked before execution', () => {}, true, 'BLOCKED');
  add('native unknown preserves observed start facts', r => { r.pid = 123; r.started = iso(now - 1000); }, true, 'UNKNOWN');
  add('historical candidate remains bound after approval expiry', r => {
    r.candidate.requestedAtUtc = iso(now - 600_000); r.candidate.expiresAtUtc = iso(now - 300_000);
  }, true);
  add('canonical candidate ignores property order', r => {
    r.candidateJson = JSON.stringify(Object.fromEntries(Object.entries(r.candidate).reverse()));
  }, true);
  add('expired candidate cannot reopen approval', r => {
    r.candidate.requestedAtUtc = iso(now - 600_000); r.candidate.expiresAtUtc = iso(now - 300_000);
  }, false, 'AWAITING_APPROVAL');
  add('READY is never producible', () => {}, false, 'READY');
  add('wrong native machine binding', r => { r.anchorMachine = 'f'.repeat(64); });
  add('wrong native operator binding', r => { r.anchorSid = 'S-1-5-21-1-2-3-1002'; });
  add('wrong native generation binding', r => { r.anchorGeneration = 2; });
  add('wrong journal head', r => { r.head = '8'.repeat(64); });
  add('old journal sequence', r => { r.sequence = 2; });
  add('uncommitted journal sequence', r => { r.sequence = 4; });
  add('zero receipt sequence', r => { r.sequence = 0; });
  add('unsafe receipt integer', r => { r.sequence = 2 ** 53; });
  add('future native observation', r => { r.observedAtUtc = iso(now + 60_000); });
  add('stale native observation', r => {
    r.candidate.requestedAtUtc = iso(now - 240_000); r.candidate.expiresAtUtc = iso(now + 60_000); r.observedAtUtc = iso(now - 121_000);
  });
  add('installing without root', r => { r.started = iso(now - 1000); }, false, 'INSTALLING');
  add('installing without start', r => { r.pid = 123; }, false, 'INSTALLING');
  add('installed without native byte readback', r => { r.pid = 123; r.started = iso(now - 1000); r.boot = '9'.repeat(64); }, false, 'INSTALLED_PENDING_BOOT');
  add('installed without installation boot', r => { r.pid = 123; r.started = iso(now - 1000); r.helper = '8'.repeat(64); }, false, 'INSTALLED_PENDING_BOOT');
  add('starting cannot claim resumed execution', r => { r.pid = 123; r.started = iso(now - 1000); }, false, 'STARTING');
  add('preapproval cannot carry execution facts', r => { r.pid = 123; }, false, 'AWAITING_APPROVAL');
  add('unknown cannot assert partial installed health', r => { r.helper = '8'.repeat(64); }, false, 'UNKNOWN');
  add('reason cannot carry private paths', r => { r.reason = 'C:\\private\\secret'; });
  add('tampered typed payload cannot be signed', r => { r.tamper = 'payload'; });
  add('tampered typed candidate cannot be signed', r => { r.tamper = 'candidate'; });
  add('duplicate candidate keys fail closed', r => { r.candidateJson = JSON.stringify(r.candidate).replace('"issueNumber":1814', '"issueNumber":1814,"issueNumber":1814'); });
  add('unknown candidate authority fields fail closed', r => { r.candidate.approved = true; });
  add('candidate metadata byte limit', r => { r.candidateJson = ' '.repeat(4096) + JSON.stringify(r.candidate); });
  return rows;
}

test('typed native receipts sign exact shared canonical payloads through CNG without READY or generic signing authority',
  { skip: process.platform !== 'win32', timeout: 40_000 }, t => {
    const rows = fixtures();
    const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const deviceSpki = device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-receipt-fixture-'));
    const source = join(root, 'receipt-fixture.cs'), input = join(root, 'receipt-fixtures.json');
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    try {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(rows[0].candidate), origin: 'https://bridge.stephanos.example' }));
      const auth = Buffer.concat([createHash('sha256').update('stephanos.example').digest(), Buffer.from([5, 0, 0, 0, 1])]);
      const assertion = { type: 'public-key', id: Buffer.alloc(24, 7).toString('base64url'), rawId: Buffer.alloc(24, 7).toString('base64url'), response: {
        clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
        signature: sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), device.privateKey).toString('base64url'), userHandle: null } };
      writeFileSync(input, JSON.stringify({ rows, deviceSpki, fixtureRoot: root, assertionJson: JSON.stringify(assertion) }));
      writeFileSync(source, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + runner);
      const script = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop;` +
        `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${literal(source)})) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileInstallReceiptFixtureRunnerV1]::Run([IO.File]::ReadAllText(${literal(input)})))`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 35_000, maxBuffer: 512 * 1024 });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      const native = JSON.parse(result.stdout), observations = native.rows; assert.equal(observations.length, rows.length);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], observed = observations[i];
        assert.equal(observed.name, row.name);
        assert.equal(observed.envelope !== null, row.valid, `${row.name}: ${observed.reason}`);
        if (!row.valid) continue;
        const receipt = JSON.parse(observed.envelope);
        assert.equal(observed.candidateSha256, mobileInstallationCandidateDigestV1(row.candidate), row.name);
        assert.equal(observed.challenge, mobileInstallationChallengeV1(row.candidate), row.name);
        assert.equal(observed.canonical, canonicalMobileInstallationReceiptV1(receipt.payload), row.name);
        const projection = projectMobileInstallationV1({ candidate: row.candidate, enrollment: observed.enrollment, receipt }, { minimumSequence: row.sequence });
        assert.equal(projection.receiptVerified, true, `${row.name}: ${projection.blockers}`);
        assert.equal(projection.state, row.state, row.name);
        assert.equal(projection.executionAuthorityGranted, false, row.name);
        assert.equal(receipt.payload.qualifiedBootId, null, row.name);
        const forged = structuredClone(receipt); forged.payload.state = 'READY';
        assert.equal(projectMobileInstallationV1({ candidate: row.candidate, enrollment: observed.enrollment, receipt: forged }).state, 'UNKNOWN', row.name);
      }
      for (const row of native.factory) {
        const receipt = JSON.parse(row.envelope), candidate = JSON.parse(row.candidateJson);
        const projection = projectMobileInstallationV1({ candidate, enrollment: row.enrollment, receipt }, { minimumSequence: receipt.payload.sequence });
        assert.equal(projection.receiptVerified, true, `${row.name}: ${projection.blockers}`);
        assert.equal(projection.state, row.expectedState, row.name);
        assert.equal(receipt.payload.qualifiedBootId, null, row.name);
      }
      t.diagnostic(`${rows.length} native receipt cases plus ${native.factory.length} actual retained-journal factory cases; ` +
        `${rows.filter(row => row.valid).length + native.factory.length} CNG signatures verified by shared JavaScript projection; no production key/log access`);
    } finally {
      for (const path of [source, input]) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      rmdirSync(root);
    }
  });
