import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { mobileInstallationChallengeV1, projectMobileInstallationV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

const hash = value => createHash('sha256').update(value).digest();
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
function fixture(index) {
  const now = Date.now();
  const candidate = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-candidate.v1', repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1814, action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1', requestId: `mobile-install-reconcile-fixture-${index}`,
    nonce: String(index).repeat(64), machineHash: '2'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001', sourceHead: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40), packageSha256: '3'.repeat(64), closureSha256: '4'.repeat(64), releaseProofSha256: '5'.repeat(64),
    enrollmentGeneration: 1, requestedAtUtc: new Date(now - 1000).toISOString(), expiresAtUtc: new Date(now + 240_000).toISOString() };
  const enrollment = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1', machineHash: candidate.machineHash,
    operatorSid: candidate.operatorSid, generation: 1, rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example',
    credentialId: Buffer.alloc(24, 7).toString('base64url'), publicKeySpki: device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    userHandle: Buffer.from('fixture-operator').toString('base64url'), lastSignCount: 0, revoked: false,
    receiptPublicKeySpki: device.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') };
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(candidate), origin: enrollment.origin, crossOrigin: false }));
  const auth = Buffer.concat([hash(enrollment.rpId), Buffer.from([5]), Buffer.alloc(4)]); auth.writeUInt32BE(index, 33);
  const assertion = { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId, response: {
    clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
    signature: sign('sha256', Buffer.concat([auth, hash(client)]), device.privateKey).toString('base64url'), userHandle: null } };
  return { candidateJson: JSON.stringify(candidate), enrollmentJson: JSON.stringify(enrollment), assertionJson: JSON.stringify(assertion) };
}

// The fixture uses actual NTFS handles, exclusive WAL replay and Windows CNG.
// Only private constructors bind synthetic qualified/readback data to those
// workspace pins. No production enrollment/store/installer/child is invoked.
const harness = String.raw`
namespace Stephanos.Sovereign {
  public static partial class CoreJobCustodyV1 {
    internal static MobileInstallJournalStorageV1 ReconciliationFixtureStorage(string path) {
      var dirs=new System.Collections.Generic.List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
      Microsoft.Win32.SafeHandles.SafeFileHandle handle=null;System.IO.FileStream file=null;
      try {
        try{PinDirectoryChain(System.IO.Path.GetDirectoryName(path),dirs);}catch{throw new System.Exception("FIXTURE_PARENT_PIN_FAILED_"+System.Runtime.InteropServices.Marshal.GetLastWin32Error());}
        handle=CreateFileW(path,0xc0000000u,0u,System.IntPtr.Zero,3u,0x80200000u,System.IntPtr.Zero);FILE_INFO info;
        if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 || info.links!=1 || info.sizeHigh!=0 || info.sizeLow<1)
          throw new System.Exception("FIXTURE_NTFS_WAL_IDENTITY_UNPROVEN");
        var fs=new System.Text.StringBuilder(16);uint serial,component,flags;
        if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out component,out flags,fs,16) || fs.ToString()!="NTFS")throw new System.Exception("FIXTURE_NTFS_REQUIRED");
        file=new System.IO.FileStream(handle,System.IO.FileAccess.ReadWrite,4096,false);handle=null;return new MobileInstallJournalStorageV1(file,dirs);
      }catch{if(file!=null)file.Dispose();if(handle!=null)handle.Dispose();foreach(var dir in dirs)dir.Dispose();throw;}
    }
    internal static FixedRuntimeIdentityPinsV1 ReconciliationFixturePins(string path) {
      var pins=new FixedRuntimeIdentityPinsV1();
      try{PinDirectoryChain(System.IO.Path.GetDirectoryName(path),pins.Directories);pins.Files.Add(new System.IO.FileStream(path,System.IO.FileMode.Open,System.IO.FileAccess.Read,System.IO.FileShare.Read));return pins;}
      catch{int code=System.Runtime.InteropServices.Marshal.GetLastWin32Error();pins.Dispose();throw new System.Exception("FIXTURE_READBACK_PARENT_PIN_FAILED_"+code);}
    }
  }
  public static class MobileReconciliationFixtureRunnerV1 {
    const System.Reflection.BindingFlags Hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.Instance;
    sealed class Pins:System.IDisposable{public void Dispose(){}}
    static string Hash(string text){using(var sha=System.Security.Cryptography.SHA256.Create())return System.BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    static void Check(bool okay,string reason){if(!okay)throw new System.Exception(reason);}
    sealed class Fixture:System.IDisposable {
      internal readonly SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 Candidate;
      internal readonly SovereignMobileInstallAnchorV1 Anchor;
      internal readonly MobileInstallQualifiedEnrollmentV1 Qualified;
      internal readonly System.Collections.Generic.Dictionary<string,object> Enrollment;
      internal readonly System.Collections.Generic.List<MobileInstallAnchorEventV1> Events=new System.Collections.Generic.List<MobileInstallAnchorEventV1>();
      internal readonly string Wal,Installed,Helper,Boot=new string('9',64),Birth,Started;
      internal SovereignMobileInstallJournalV1 Journal;
      readonly string root;
      readonly System.Web.Script.Serialization.JavaScriptSerializer parser;
      internal Fixture(System.Collections.Generic.Dictionary<string,object> input) {
        parser=new System.Web.Script.Serialization.JavaScriptSerializer();root=System.IO.Path.Combine((string)input["root"],System.Guid.NewGuid().ToString("N"));System.IO.Directory.CreateDirectory(root);
        var row=(System.Collections.Generic.Dictionary<string,object>)((object[])input["rows"])[0];
        Candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1((string)row["candidateJson"]);
        var key=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256);Check(key.IsEphemeral,"FIXTURE_KEY_PERSISTENT");
        string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",Hidden).Invoke(null,new object[]{key});
        Enrollment=(System.Collections.Generic.Dictionary<string,object>)parser.DeserializeObject((string)row["enrollmentJson"]);Enrollment["receiptPublicKeySpki"]=spki;
        var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(parser.Serialize(Enrollment));
        Anchor=(SovereignMobileInstallAnchorV1)typeof(SovereignMobileInstallAnchorV1).GetConstructors(Hidden)[0].Invoke(new object[]{Candidate.MachineHash,Candidate.OperatorSid,1L,0u,binding.CredentialBindingSha256,spki,key,new Pins(),
          new System.Func<System.Collections.Generic.List<MobileInstallAnchorEventV1>>(()=>new System.Collections.Generic.List<MobileInstallAnchorEventV1>(Events)),
          new System.Action<string>(text=>Events.Add(new MobileInstallAnchorEventV1(Events.Count+2,text)))});
        string header=SovereignMobileInstallJournalV1.CreateEnrollmentHeaderV1(binding),head=header.TrimEnd('\n').Split('|')[4];
        Events.Add(new MobileInstallAnchorEventV1(2,(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("SignEntry",Hidden).Invoke(Anchor,new object[]{0L,head,new string('0',64)})));
        Wal=System.IO.Path.Combine(root,"approval-journal.wal");System.IO.File.WriteAllText(Wal,header,new System.Text.UTF8Encoding(false));
        Installed=System.IO.Path.Combine(root,"fixture-installed-bytes.bin");System.IO.File.WriteAllText(Installed,"benign exact installed fixture",new System.Text.UTF8Encoding(false));Helper=Hash("benign exact installed fixture");
        var releaseFields=new System.Collections.Generic.Dictionary<string,string>{{"machineHash",Candidate.MachineHash},{"operatorSid",Candidate.OperatorSid},{"enrollmentGeneration","1"},
          {"sourceHead",Candidate.SourceHead},{"sourceTree",Candidate.SourceTree},{"packageSha256",Candidate.PackageSha256},{"closureSha256",Candidate.ClosureSha256},{"releaseProofSha256",Candidate.ReleaseProofSha256},{"bootstrapSha256",new string('8',64)}};
        var files=new MobileInstallEnrollmentFilesV1{EnrollmentJson=parser.Serialize(Enrollment),Binding=binding,HelperBytes=new byte[0],Pins=CoreJobCustodyV1.ReconciliationFixturePins(Installed)};
        var release=new MobileInstallReleaseInspectionV1(true,"EXPLICIT_PRIVATE_FIXTURE_ONLY",releaseFields,CoreJobCustodyV1.ReconciliationFixturePins(Installed));
        Qualified=(MobileInstallQualifiedEnrollmentV1)typeof(MobileInstallQualifiedEnrollmentV1).GetConstructors(Hidden)[0].Invoke(new object[]{files,release,Anchor});
        Reopen();Check(((MobileInstallJournalObservationV1)typeof(SovereignMobileInstallJournalV1).GetMethod("AppendPreparedV1",Hidden).Invoke(Journal,new object[]{"PREPARE",Candidate})).JournalTransitionRecorded,"PREPARE_UNPROVEN");
        var approval=SovereignMobileInstallAssertionV1.Verify(Candidate.CanonicalJson,parser.Serialize(Enrollment),(string)row["assertionJson"],System.DateTime.UtcNow);
        Check(approval.ApprovalVerified && Journal.ConsumeVerifiedApproval(approval).JournalTransitionRecorded,"CONSUME_UNPROVEN");
        Birth=System.DateTime.UtcNow.ToString("O",System.Globalization.CultureInfo.InvariantCulture);System.Threading.Thread.Sleep(2);Started=System.DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture);
      }
      internal void Close(){if(Journal!=null){Journal.Dispose();Journal=null;}}
      internal void Reopen(){Close();var storage=CoreJobCustodyV1.ReconciliationFixtureStorage(Wal);Journal=(SovereignMobileInstallJournalV1)typeof(SovereignMobileInstallJournalV1).GetConstructors(Hidden)[0].Invoke(new object[]{storage.File,storage,SovereignMobileInstallJournalV1.AnchorChannel.BindProtected(Anchor)});}
      internal SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 Evidence(string state,bool root,bool resumed,bool zero,string helper=null,string boot=null) {
        var s=Journal.ReceiptSnapshot(Candidate.RequestId,Candidate.CandidateSha256);
        return (SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1)typeof(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1).GetConstructors(Hidden)[0].Invoke(new object[]{state,"MOBILE_NATIVE_FIXTURE_TERMINAL",Candidate.RequestId,Candidate.CandidateSha256,Candidate.MachineHash,Candidate.SourceHead,Candidate.PackageSha256,1L,s.Sequence,s.HeadSha256,root?123u:0u,root?Birth:null,resumed?Started:null,root,resumed,zero,zero,helper,boot});
      }
      internal void Terminal(string state,bool root=true) {
        Check(Journal.RecordClaim(Candidate.RequestId,Candidate.CandidateSha256).JournalTransitionRecorded,"CLAIM_UNPROVEN");
        if(root){Check(Journal.RecordSuspendedRoot(Evidence("ROOT_SUSPENDED",true,false,false)).JournalTransitionRecorded,"ROOT_UNPROVEN");Check(Journal.RecordStarted(Evidence("INSTALLING",true,true,false)).JournalTransitionRecorded,"START_UNPROVEN");}
        if(state=="INSTALLED_PENDING_BOOT")Check(Journal.RecordInstalledPendingBoot(Evidence(state,true,true,true,Helper,Boot)).JournalTransitionRecorded,"PENDING_UNPROVEN");
        else Check(Journal.RecordFailed(Evidence(state,root,root,state=="FAILED")).JournalTransitionRecorded,"TERMINAL_UNPROVEN");
      }
      internal CoreJobCustodyV1.MobileInstallerReadBackV1 Readback(string helper=null,string boot=null) {
        return (CoreJobCustodyV1.MobileInstallerReadBackV1)typeof(CoreJobCustodyV1.MobileInstallerReadBackV1).GetConstructors(Hidden)[0].Invoke(new object[]{helper??Helper,boot??Boot,CoreJobCustodyV1.ReconciliationFixturePins(Installed)});
      }
      internal SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1 Bind(CoreJobCustodyV1.MobileInstallerReadBackV1 readback) {
        return (SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1)typeof(SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1).GetMethod("Bind",Hidden).Invoke(null,new object[]{Journal,Candidate,Qualified,SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(Journal,Candidate),readback});
      }
      internal void Advance(System.Collections.Generic.Dictionary<string,object> input) {
        var row=(System.Collections.Generic.Dictionary<string,object>)((object[])input["rows"])[1];var approval=SovereignMobileInstallAssertionV1.Verify((string)row["candidateJson"],parser.Serialize(Enrollment),(string)row["assertionJson"],System.DateTime.UtcNow);
        Check(approval.ApprovalVerified && Journal.ConsumeVerifiedApproval(approval).JournalTransitionRecorded,"SECOND_HEAD_UNPROVEN");
      }
      public void Dispose(){try{Close();}finally{Qualified.Dispose();System.IO.Directory.Delete(root,true);}}
    }
    public static string Run(string wire) {
      var parser=new System.Web.Script.Serialization.JavaScriptSerializer();var input=(System.Collections.Generic.Dictionary<string,object>)parser.DeserializeObject(wire);
      var cases=new System.Collections.Generic.List<object>();var signed=new System.Collections.Generic.List<object>();
      System.Action<string,System.Action> run=(name,body)=>{try{body();cases.Add(new{name,passed=true,reason=""});}catch(System.Exception error){while(error is System.Reflection.TargetInvocationException && error.InnerException!=null)error=error.InnerException;cases.Add(new{name,passed=false,reason=error.GetType().Name+":"+error.Message});}};
      run("terminal type has private construction and no live Job booleans",()=>{
        var type=typeof(SovereignMobileInstallExecutorV1.TerminalReadbackEvidenceV1);foreach(var ctor in type.GetConstructors(Hidden))Check(ctor.IsPrivate,"PUBLIC_TERMINAL_CONSTRUCTION");
        foreach(string name in new[]{"ResumeConfirmed","AssignedBeforeExecution","ZeroActiveProcessesObserved","ExecutionCustodyReleased"})Check(type.GetField(name,Hidden)==null,"LIVE_JOB_FACT_FABRICATED");
      });
      run("real signed replay preserves same terminal request without WAL mutation or execution",()=>{using(var f=new Fixture(input)){
        f.Terminal("INSTALLED_PENDING_BOOT");var old=SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(f.Journal,f.Candidate);f.Reopen();Check(!old.IsCurrent(f.Journal,f.Candidate),"OLD_OWNER_BORROWED");
        long length=new System.IO.FileInfo(f.Wal).Length;int events=f.Events.Count;
        using(var proof=f.Bind(f.Readback())){Check(proof!=null && proof.IsCurrent(f.Journal,f.Candidate) && proof.HistoricalRootBindingCommitted && proof.HistoricalResumeCommitted && proof.HistoricalZeroActiveCommitted && proof.CurrentInstalledReadbackVerified,"RESTART_PROOF_UNPROVEN");
          Check(!proof.ExecutionAuthorityGranted && !proof.RebootAllowed,"TERMINAL_AUTHORITY_EXPANDED");var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);Check(receipt.State=="INSTALLED_PENDING_BOOT","RESTART_BECAME_UNKNOWN");signed.Add(new{envelope=f.Anchor.SignReceipt(receipt),enrollment=f.Enrollment,candidate=f.Candidate.CanonicalJson});}
        Check(new System.IO.FileInfo(f.Wal).Length==length && f.Events.Count==events,"RECONCILIATION_MUTATED_WAL");}});
      run("failed before any ROOT replays as failure with no invented process or start",()=>{using(var f=new Fixture(input)){f.Terminal("FAILED",false);f.Reopen();using(var proof=SovereignMobileInstallExecutorV1.ReconcileProtected(f.Journal,f.Candidate,f.Qualified)){
        Check(proof!=null && proof.IsCurrent(f.Journal,f.Candidate) && !proof.HistoricalRootBindingCommitted && !proof.HistoricalResumeCommitted && proof.HistoricalZeroActiveCommitted && !proof.CurrentInstalledReadbackVerified && proof.RootPid==0 && proof.ExecutionStartedAtUtc==null,"PRE_ROOT_FAILURE_INVENTED_ROOT");
        var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);Check(receipt.State=="FAILED","FAILED_RESTART_UNKNOWN");signed.Add(new{envelope=f.Anchor.SignReceipt(receipt),enrollment=f.Enrollment,candidate=f.Candidate.CanonicalJson});}}});
      run("outcome unknown never borrows terminal historical zero",()=>{using(var f=new Fixture(input)){f.Terminal("UNKNOWN");f.Reopen();Check(SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(f.Journal,f.Candidate)==null && f.Bind(null)==null,"UNKNOWN_TERMINALIZED");}});
      run("uncommitted claim never becomes terminal after restart",()=>{using(var f=new Fixture(input)){Check(f.Journal.RecordClaim(f.Candidate.RequestId,f.Candidate.CandidateSha256).JournalTransitionRecorded,"CLAIM");f.Reopen();Check(SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(f.Journal,f.Candidate)==null,"CLAIM_TERMINALIZED");}});
      run("pending commit alone requires fresh installed pins",()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();Check(f.Bind(null)==null,"NO_READBACK_ACCEPTED");}});
      foreach(string attack in new[]{"helper","boot","disposed","closed-file","closed-native-file-handle","closed-directory"}){string mode=attack;run("readback refuses "+mode,()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();using(var readback=f.Readback(mode=="helper"?new string('f',64):null,mode=="boot"?new string('f',64):null)){
        if(mode=="disposed")readback.Dispose();if(mode=="closed-file" || mode=="closed-native-file-handle" || mode=="closed-directory"){
          var pins=(FixedRuntimeIdentityPinsV1)typeof(CoreJobCustodyV1.MobileInstallerReadBackV1).GetField("pins",Hidden).GetValue(readback);if(mode=="closed-file")pins.Files[0].Dispose();else if(mode=="closed-native-file-handle")pins.Files[0].SafeFileHandle.Dispose();else pins.Directories[0].Dispose();}
        using(var proof=f.Bind(readback))Check(proof==null,"UNPROVEN_READBACK_ACCEPTED");}}});}
      run("disposing current readback invalidates receipt again at signing",()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();var readback=f.Readback();using(var proof=f.Bind(readback)){
        var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);readback.Dispose();Check(!proof.IsCurrent(f.Journal,f.Candidate),"DISPOSED_PINS_CURRENT");bool held=false;try{f.Anchor.SignReceipt(receipt);}catch{held=true;}Check(held,"DISPOSED_PROOF_SIGNED");}}});
      run("advanced authenticated head invalidates old proof and receipt",()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();using(var proof=f.Bind(f.Readback())){var receipt=MobileInstallReceiptV1.FromTerminalReadback(f.Journal,f.Candidate,proof);f.Advance(input);Check(!proof.IsCurrent(f.Journal,f.Candidate),"OLD_HEAD_CURRENT");bool held=false;try{f.Anchor.SignReceipt(receipt);}catch{held=true;}Check(held,"OLD_HEAD_SIGNED");}}});
      run("changed candidate cannot borrow original prepared identity",()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();var changed=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1(f.Candidate.CanonicalJson.Replace(f.Candidate.SourceHead,new string('f',40)));Check(SovereignMobileInstallJournalV1.TerminalWitnessV1.Capture(f.Journal,changed)==null,"WRONG_CANDIDATE_CAPTURED");}});
      run("disposed enrollment qualification invalidates retained terminal proof",()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Reopen();using(var proof=f.Bind(f.Readback())){f.Qualified.Dispose();Check(!proof.IsCurrent(f.Journal,f.Candidate),"RELEASED_QUALIFIED_CURRENT");}}});
      run("exclusive native WAL handle blocks a second writer",()=>{using(var f=new Fixture(input)){bool denied=false;try{using(var second=new System.IO.FileStream(f.Wal,System.IO.FileMode.Open,System.IO.FileAccess.ReadWrite,System.IO.FileShare.ReadWrite)){} }catch(System.IO.IOException){denied=true;}Check(denied,"DUPLICATE_WRITER_ALLOWED");}});
      foreach(string attack in new[]{"truncated","changed-terminal","missing-anchor","rollback-anchor"}){string mode=attack;run("restart refuses "+mode,()=>{using(var f=new Fixture(input)){f.Terminal("INSTALLED_PENDING_BOOT");f.Close();
        if(mode=="truncated"){using(var file=new System.IO.FileStream(f.Wal,System.IO.FileMode.Open,System.IO.FileAccess.Write)){file.SetLength(file.Length-1);}}
        if(mode=="changed-terminal"){string raw=System.IO.File.ReadAllText(f.Wal);System.IO.File.WriteAllText(f.Wal,raw.Replace(f.Helper,new string('f',64)),new System.Text.UTF8Encoding(false));}
        if(mode=="missing-anchor")f.Events.Clear();if(mode=="rollback-anchor")f.Events.RemoveAt(f.Events.Count-1);
        bool denied=false;try{f.Reopen();}catch{denied=true;}Check(denied,"CORRUPT_TERMINAL_REOPENED");}});}
      return parser.Serialize(new{cases,signed});
    }
  }
}`;

test('terminal reconciliation preserves authenticated historical custody across native restart',
  { skip: process.platform !== 'win32', timeout: 60_000 }, t => {
    const root = mkdtempSync(join(tmpdir(), 'stephanos-terminal-reconciliation-'));
    try {
      const source = join(root, 'fixture.cs'), input = join(root, 'input.json');
      writeFileSync(source, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + harness);
      writeFileSync(input, JSON.stringify({ root, rows: [fixture(1), fixture(2)] }));
      const literal = value => "'" + value.replaceAll("'", "''") + "'";
      const code = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop;` +
        `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${literal(source)})) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileReconciliationFixtureRunnerV1]::Run([IO.File]::ReadAllText(${literal(input)})))`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 50_000, maxBuffer: 256 * 1024 });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout); assert.equal(report.cases.length, 21);
      assert.deepEqual(report.cases.filter(row => !row.passed), []);
      assert.equal(report.signed.length, 2);
      for (const row of report.signed) {
        const candidate = JSON.parse(row.candidate), receipt = JSON.parse(row.envelope);
        const view = projectMobileInstallationV1({ candidate, enrollment: row.enrollment, receipt }, { minimumSequence: receipt.payload.sequence });
        assert.equal(view.receiptVerified, true); assert.equal(view.canApprove, false); assert.notEqual(view.state, 'READY');
      }
      t.diagnostic('21 actual NTFS/CNG terminal/restart/pin/anchor attack cases; no production store, enrollment, installation, claim replay or child dispatch');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
