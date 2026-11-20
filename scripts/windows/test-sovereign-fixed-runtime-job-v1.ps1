param([Parameter(Mandatory=$true)][string]$FixtureNodePath,
  [ValidateSet('None','Cancel','ParentDeath')][string]$FixtureTerminalGuardBaseline='None',
  [ValidateSet('Atomic','VisiblePartial')][string]$FixtureWitnessPublication='Atomic',
  [ValidateSet('ReadDelete','LegacyNoDeleteSharing')][string]$FixtureWitnessReader='ReadDelete')
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
const [mode,witness,ack,publicationVariant] = process.argv.slice(2);
let child;
if (mode === 'orphan') child = spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore',windowsHide:true,detached:true});
const payload=String(process.pid)+'|'+String(child?.pid||0);
const pending=witness+'.pending';
if(mode==='witness-paused') {
  const staged=publicationVariant==='VisiblePartial'?witness:pending;
  const fd=fs.openSync(staged,'wx');
  fs.writeSync(fd,'not-an-identity');
  const publishing=setInterval(()=>{
    if(!fs.existsSync(witness+'.publish')) return;
    clearInterval(publishing);
    fs.ftruncateSync(fd,0);fs.writeSync(fd,payload,0,'utf8');fs.closeSync(fd);
    if(staged!==witness) fs.renameSync(staged,witness);
  },5);
} else {
  fs.writeFileSync(pending,payload,{flag:'wx'});
  fs.renameSync(pending,witness);
}
const waiting = setInterval(()=>{
  if (!fs.existsSync(ack)) return;
  clearInterval(waiting);
  if (['normal','drain-cancel','drain-parent-death','witness-paused'].includes(mode)) { process.stdout.write('normal'); process.exitCode=0; }
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
   public FixedRuntimeReceiptV1 HostProjection;
   public bool RootCaptured, RootEndedByHandle, DescendantCaptured, DescendantEndedByHandle;
   public bool BoundBeforeExecution, TerminalDrainObserved, PartialWitnessIgnored;
   public bool DeleteHandleHeldBeforeCommit, SameFileAcrossRename;
   public string ObserverFaultCode="", ObserverFaultType="", ObserverFaultPhase="";
   public int ObserverFaultHResult, ObserverFaultWin32;
   public bool SourceMutationAllowed=false, RuntimeQualified=false;
 }
 public static partial class CoreJobCustodyV1 {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder name,ref uint size);
  static void FixtureObserverFault(FixedRuntimeFixtureResultV1 result,Exception error,string phase,string code) {
    result.ObserverFaultCode=code;result.ObserverFaultType=error.GetType().FullName;result.ObserverFaultPhase=phase;
    result.ObserverFaultHResult=error.HResult;
    result.ObserverFaultWin32=error is System.ComponentModel.Win32Exception?((System.ComponentModel.Win32Exception)error).NativeErrorCode:
      (unchecked((uint)error.HResult)&0xffff0000u)==0x80070000u?error.HResult&0xffff:0;
  }
  static string ReadCommittedFixtureWitness(string path,Microsoft.Win32.SafeHandles.SafeFileHandle renameHandle,out bool sameFile) {
    sameFile=false;
    // Commit publishes complete bytes, but its rename may still hold DELETE
    // access. Permit that metadata lifetime; continue to deny every writer.
    using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read|FileShare.Delete)) {
      if(renameHandle!=null) {
        FILE_INFO expected,actual;Require(GetFileInformationByHandle(renameHandle,out expected));Require(GetFileInformationByHandle(file.SafeFileHandle,out actual));
        if(expected.volume!=actual.volume || expected.indexHigh!=actual.indexHigh || expected.indexLow!=actual.indexLow)
          throw new IOException("WITNESS_COMMITTED_IDENTITY_CHANGED");
        sameFile=true;
      }
      long length=file.Length;if(length<1 || length>64)throw new FormatException("WITNESS_COMMITTED_BOUND_INVALID");
      var bytes=new byte[(int)length];int at=0;
      while(at<bytes.Length){int read=file.Read(bytes,at,bytes.Length-at);if(read<=0)throw new IOException("WITNESS_COMMITTED_SHORT_READ");at+=read;}
      if(file.ReadByte()!=-1 || file.Length!=length)throw new IOException("WITNESS_COMMITTED_BYTES_CHANGED");
      foreach(byte value in bytes)if(value<32 || value>126)throw new FormatException("WITNESS_COMMITTED_ASCII_INVALID");
      return Encoding.ASCII.GetString(bytes);
    }
  }
  public static FixedRuntimeFixtureResultV1 FixedRuntimeFixtureV1(string directory,string mode,string fixtureNode,string publicationVariant,string readerVariant) {
   if(!System.Text.RegularExpressions.Regex.IsMatch(mode,
     "^(normal|failed|input|deadline|orphan|overflow|query|cancel|parent-death|spawn-fail|bind-denied|drain-cancel|drain-parent-death|witness-paused)$"))
     throw new InvalidOperationException("FIXTURE_MODE_INVALID");
   if(publicationVariant!="Atomic" && publicationVariant!="VisiblePartial")
     throw new InvalidOperationException("FIXTURE_PUBLICATION_VARIANT_INVALID");
   if(publicationVariant=="VisiblePartial" && mode!="witness-paused")
     throw new InvalidOperationException("FIXTURE_PUBLICATION_MODE_INVALID");
   if(readerVariant!="ReadDelete" && readerVariant!="LegacyNoDeleteSharing")
     throw new InvalidOperationException("FIXTURE_READER_VARIANT_INVALID");
   if(readerVariant=="LegacyNoDeleteSharing" && (publicationVariant!="Atomic" || mode!="witness-paused"))
     throw new InvalidOperationException("FIXTURE_READER_MODE_INVALID");
   var result=new FixedRuntimeFixtureResultV1 { Mode=mode };
   string witness=Path.Combine(directory,mode+".witness"),ack=Path.Combine(directory,mode+".ack");
   var current=Process.GetCurrentProcess(); Process fakeOwner=null;
   IntPtr owner=IntPtr.Zero,launcher=IntPtr.Zero,job=IntPtr.Zero,rootHandle=IntPtr.Zero,descendant=IntPtr.Zero;
   int captured=0,finished=0,terminalCancel=0,observerFailed=0; Task observer=null,killer=null;
   try {
    long created,exited,kernel,user;
    IntPtr currentHandle=RuntimeOpenProcessV1(0x101000,false,(uint)current.Id);
    if(currentHandle==IntPtr.Zero) throw new InvalidOperationException("FIXTURE_OWNER_UNAVAILABLE");
    try { Require(RuntimeProcessTimesV1(currentHandle,out created,out exited,out kernel,out user)); }
    finally { CloseHandle(currentHandle); }
    launcher=RuntimeOwnerHandleV1(current.Id,created);
    if(mode=="parent-death" || mode=="drain-parent-death") {
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
     Microsoft.Win32.SafeHandles.SafeFileHandle renameHandle=null;
     try {
      var wait=Stopwatch.StartNew();
      bool publicationReleased=false;
      while(wait.ElapsedMilliseconds<10000 && Interlocked.CompareExchange(ref finished,0,0)==0) {
        if(mode=="witness-paused" && !publicationReleased && File.Exists(witness+".pending") && !File.Exists(witness)) {
          // Never read or parse a staged publication. Only its atomic commit
          // can become a process witness; release the deliberately paused writer.
          result.PartialWitnessIgnored=true;
          try {
            // Retain a real DELETE-access handle on the SAME staged file across
            // the atomic rename. This deterministically exercises the Windows
            // sharing window without sleeping or weakening native deadlines.
            renameHandle=CreateFileW(witness+".pending",0x10080u,7u,IntPtr.Zero,3u,0x00200000u,IntPtr.Zero);
            Require(!renameHandle.IsInvalid);result.DeleteHandleHeldBeforeCommit=true;
            File.WriteAllText(witness+".publish","release");publicationReleased=true;
          }
          catch(Exception error) {
            FixtureObserverFault(result,error,"STAGING_RELEASE","WITNESS_PUBLICATION_RELEASE_FAILED");
            Interlocked.Exchange(ref observerFailed,1); return;
          }
        }
        if(File.Exists(witness)) {
          string phase="COMMITTED_READ";
          try {
            string raw=readerVariant=="LegacyNoDeleteSharing"?File.ReadAllText(witness):
              ReadCommittedFixtureWitness(witness,renameHandle,out result.SameFileAcrossRename);
            phase="COMMITTED_PARSE";
            if(!System.Text.RegularExpressions.Regex.IsMatch(raw,"^[1-9][0-9]*[|][0-9]+$"))
              throw new FormatException("WITNESS_COMMITTED_FORMAT_INVALID");
            string[] ids=raw.Split('|');
            int rootPid=Int32.Parse(ids[0]), childPid=Int32.Parse(ids[1]);
            phase="PROCESS_BIND";
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
            phase="ACK_PUBLICATION";
            File.WriteAllText(ack,"ack");
            return;
          } catch(Exception error) {
            if(rootHandle!=IntPtr.Zero) { CloseHandle(rootHandle); rootHandle=IntPtr.Zero; }
            if(descendant!=IntPtr.Zero) { CloseHandle(descendant); descendant=IntPtr.Zero; }
            result.RootCaptured=false; result.DescendantCaptured=false;
            string code=phase=="ACK_PUBLICATION"?"WITNESS_ACK_PUBLICATION_FAILED":
              error is FormatException?"WITNESS_FORMAT_INVALID":phase=="COMMITTED_READ"?"WITNESS_READ_FAILED":"WITNESS_BINDING_UNPROVEN";
            FixtureObserverFault(result,error,phase,code);
            Interlocked.Exchange(ref observerFailed,1); return;
          }
        }
        Thread.Sleep(5);
      }
     } finally {if(renameHandle!=null)renameHandle.Dispose();}
    },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
    if(mode=="parent-death") killer=Task.Factory.StartNew(delegate {
      while(Interlocked.CompareExchange(ref captured,0,0)==0 &&
        Interlocked.CompareExchange(ref finished,0,0)==0) Thread.Sleep(5);
      if(Interlocked.CompareExchange(ref captured,0,0)!=0) { Thread.Sleep(100); fakeOwner.Kill(); }
    });
    var clock=Stopwatch.StartNew();
    string executable=mode=="spawn-fail"?Path.Combine(directory,"missing-owned-fixture.exe"):fixtureNode;
    string args=Quote(Path.Combine(directory,"worker.mjs"))+" "+mode+" "+Quote(witness)+" "+Quote(ack)+" "+publicationVariant;
    byte[] input=mode=="input"?Encoding.UTF8.GetBytes("fixed-fixture-input"):new byte[0];
    result.Receipt=RunRuntimeStageV1(job,"FIXTURE_ONLY",executable,args,directory,input,clock,
      mode=="deadline"?3000:7000,owner,launcher,
      delegate { return (mode=="cancel" && Interlocked.CompareExchange(ref captured,0,0)!=0) || Interlocked.CompareExchange(ref terminalCancel,0,0)!=0 || Interlocked.CompareExchange(ref observerFailed,0,0)!=0; },
      delegate { return mode=="query" && Interlocked.CompareExchange(ref captured,0,0)!=0; },
      delegate(FixedRuntimeStageV1 prepared) {
        if(mode!="bind-denied") return true;
        if(!prepared.AssignedBeforeExecution || prepared.RootPid<=0 || File.Exists(witness))
          throw new InvalidOperationException("EXECUTED_BEFORE_PARENT_BINDING");
        rootHandle=RuntimeOpenProcessV1(0x101000,false,(uint)prepared.RootPid);
        if(rootHandle==IntPtr.Zero) throw new InvalidOperationException("PREPARED_ROOT_UNAVAILABLE");
        bool member; Require(IsProcessInJob(rootHandle,job,out member)); Require(member);
        long born,ended,k,u; Require(RuntimeProcessTimesV1(rootHandle,out born,out ended,out k,out u));
        result.RootCreatedAtUtc=DateTime.FromFileTimeUtc(born).ToString("O");
        var image=new StringBuilder(32768); uint imageLength=32768;
        Require(QueryFullProcessImageNameW(rootHandle,0,image,ref imageLength));
        result.RootImagePath=image.ToString();
        result.RootCaptured=true; result.BoundBeforeExecution=true;
        Interlocked.Exchange(ref captured,1);
        return false;
      },
      delegate(FixedRuntimeStageV1 terminal) {
        if(mode!="drain-cancel" && mode!="drain-parent-death") return;
        if(!terminal.NormalRootExit || terminal.ExitCode!=0 || !terminal.ExecutionCustodyReleased ||
          !terminal.ZeroActiveProcessesObserved || !terminal.OutputComplete)
          throw new InvalidOperationException("TERMINAL_DRAIN_NOT_REACHED");
        result.TerminalDrainObserved=true;
        if(mode=="drain-cancel") Interlocked.Exchange(ref terminalCancel,1);
        else {
          fakeOwner.Kill();
          if(!fakeOwner.WaitForExit(5000) || WaitForSingleObject(owner,0)!=0)
            throw new InvalidOperationException("OWNED_PARENT_NOT_ENDED");
        }
      });
    result.HostProjection=new FixedRuntimeReceiptV1 { Profile="MAINTENANCE_GOAL_BUILDER_V1" };
    ProjectRuntimeTaskEvidenceV1(result.HostProjection,result.Receipt);
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
$kernel = [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeJobV1.cs'))
if ($FixtureTerminalGuardBaseline -cne 'None') {
  # Fixture counterfactual never rewrites production source or grants authority.
  $guard = @'
        if(!RuntimeParentsAliveV1(owner,launcher) || Cancelled(cancelled)) {
          interrupted=true; r.CancellationRequested=true; r.Reason=!RuntimeParentsAliveV1(owner,launcher)?"OWNER_ENDED":"CANCELLED";
        }
'@
  $guard = $guard.Replace([string][char]13,'')
  $kernel = $kernel.Replace([string][char]13,'')
  if (($kernel.Split(@($guard),[StringSplitOptions]::None)).Length -ne 2) { throw 'BASELINE_GUARD_IDENTITY_CHANGED' }
  $kernel = $kernel.Replace($guard,'')
}
$source = [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignCoreJobCustodyV1.cs')) +
  [Environment]::NewLine + $kernel +
  [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeIdentityV1.cs')) +
  [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeAuthorityV1.cs')) +
  [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeHostV1.cs')) +
  [Environment]::NewLine + [IO.File]::ReadAllText((Join-Path $repoRoot 'scripts/windows/SovereignFixedRuntimeSourceV1.cs')) +
  [Environment]::NewLine + $fixtureCode
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management' -ErrorAction Stop
$cases = @()
$modes = @('normal','failed','input','deadline','orphan','overflow','query','cancel','parent-death','spawn-fail','bind-denied','drain-cancel','drain-parent-death','witness-paused')
if ($FixtureTerminalGuardBaseline -ceq 'Cancel') { $modes = @('drain-cancel') }
if ($FixtureTerminalGuardBaseline -ceq 'ParentDeath') { $modes = @('drain-parent-death') }
if ($FixtureWitnessPublication -ceq 'VisiblePartial') {
  if ($FixtureTerminalGuardBaseline -cne 'None') { throw 'FIXTURE_COMBINED_MUTANTS_UNSUPPORTED' }
  $modes = @('witness-paused')
}
if ($FixtureWitnessReader -ceq 'LegacyNoDeleteSharing') {
  if ($FixtureTerminalGuardBaseline -cne 'None' -or $FixtureWitnessPublication -cne 'Atomic') { throw 'FIXTURE_COMBINED_MUTANTS_UNSUPPORTED' }
  $modes = @('witness-paused')
}
foreach($mode in $modes) {
  $r = [Stephanos.Sovereign.CoreJobCustodyV1]::FixedRuntimeFixtureV1($fixtureRoot,$mode,$fixtureNode,$FixtureWitnessPublication,$FixtureWitnessReader)
  if ($r.RuntimeQualified -ne $false -or $r.SourceMutationAllowed -ne $false) { throw 'FIXTURE_AUTHORITY_INVALID' }
  if ($FixtureWitnessReader -ceq 'LegacyNoDeleteSharing') {
    if ($r.ObserverFaultCode -cne 'WITNESS_READ_FAILED' -or $r.ObserverFaultPhase -cne 'COMMITTED_READ' -or
        $r.ObserverFaultWin32 -ne 32 -or -not $r.DeleteHandleHeldBeforeCommit -or $r.RootCaptured -or
        $r.Receipt.OperationOk -or -not $r.Receipt.CancellationRequested -or
        -not $r.Receipt.ExecutionCustodyReleased -or -not $r.Receipt.ZeroActiveProcessesObserved) {
      throw ('FIXTURE_SHARING_COUNTEREXAMPLE_INVALID:'+ ($r|ConvertTo-Json -Depth 6 -Compress))
    }
    $cases += $r
    continue
  }
  if ($FixtureWitnessPublication -ceq 'VisiblePartial') {
    if ($r.ObserverFaultCode -notin @('WITNESS_READ_FAILED','WITNESS_FORMAT_INVALID') -or
        $r.RootCaptured -or $r.Receipt.OperationOk -or -not $r.Receipt.Launched -or
        -not $r.Receipt.AssignedBeforeExecution -or -not $r.Receipt.ExecutionCustodyReleased -or
        -not $r.Receipt.ZeroActiveProcessesObserved) {
      throw ('FIXTURE_PARTIAL_WITNESS_COUNTEREXAMPLE_INVALID:'+ ($r|ConvertTo-Json -Depth 6 -Compress))
    }
    $cases += $r
    continue
  }
  if ($r.ObserverFaultCode -cne '') { throw ('FIXTURE_OBSERVER_FAILED:'+ ($r|ConvertTo-Json -Depth 6 -Compress)) }
  if ($mode -ceq 'witness-paused' -and (-not $r.DeleteHandleHeldBeforeCommit -or -not $r.SameFileAcrossRename)) {
    throw ('FIXTURE_RENAME_IDENTITY_UNPROVEN:'+ ($r|ConvertTo-Json -Depth 6 -Compress))
  }
  if ($mode -ne 'spawn-fail') {
    if (-not $r.RootCaptured -or -not $r.RootEndedByHandle -or
        $r.RootCreatedAtUtc -cne $r.Receipt.RootCreatedAtUtc) { throw ('FIXTURE_ROOT_WITNESS_INVALID:'+ ($r | ConvertTo-Json -Depth 6 -Compress)) }
  }
  if ($mode -eq 'normal' -or $mode -eq 'input' -or $mode -eq 'witness-paused') {
    if (-not $r.Receipt.OperationOk -or -not $r.Receipt.ExecutionCustodyReleased) { throw ('FIXTURE_SUCCESS_INVALID:'+ $mode) }
  } else {
    if ($FixtureTerminalGuardBaseline -ceq 'None' -and $r.Receipt.OperationOk) { throw ('FIXTURE_FALSE_SUCCESS:'+ ($r | ConvertTo-Json -Depth 6 -Compress)) }
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
@{schemaVersion='stephanos.fixed-runtime-native-fixture.v1';ok=($FixtureTerminalGuardBaseline -ceq 'None' -and $FixtureWitnessPublication -ceq 'Atomic' -and $FixtureWitnessReader -ceq 'ReadDelete');witnessPublicationVariant=$FixtureWitnessPublication;witnessReaderVariant=$FixtureWitnessReader;counterfactualVariant=$FixtureTerminalGuardBaseline;fixtureExecutable=$fixtureNode;fixtureExecutableSha256=$copyDigest;cases=$cases;runtimeQualified=$false;fixtureRoot=$fixtureRoot} | ConvertTo-Json -Depth 8 -Compress
