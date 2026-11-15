import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

// Only the private CLOSED benign child fixture is invoked. Production factory,
// protected store, enrollment, signing key and installer are never opened.
const harness = String.raw`
namespace Stephanos.Sovereign {
  public static partial class CoreJobCustodyV1 {
    static partial void MobileExecutorFixturePayloadV1(string mode,ref string script,ref string file) {
      if(mode=="bounded-descendant") {
        file=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"mobile-parent-exit-fixture-"+System.Guid.NewGuid().ToString("N")+".ready");
        string ready=file.Replace("'","''");
        // Parent cannot exit until the child has retained the exact parent
        // handle and checked its creation time. The natural 150ms lifetime
        // starts after that handle signals, never at child launch/PID reuse.
        string child="$ErrorActionPreference='Stop';$original=[Diagnostics.Process]::GetProcessById(__PARENT_PID__);try{"+
          "$null=$original.Handle;if($original.Id -ne __PARENT_PID__ -or $original.StartTime.ToUniversalTime().Ticks -ne [long]'__PARENT_BIRTH__' -or $original.HasExited){throw 'FIXTURE_PARENT_IDENTITY_UNPROVEN'};"+
          "[IO.File]::WriteAllText('"+ready+"','PARENT_BOUND:__PARENT_PID__:__PARENT_BIRTH__');"+
          "if(-not $original.WaitForExit(5000)){throw 'FIXTURE_PARENT_EXIT_TIMEOUT'};[Threading.Thread]::Sleep(150)}finally{$original.Dispose()}";
        script="$ErrorActionPreference='Stop';$parent=[Diagnostics.Process]::GetCurrentProcess();try{"+
          "$birth=[string]$parent.StartTime.ToUniversalTime().Ticks;$expected='PARENT_BOUND:'+$PID+':'+$birth;"+
          "$source='"+child.Replace("'","''")+"';$source=$source.Replace('__PARENT_PID__',[string]$PID).Replace('__PARENT_BIRTH__',$birth);"+
          "$arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source));"+
          "$p=[Diagnostics.ProcessStartInfo]::new('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',$arguments);$p.UseShellExecute=$false;$p.CreateNoWindow=$true;"+
          "$child=[Diagnostics.Process]::Start($p);try{$wait=[Diagnostics.Stopwatch]::StartNew();while(-not [IO.File]::Exists('"+ready+"')){"+
          "if($child.HasExited -or $wait.ElapsedMilliseconds -ge 5000){throw 'FIXTURE_PARENT_BIND_TIMEOUT'};[Threading.Thread]::Sleep(10)};"+
          "if([IO.File]::ReadAllText('"+ready+"') -cne $expected){throw 'FIXTURE_PARENT_BIND_CHANGED'};"+
          "[Console]::Write('BENIGN_OWNED_DESCENDANT')}finally{$child.Dispose()}}finally{$parent.Dispose()}";
      } else if(mode=="persistent-descendant") {
        script="$ErrorActionPreference='Stop';$p=[Diagnostics.ProcessStartInfo]::new('C:\\Program Files\\nodejs\\node.exe','-e \""+
          "setInterval(()=>{},1000)\"');$p.UseShellExecute=$false;$p.CreateNoWindow=$true;"+
          "$child=[Diagnostics.Process]::Start($p);$child.Dispose();[Console]::Write('BENIGN_OWNED_DESCENDANT')";
      } else if(mode=="compiler-child") {
        script="$ErrorActionPreference='Stop';$p=[CodeDom.Compiler.CompilerParameters]::new();$p.GenerateInMemory=$true;$c=[Microsoft.CSharp.CSharpCodeProvider]::new();try{$r=$c.CompileAssemblyFromSource($p,@('public static class BenignMobileFixture {public static int Value(){return 42;}}'));if($r.Errors.HasErrors){exit 9};[Console]::Write('BENIGN_COMPILER_CHILD')}finally{$c.Dispose()}";
      } else {
        file=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"mobile-sealed-loader-fixture-"+System.Guid.NewGuid().ToString("N")+".ps1");
        byte[] bytes=System.Text.Encoding.UTF8.GetBytes("[Console]::Write('BENIGN_SEALED_LOADER')");System.IO.File.WriteAllBytes(file,bytes);
        script=MobileSealedBootstrapLoaderV1(file,mode=="sealed-loader"?RuntimeHashV1(bytes):new string('0',64));
      }
    }
  }
  public static class MobileExecutorFixtureRunnerV1 {
    static readonly System.Reflection.BindingFlags Hidden=System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.Instance;
    static void Check(bool condition,string message){if(!condition)throw new System.Exception(message);}
    static FixedRuntimeStageV1 Run(string mode) {
      var method=typeof(CoreJobCustodyV1).GetMethod("MobileInstallerFixtureV1",Hidden);
      Check(method!=null && method.IsPrivate,"FIXTURE_SHIPPING_SURFACE_EXPOSED");
      using(var run=(CoreJobCustodyV1.MobileInstallerNativeRunV1)method.Invoke(null,new object[]{mode})){
        LastObserverCalls=run.ResumeObserverCalls;return run.Stage;
      }
    }
    static int LastObserverCalls;
    public static string Run() {
      var results=new System.Collections.Generic.List<object>();
      System.Action<string,System.Action> test=(name,body)=>{try{body();results.Add(new{name,passed=true,reason=""});}catch(System.Exception error){
        while(error is System.Reflection.TargetInvocationException && error.InnerException!=null)error=error.InnerException;
        results.Add(new{name,passed=false,reason=error.GetType().Name+":"+error.Message});}};
      test("console adapter selects only the exact canonical PowerShell path",()=>{
        var select=typeof(CoreJobCustodyV1).GetMethod("RuntimeConsoleCreationFlagV1",Hidden);
        Check((uint)select.Invoke(null,new object[]{@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"})==0x08000000u,"FIXED_PS_CONSOLE_UNPROVEN");
        foreach(string path in new[]{@"C:\Program Files\nodejs\node.exe",@"C:\untrusted\powershell.exe",@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe.extra",null})
          Check((uint)select.Invoke(null,new object[]{path})==8u,"OTHER_CONSOLE_BEHAVIOUR_CHANGED");
      });
      test("actual fixed PowerShell root is atomically assigned before resume and drains",()=>{
        var stage=Run("complete");Check(stage.OperationOk,"COMPLETE:"+stage.Reason);
        Check(stage.Launched && stage.AssignedBeforeExecution && stage.ParentBindingAccepted && stage.ResumeConfirmed,"ASSIGN_RESUME_UNPROVEN");
        Check(LastObserverCalls==1,"ACTUAL_POST_RESUME_OBSERVER_NOT_CALLED_ONCE");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased && stage.ActiveProcesses==0,"DRAIN_UNPROVEN");
        Check(stage.OutputComplete && stage.Output=="BENIGN_MOBILE_EXECUTOR_FIXTURE","OUTPUT_UNPROVEN:"+new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(stage));
        var birth=System.DateTime.Parse(stage.RootCreatedAtUtc,System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind);
        var resumed=System.DateTime.ParseExact(stage.ResumeConfirmedAtUtc,"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal|System.Globalization.DateTimeStyles.AdjustToUniversal);
        Check(resumed.Ticks+System.TimeSpan.TicksPerMillisecond>birth.Ticks && resumed<=System.DateTime.UtcNow,"ACTUAL_RESUME_TIME_UNPROVEN");
      });
      test("rejected durable-parent binding never resumes a suspended root",()=>{
        var stage=Run("reject-binding");Check(stage.AssignedBeforeExecution && !stage.ResumeConfirmed && stage.ResumeConfirmedAtUtc=="","REJECTED_ROOT_RESUMED");
        Check(LastObserverCalls==0,"OBSERVER_CALLED_BEFORE_RESUME");
        Check(!stage.OperationOk && stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"REJECTED_ROOT_CUSTODY_UNPROVEN");
      });
      test("cancellation before launch produces no child or execution timestamp",()=>{
        var stage=Run("cancel-before");Check(!stage.Launched && stage.RootPid==0 && !stage.ResumeConfirmed && stage.ResumeConfirmedAtUtc=="","CANCELLED_ROOT_STARTED");
        Check(LastObserverCalls==0,"CANCELLED_ROOT_OBSERVER_CALLED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"PRELAUNCH_CUSTODY_UNPROVEN");
      });
      test("nonzero child exit cannot become an installation success",()=>{
        var stage=Run("failed");Check(!stage.OperationOk && stage.NormalRootExit && stage.ExitCode==7,"FAILED_CHILD_ACCEPTED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"FAILED_CHILD_NOT_DRAINED");
      });
      test("failed durable start observer kills and drains without successful execution receipt",()=>{
        var stage=Run("observer-failure");Check(stage.ResumeConfirmed && LastObserverCalls==1 && !stage.OperationOk,"OBSERVER_FAILURE_ACCEPTED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"OBSERVER_FAILURE_CUSTODY_UNPROVEN");
      });
      test("output overflow cancels and retains honest native accounting",()=>{
        var stage=Run("overflow");Check(!stage.OperationOk && stage.OutputOverflow,"OUTPUT_BOUND_NOT_ENFORCED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"OVERFLOW_NOT_DRAINED");
      });
      test("deadline terminates the SAME owned Job and proves zero active",()=>{
        var stage=Run("deadline");Check(!stage.OperationOk && stage.CancellationRequested,"DEADLINE_NOT_ENFORCED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"DEADLINE_NOT_DRAINED");
      });
      test("real harmless CodeDom compiler descendant completes inside bounded Job",()=>{
        var stage=Run("compiler-child");Check(stage.OperationOk,"COMPILER:"+stage.Reason+":"+stage.Output);
        Check(stage.Output=="BENIGN_COMPILER_CHILD" && stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"COMPILER_ACCOUNTING_UNPROVEN");
      });
      test("natural short-lived descendant drain requires real Job zero before success",()=>{
        var stage=Run("bounded-descendant");Check(stage.OperationOk,"BOUNDED_DESCENDANT:"+stage.Reason);
        Check(stage.NormalRootExit && stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased && stage.ActiveProcesses==0,"NATURAL_DRAIN_ZERO_UNPROVEN");
        Check(stage.ObservedLiveDescendantPid>0 && stage.Output=="BENIGN_OWNED_DESCENDANT","NATIVE_DESCENDANT_NOT_OBSERVED:"+stage.Reason+":"+stage.Output+":"+stage.ElapsedMilliseconds);
        Check(!stage.CancellationRequested,"NATURAL_DRAIN_BECAME_CLEANUP_SUCCESS");
      });
      test("persistent descendant cannot outlive original deadline or turn termination into success",()=>{
        var stage=Run("persistent-descendant");Check(!stage.OperationOk && stage.CancellationRequested && stage.ObservedLiveDescendantPid>0,"PERSISTENT_DESCENDANT_ACCEPTED:"+stage.Reason+":"+stage.Output+":"+stage.ObservedLiveDescendantPid+":"+stage.ElapsedMilliseconds);
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased && stage.ActiveProcesses==0,"PERSISTENT_DESCENDANT_CUSTODY_UNPROVEN");
        Check(stage.ElapsedMilliseconds<6500,"ORIGINAL_DRAIN_BUDGET_WIDENED");
      });
      test("sealed bootstrap loader executes only exact pinned benign file bytes",()=>{
        var stage=Run("sealed-loader");Check(stage.OperationOk && stage.Output=="BENIGN_SEALED_LOADER","SEALED_LOADER_FAILED:"+stage.Reason);
        Check(stage.AssignedBeforeExecution && stage.ResumeConfirmed && stage.ZeroActiveProcessesObserved,"SEALED_LOADER_CUSTODY_UNPROVEN");
      });
      test("wrong sealed bootstrap hash refuses before script body executes",()=>{
        var stage=Run("sealed-loader-wrong-hash");Check(!stage.OperationOk && stage.ExitCode!=0 && !stage.Output.Contains("BENIGN_SEALED_LOADER"),"UNPINNED_BOOTSTRAP_EXECUTED");
        Check(stage.ZeroActiveProcessesObserved && stage.ExecutionCustodyReleased,"WRONG_BOOTSTRAP_NOT_DRAINED");
      });
      test("fixture cannot accept arbitrary commands or paths",()=>{
        bool rejected=false;try{Run("C:\\not-an-admitted-mode");}catch(System.Reflection.TargetInvocationException error){
          rejected=error.InnerException is System.InvalidOperationException && error.InnerException.Message=="MOBILE_EXECUTOR_FIXTURE_MODE_INVALID";}
        Check(rejected,"ARBITRARY_FIXTURE_MODE_ACCEPTED");
      });
      test("execution evidence is internal, immutable and privately constructed",()=>{
        var type=typeof(SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1);Check(type.IsNestedAssembly && type.IsSealed,"EVIDENCE_SURFACE_PUBLIC");
        foreach(var ctor in type.GetConstructors(Hidden))Check(ctor.IsPrivate,"EVIDENCE_CONSTRUCTOR_EXPOSED");
        foreach(var field in type.GetFields(Hidden))Check(field.IsInitOnly,"EVIDENCE_MUTABLE");
      });
      var pending=new System.Collections.Generic.Dictionary<string,object> {
        {"SchemaVersion","stephanos.fixed-runtime-pending.v1"},{"SourceHead",new string('a',40)},{"SourceTree",new string('b',40)},
        {"HelperSha256",new string('c',64)},{"ManifestSha256",new string('d',64)},{"GitClosureSha256",new string('e',64)},{"MachineHash",new string('f',64)},
        {"CompilerCompletedAtUtc","2026-11-14T14:00:00.0000000Z"},{"InstalledAtUtc","2026-11-14T14:00:01.0000000Z"},{"OperatorSid","S-1-5-21-1-2-3-1001"},
        {"NodeExecutableSha256",new string('1',64)},{"GitExecutableSha256",new string('2',64)},{"PowerShellExecutableSha256",new string('3',64)},
        {"NodeExecutableLinkCount",1},{"GitExecutableLinkCount",1},{"PowerShellExecutableLinkCount",2}};
      string pendingJson=new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(pending);
      var parsePending=typeof(CoreJobCustodyV1.MobileInstallerReadBackV1).GetMethod("Pending",Hidden);
      test("pending readback parser accepts the exact immutable installer protocol",()=>{
        var row=(System.Collections.Generic.Dictionary<string,string>)parsePending.Invoke(null,new object[]{pendingJson});
        Check(row.Count==16 && row["SourceHead"]==new string('a',40) && row["PowerShellExecutableLinkCount"]=="2","PENDING_PROTOCOL_CHANGED");
      });
      string[] attacks={pendingJson.Replace("\"NodeExecutableLinkCount\":1","\"NodeExecutableLinkCount\":\"1\""),
        pendingJson.Replace("\"NodeExecutableLinkCount\":1","\"NodeExecutableLinkCount\":true"),
        pendingJson.Replace("\"NodeExecutableLinkCount\":1","\"NodeExecutableLinkCount\":1,\"NodeExecutableLinkCount\":1"),
        pendingJson.Replace("\"SourceHead\"","\"Source\\u0048ead\""),pendingJson.Replace("\"SourceHead\"","\"Executable\""),
        pendingJson+"{}",pendingJson.Replace("\"NodeExecutableLinkCount\":1","\"NodeExecutableLinkCount\":01"),
        "\u00a0"+pendingJson,new string(' ',32769)+pendingJson,pendingJson.Replace(",\"PowerShellExecutableLinkCount\":2","")};
      for(int index=0;index<attacks.Length;index++) {
        string raw=attacks[index];test("pending parser refuses structural attack "+index,()=>{
          bool refused=false;try{parsePending.Invoke(null,new object[]{raw});}catch(System.Reflection.TargetInvocationException error){
            refused=error.InnerException is System.InvalidOperationException && error.InnerException.Message.StartsWith("MOBILE_READBACK_",System.StringComparison.Ordinal);}
          Check(refused,"AMBIGUOUS_PENDING_ACCEPTED");
        });
      }
      test("actual resume-time parser preserves explicit UTC without accepting local time",()=>{
        var parse=typeof(CoreJobCustodyV1.MobileInstallerReadBackV1).GetMethod("Time",Hidden);
        var time=(System.DateTime)parse.Invoke(null,new object[]{"2026-11-14T14:00:00.123Z","yyyy-MM-dd'T'HH:mm:ss.fff'Z'"});
        Check(time.Kind==System.DateTimeKind.Utc && time.Millisecond==123,"RESUME_UTC_LOST");
        bool refused=false;try{parse.Invoke(null,new object[]{"2026-11-14T14:00:00.123","yyyy-MM-dd'T'HH:mm:ss.fff'Z'"});}
        catch(System.Reflection.TargetInvocationException){refused=true;}Check(refused,"LOCAL_TIME_ACCEPTED");
      });
      return new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(results);
    }
  }
}`;

test('fixed native executor reuses canonical suspended Job launch with harmless Windows fixtures',
  { skip: process.platform !== 'win32', timeout: 60_000 }, t => {
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-executor-fixture-'));
    const sourcePath = join(root, 'fixture.cs');
    const units = readMobileInstallerNativeSourceV1();
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    try {
      writeFileSync(sourcePath, units.map(row => row.bytes.toString('utf8')).join('\n') + '\n' + harness);
      const script = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop;` +
        `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${literal(sourcePath)})) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileExecutorFixtureRunnerV1]::Run())`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 45_000, maxBuffer: 256 * 1024 });
      assert.equal(result.error, undefined);assert.equal(result.status, 0, result.stderr);
      const cases = JSON.parse(result.stdout);assert.equal(cases.length, 27);
      assert.deepEqual(cases.filter(row => !row.passed), []);
      t.diagnostic('27 native launch/observer/cancellation/bounds/drain/sealed-loader/readback-parser cases; closed benign PowerShell only; no production enrollment or installation');
    } finally {
      try { unlinkSync(sourcePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      rmdirSync(root);
    }
  });
