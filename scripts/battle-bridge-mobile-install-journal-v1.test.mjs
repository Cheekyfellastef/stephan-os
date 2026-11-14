import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync, statSync, linkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mobileInstallationChallengeV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

const hash = value => createHash('sha256').update(value).digest();
const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = keyPair(), receipt = keyPair(), other = keyPair();
const spki = key => key.export({ type: 'spki', format: 'der' }).toString('base64url');
function fixture({ request = 'one', count = 1, generation = 1, device = key, nonce = '1', expired = false } = {}) {
  const nowMs = Date.now() - (expired ? 600_000 : 0), nowUtc = new Date(nowMs).toISOString();
  const candidate = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-candidate.v1', repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1814, action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1', requestId: `mobile-install-journal-fixture-${request}`,
    nonce: nonce.repeat(64), machineHash: '2'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001', sourceHead: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40), packageSha256: '3'.repeat(64), closureSha256: '4'.repeat(64), releaseProofSha256: '5'.repeat(64),
    enrollmentGeneration: generation, requestedAtUtc: new Date(nowMs - 1000).toISOString(), expiresAtUtc: new Date(nowMs + 240_000).toISOString() };
  const enrollment = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1', machineHash: candidate.machineHash,
    operatorSid: candidate.operatorSid, generation, rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example',
    credentialId: Buffer.alloc(24, 7).toString('base64url'), publicKeySpki: spki(device.publicKey),
    userHandle: Buffer.from('synthetic-journal-operator').toString('base64url'), lastSignCount: 0, revoked: false,
    receiptPublicKeySpki: spki(receipt.publicKey) };
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(candidate), origin: enrollment.origin, crossOrigin: false }));
  const auth = Buffer.concat([hash(enrollment.rpId), Buffer.from([5]), Buffer.alloc(4)]); auth.writeUInt32BE(count, 33);
  const assertion = { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId,
    response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
      signature: sign('sha256', Buffer.concat([auth, hash(client)]), device.privateKey).toString('base64url'), userHandle: null } };
  return { candidateJson: JSON.stringify(candidate), enrollmentJson: JSON.stringify(enrollment), assertionJson: JSON.stringify(assertion), nowUtc };
}

// This harness exists only in the compiled temporary test executable. Shipping
// code has no fixture path/anchor factory or installer entry point.
const harness = String.raw`
namespace Stephanos.Sovereign {
  public static partial class CoreJobCustodyV1 {
    internal static MobileInstallJournalStorageV1 FixturePinMobileJournal(string path) {
      var pins=new System.Collections.Generic.List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
      Microsoft.Win32.SafeHandles.SafeFileHandle handle=null;System.IO.FileStream stream=null;
      try {
        try {PinDirectoryChain(System.IO.Path.GetDirectoryName(path),pins);}
        catch {throw new System.InvalidOperationException("FIXTURE_PARENT_PIN_FAILED_"+System.Runtime.InteropServices.Marshal.GetLastWin32Error());}
        handle=CreateFileW(path,0xc0000000u,0u,System.IntPtr.Zero,3u,0x80200000u,System.IntPtr.Zero);
        FILE_INFO info;
        if(handle.IsInvalid || !GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0 || info.links!=1 || info.sizeHigh!=0 || info.sizeLow<1 || info.sizeLow>1048576)
          throw new System.InvalidOperationException("FIXTURE_STORAGE_IDENTITY_REFUSED");
        var fs=new System.Text.StringBuilder(16);uint serial,component,flags;
        if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out component,out flags,fs,16) || fs.ToString()!="NTFS")
          throw new System.InvalidOperationException("FIXTURE_NTFS_REQUIRED");
        stream=new System.IO.FileStream(handle,System.IO.FileAccess.ReadWrite,4096,false);handle=null;
        return new MobileInstallJournalStorageV1(stream,pins);
      } catch {
        if(stream!=null) stream.Dispose();if(handle!=null) handle.Dispose();for(int i=pins.Count-1;i>=0;i--) pins[i].Dispose();throw;
      }
    }
  }
  public static class MobileJournalFixtureRunnerV1 {
    sealed class FixtureNoopPins : System.IDisposable {public void Dispose(){}}
    static readonly System.Web.Script.Serialization.JavaScriptSerializer Json=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=2097152,RecursionLimit=32};
    static readonly System.Text.UTF8Encoding Utf8=new System.Text.UTF8Encoding(false,true);
    static string fixtures;
    static SovereignMobileInstallAssertionV1.MobileInstallAssertionResultV1 Approval(int index) {
      var rows=(object[])Json.DeserializeObject(System.IO.File.ReadAllText(fixtures,Utf8));
      var row=(System.Collections.Generic.Dictionary<string,object>)rows[index];
      var now=System.DateTime.Parse((string)row["nowUtc"],System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind);
      return SovereignMobileInstallAssertionV1.Verify((string)row["candidateJson"],(string)row["enrollmentJson"],(string)row["assertionJson"],now);
    }
    static string Hash(string text) {using(var sha=System.Security.Cryptography.SHA256.Create()) return System.BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    static void DurableText(string path,string text) {
      using(var file=new System.IO.FileStream(path,System.IO.FileMode.Create,System.IO.FileAccess.Write,System.IO.FileShare.None,4096,System.IO.FileOptions.WriteThrough)) {
        var bytes=Utf8.GetBytes(text);file.Write(bytes,0,bytes.Length);file.Flush(true);
      }
    }
    static SovereignMobileInstallJournalV1 Open(string root,bool failCommit) {
      var storage=CoreJobCustodyV1.FixturePinMobileJournal(System.IO.Path.Combine(root,"approval-journal.wal"));
      try {
        string head=System.IO.Path.Combine(root,"head.fixture"),temporary=System.IO.Path.Combine(root,"head.pending.fixture");
        System.Func<string> read=delegate {return System.IO.File.ReadAllText(head,Utf8);};
        System.Action<string> commit=delegate(string text) {
          if(failCommit) throw new System.IO.IOException("SYNTHETIC_ANCHOR_COMMIT_FAILURE");
          DurableText(temporary,text);System.IO.File.Replace(temporary,head,null);
        };
        var anchorType=typeof(SovereignMobileInstallJournalV1.AnchorChannel);
        var anchor=anchorType.GetConstructors(System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)[0].Invoke(new object[]{read,commit});
        var constructor=typeof(SovereignMobileInstallJournalV1).GetConstructors(System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)[0];
        if(!constructor.IsPrivate) throw new System.InvalidOperationException("GENERIC_JOURNAL_CONSTRUCTOR_EXPOSED");
        return (SovereignMobileInstallJournalV1)constructor.Invoke(new object[]{storage.File,storage,anchor});
      } catch {storage.Dispose();throw;}
    }
    static object View(MobileInstallJournalObservationV1 result) {
      return new {state=result.State,reason=result.ReasonCode,requestId=result.RequestId,candidateSha256=result.CandidateSha256,
        sequence=result.Sequence,head=result.HeadSha256,recorded=result.JournalTransitionRecorded,
        executionAuthorityGranted=result.ExecutionAuthorityGranted,releaseEligibilityVerified=result.ReleaseEligibilityVerified,
        installationVerified=result.InstallationVerified,replayAllowed=result.ReplayAllowed};
    }
    static SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 SyntheticEvidence(SovereignMobileInstallJournalV1 journal,
      SovereignMobileInstallAssertionV1.MobileInstallAssertionResultV1 approval,string state,string birth,string started,bool resumed,bool zero,bool released,string helper=null,string boot=null) {
      var snapshot=journal.ReceiptSnapshot(approval.RequestId,approval.CandidateSha256);
      var type=typeof(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1);
      return (SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1)type.GetConstructors(System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)[0].Invoke(new object[]{
        state,"SYNTHETIC_R2_WAL_FIXTURE",approval.RequestId,approval.CandidateSha256,new string('2',64),new string('a',40),new string('3',64),
        approval.EnrollmentGeneration,snapshot.Sequence,snapshot.HeadSha256,4242u,birth,started,true,resumed,zero,released,helper,boot});
    }
    public static int Main(string[] args) {
      try {
        string op=args[0],root=args[1];fixtures=args[2];int index=args.Length>3?System.Int32.Parse(args[3]):0;
        if(op=="counter-floor") {
          var results=new System.Collections.Generic.List<object>();
          foreach(uint[] item in new[]{new uint[]{0,0},new uint[]{31,31},new uint[]{32,31},new uint[]{System.UInt32.MaxValue,System.UInt32.MaxValue},
            new uint[]{0,1},new uint[]{30,31},new uint[]{System.UInt32.MaxValue-1,System.UInt32.MaxValue}}) {
            bool allowed=true;
            using(var key=System.Security.Cryptography.CngKey.Create(System.Security.Cryptography.CngAlgorithm.ECDsaP256)) {
              if(!key.IsEphemeral)throw new System.Exception("FIXTURE_KEY_NOT_EPHEMERAL");
              var hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.Static;
              string spki=(string)typeof(SovereignMobileInstallAnchorV1).GetMethod("PublicSpki",hidden).Invoke(null,new object[]{key});
              var ctor=typeof(SovereignMobileInstallAnchorV1).GetConstructors(hidden)[0];
              using(var anchor=(SovereignMobileInstallAnchorV1)ctor.Invoke(new object[]{new string('2',64),"S-1-5-21-1-2-3-1001",1L,item[1],new string('c',64),spki,key,new FixtureNoopPins(),
                new System.Func<System.Collections.Generic.List<MobileInstallAnchorEventV1>>(()=>new System.Collections.Generic.List<MobileInstallAnchorEventV1>()),
                new System.Action<string>(text=>{throw new System.Exception("FLOOR_FIXTURE_MUST_NOT_APPEND");})})) {
                try {anchor.AssertMinimumSignCount(item[0]);}
                catch(System.InvalidOperationException error) {if(error.Message!="MOBILE_ANCHOR_SIGN_COUNTER_FLOOR_UNPROVEN")throw;allowed=false;}
              }
            }
            results.Add(new {watermark=item[0],minimum=item[1],allowed,executionAuthorityGranted=false});
          }
          System.Console.Write(Json.Serialize(results));return 0;
        }
        if(op=="protected") {
          var open=typeof(SovereignMobileInstallJournalV1).GetMethod("OpenProtected",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic);
          var bind=typeof(SovereignMobileInstallJournalV1.AnchorChannel).GetMethod("BindProtected",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic);
          if(open==null || open.IsPublic || open.GetParameters().Length!=0 || bind==null || bind.GetParameters().Length!=1 ||
             bind.GetParameters()[0].ParameterType!=typeof(SovereignMobileInstallAnchorV1)) throw new System.Exception("PRODUCTION_FACTORY_BOUNDARY_INVALID");
          System.Console.Write(Json.Serialize(new {protectedFactoryClosed=true,productionInvoked=false}));return 0;
        }
        var approval=Approval(index);
        if(op=="init") {
          if(!approval.ApprovalVerified) throw new System.Exception("FIXTURE_ASSERTION_INVALID");
          string generation=approval.EnrollmentGeneration.ToString(System.Globalization.CultureInfo.InvariantCulture);
          string body="STEPHANOS-MOBILE-JOURNAL-V1|"+approval.CredentialBindingSha256+"|"+generation+"|0";
          string head=Hash("stephanos.mobile-journal-header.v1\0"+body);
          DurableText(System.IO.Path.Combine(root,"approval-journal.wal"),body+"|"+head+"\n");
          DurableText(System.IO.Path.Combine(root,"head.fixture"),"STEPHANOS-MOBILE-JOURNAL-HEAD-V1|"+approval.CredentialBindingSha256+"|"+generation+"|0|"+head);
          System.Console.Write(Json.Serialize(new {initialized=true}));return 0;
        }
        using(var journal=Open(root,op=="anchor-failure")) {
          object result;
          if(op=="hold") {System.Console.WriteLine("HELD");System.Console.Out.Flush();System.Console.ReadLine();return 0;}
          if(op=="consume" || op=="anchor-failure") result=View(journal.ConsumeVerifiedApproval(approval));
          else if(op=="active-projection") {
            var hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.Static;
            var rows=(object[])Json.DeserializeObject(System.IO.File.ReadAllText(fixtures,Utf8));var row=(System.Collections.Generic.Dictionary<string,object>)rows[index];
            var candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1((string)row["candidateJson"]);
            var type=typeof(SovereignMobileInstallExecutorV1);var activeType=type.GetNestedType("ActiveExecution",hidden);
            var active=System.Activator.CreateInstance(activeType,true);var activeField=type.GetField("active",hidden);
            activeType.GetField("RequestId",hidden).SetValue(active,approval.RequestId);activeType.GetField("Journal",hidden).SetValue(active,journal);
            activeType.GetField("Candidate",hidden).SetValue(active,candidate);activeField.SetValue(null,active);
            try {
              string pre=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(approval.RequestId).State;
              journal.RecordClaim(approval.RequestId,approval.CandidateSha256);
              string claimed=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(approval.RequestId).State;
              string birth=System.DateTime.UtcNow.AddMilliseconds(-3).ToString("O",System.Globalization.CultureInfo.InvariantCulture);
              string started=System.DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture);
              var stage=new FixedRuntimeStageV1 {RootPid=4242,RootCreatedAtUtc=birth,AssignedBeforeExecution=true};
              activeType.GetField("Stage",hidden).SetValue(active,stage);
              journal.RecordSuspendedRoot(SyntheticEvidence(journal,approval,"ROOT_SUSPENDED",birth,null,false,false,false));
              string suspended=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(approval.RequestId).State;
              var cancel=journal.Cancel(approval.RequestId,approval.CandidateSha256);
              stage.ResumeConfirmed=true;stage.ResumeConfirmedAtUtc=started;stage.ZeroActiveProcessesObserved=true;stage.ExecutionCustodyReleased=true;
              var terminal=journal.RecordFailed(SyntheticEvidence(journal,approval,"FAILED",birth,started,true,true,true));
              string final=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(approval.RequestId).State;
              result=new {pre,claimed,suspended,cancel=View(cancel),terminal=View(terminal),final};
            } finally {activeField.SetValue(null,null);}
          }
          else if(op=="r2-progress" || op=="r2-proof-refusal") {
            var claim=journal.RecordClaim(approval.RequestId,approval.CandidateSha256);
            string birth=System.DateTime.UtcNow.AddMilliseconds(-3).ToString("O",System.Globalization.CultureInfo.InvariantCulture);
            string started=System.DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture);
            var rootEvidence=SyntheticEvidence(journal,approval,"ROOT_SUSPENDED",birth,null,false,false,false);
            var rootResult=journal.RecordSuspendedRoot(rootEvidence);
            if(op=="r2-proof-refusal") {
              var missingResume=SyntheticEvidence(journal,approval,"INSTALLING",birth,started,false,false,false);
              result=new object[]{View(rootResult),View(journal.RecordStarted(missingResume)),View(journal.RecordSuspendedRoot(rootEvidence))};
            } else {
              var startResult=journal.RecordStarted(SyntheticEvidence(journal,approval,"INSTALLING",birth,started,true,true,true));
              var invalidPending=journal.RecordInstalledPendingBoot(SyntheticEvidence(journal,approval,"INSTALLED_PENDING_BOOT",birth,started,true,false,false,new string('d',64),new string('e',64)));
              var installed=journal.RecordInstalledPendingBoot(SyntheticEvidence(journal,approval,"INSTALLED_PENDING_BOOT",birth,started,true,true,true,new string('d',64),new string('e',64)));
              var snapshot=journal.ReceiptSnapshot(approval.RequestId,approval.CandidateSha256);
              result=new {transitions=new object[]{View(claim),View(rootResult),View(startResult),View(invalidPending),View(installed)},
                snapshotState=snapshot.State,snapshotPid=snapshot.RootPid,snapshotBirth=snapshot.RootCreatedAtUtc,snapshotStarted=snapshot.ExecutionStartedAtUtc,
                snapshotHelper=snapshot.InstalledHelperSha256,snapshotBoot=snapshot.InstallationBootId,snapshotIntact=snapshot.IsIntact()};
            }
          }
          else if(op=="tamper") {
            approval.GetType().GetField("CandidateSha256",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).SetValue(approval,new string('f',64));
            result=View(journal.ConsumeVerifiedApproval(approval));
          } else if(op=="claim") result=View(journal.RecordClaim(approval.RequestId,approval.CandidateSha256));
          else if(op=="cancel") result=View(journal.Cancel(approval.RequestId,approval.CandidateSha256));
          else if(op=="uncertain") result=View(journal.RecordUncertain(approval.RequestId,approval.CandidateSha256));
          else if(op=="read") result=View(journal.Reconcile(approval.RequestId,approval.CandidateSha256));
          else if(op=="race" || op=="duplicate") {
            var gate=new System.Threading.Barrier(2);
            var first=System.Threading.Tasks.Task.Factory.StartNew(delegate {gate.SignalAndWait();return op=="race"?
              journal.RecordClaim(approval.RequestId,approval.CandidateSha256):journal.ConsumeVerifiedApproval(approval);});
            var second=System.Threading.Tasks.Task.Factory.StartNew(delegate {gate.SignalAndWait();return op=="race"?
              journal.Cancel(approval.RequestId,approval.CandidateSha256):journal.ConsumeVerifiedApproval(approval);});
            System.Threading.Tasks.Task.WaitAll(first,second);gate.Dispose();result=new object[]{View(first.Result),View(second.Result)};
          } else throw new System.Exception("FIXTURE_OPERATION_INVALID");
          System.Console.Write(Json.Serialize(result));return 0;
        }
      } catch(System.Exception error) {
        while(error.InnerException!=null) error=error.InnerException;
        System.Console.Write(Json.Serialize(new {held=true,reason=error.Message}));return 0;
      }
    }
  }
}`;

test('native Windows journal durably binds and consumes verified assertions without execution authority',
  { skip: process.platform !== 'win32', timeout: 60_000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-journal-fixture-'));
    const sourcePath = join(root, 'fixture.cs'), fixturePath = join(root, 'assertions.json'), exePath = join(root, 'fixture.exe');
    const files = readMobileInstallerNativeSourceV1();
    const rows = [fixture(), fixture({ request: 'two', count: 2 }), fixture({ request: 'old', count: 1 }),
      fixture({ nonce: '9' }), fixture({ request: 'generation', generation: 2, count: 3 }),
      fixture({ request: 'credential', device: other, count: 3 }), fixture({ request: 'zero', count: 0 }),
      fixture({ request: 'expired', count: 3, expired: true })];
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    const run = (op, directory, index = 0) => {
      const result = spawnSync(exePath, [op, directory, fixturePath, String(index)], { shell: false, windowsHide: true,
        encoding: 'utf8', timeout: 8000, maxBuffer: 128 * 1024 });
      assert.equal(result.error, undefined);assert.equal(result.status, 0, result.stderr);return JSON.parse(result.stdout);
    };
    const provision = name => { const directory = join(root, name);mkdirSync(directory);assert.equal(run('init', directory).initialized, true);return directory; };
    const noAuthority = result => { for (const key of ['executionAuthorityGranted', 'releaseEligibilityVerified', 'installationVerified', 'replayAllowed']) assert.equal(result[key], false, key); };
    try {
      writeFileSync(fixturePath, JSON.stringify(rows));
      writeFileSync(sourcePath, files.map(row => row.bytes.toString('utf8')).join('\n') + '\n' + harness);
      const script = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `$p=[CodeDom.Compiler.CompilerParameters]::new();$p.GenerateExecutable=$true;$p.GenerateInMemory=$false;$p.IncludeDebugInformation=$false;` +
        `$p.OutputAssembly=${literal(exePath)};$p.CompilerOptions='/target:exe /main:Stephanos.Sovereign.MobileJournalFixtureRunnerV1';` +
        `$p.TempFiles=[CodeDom.Compiler.TempFileCollection]::new(${literal(root)},$false);` +
        `foreach($r in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll')){[void]$p.ReferencedAssemblies.Add($r)};` +
        `$compiler=[Microsoft.CSharp.CSharpCodeProvider]::new();try{$r=$compiler.CompileAssemblyFromSource($p,@([IO.File]::ReadAllText(${literal(sourcePath)})));` +
        `if($r.Errors.HasErrors){foreach($e in $r.Errors){[Console]::Error.WriteLine($e.ToString())};exit 1};[Console]::Write('COMPILED')}finally{$compiler.Dispose();$p.TempFiles.Delete()}`;
      const compiled = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 20_000, maxBuffer: 64 * 1024 });
      assert.equal(compiled.error, undefined);assert.equal(compiled.status, 0, compiled.stderr);assert.equal(compiled.stdout, 'COMPILED');

      await t.test('reconstructed counter meets protected enrollment floor including uint boundaries', () => {
        const cases = run('counter-floor', root);assert.equal(cases.length, 7);
        for (const row of cases) {
          assert.equal(row.allowed, row.watermark >= row.minimum, JSON.stringify(row));
          assert.equal(row.executionAuthorityGranted, false);
        }
      });

      await t.test('production factories accept no caller path or callback and are not invoked by fixtures', () => {
        const observed = run('protected', root);assert.equal(observed.protectedFactoryClosed, true);assert.equal(observed.productionInvoked, false);
      });
      await t.test('durable consume, restart claim, crash reconciliation and replay refusal', () => {
        const directory = provision('restart');
        const consumed = run('consume', directory);assert.equal(consumed.recorded, true);assert.equal(consumed.sequence, 1);noAuthority(consumed);
        const duplicate = run('consume', directory);assert.equal(duplicate.recorded, false);assert.match(duplicate.reason, /ALREADY_CONSUMED_NO_REPLAY/);
        const claimed = run('claim', directory);assert.equal(claimed.recorded, true);assert.equal(claimed.sequence, 2);noAuthority(claimed);
        const read = run('read', directory);assert.equal(read.state, 'OUTCOME_UNKNOWN');assert.equal(read.recorded, false);noAuthority(read);
        const replay = run('claim', directory);assert.equal(replay.state, 'OUTCOME_UNKNOWN');assert.equal(replay.recorded, false);assert.equal(replay.sequence, 2);
      });
      await t.test('R2 synthetic execution records share anchored WAL and preserve physical receipt bindings', () => {
        const directory = provision('r2-progress');assert.equal(run('consume', directory).recorded, true);
        const progress = run('r2-progress', directory);
        assert.deepEqual(progress.transitions.map(row => row.recorded), [true, true, true, false, true]);progress.transitions.forEach(noAuthority);
        assert.equal(progress.snapshotState, 'INSTALLED_PENDING_BOOT');assert.equal(progress.snapshotPid, 4242);
        assert.match(progress.snapshotBirth, /^\d{4}-.*\.\d{7}Z$/);assert.match(progress.snapshotStarted, /^\d{4}-.*\.\d{3}Z$/);
        assert.equal(progress.snapshotHelper, 'd'.repeat(64));assert.equal(progress.snapshotBoot, 'e'.repeat(64));assert.equal(progress.snapshotIntact, true);
        assert.equal(run('claim', directory).recorded, false);
      });
      await t.test('R2 refuses missing actual resume and stale pretransition evidence without replay', () => {
        const directory = provision('r2-refusal');run('consume', directory);
        const rows = run('r2-proof-refusal', directory);assert.deepEqual(rows.map(row => row.recorded), [true, false, false]);rows.forEach(noAuthority);
        assert.match(rows[1].reason, /PROOF_UNPROVEN/);assert.match(rows[2].reason, /BINDING_UNPROVEN/);
        assert.equal(run('claim', directory).recorded, false);assert.equal(run('read', directory).state, 'STARTING');
      });
      await t.test('live preexecution receipts remain truthful and cancelled uncertainty terminalizes only with native drain proof', () => {
        const directory = provision('active-projection');run('consume', directory);
        const observed = run('active-projection', directory);
        assert.equal(observed.pre, 'APPROVAL_RECORDED');assert.equal(observed.claimed, 'STARTING');assert.equal(observed.suspended, 'STARTING');
        assert.equal(observed.cancel.state, 'OUTCOME_UNKNOWN');assert.equal(observed.terminal.recorded, true);
        assert.equal(observed.terminal.state, 'FAILED');assert.equal(observed.final, 'FAILED');
        noAuthority(observed.cancel);noAuthority(observed.terminal);assert.equal(run('claim', directory).recorded, false);
      });
      await t.test('request collision, credential generation and global sign-counter boundaries', () => {
        const directory = provision('binding');assert.equal(run('consume', directory).recorded, true);
        assert.match(run('consume', directory, 3).reason, /REQUEST_CANDIDATE_COLLISION/);
        for (const index of [4, 5]) assert.match(run('consume', directory, index).reason, /ENROLLMENT_BINDING_MISMATCH/);
        assert.match(run('consume', directory, 2).reason, /SIGN_COUNTER_ROLLBACK/);
        assert.match(run('consume', directory, 6).reason, /SIGN_COUNTER_ROLLBACK/);
        const next = run('consume', directory, 1);assert.equal(next.recorded, true);assert.equal(next.sequence, 2);noAuthority(next);
        assert.match(run('consume', directory, 7).reason, /APPROVAL_EXPIRED/);
      });
      await t.test('cancellation before claim is durable, cancellation after claim stays uncertain', () => {
        const before = provision('cancel-before');run('consume', before);
        const cancelled = run('cancel', before);assert.equal(cancelled.state, 'CANCELLED');assert.equal(cancelled.recorded, true);noAuthority(cancelled);
        assert.equal(run('claim', before).state, 'CANCELLED');assert.equal(run('claim', before).recorded, false);
        const after = provision('cancel-after');run('consume', after);run('claim', after);
        const uncertain = run('cancel', after);assert.equal(uncertain.state, 'OUTCOME_UNKNOWN');assert.equal(uncertain.recorded, true);noAuthority(uncertain);
        assert.equal(run('claim', after).recorded, false);
      });
      await t.test('simultaneous claim/cancel and duplicate-consume calls serialize', () => {
        const race = provision('race');run('consume', race);
        const raced = run('race', race);raced.forEach(noAuthority);
        assert.ok(!(raced[0].state === 'CLAIM_RECORDED' && raced[1].state === 'CANCELLED'));
        assert.ok(['CANCELLED', 'OUTCOME_UNKNOWN'].includes(run('read', race).state));
        const duplicate = provision('duplicate');const outcomes = run('duplicate', duplicate);outcomes.forEach(noAuthority);
        assert.equal(outcomes.filter(result => result.recorded).length, 1);assert.equal(run('read', duplicate).sequence, 1);
      });
      await t.test('another Windows process cannot open or mutate the retained WAL', async () => {
        const directory = provision('process-lock');
        const child = spawn(exePath, ['hold', directory, fixturePath, '0'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        try {
          const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'error').then(([error]) => { throw error; })]);
          assert.equal(String(ready[0]).trim(), 'HELD');
          const excluded = run('consume', directory);assert.equal(excluded.held, true);assert.match(excluded.reason, /STORAGE_IDENTITY_REFUSED/);
        } finally { child.stdin.end('\n');await once(child, 'close'); }
        assert.equal(run('consume', directory).recorded, true);
      });
      await t.test('partial writes, complete-prefix rollback and corrupted chain hold without replay', () => {
        const partial = provision('partial');run('consume', partial);
        const partialPath = join(partial, 'approval-journal.wal');truncateSync(partialPath, statSync(partialPath).size - 1);
        assert.equal(run('claim', partial).held, true);
        const prefix = provision('prefix');run('consume', prefix);
        const prefixPath = join(prefix, 'approval-journal.wal');writeFileSync(prefixPath, readFileSync(prefixPath, 'utf8').split('\n')[0] + '\n');
        const rolledBack = run('consume', prefix);assert.equal(rolledBack.held, true);assert.match(rolledBack.reason, /AUTHENTICATED_HEAD_MISMATCH/);
        const corrupt = provision('corrupt');run('consume', corrupt);
        const corruptPath = join(corrupt, 'approval-journal.wal');writeFileSync(corruptPath, readFileSync(corruptPath, 'utf8').replace('R1|1|', 'R1|2|'));
        assert.equal(run('claim', corrupt).held, true);
      });
      await t.test('WAL commit before failed anchor publication remains held across restart', () => {
        const directory = provision('uncertain');
        const uncertain = run('anchor-failure', directory);assert.equal(uncertain.state, 'UNKNOWN');assert.equal(uncertain.recorded, false);noAuthority(uncertain);
        const restart = run('consume', directory);assert.equal(restart.held, true);assert.match(restart.reason, /AUTHENTICATED_HEAD_MISMATCH/);
      });
      await t.test('tampered live verification object, hardlink, file bounds and missing header are refused', () => {
        const tamper = provision('tamper');assert.match(run('tamper', tamper).reason, /LIVE_VERIFIED_ASSERTION_REQUIRED/);assert.equal(run('read', tamper).sequence, 0);
        const linked = provision('linked');linkSync(join(linked, 'approval-journal.wal'), join(linked, 'alias.fixture'));
        assert.equal(run('consume', linked).held, true);
        const large = provision('large');writeFileSync(join(large, 'approval-journal.wal'), Buffer.alloc(1048577));assert.equal(run('consume', large).held, true);
        const empty = provision('empty');writeFileSync(join(empty, 'approval-journal.wal'), '');assert.equal(run('consume', empty).held, true);
      });
      t.diagnostic('Real .NET Framework compilation, NTFS retained handles, process exclusion, flush/restart and synthetic independent head anchor; no production enrollment/anchor/installation');
    } finally {
      const expected = resolve(tmpdir()) + sep;
      const absolute = realpathSync(root);
      assert.ok(absolute.toLowerCase().startsWith(expected.toLowerCase()) && absolute.includes('stephanos-mobile-journal-fixture-'));
      rmSync(absolute, { recursive: true, force: true });
    }
  });
