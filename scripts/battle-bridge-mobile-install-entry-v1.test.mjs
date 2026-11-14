import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

const entry = readFileSync(new URL('./windows/SovereignMobileInstallEntryV1.cs', import.meta.url), 'utf8');
const requests = readFileSync(new URL('./windows/SovereignMobileInstallRequestsV1.cs', import.meta.url), 'utf8');
const pair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = () => pair().publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const enrollment = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1',
  machineHash: '2'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001', generation: 1,
  rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example', credentialId: Buffer.alloc(24, 7).toString('base64url'),
  publicKeySpki: publicKey(), userHandle: Buffer.from('synthetic-pipe-fixture').toString('base64url'),
  lastSignCount: 0, revoked: false, receiptPublicKeySpki: publicKey() };
const literal = value => "'" + value.replaceAll("'", "''") + "'";

test('fixed entry and same-WAL requests expose no installation argv or replacement authority lane', () => {
  for (const source of [entry, requests]) assert.ok(Buffer.byteLength(source) <= 32768);
  assert.match(entry, /public static int Main\(string\[\] args\)/);
  assert.match(entry, /args==null \|\| args\.Length!=0/);
  assert.match(entry, /ClientRights=0x00120083/);
  assert.equal(0x00120083 & (4 | 0x00040000 | 0x00080000 | 0x40000000), 0);
  assert.match(entry, /3\|FirstInstance\|Overlapped,RejectRemote,1/);
  assert.match(entry, /GetSecurityInfo\(handle,6,5/);
  assert.match(entry, /production\?"S-1-5-32-544"/);
  assert.match(entry, /WriteResponseAndDisconnect\(pipe,response\)/);
  assert.match(entry, /ObserveOriginalDrain\(\);if\(!PendingOperation/);
  assert.match(entry, /GetNamedPipeServerProcessId/);
  assert.match(entry, /GetNamedPipeClientProcessId/);
  assert.match(entry, /QueryFullProcessImageNameW/);
  assert.match(entry, /pipe\.RunAsClient/);
  assert.doesNotMatch(entry, /RegisterTask|RegisterTaskDefinition|Process\.Start|TcpListener|HttpListener/);
  assert.match(requests, /CommitEncodedRecordV1\(line,next,candidate\.RequestId,candidate\.CandidateSha256\)/);
  assert.match(requests, /RandomNumberGenerator\.Create/);
  assert.doesNotMatch(requests, /File\.Write|File\.Create|Directory\.Create|new FileStream/);
});

const runner = String.raw`
namespace Stephanos.Sovereign {
  public static class MobileEntryFixtureRunnerV1 {
    static readonly System.Reflection.BindingFlags Hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.Static;
    static readonly System.Web.Script.Serialization.JavaScriptSerializer Json=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=1048576,RecursionLimit=20};
    static readonly System.Text.UTF8Encoding Utf8=new System.Text.UTF8Encoding(false,true);
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
    static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string name,uint rights,uint sharing,System.IntPtr security,uint creation,uint flags,System.IntPtr template);
    sealed class NoopPins:System.IDisposable {public void Dispose(){}}
    sealed class AnchorFixture {internal string Current;internal bool Fail;}
    static string Hash(string value){using(var sha=System.Security.Cryptography.SHA256.Create())return System.BitConverter.ToString(sha.ComputeHash(Utf8.GetBytes(value))).Replace("-","").ToLowerInvariant();}
    static SovereignMobileInstallJournalV1 Open(string path,AnchorFixture anchored) {
      var file=new System.IO.FileStream(path,System.IO.FileMode.Open,System.IO.FileAccess.ReadWrite,System.IO.FileShare.None,4096,System.IO.FileOptions.WriteThrough);
      var anchor=(SovereignMobileInstallJournalV1.AnchorChannel)typeof(SovereignMobileInstallJournalV1.AnchorChannel).GetConstructors(Hidden)[0].Invoke(new object[]{
        new System.Func<string>(()=>anchored.Current),new System.Action<string>(value=>{if(anchored.Fail)throw new System.IO.IOException("SYNTHETIC_ANCHOR_FAILURE");anchored.Current=value;})});
      try{return (SovereignMobileInstallJournalV1)typeof(SovereignMobileInstallJournalV1).GetConstructors(Hidden)[0].Invoke(new object[]{file,new NoopPins(),anchor});}
      catch{file.Dispose();throw;}
    }
    static MobileInstallQualifiedEnrollmentV1 SyntheticQualified(string enrollment) {
      // Reflection reaches the private constructor only in this temporary
      // fixture assembly; it does NOT invoke or qualify the shipping factory.
      var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(enrollment);
      var values=new System.Collections.Generic.Dictionary<string,string> {
        {"machineHash",binding.MachineHash},{"operatorSid",binding.OperatorSid},{"enrollmentGeneration","1"},
        {"sourceHead",new string('a',40)},{"sourceTree",new string('b',40)},{"packageSha256",new string('3',64)},
        {"closureSha256",new string('4',64)},{"releaseProofSha256",new string('5',64)},{"bootstrapSha256",new string('6',64)}};
      var release=new MobileInstallReleaseInspectionV1(true,"SYNTHETIC_DATA_NOT_QUALIFICATION",values);
      var files=new MobileInstallEnrollmentFilesV1 {EnrollmentJson=enrollment,Binding=binding};
      return (MobileInstallQualifiedEnrollmentV1)typeof(MobileInstallQualifiedEnrollmentV1).GetConstructors(Hidden)[0].Invoke(new object[]{files,release,null});
    }
    static object Protocol(string[] wires) {
      var results=new System.Collections.Generic.List<object>();
      foreach(string wire in wires) {
        try {var request=MobileInstallPipeRequestV1.Parse(wire);results.Add(new{allowed=true,operation=request.Operation,request=request.RequestId,assertion=request.AssertionJson});}
        catch(System.InvalidOperationException error){results.Add(new{allowed=false,reason=error.Message});}
      }return results;
    }
    static object Prepared(string root,string enrollment) {
      var qualified=SyntheticQualified(enrollment);var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(enrollment);
      string wal=System.IO.Path.Combine(root,"requests.wal"),header=SovereignMobileInstallJournalV1.CreateEnrollmentHeaderV1(binding);
      System.IO.File.WriteAllText(wal,header,Utf8);string[] parts=header.TrimEnd('\n').Split('|');
      var anchor=new AnchorFixture {Current="STEPHANOS-MOBILE-JOURNAL-HEAD-V1|"+binding.CredentialBindingSha256+"|1|0|"+parts[4]};
      var rows=new System.Collections.Generic.List<object>();string first,firstJson,digest,second;
      using(var journal=Open(wal,anchor)) {
        var candidate=journal.PrepareNative(qualified);first=candidate.RequestId;firstJson=candidate.CanonicalJson;digest=candidate.CandidateSha256;
        var repeated=journal.PrepareNative(qualified);var snapshot=journal.ReceiptSnapshot(first,digest);
        if(repeated.CanonicalJson!=firstJson || snapshot.Sequence!=1 || snapshot.State!="PREPARED")throw new System.Exception("PREPARE_NOT_DURABLE_OR_REUSED");
        var simultaneous=new System.Threading.Tasks.Task<SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1>[8];
        for(int i=0;i<simultaneous.Length;i++)simultaneous[i]=System.Threading.Tasks.Task.Factory.StartNew(()=>journal.PrepareNative(qualified));
        System.Threading.Tasks.Task.WaitAll(simultaneous);
        foreach(var result in simultaneous)if(result.Result.CanonicalJson!=firstJson)throw new System.Exception("CONCURRENT_PREPARE_CREATED_SECOND_REQUEST");
        if(journal.ReceiptSnapshot(first,digest).Sequence!=1)throw new System.Exception("CONCURRENT_PREPARE_APPENDED_DUPLICATE");
        rows.Add(new{name="native preparation before approval",state=snapshot.State,sequence=snapshot.Sequence,request=first,candidate=firstJson});
      }
      using(var journal=Open(wal,anchor)) {
        if(journal.LoadPreparedCandidate(first).CanonicalJson!=firstJson || journal.PrepareNative(qualified).CanonicalJson!=firstJson)
          throw new System.Exception("RESTART_CHANGED_NATIVE_REQUEST");
        var cancelled=journal.CancelPrepared(first);if(!cancelled.JournalTransitionRecorded || cancelled.State!="CANCELLED")throw new System.Exception("PREPARED_CANCEL_NOT_DURABLE");
        var next=journal.PrepareNative(qualified);second=next.RequestId;
        if(second==first || next.Nonce==journal.LoadPreparedCandidate(first).Nonce)throw new System.Exception("CANCELLED_NATIVE_NONCE_REUSED");
        if(journal.ReceiptSnapshot(first,digest).State!="CANCELLED")throw new System.Exception("OLD_REQUEST_CANCEL_LOST");
        rows.Add(new{name="cancelled original remains historical",state="CANCELLED",sequence=cancelled.Sequence,request=first,candidate=firstJson});
        var current=journal.ReceiptSnapshot(second,next.CandidateSha256);
        rows.Add(new{name="fresh native request after explicit cancellation",state=current.State,sequence=current.Sequence,request=second,candidate=next.CanonicalJson});
        bool unknown=false;try{journal.LoadPreparedCandidate("mobile-install-not-a-stored-request");}catch{unknown=true;}
        if(!unknown)throw new System.Exception("CALLER_CHOSEN_REQUEST_ACCEPTED");
      }
      using(var journal=Open(wal,anchor)) {
        var candidate=journal.LoadPreparedCandidate(second);
        if(journal.PrepareNative(qualified).CanonicalJson!=candidate.CanonicalJson)throw new System.Exception("REOPEN_CHANGED_ORIGINAL");
        // Authenticated head failure after WAL write must not make a new ID or
        // return a prepared candidate. This fixture deliberately poisons owner.
        journal.CancelPrepared(second);anchor.Fail=true;bool held=false;
        try{journal.PrepareNative(qualified);}catch{held=true;}
        if(!held)throw new System.Exception("UNCERTAIN_PREPARATION_RETURNED");
      }
      bool reopenHeld=false;try{using(var journal=Open(wal,anchor)){}}catch{reopenHeld=true;}
      if(!reopenHeld)throw new System.Exception("UNANCHORED_PREPARATION_REOPENED");
      return new {rows,unanchoredReopenHeld=true,productionFactoryInvoked=false};
    }
    static object Concurrency(string enrollment) {
      string request="mobile-install-reserved-fixture-12345678";int admitted=0;
      var workers=new System.Threading.Tasks.Task[16];
      for(int i=0;i<workers.Length;i++)workers[i]=System.Threading.Tasks.Task.Factory.StartNew(delegate {
        if(SovereignMobileInstallExecutorV1.ReserveProtectedRequest(request))System.Threading.Interlocked.Increment(ref admitted);
      });
      System.Threading.Tasks.Task.WaitAll(workers);
      if(admitted!=1 || SovereignMobileInstallExecutorV1.ReserveProtectedRequest("mobile-install-other-fixture-12345678"))
        throw new System.Exception("EXECUTOR_DUPLICATE_RESERVATION");
      SovereignMobileInstallExecutorV1.CancelActive(request);
      var activeField=typeof(SovereignMobileInstallExecutorV1).GetField("active",Hidden);object active=activeField.GetValue(null);
      if(active==null || !(bool)active.GetType().GetField("CancelRequested",Hidden).GetValue(active))
        throw new System.Exception("PREJOURNAL_CANCEL_WAS_LOST");
      activeField.SetValue(null,null);
      var qualified=SyntheticQualified(enrollment);var now=System.DateTime.UtcNow;
      string json="{\"schemaVersion\":\"stephanos.battle-bridge-mobile-installation-candidate.v1\",\"repository\":\"Cheekyfellastef/stephan-os\",\"issueNumber\":1814,"+
        "\"action\":\"INSTALL_SOVEREIGN_FIXED_RUNTIME_V1\",\"requestId\":\""+request+"\",\"nonce\":\""+new string('1',64)+"\",\"machineHash\":\""+qualified.MachineHash+
        "\",\"operatorSid\":\""+qualified.OperatorSid+"\",\"sourceHead\":\""+qualified.SourceHead+"\",\"sourceTree\":\""+qualified.SourceTree+
        "\",\"packageSha256\":\""+qualified.PackageSha256+"\",\"closureSha256\":\""+qualified.ClosureSha256+"\",\"releaseProofSha256\":\""+qualified.ReleaseProofSha256+
        "\",\"enrollmentGeneration\":1,\"requestedAtUtc\":\""+now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture)+
        "\",\"expiresAtUtc\":\""+now.AddMinutes(5).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture)+"\"}";
      var candidate=SovereignMobileInstallAssertionV1.ReadCandidateBindingV1(json);
      var blocked=new System.Threading.Tasks.TaskCompletionSource<SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1>();
      var operation=typeof(SovereignMobileInstallEntryV1).GetField("originalOperation",Hidden);
      var retained=typeof(SovereignMobileInstallEntryV1).GetField("retainedCandidate",Hidden);
      var reserve=typeof(SovereignMobileInstallEntryV1).GetMethod("ReserveApproval",Hidden);
      operation.SetValue(null,blocked.Task);retained.SetValue(null,candidate);int duplicates=0;
      try {
        for(int i=0;i<workers.Length;i++)workers[i]=System.Threading.Tasks.Task.Factory.StartNew(delegate {
          if((bool)reserve.Invoke(null,new object[]{candidate,"SYNTHETIC_NO_EXECUTION"}))System.Threading.Interlocked.Increment(ref duplicates);
        });
        System.Threading.Tasks.Task.WaitAll(workers);
        if(duplicates!=0 || !System.Object.ReferenceEquals(operation.GetValue(null),blocked.Task) || activeField.GetValue(null)!=null)
          throw new System.Exception("ENTRY_REDISPATCHED_OR_REPLACED_ORIGINAL");
        if(!(bool)typeof(SovereignMobileInstallEntryV1).GetMethod("PendingOperation",Hidden).Invoke(null,null))
          throw new System.Exception("ENTRY_CAN_EXIT_WITH_PENDING_NATIVE_TASK");
      }finally{blocked.SetResult(null);operation.SetValue(null,null);retained.SetValue(null,null);}
      return new {singleExecutorReservation=admitted,duplicateEntryDispatches=duplicates,prejournalCancellationRetained=true,
        originalTaskIdentityPreserved=true,productionFactoryInvoked=false};
    }
    static object PipeFixture() {
      string name="Stephanos.MobileInstallFixture."+System.Guid.NewGuid().ToString("N"),sid;
      using(var identity=System.Security.Principal.WindowsIdentity.GetCurrent())sid=identity.User.Value;
      var create=typeof(SovereignMobileInstallEntryV1).GetMethod("CreateServer",Hidden);
      var read=typeof(SovereignMobileInstallEntryV1).GetMethod("ReadFrame",Hidden);
      var write=typeof(SovereignMobileInstallEntryV1).GetMethod("WriteFrame",Hidden);
      var respond=typeof(SovereignMobileInstallEntryV1).GetMethod("WriteResponseAndDisconnect",Hidden);
      var receive=typeof(SovereignMobileInstallEntryV1).GetMethod("ReadResponseAndAcknowledge",Hidden);
      var verify=typeof(SovereignMobileInstallEntryV1).GetMethod("VerifyClient",Hidden);
      var verifyServer=typeof(SovereignMobileInstallEntryV1).GetMethod("VerifyServer",Hidden);
      using(var server=(System.IO.Pipes.NamedPipeServerStream)create.Invoke(null,new object[]{name,sid})) {
        var acl=server.GetAccessControl();bool exact=false,ownerRights=false;
        if(acl.GetOwner(typeof(System.Security.Principal.SecurityIdentifier)).Value!=sid || !acl.AreAccessRulesProtected)
          throw new System.Exception("PIPE_FIXTURE_OWNER_UNPROVEN");
        foreach(System.IO.Pipes.PipeAccessRule rule in acl.GetAccessRules(true,true,typeof(System.Security.Principal.SecurityIdentifier))) {
          if(rule.AccessControlType!=System.Security.AccessControl.AccessControlType.Allow)throw new System.Exception("PIPE_UNEXPECTED_RULE");
          if(rule.IdentityReference.Value=="S-1-3-4" && (int)rule.PipeAccessRights==0x00020000){ownerRights=true;continue;}
          if(rule.IdentityReference.Value!=sid || (int)rule.PipeAccessRights!=SovereignMobileInstallEntryV1.ClientRights)
            throw new System.Exception("PIPE_OVERBROAD_OPERATOR_RIGHTS");exact=true;
        }
        if(!exact || !ownerRights)throw new System.Exception("PIPE_OPERATOR_ACL_ABSENT");
        using(var forbidden=CreateFileW(@"\\.\pipe\"+name,0x00040000,0,System.IntPtr.Zero,3,0,System.IntPtr.Zero)) {
          int error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();
          if(!forbidden.IsInvalid || error!=5)throw new System.Exception("PIPE_OWNER_WRITE_DAC_NOT_DENIED:"+error);
        }
        bool duplicate=false;try{using(var second=(System.IO.Pipes.NamedPipeServerStream)create.Invoke(null,new object[]{name,sid})){}}
        catch{duplicate=true;}if(!duplicate)throw new System.Exception("PIPE_SECOND_FIRST_INSTANCE_ACCEPTED");
        var responding=new System.Threading.ManualResetEvent(false);
        var worker=System.Threading.Tasks.Task.Factory.StartNew(delegate {
          var waiting=server.BeginWaitForConnection(null,null);
          if(!waiting.AsyncWaitHandle.WaitOne(5000))throw new System.Exception("PIPE_FIXTURE_CONNECT_TIMEOUT");server.EndWaitForConnection(waiting);
          verify.Invoke(null,new object[]{server,sid});
          var command=MobileInstallPipeRequestV1.Parse((string)read.Invoke(null,new object[]{server}));
          if(command.Operation!="PREPARE")throw new System.Exception("PIPE_FIXTURE_COMMAND_CHANGED");
          responding.Set();respond.Invoke(null,new object[]{server,"SYNTHETIC_TRANSPORT_ONLY"});
        });
        using(var client=new System.IO.Pipes.NamedPipeClientStream(".",name,(System.IO.Pipes.PipeAccessRights)SovereignMobileInstallEntryV1.ClientRights,
          System.IO.Pipes.PipeOptions.Asynchronous,System.Security.Principal.TokenImpersonationLevel.Identification,System.IO.HandleInheritability.None)) {
          client.Connect(5000);bool wrongServer=false;
          try{verifyServer.Invoke(null,new object[]{client});}catch(System.Reflection.TargetInvocationException error){
            if(error.InnerException.Message!="MOBILE_PIPE_SERVER_IMAGE_UNPROVEN")throw;wrongServer=true;}
          if(!wrongServer)throw new System.Exception("SAME_SID_WRONG_SERVER_IMAGE_ACCEPTED");
          write.Invoke(null,new object[]{client,"STEPHANOS_MOBILE_INSTALL_PIPE_V1|PREPARE"});
          if(!responding.WaitOne(5000))throw new System.Exception("PIPE_FIXTURE_RESPONSE_NOT_STARTED");
          // Exercise production Write->ACK->Disconnect with a genuinely late
          // client read; waiting for the read before server disposal hid this.
          System.Threading.Thread.Sleep(200);
          if(worker.IsCompleted)throw new System.Exception("PIPE_DISCONNECTED_BEFORE_CLIENT_READ");
          if((string)receive.Invoke(null,new object[]{client})!="SYNTHETIC_TRANSPORT_ONLY")throw new System.Exception("PIPE_FIXTURE_RESPONSE_CHANGED");
        }
        if(!worker.Wait(5000))throw new System.Exception("PIPE_FIXTURE_WORKER_TIMEOUT");
        responding.Dispose();
        return new {localPipeProven=true,exactOperatorAcl=true,ownerWriteDacDenied=true,delayedReadAcknowledgedBeforeDisconnect=true,
          duplicateFirstInstanceRefused=true,wrongServerImageRefused=true,productionListenerStarted=false};
      }
    }
    static object FailedAcknowledgements() {
      var create=typeof(SovereignMobileInstallEntryV1).GetMethod("CreateServer",Hidden);
      var respond=typeof(SovereignMobileInstallEntryV1).GetMethod("WriteResponseAndDisconnect",Hidden);
      var read=typeof(SovereignMobileInstallEntryV1).GetMethod("ReadFrame",Hidden);
      string sid;using(var identity=System.Security.Principal.WindowsIdentity.GetCurrent())sid=identity.User.Value;
      var rows=new System.Collections.Generic.List<object>();
      foreach(string mode in new[]{"wrong","absent","disconnected"}) {
        string name="Stephanos.MobileInstallFixture."+System.Guid.NewGuid().ToString("N");
        using(var server=(System.IO.Pipes.NamedPipeServerStream)create.Invoke(null,new object[]{name,sid})) {
          var worker=System.Threading.Tasks.Task.Factory.StartNew(delegate {
            server.WaitForConnection();var clock=System.Diagnostics.Stopwatch.StartNew();
            try {respond.Invoke(null,new object[]{server,"SYNTHETIC_TRANSPORT_ONLY"});throw new System.Exception("INVALID_ACK_ACCEPTED");}
            catch(System.Reflection.TargetInvocationException error) {
              string reason=error.InnerException.Message;
              if(reason!=(mode=="wrong"?"MOBILE_PIPE_TRANSPORT_ACK_INVALID":mode=="absent"?"MOBILE_PIPE_IO_DEADLINE":"MOBILE_PIPE_DISCONNECTED"))throw;
              if(clock.ElapsedMilliseconds>4500)throw new System.Exception("ACK_DEADLINE_UNBOUNDED");
              return reason;
            }
          });
          using(var client=new System.IO.Pipes.NamedPipeClientStream(".",name,(System.IO.Pipes.PipeAccessRights)SovereignMobileInstallEntryV1.ClientRights,
            System.IO.Pipes.PipeOptions.Asynchronous,System.Security.Principal.TokenImpersonationLevel.Identification,System.IO.HandleInheritability.None)) {
            client.Connect(5000);if((string)read.Invoke(null,new object[]{client})!="SYNTHETIC_TRANSPORT_ONLY")throw new System.Exception("ACK_FIXTURE_FRAME_CHANGED");
            if(mode=="wrong")client.WriteByte(7);
            if(mode!="disconnected" && !worker.Wait(5000))throw new System.Exception("ACK_FIXTURE_WAIT_UNBOUNDED");
          }
          if(!worker.Wait(5000))throw new System.Exception("ACK_FIXTURE_DISCONNECT_UNBOUNDED");
          rows.Add(new{mode,reason=worker.Result});
        }
      }
      return new{rows,productionListenerStarted=false,executionDispatched=false};
    }
    public static int Main(string[] args) {
      try {
        object result;
        if(args[0]=="protocol")result=Protocol((string[])Json.Deserialize(System.IO.File.ReadAllText(args[1]),typeof(string[])));
        else if(args[0]=="prepared")result=Prepared(args[1],System.IO.File.ReadAllText(args[2]));
        else if(args[0]=="concurrency")result=Concurrency(System.IO.File.ReadAllText(args[1]));
        else if(args[0]=="pipe")result=PipeFixture();
        else if(args[0]=="ack-failures")result=FailedAcknowledgements();
        else throw new System.Exception("FIXTURE_MODE_INVALID");
        System.Console.Write(Json.Serialize(result));return 0;
      }catch(System.Exception error){while(error.InnerException!=null)error=error.InnerException;System.Console.Error.Write(error.GetType().Name+":"+error.Message);return 1;}
    }
  }
}`;

function fixture(mode, data) {
  const directory = mkdtempSync(join(tmpdir(), 'mobile-entry-fixture-'));
  const source = join(directory, 'fixture.cs'), exe = join(directory, 'fixture.exe'), input = join(directory, 'input.json');
  try {
    writeFileSync(source, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + runner);
    writeFileSync(input, JSON.stringify(data));
    const compile = `$ErrorActionPreference='Stop';$p=[CodeDom.Compiler.CompilerParameters]::new();` +
      `$p.GenerateExecutable=$true;$p.GenerateInMemory=$false;$p.OutputAssembly=${literal(exe)};` +
      `$p.CompilerOptions='/target:exe /main:Stephanos.Sovereign.MobileEntryFixtureRunnerV1';` +
      `$p.TempFiles=[CodeDom.Compiler.TempFileCollection]::new(${literal(directory)},$false);` +
      `foreach($r in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll')){[void]$p.ReferencedAssemblies.Add($r)};` +
      `$compiler=[Microsoft.CSharp.CSharpCodeProvider]::new();try{$result=$compiler.CompileAssemblyFromSource($p,@([IO.File]::ReadAllText(${literal(source)})));` +
      `if($result.Errors.HasErrors){foreach($e in $result.Errors){[Console]::Error.WriteLine($e.ToString())};exit 1};[Console]::Write('COMPILED')}` +
      `finally{$compiler.Dispose();$p.TempFiles.Delete()}`;
    const compiled = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(compile, 'utf16le').toString('base64')],
      { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 65536 });
    assert.equal(compiled.error, undefined); assert.equal(compiled.status, 0, compiled.stderr); assert.equal(compiled.stdout, 'COMPILED');
    const result = spawnSync(exe, mode === 'prepared' ? [mode, directory, input] : [mode, input],
      { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 1048576 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('mobile-entry-fixture-'));
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
}

test('Windows compiled strict local protocol admits only four operations and original IDs/assertions',
  { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  const prefix = 'STEPHANOS_MOBILE_INSTALL_PIPE_V1', id = 'mobile-install-fixture-12345678';
  const accepted = [`${prefix}|PREPARE`, `${prefix}|RECONCILE|${id}`, `${prefix}|CANCEL|${id}`,
    `${prefix}|APPROVE|${id}|${Buffer.from('{"type":"public-key"}').toString('base64')}`];
  const rejected = ['', `${prefix}|INSTALL|${id}`, `${prefix}|PREPARE|source=main`, `${prefix}|RECONCILE`,
    `${prefix}|RECONCILE|${id}|extra`, `${prefix}|CANCEL|foreign`, `${prefix}|APPROVE|${id}|YQ===`,
    `${prefix}|APPROVE|${id}|${Buffer.from([0xff]).toString('base64')}`, `${prefix}|PREPARE\n`,
    `${prefix}|PREPARE\0`, `${prefix}|APPROVE|${id}|${Buffer.alloc(16385).toString('base64')}`, 'x'.repeat(32769)];
  const rows = fixture('protocol', [...accepted, ...rejected]);
  assert.deepEqual(rows.map(row => row.allowed), [...accepted.map(() => true), ...rejected.map(() => false)]);
  assert.equal(rows[3].assertion, '{"type":"public-key"}');
});

test('Windows compiled native preparation persists canonical identity/nonce in the same anchored WAL across restart and cancellation',
  { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  const result = fixture('prepared', enrollment);
  assert.equal(result.productionFactoryInvoked, false); assert.equal(result.unanchoredReopenHeld, true);
  assert.deepEqual(result.rows.map(row => row.state), ['PREPARED', 'CANCELLED', 'PREPARED']);
  assert.deepEqual(result.rows.map(row => row.sequence), [1, 2, 3]);
  const first = JSON.parse(result.rows[0].candidate), second = JSON.parse(result.rows[2].candidate);
  assert.notEqual(first.requestId, second.requestId); assert.notEqual(first.nonce, second.nonce);
  assert.equal(first.sourceHead, 'a'.repeat(40)); assert.equal(first.machineHash, enrollment.machineHash);
  assert.equal(Date.parse(first.expiresAtUtc) - Date.parse(first.requestedAtUtc), 300000);
});

test('Windows private random pipe proves exact SID data rights, bounded framing and first-instance exclusion',
  { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  assert.deepEqual(fixture('pipe', {}), { localPipeProven: true, exactOperatorAcl: true,
    ownerWriteDacDenied: true, delayedReadAcknowledgedBeforeDisconnect: true,
    duplicateFirstInstanceRefused: true, wrongServerImageRefused: true, productionListenerStarted: false });
});

test('Windows private pipe requires bounded transport acknowledgement and rejects wrong, absent or disconnected clients',
  { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  assert.deepEqual(fixture('ack-failures', {}), {rows: [
    { mode: 'wrong', reason: 'MOBILE_PIPE_TRANSPORT_ACK_INVALID' },
    { mode: 'absent', reason: 'MOBILE_PIPE_IO_DEADLINE' },
    { mode: 'disconnected', reason: 'MOBILE_PIPE_DISCONNECTED' },
  ], productionListenerStarted: false, executionDispatched: false});
});

test('Windows native owner atomically retains one request, pre-journal cancellation and one background task without redispatch',
  { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  assert.deepEqual(fixture('concurrency', enrollment), { singleExecutorReservation: 1, duplicateEntryDispatches: 0,
    prejournalCancellationRetained: true, originalTaskIdentityPreserved: true, productionFactoryInvoked: false });
});
