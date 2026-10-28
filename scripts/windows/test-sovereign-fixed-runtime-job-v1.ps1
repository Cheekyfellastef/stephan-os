param([Parameter(Mandatory=$true)][string]$FixtureNodePath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('stph-runtime-job-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
# Fixture-only executable placement exercises hosted-tool-cache portability.
# No production executor accepts or consumes this path.
$fixtureNode = Join-Path $fixtureRoot 'fixed-fixture-node.exe'
[IO.File]::Copy([IO.Path]::GetFullPath($FixtureNodePath),$fixtureNode,$false)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $originalDigest = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($FixtureNodePath)))).Replace('-','').ToLowerInvariant()
  $copyDigest = ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($fixtureNode)))).Replace('-','').ToLowerInvariant()
} finally { $sha.Dispose() }
if ($copyDigest -cne $originalDigest) { throw 'FIXTURE_EXECUTABLE_COPY_CHANGED' }
$worker = @'
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [mode,witness,ack] = process.argv.slice(2);
let child;
if (mode === 'orphan') child = spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore',windowsHide:true,detached:true});
fs.writeFileSync(witness,String(process.pid)+'|'+String(child?.pid||0));
const waiting = setInterval(()=>{
  if (!fs.existsSync(ack)) return;
  clearInterval(waiting);
  if (mode === 'normal') { process.stdout.write('normal'); process.exitCode=0; }
  else if (mode === 'failed') { process.stdout.write('failed'); process.exitCode=2; }
  else if (mode === 'input') { process.stdout.write(String(fs.readFileSync(0).length)); }
  else if (mode === 'orphan') { process.exit(0); }
  else if (mode === 'overflow') { process.stdout.write('x'.repeat(20000)); setTimeout(()=>{},30000); }
  else { setTimeout(()=>{},30000); }
},5);
'@
[IO.File]::WriteAllText((Join-Path $fixtureRoot 'worker.mjs'),$worker,[Text.UTF8Encoding]::new($false))
$fixtureCode = @'
namespace Stephanos.Sovereign {
 using System;
 using System.Diagnostics;
 using System.IO;
 using System.Runtime.InteropServices;
 using System.Text;
 using System.Threading;
 using System.Threading.Tasks;
 public sealed class FixedRuntimeFixtureResultV1 {
   public string Mode, RootCreatedAtUtc="", DescendantCreatedAtUtc="", RootImagePath="";
   public FixedRuntimeStageV1 Receipt;
   public bool RootCaptured, RootEndedByHandle, DescendantCaptured, DescendantEndedByHandle;
   public bool SourceMutationAllowed=false, RuntimeQualified=false;
 }
 public static partial class CoreJobCustodyV1 {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder name,ref uint size);
  public static FixedRuntimeFixtureResultV1 FixedRuntimeFixtureV1(string directory,string mode,string fixtureNode) {
   if(!System.Text.RegularExpressions.Regex.IsMatch(mode,
     "^(normal|failed|input|deadline|orphan|overflow|query|cancel|parent-death|spawn-fail)$"))
     throw new InvalidOperationException("FIXTURE_MODE_INVALID");
   var result=new FixedRuntimeFixtureResultV1 { Mode=mode };
   string witness=Path.Combine(directory,mode+".witness"),ack=Path.Combine(directory,mode+".ack");
   var current=Process.GetCurrentProcess(); Process fakeOwner=null;
   IntPtr owner=IntPtr.Zero,launcher=IntPtr.Zero,job=IntPtr.Zero,rootHandle=IntPtr.Zero,descendant=IntPtr.Zero;
   int captured=0,finished=0; Task observer=null,killer=null;
   try {
    long created,exited,kernel,user;
    IntPtr currentHandle=RuntimeOpenProcessV1(0x101000,false,(uint)current.Id);
    if(currentHandle==IntPtr.Zero) throw new InvalidOperationException("FIXTURE_OWNER_UNAVAILABLE");
    try { Require(RuntimeProcessTimesV1(currentHandle,out created,out exited,out kernel,out user)); }
    finally { CloseHandle(currentHandle); }
    launcher=RuntimeOwnerHandleV1(current.Id,created);
    if(mode=="parent-death") {
      var info=new ProcessStartInfo(fixtureNode,"-e \"setTimeout(()=>{},30000)\"");
      info.UseShellExecute=false; info.CreateNoWindow=true;
      fakeOwner=Process.Start(info);
      IntPtr h=RuntimeOpenProcessV1(0x101000,false,(uint)fakeOwner.Id);
      try { Require(RuntimeProcessTimesV1(h,out created,out exited,out kernel,out user)); }
      finally { CloseHandle(h); }
      owner=RuntimeOwnerHandleV1(fakeOwner.Id,created);
    } else owner=RuntimeOwnerHandleV1(current.Id,created);
    job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero); Require(job!=IntPtr.Zero);
    var limits=new EXTENDED_LIMIT();
    limits.basic.flags=0x2000|0x400|0x8; limits.basic.activeLimit=16;
    Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
    observer=Task.Factory.StartNew(delegate {
      var wait=Stopwatch.StartNew();
      while(wait.ElapsedMilliseconds<10000 && Interlocked.CompareExchange(ref finished,0,0)==0) {
        if(File.Exists(witness)) {
          try {
            string[] ids=File.ReadAllText(witness).Split('|');
            int rootPid=Int32.Parse(ids[0]), childPid=Int32.Parse(ids[1]);
            rootHandle=RuntimeOpenProcessV1(0x101000,false,(uint)rootPid);
            if(rootHandle==IntPtr.Zero) throw new InvalidOperationException("ROOT_CAPTURE_FAILED");
            bool member; Require(IsProcessInJob(rootHandle,job,out member)); Require(member);
            long born,ended,k,u; Require(RuntimeProcessTimesV1(rootHandle,out born,out ended,out k,out u));
            result.RootCreatedAtUtc=DateTime.FromFileTimeUtc(born).ToString("O");
            var image=new StringBuilder(32768); uint imageLength=32768;
            Require(QueryFullProcessImageNameW(rootHandle,0,image,ref imageLength));
            result.RootImagePath=image.ToString();
            if(!String.Equals(Path.GetFullPath(fixtureNode),result.RootImagePath,StringComparison.OrdinalIgnoreCase))
              throw new InvalidOperationException("ROOT_IMAGE_CHANGED");
            result.RootCaptured=true;
            if(childPid>0) {
              descendant=RuntimeOpenProcessV1(0x101000,false,(uint)childPid);
              if(descendant==IntPtr.Zero) throw new InvalidOperationException("DESCENDANT_CAPTURE_FAILED");
              Require(IsProcessInJob(descendant,job,out member)); Require(member);
              Require(RuntimeProcessTimesV1(descendant,out born,out ended,out k,out u));
              result.DescendantCreatedAtUtc=DateTime.FromFileTimeUtc(born).ToString("O");
              result.DescendantCaptured=true;
            }
            Interlocked.Exchange(ref captured,1);
            File.WriteAllText(ack,"ack");
            return;
          } catch {
            if(rootHandle!=IntPtr.Zero) { CloseHandle(rootHandle); rootHandle=IntPtr.Zero; }
            if(descendant!=IntPtr.Zero) { CloseHandle(descendant); descendant=IntPtr.Zero; }
            throw;
          }
        }
        Thread.Sleep(5);
      }
    },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
    if(mode=="parent-death") killer=Task.Factory.StartNew(delegate {
      while(Interlocked.CompareExchange(ref captured,0,0)==0 &&
        Interlocked.CompareExchange(ref finished,0,0)==0) Thread.Sleep(5);
      if(Interlocked.CompareExchange(ref captured,0,0)!=0) { Thread.Sleep(100); fakeOwner.Kill(); }
    });
    var clock=Stopwatch.StartNew();
    string executable=mode=="spawn-fail"?Path.Combine(directory,"missing-owned-fixture.exe"):fixtureNode;
    string args=Quote(Path.Combine(directory,"worker.mjs"))+" "+mode+" "+Quote(witness)+" "+Quote(ack);
    byte[] input=mode=="input"?Encoding.UTF8.GetBytes("fixed-fixture-input"):new byte[0];
    result.Receipt=RunRuntimeStageV1(job,"FIXTURE_ONLY",executable,args,directory,input,clock,
      mode=="deadline"?3000:7000,owner,launcher,
      delegate { return mode=="cancel" && Interlocked.CompareExchange(ref captured,0,0)!=0; },
      delegate { return mode=="query" && Interlocked.CompareExchange(ref captured,0,0)!=0; });
    Interlocked.Exchange(ref finished,1);
    if(observer!=null && !observer.Wait(5000)) throw new InvalidOperationException("OBSERVER_NOT_TERMINAL");
    if(killer!=null && !killer.Wait(5000)) throw new InvalidOperationException("KILLER_NOT_TERMINAL");
    if(rootHandle!=IntPtr.Zero) result.RootEndedByHandle=WaitForSingleObject(rootHandle,5000)==0;
    if(descendant!=IntPtr.Zero) result.DescendantEndedByHandle=WaitForSingleObject(descendant,5000)==0;
    return result;
   } finally {
    Interlocked.Exchange(ref finished,1);
    if(job!=IntPtr.Zero) { TerminateJobObject(job,81); CloseHandle(job); }
    if(fakeOwner!=null) { try { if(!fakeOwner.HasExited) fakeOwner.Kill(); fakeOwner.WaitForExit(5000); } finally { fakeOwner.Dispose(); } }
    if(rootHandle!=IntPtr.Zero) CloseHandle(rootHandle);
    if(descendant!=IntPtr.Zero) CloseHandle(descendant);
    if(owner!=IntPtr.Zero) CloseHandle(owner);
    if(launcher!=IntPtr.Zero) CloseHandle(launcher);
    current.Dispose();
   }
  }
 }
}
'@
$source = [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignCoreJobCustodyV1.cs')) +
  [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeJobV1.cs')) +
  [Environment]::NewLine + $fixtureCode
Add-Type -TypeDefinition $source -ErrorAction Stop
$cases = @()
foreach($mode in @('normal','failed','input','deadline','orphan','overflow','query','cancel','parent-death','spawn-fail')) {
  $r = [Stephanos.Sovereign.CoreJobCustodyV1]::FixedRuntimeFixtureV1($fixtureRoot,$mode,$fixtureNode)
  if ($r.RuntimeQualified -ne $false -or $r.SourceMutationAllowed -ne $false) { throw 'FIXTURE_AUTHORITY_INVALID' }
  if ($mode -ne 'spawn-fail') {
    if (-not $r.RootCaptured -or -not $r.RootEndedByHandle -or
        $r.RootCreatedAtUtc -cne $r.Receipt.RootCreatedAtUtc) { throw ('FIXTURE_ROOT_WITNESS_INVALID:'+ ($r | ConvertTo-Json -Depth 6 -Compress)) }
  }
  if ($mode -eq 'normal' -or $mode -eq 'input') {
    if (-not $r.Receipt.OperationOk -or -not $r.Receipt.ExecutionCustodyReleased) { throw ('FIXTURE_SUCCESS_INVALID:'+ $mode) }
  } else {
    if ($r.Receipt.OperationOk) { throw ('FIXTURE_FALSE_SUCCESS:'+ ($r | ConvertTo-Json -Depth 6 -Compress)) }
  }
  if ($mode -eq 'query') {
    if ($r.Receipt.ExecutionCustodyReleased -or $r.Receipt.ZeroActiveProcessesObserved) { throw 'FIXTURE_QUERY_FALSE_ZERO' }
  } elseif (-not $r.Receipt.ExecutionCustodyReleased -or -not $r.Receipt.ZeroActiveProcessesObserved) {
    throw ('FIXTURE_NATIVE_ZERO_UNPROVEN:'+ $mode)
  }
  if ($mode -eq 'orphan') {
    if (-not $r.DescendantCaptured -or -not $r.DescendantEndedByHandle -or
        $r.Receipt.Reason -cne 'LIVE_DESCENDANT_REMAINS' -or
        $r.DescendantCreatedAtUtc -cne $r.Receipt.ObservedLiveDescendantCreatedAtUtc) { throw 'FIXTURE_DESCENDANT_WITNESS_INVALID' }
  }
  if ($mode -eq 'failed' -and ($r.Receipt.ExitCode -ne 2 -or $r.Receipt.CancellationRequested)) { throw 'FIXTURE_FAILED_OPERATION_PROMOTED' }
  if ($mode -eq 'input' -and $r.Receipt.Output -cne '19') { throw 'FIXTURE_STDIN_UNBOUND' }
  if ($mode -eq 'overflow' -and (-not $r.Receipt.OutputOverflow -or $r.Receipt.OutputComplete)) { throw 'FIXTURE_OUTPUT_FALSE_PROOF' }
  $cases += $r
}
@{schemaVersion='stephanos.fixed-runtime-native-fixture.v1';ok=$true;fixtureExecutable=$fixtureNode;fixtureExecutableSha256=$copyDigest;cases=$cases;runtimeQualified=$false;fixtureRoot=$fixtureRoot} | ConvertTo-Json -Depth 8 -Compress
