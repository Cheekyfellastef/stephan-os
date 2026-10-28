// Native adapter for the EXISTING Commander executor. No scheduler, lease,
// task/service installer or caller-selected executable/command surface.
// Candidate-only custody qualification; no runtime repair is enrolled here.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.Sovereign {
  public sealed class CoreJobReceiptV1 {
    public string SchemaVersion = "stephanos.core-job-custody-candidate.v1";
    public string RequestId;
    public string SourceHead;
    public string Verdict = "HELD";
    public string Reason = "NATIVE_CUSTODY_UNPROVEN";
    public int ChildPid;
    public bool AssignedBeforeExecution;
    public bool CancellationRequested;
    public bool CancellationAcknowledged;
    public bool DescendantAttemptDenied;
    public bool ZeroActiveProcessesObserved;
    public bool CustodyReleased;
    public uint ActiveProcesses;
    public uint ExitCode;
    public bool SourceMutationAllowed = false;
    public bool OriginalR7Authority = false;
    public bool SpecialistQualified = false;
    public bool RepairExecuted = false;
    public bool WorkspaceMutationAttempted;
    public bool CorePublicationDirectoriesReady;
    public string RepairScope = "NONE";
  }

  public sealed class MaintenanceSourceProbeReceiptV3 {
    public string SchemaVersion = "stephanos.maintenance-source-probe.v3";
    public bool Passed, AssignedBeforeExecution, ZeroActiveProcessesObserved, CustodyReleased;
    public bool CancellationRequested, NormalRootExit, SourceHeadMatched, OutputOverflow;
    public string Reason = "SOURCE_PROBE_UNPROVEN", ObservedSourceHead = "";
    public int ChildPid, ObservedLiveDescendantPid;
    public string ObservedLiveDescendantCreatedAtUtc = "", ObservedLiveDescendantKind = "";
    public string ChildCreatedAtUtc = "";
    public long ElapsedMilliseconds;
    public uint ActiveProcesses, ExitCode;
    public bool JournalMutationAllowed = false, MaintenanceCustodyReleased = false;
  }

  public static class CoreJobCustodyV1 {
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct FILE_INFO {
      public uint attributes; public long creation,access,write;
      public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
    }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FILE_INFO info);
    // Pin every directory and the final file with read-only sharing and
    // OPEN_REPARSE_POINT. No lstat/read path race or redirected ancestor.
    public static string ReadGovernorLocked(string file) {
      var handles=new List<SafeFileHandle>();
      try {
        string full=Path.GetFullPath(file);
        if(!Path.IsPathRooted(file) || file.Contains("..") || full.StartsWith("\\\\")) return null;
        string root=Path.GetPathRoot(full),cursor=root;
        string[] parts=full.Substring(root.Length).Split(Path.DirectorySeparatorChar);
        for(int i=-1;i<parts.Length;i++) {
          if(i>=0) cursor=Path.Combine(cursor,parts[i]);
          bool last=i==parts.Length-1;
          // Directory contents may change independently, but their identities
          // cannot be renamed/deleted while pinned. The final file also denies
          // existing/new write access until its bytes have been captured.
          // Metadata-only access does not participate in Windows sharing
          // exclusion. GENERIC_READ is required to actually deny renaming.
          var handle=CreateFileW(cursor,0x80000000u,last?1u:3u,IntPtr.Zero,3,0x02000000|0x00200000,IntPtr.Zero);
          if(handle.IsInvalid) { handle.Dispose(); return null; }
          handles.Add(handle);
          FILE_INFO info; if(!GetFileInformationByHandle(handle,out info)) return null;
          if((info.attributes&0x400)!=0 || (last ? (info.attributes&0x10)!=0 : (info.attributes&0x10)==0)) return null;
          if(last) {
            if(info.sizeHigh!=0 || info.sizeLow<2 || info.sizeLow>32768) return null;
            using(var stream=new FileStream(handle,FileAccess.Read,4096,false))
            using(var reader=new StreamReader(stream,Encoding.UTF8,true,4096)) {
              string raw=reader.ReadToEnd();
              return Encoding.UTF8.GetByteCount(raw)<=32768 ? raw : null;
            }
          }
        }
        return null;
    } catch { return null; }
      finally { for(int i=handles.Count-1;i>=0;i--) handles[i].Dispose(); }
    }
    static void PinDirectory(string directory,List<SafeFileHandle> pins) {
      var h=CreateFileW(directory,0x80000000u,3,IntPtr.Zero,3,0x02000000|0x00200000,IntPtr.Zero);
      if(h.IsInvalid) { h.Dispose(); throw new IOException("CORE_DIRECTORY_CUSTODY_UNAVAILABLE"); }
      pins.Add(h); FILE_INFO info;
      if(!GetFileInformationByHandle(h,out info) || (info.attributes&0x400)!=0 || (info.attributes&0x10)==0)
        throw new IOException("CORE_DIRECTORY_CUSTODY_UNAVAILABLE");
    }
    static void PinDirectoryChain(string root,List<SafeFileHandle> pins) {
      if(!Path.IsPathRooted(root) || root.Contains("..")) throw new IOException("CORE_DIRECTORY_ROOT_INVALID");
      string full=Path.GetFullPath(root),drive=Path.GetPathRoot(full),cursor=drive;
      if(full.StartsWith("\\\\")) throw new IOException("CORE_DIRECTORY_ROOT_INVALID");
      PinDirectory(cursor,pins);
      foreach(string part in full.Substring(drive.Length).Split(Path.DirectorySeparatorChar)) {
        if(part.Length==0) continue;
        cursor=Path.Combine(cursor,part); PinDirectory(cursor,pins);
      }
    }
    static void PinExistingPublicationLeaves(string root,List<SafeFileHandle> pins) {
      foreach(string leaf in new string[]{"status","proof"}) {
        string file=Path.Combine(root,leaf);
        var h=CreateFileW(file,0x80000000u,3,IntPtr.Zero,3,0x02000000|0x00200000,IntPtr.Zero);
        if(h.IsInvalid) {
          int error=Marshal.GetLastWin32Error(); h.Dispose();
          if(error==2 || error==3) continue;
          throw new IOException("CORE_DIRECTORY_LEAF_UNAVAILABLE");
        }
        pins.Add(h); FILE_INFO info;
        if(!GetFileInformationByHandle(h,out info) || (info.attributes&0x400)!=0 || (info.attributes&0x10)==0)
          throw new IOException("CORE_DIRECTORY_LEAF_UNTRUSTED");
      }
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
      public int cb; public IntPtr reserved, desktop, title;
      public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
      public ushort show,reservedSize; public IntPtr reserved2,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO start; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
      public long processTime,jobTime; public uint flags;
      public UIntPtr minWorking,maxWorking; public uint activeLimit;
      public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
      public BASIC_LIMIT basic; public IO_COUNTERS io;
      public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING {
      public long user,kernel,periodUser,periodKernel;
      public uint pageFaults,totalProcesses,activeProcesses,terminatedProcesses;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr sa, IntPtr name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT value,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out ACCOUNTING value,uint size,IntPtr length);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFOEX start,out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static bool Safe(Func<bool> predicate) { try { return predicate != null && predicate(); } catch { return false; } }
    static bool Cancelled(Func<bool> predicate) { try { return predicate == null || predicate(); } catch { return true; } }
    static string InterruptionReason(Func<bool> gamingSafe,Func<bool> cancelled,Stopwatch clock,int deadlineMs) {
      // Completion does not exempt a fast child from any interruption channel.
      bool game=!Safe(gamingSafe),external=cancelled(),timeout=clock.ElapsedMilliseconds>=deadlineMs;
      return game ? "GAMING_CANCELLED" : external ? "OPERATOR_CANCELLED" : timeout ? "DEADLINE_CANCELLED" : "";
    }
    static void Require(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static bool Empty(IntPtr job,CoreJobReceiptV1 r) {
      ACCOUNTING a;
      Require(QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero));
      r.ActiveProcesses = a.activeProcesses;
      return a.activeProcesses == 0;
    }
    static string Quote(string s) { return "\"" + s + "\""; }

    // A closed benign probe exercises the same atomic launch/cancel/drain
    // implementation needed by a separately admitted Core-only repair action.
    // Scope NEVER includes tasks, services, source, writers or lease records.
    public static CoreJobReceiptV1 Probe(string requestId,string sourceHead,string mode,
      Func<bool> gamingSafe,Func<bool> cancelRequested,int deadlineMs) {
      return RunProbe(requestId,sourceHead,mode,gamingSafe,cancelRequested,deadlineMs,false);
    }
    public static CoreJobReceiptV1 ProbeWithParentInput(string requestId,string sourceHead,
      Func<bool> gamingSafe) {
      return RunProbe(requestId,sourceHead,"wait",gamingSafe,delegate { return false; },3000,true);
    }
    // The FIRST fixed Core-only mutation. It creates only missing publication
    // directories inside the existing canonical workspace; it never writes a
    // file, starts Core/controllers, acquires/removes a lock or touches R7.
    // No caller-supplied root/path/command is accepted by this public method.
    public static CoreJobReceiptV1 RepairCorePublicationDirectories(string requestId,string sourceHead,
      Func<bool> gamingSafe) {
      string root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Documents","Stephanos-openclaw-workspace");
      return RunProbe(requestId,sourceHead,"directories",gamingSafe,delegate { return false; },3000,true,root);
    }
    static CoreJobReceiptV1 RunProbe(string requestId,string sourceHead,string mode,
      Func<bool> gamingSafe,Func<bool> cancelRequested,int deadlineMs,bool watchParentInput,string directoryRoot=null) {
      if (!System.Text.RegularExpressions.Regex.IsMatch(requestId ?? "", "^[a-z0-9-]{8,80}$")
        || !System.Text.RegularExpressions.Regex.IsMatch(sourceHead ?? "", "^[a-f0-9]{40}$")
        || (mode != "complete" && mode != "wait" && mode != "descendant" && mode != "directories")
        || (mode == "directories" && String.IsNullOrEmpty(directoryRoot))
        || deadlineMs < 200 || deadlineMs > 10000) throw new ArgumentException("CORE_JOB_FIXED_PROBE_ONLY");
      var r = new CoreJobReceiptV1 { RequestId=requestId, SourceHead=sourceHead };
      if(mode=="directories") r.RepairScope="CORE_PUBLICATION_DIRECTORIES_ONLY";
      // The wrapper supplies source bytes on stdin, then retains the pipe.
      // Explicit cancel OR parent death/EOF stops the same owned Job.
      Task<string> parentInput=watchParentInput ? Task.Factory.StartNew(delegate { return Console.ReadLine(); }) : null;
      Func<bool> cancelled=delegate { return Cancelled(cancelRequested) || (parentInput!=null && parentInput.IsCompleted); };
      if (!Safe(gamingSafe)) { r.Reason="GAMING_GUARD_BLOCKED"; return r; }
      if (cancelled()) { r.Reason="CANCELLED_BEFORE_LAUNCH"; return r; }
      IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,jobList=IntPtr.Zero,environment=IntPtr.Zero;
      PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
      bool initialized=false,launched=false;
      Stopwatch clock=null;
      var scopePins=new List<SafeFileHandle>();
      string nonce=Guid.NewGuid().ToString("N");
      // Private non-inherited events: acknowledgement is corroborated by OS
      // zero-active query, never promoted from worker text or a PID check.
      string prefix="Local\\StephanosCoreJob-"+nonce;
      using (var cancel=new EventWaitHandle(false,EventResetMode.ManualReset,prefix+"-cancel"))
      using (var ack=new EventWaitHandle(false,EventResetMode.ManualReset,prefix+"-ack"))
      using (var denied=new EventWaitHandle(false,EventResetMode.ManualReset,prefix+"-denied")) {
        try {
          if(mode=="directories") {
            PinDirectoryChain(directoryRoot,scopePins);
            PinExistingPublicationLeaves(directoryRoot,scopePins);
          }
          job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);
          Require(job!=IntPtr.Zero);
          var limits=new EXTENDED_LIMIT();
          // KILL_ON_JOB_CLOSE, DIE_ON_UNHANDLED_EXCEPTION, ACTIVE_PROCESS=1.
          // Neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is set. A Core-only
          // worker cannot spawn a direct descendant. Broker APIs are outside
          // this custody boundary and forbidden in the fixed worker scope.
          limits.basic.flags=0x2000|0x400|0x8;
          limits.basic.activeLimit=1;
          Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
          IntPtr size=IntPtr.Zero;
          InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
          if (size==IntPtr.Zero) throw new InvalidOperationException("ATTRIBUTE_SIZE_UNAVAILABLE");
          attributes=Marshal.AllocHGlobal(size);
          Require(InitializeProcThreadAttributeList(attributes,1,0,ref size)); initialized=true;
          jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);
          // JOB_LIST binds the child atomically during CreateProcess. This
          // closes the parent-crash gap in create-suspended/assign/resume.
          Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
          string exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32","WindowsPowerShell","v1.0","powershell.exe");
          string worker = "$ErrorActionPreference='Stop';"
            + "$c=[Threading.EventWaitHandle]::OpenExisting('"+prefix+"-cancel');"
            + "$a=[Threading.EventWaitHandle]::OpenExisting('"+prefix+"-ack');"
            + "$d=[Threading.EventWaitHandle]::OpenExisting('"+prefix+"-denied');";
          // Direct CreateProcess path only. ShellExecute/COM/service/task
          // brokers can launch outside a Job and are forbidden in the fixed
          // Core-only scope; a Job is resource custody, NOT a security sandbox.
          if (mode=="descendant") worker += "$s=[Diagnostics.ProcessStartInfo]::new();$s.FileName='"+exe+"';$s.Arguments='-NoProfile -NonInteractive -Command Start-Sleep -Seconds 20';$s.UseShellExecute=$false;$s.ErrorDialog=$false;try {$p=[Diagnostics.Process]::Start($s);if($null -ne $p){$p.Kill()};exit 91} catch {$d.Set()|Out-Null};";
          if (mode=="directories") {
            string literal=directoryRoot.Replace("'","''");
            worker += "foreach($leaf in @('status','proof')){if($c.WaitOne(0)){$a.Set()|Out-Null;exit 77};"
              + "[IO.Directory]::CreateDirectory([IO.Path]::Combine('"+literal+"',$leaf))|Out-Null;"
              + "if($c.WaitOne(0)){$a.Set()|Out-Null;exit 77}};exit 0;";
          } else if (mode=="complete") worker += "exit 0;";
          else worker += "if($c.WaitOne(15000)){$a.Set()|Out-Null;exit 0};exit 92;";
          string encoded=Convert.ToBase64String(Encoding.Unicode.GetBytes(worker));
          var command=new StringBuilder(Quote(exe)+" -NoLogo -NoProfile -NonInteractive -EncodedCommand "+encoded);
          // No parent NODE_OPTIONS, PS module paths, Git helpers or credentials.
          string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
          string env="SystemRoot="+windows+"\0WINDIR="+windows+"\0PATH="+windows+"\\System32\0\0";
          environment=Marshal.StringToHGlobalUni(env);
          var start=new STARTUPINFOEX(); start.start.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); start.attributes=attributes;
          // Recheck immediately before creation and again before resume.
          if (!Safe(gamingSafe)) { r.Reason="GAMING_GUARD_BLOCKED"; return r; }
          Require(CreateProcessW(exe,command,IntPtr.Zero,IntPtr.Zero,false,
            0x80000|0x4|0x400|0x8000000|0x40,environment,windows,ref start,out pi));
          launched=true; r.ChildPid=(int)pi.pid;
          bool member; Require(IsProcessInJob(pi.process,job,out member)); Require(member);
          r.AssignedBeforeExecution=true;
          Console.WriteLine("CORE_JOB_CHILD_PID="+r.ChildPid); Console.Out.Flush();
          if (!Safe(gamingSafe) || cancelled()) {
            r.Reason="CANCELLED_BEFORE_RESUME";
            r.CancellationRequested=true; Require(TerminateJobObject(job,77));
          } else {
            Require(ResumeThread(pi.thread)!=UInt32.MaxValue);
            r.WorkspaceMutationAttempted=mode=="directories";
            clock=Stopwatch.StartNew();
            while (true) {
              string interruption=InterruptionReason(gamingSafe,cancelled,clock,deadlineMs);
              if (interruption!="") {
                r.CancellationRequested=true;
                r.Reason=interruption;
                cancel.Set();
                // Bounded cooperative acknowledgement. Escalation stays inside
                // THIS Job; never kill a PID tree, service, task or R7 writer.
                r.CancellationAcknowledged=ack.WaitOne(300);
                Require(TerminateJobObject(job,77));
                break;
              }
              if (Empty(job,r)) break;
              Thread.Sleep(25);
            }
          }
          // Do not close the Job and then infer success. Positively query it
          // while owned, AND observe the child process handle signalled.
          var drain=Stopwatch.StartNew();
          while ((!Empty(job,r) || WaitForSingleObject(pi.process,0)!=0)
            && drain.ElapsedMilliseconds<2000) Thread.Sleep(10);
          r.ZeroActiveProcessesObserved=Empty(job,r) && WaitForSingleObject(pi.process,0)==0;
          r.CustodyReleased=r.ZeroActiveProcessesObserved;
          Require(GetExitCodeProcess(pi.process,out r.ExitCode));
          r.DescendantAttemptDenied=denied.WaitOne(0);
          if (!r.CustodyReleased) { r.Reason="DESCENDANT_EXCLUSION_UNPROVEN"; return r; }
          if (!r.CancellationRequested && r.ExitCode==0) {
            if(mode=="directories") {
              PinDirectory(Path.Combine(directoryRoot,"status"),scopePins);
              PinDirectory(Path.Combine(directoryRoot,"proof"),scopePins);
            }
            // Drain and directory pinning can outlive the last monitor sample.
            // Revalidate ALL channels for EVERY success before setting flags.
            string interruption=InterruptionReason(gamingSafe,cancelled,clock,deadlineMs);
            if(interruption!="") {
              r.CancellationRequested=true; r.Reason=interruption; return r;
            }
            if(mode=="directories") {
              r.CorePublicationDirectoriesReady=true; r.RepairExecuted=true;
              r.Verdict="CORE_DIRECTORY_REPAIR_SATISFIED_UNQUALIFIED";
            } else r.Verdict="PROBE_PASSED_UNQUALIFIED";
            r.Reason="";
          }
          return r;
        } catch {
          r.Reason="NATIVE_JOB_OPERATION_FAILED";
          if (launched && job!=IntPtr.Zero) {
            try { TerminateJobObject(job,78); for(int i=0;i<200&&(!Empty(job,r)||WaitForSingleObject(pi.process,0)!=0);i++) Thread.Sleep(10);
              r.ZeroActiveProcessesObserved=Empty(job,r)&&WaitForSingleObject(pi.process,0)==0;
              r.CustodyReleased=r.ZeroActiveProcessesObserved;
            } catch { r.CustodyReleased=false; }
          }
          return r;
        } finally {
          // Crash/exception also closes the private non-inherited kill Job.
          // Missing terminal evidence remains HELD in the Commander parent.
          if(job!=IntPtr.Zero) CloseHandle(job);
          if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
          if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
          if(initialized) DeleteProcThreadAttributeList(attributes);
          if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
          if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);
          if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
          for(int i=scopePins.Count-1;i>=0;i--) scopePins[i].Dispose();
        }
      }
    }
    // Private pinned-bootstrap primitive. File reparse points and hard links
    // cannot substitute a second path after its authenticated bytes were read.
    static FileStream OpenPinnedMaintenanceSourceFileV3(string path) {
      var handle=CreateFileW(path,0x80000000u,1u,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
      if(handle.IsInvalid) { handle.Dispose(); throw new IOException("SOURCE_PIN_OPEN_FAILED"); }
      FILE_INFO info;
      if(!GetFileInformationByHandle(handle,out info) || (info.attributes&0x410)!=0
        || info.links!=1 || info.sizeHigh!=0 || info.sizeLow>33554432) {
        handle.Dispose(); throw new IOException("SOURCE_PIN_IDENTITY_UNPROVEN");
      }
      return new FileStream(handle,FileAccess.Read,4096,false);
    }
    // One fixed installer adapter. It never accepts executable, command, path,
    // environment, process-count, deadline or fixture options from a caller.
    public static MaintenanceSourceProbeReceiptV3 ReadMaintenanceCanonicalSource(string expectedMain) {
      Stopwatch clock = Stopwatch.StartNew();
      string root = @"C:\Users\Stephan Callear\Documents\GitHub\stephan-os";
      return RunMaintenanceSourceProbeV3(clock, @"C:\Program Files\nodejs\node.exe",
        Quote(Path.Combine(root, "scripts", "sovereign-maintenance-journal-source-proof-v2.mjs")),
        root, expectedMain, 120000, false);
    }
    [StructLayout(LayoutKind.Sequential)] struct SOURCE_PIPE_SECURITY {
      public int length; public IntPtr descriptor; public int inherit;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(
      out IntPtr read, out IntPtr write, ref SOURCE_PIPE_SECURITY security, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(IntPtr handle,
      byte[] buffer,uint count,out uint read,IntPtr overlap);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,
      out long creation,out long exit,out long kernel,out long user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(
      IntPtr job,int type,IntPtr value,uint size,out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder name,ref uint size);
    static bool SourceJobHasOtherProcessV3(IntPtr job,int rootPid,MaintenanceSourceProbeReceiptV3 receipt) {
      int capacity=8, size=8+IntPtr.Size*capacity;
      IntPtr buffer=Marshal.AllocHGlobal(size);
      try {
        uint returned; Require(QueryInformationJobObject(job,3,buffer,(uint)size,out returned));
        uint assigned=unchecked((uint)Marshal.ReadInt32(buffer,0));
        uint count=unchecked((uint)Marshal.ReadInt32(buffer,4));
        if(count>capacity || assigned!=count) throw new InvalidOperationException("SOURCE_JOB_PROCESS_LIST_UNPROVEN");
        for(int i=0;i<(int)count;i++) {
          long pid=Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64();
          if(pid==rootPid) continue;
          if(pid<=0 || pid>UInt32.MaxValue) throw new InvalidOperationException("SOURCE_JOB_IDENTITY_UNPROVEN");
          IntPtr process=OpenProcess(0x101000,false,(uint)pid);
          if(process==IntPtr.Zero) {
            // A process can disappear between two native Job observations.
            // This is pending accounting, NEVER a zero-active witness.
            if(Marshal.GetLastWin32Error()==87) continue;
            throw new InvalidOperationException("SOURCE_JOB_PROCESS_STATE_UNPROVEN");
          }
          try {
            bool member; Require(IsProcessInJob(process,job,out member));
            if(!member) throw new InvalidOperationException("SOURCE_JOB_PROCESS_IDENTITY_CHANGED");
            uint state=WaitForSingleObject(process,0);
            if(state==258) {
              receipt.ObservedLiveDescendantPid=(int)pid;
              long created,exited,kernel,user; Require(GetProcessTimes(process,out created,out exited,out kernel,out user));
              receipt.ObservedLiveDescendantCreatedAtUtc=DateTime.FromFileTimeUtc(created).ToString("O");
              var name=new StringBuilder(1024); uint length=1024;
              Require(QueryFullProcessImageNameW(process,0,name,ref length));
              string leaf=Path.GetFileName(name.ToString()).ToLowerInvariant();
              receipt.ObservedLiveDescendantKind=leaf=="node.exe"?"NODE":leaf=="git.exe"?"GIT":leaf=="powershell.exe"?"POWERSHELL":leaf=="conhost.exe"?"CONSOLE_HOST":"OTHER";
              return true;
            }
            if(state!=0) throw new InvalidOperationException("SOURCE_JOB_PROCESS_WAIT_UNPROVEN");
          } finally { CloseHandle(process); }
        }
        return false;
      } finally { Marshal.FreeHGlobal(buffer); }
    }
    sealed class SourceOutputV3 { public string Text = ""; public int Overflow; public bool Failed; }
    static string MaintenanceSourceEnvironmentV3() {
      var rows = new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string name in new string[]{"SYSTEMROOT","WINDIR","TEMP","TMP"}) {
        string value=Environment.GetEnvironmentVariable(name);
        if(!String.IsNullOrEmpty(value) && value.IndexOfAny(new char[]{'\0','\r','\n'})<0) rows[name]=value;
      }
      rows["PATH"]=@"C:\Windows\System32;C:\Windows;C:\Program Files\nodejs";
      var text=new StringBuilder();
      foreach(var row in rows) text.Append(row.Key).Append('=').Append(row.Value).Append('\0');
      return text.Append('\0').ToString();
    }
    // Private fixture seam only. The production API above supplies every fixed
    // value and never exposes this method through a caller-selected action.
    static MaintenanceSourceProbeReceiptV3 RunMaintenanceSourceProbeV3(Stopwatch clock,
      string executable,string arguments,string cwd,string expectedMain,int deadlineMs,bool failQueries) {
      var r=new MaintenanceSourceProbeReceiptV3();
      if(clock==null || !System.Text.RegularExpressions.Regex.IsMatch(expectedMain??"", "^[a-f0-9]{40}$")
        || deadlineMs<200 || deadlineMs>120000) return r;
      IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,jobList=IntPtr.Zero,handleList=IntPtr.Zero,environment=IntPtr.Zero;
      IntPtr outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero;
      PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
      bool initialized=false,launched=false,interrupted=false;
      Task outputTask=null; var output=new SourceOutputV3(); var accounting=new CoreJobReceiptV1();
      Func<bool> empty=delegate {
        if(failQueries) throw new InvalidOperationException("SOURCE_JOB_QUERY_UNPROVEN");
        bool zero=Empty(job,accounting); r.ActiveProcesses=accounting.ActiveProcesses; return zero;
      };
      try {
        job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero); Require(job!=IntPtr.Zero);
        var limits=new EXTENDED_LIMIT();
        // Same Job primitives; Core's separate ACTIVE_PROCESS=1 scope stays unchanged.
        limits.basic.flags=0x2000|0x400|0x8; limits.basic.activeLimit=8;
        Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
        var security=new SOURCE_PIPE_SECURITY { length=Marshal.SizeOf(typeof(SOURCE_PIPE_SECURITY)),inherit=1 };
        Require(CreatePipe(out outputRead,out outputWrite,ref security,0));
        Require(SetHandleInformation(outputRead,1,0));
        Require(CreatePipe(out inputRead,out inputWrite,ref security,0));
        Require(SetHandleInformation(inputWrite,1,0));
        IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
        Require(size!=IntPtr.Zero); attributes=Marshal.AllocHGlobal(size);
        Require(InitializeProcThreadAttributeList(attributes,2,0,ref size)); initialized=true;
        jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
        handleList=Marshal.AllocHGlobal(IntPtr.Size*2);
        Marshal.WriteIntPtr(handleList,0,inputRead); Marshal.WriteIntPtr(handleList,IntPtr.Size,outputWrite);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
        environment=Marshal.StringToHGlobalUni(MaintenanceSourceEnvironmentV3());
        var start=new STARTUPINFOEX(); start.start.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));
        start.attributes=attributes; start.start.flags=0x100;
        start.start.input=inputRead; start.start.output=outputWrite; start.start.error=outputWrite;
        if(clock.ElapsedMilliseconds>=deadlineMs) { r.Reason="SOURCE_DEADLINE"; return r; }
        Require(CreateProcessW(executable,new StringBuilder(Quote(executable)+" "+arguments),
          // DETACHED_PROCESS avoids an implicit console-host descendant. Explicit
          // pipe handles still carry I/O; this is NOT CREATE_BREAKAWAY_FROM_JOB.
          IntPtr.Zero,IntPtr.Zero,true,0x80000|0x4|0x400|0x8|0x20,environment,cwd,ref start,out pi));
        launched=true; r.ChildPid=(int)pi.pid;
        long created,exited,kernel,user;
        Require(GetProcessTimes(pi.process,out created,out exited,out kernel,out user));
        r.ChildCreatedAtUtc=DateTime.FromFileTimeUtc(created).ToString("O");
        bool member; Require(IsProcessInJob(pi.process,job,out member));
        r.AssignedBeforeExecution=member; if(!member) throw new InvalidOperationException("SOURCE_JOB_ASSIGNMENT_UNPROVEN");
        CloseHandle(outputWrite); outputWrite=IntPtr.Zero;
        CloseHandle(inputRead); inputRead=IntPtr.Zero;
        CloseHandle(inputWrite); inputWrite=IntPtr.Zero; // fixed EOF; no caller stdin
        IntPtr reader=outputRead;
        outputTask=Task.Factory.StartNew(delegate {
          var bytes=new byte[1024]; var captured=new MemoryStream();
          try {
            while(true) {
              uint count; bool ok=ReadFile(reader,bytes,(uint)bytes.Length,out count,IntPtr.Zero);
              if(!ok) { if(Marshal.GetLastWin32Error()!=109) output.Failed=true; break; }
              if(count==0) break;
              if(captured.Length+count>4096) Interlocked.Exchange(ref output.Overflow,1);
              else if(Interlocked.CompareExchange(ref output.Overflow,0,0)==0) captured.Write(bytes,0,(int)count);
            }
            output.Text=new UTF8Encoding(false,true).GetString(captured.ToArray());
          } catch { output.Failed=true; } finally { captured.Dispose(); }
        },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
        if(clock.ElapsedMilliseconds>=deadlineMs) { r.Reason="SOURCE_DEADLINE"; interrupted=true; }
        else Require(ResumeThread(pi.thread)!=UInt32.MaxValue);
        while(!interrupted) {
          if(clock.ElapsedMilliseconds>=deadlineMs) { r.Reason="SOURCE_DEADLINE"; interrupted=true; break; }
          if(Interlocked.CompareExchange(ref output.Overflow,0,0)!=0) { r.Reason="SOURCE_OUTPUT_OVERFLOW"; interrupted=true; break; }
          if(output.Failed) { r.Reason="SOURCE_OUTPUT_UNPROVEN"; interrupted=true; break; }
          if(WaitForSingleObject(pi.process,0)==0) {
            r.NormalRootExit=true; Require(GetExitCodeProcess(pi.process,out r.ExitCode));
            if(r.ExitCode!=0) { r.Reason="SOURCE_TERMINAL_UNPROVEN"; interrupted=true; break; }
            var normalDrain=Stopwatch.StartNew();
            while(!empty()) {
              // Process-handle signal can precede Job accounting by a short
              // interval. Never subtract it or promote a nonzero count to zero.
              // A positive non-root Job identity is an actual descendant.
              if(SourceJobHasOtherProcessV3(job,r.ChildPid,r)) {
                r.Reason="SOURCE_DESCENDANT_REMAINS"; interrupted=true; break;
              }
              if(clock.ElapsedMilliseconds>=deadlineMs || normalDrain.ElapsedMilliseconds>=5000) {
                r.Reason="SOURCE_NORMAL_DRAIN_UNPROVEN"; interrupted=true; break;
              }
              Thread.Sleep(10);
            }
            break;
          }
          Thread.Sleep(10);
        }
        if(interrupted) { r.CancellationRequested=true; Require(TerminateJobObject(job,79)); }
        var drain=Stopwatch.StartNew();
        while((!empty() || WaitForSingleObject(pi.process,0)!=0) && drain.ElapsedMilliseconds<5000) Thread.Sleep(10);
        r.ZeroActiveProcessesObserved=empty() && WaitForSingleObject(pi.process,0)==0;
        r.CustodyReleased=r.ZeroActiveProcessesObserved;
        Require(GetExitCodeProcess(pi.process,out r.ExitCode));
        int remaining=(int)Math.Max(0,5000-drain.ElapsedMilliseconds);
        if(outputTask!=null && !outputTask.Wait(remaining)) { output.Failed=true; r.Reason="SOURCE_OUTPUT_DRAIN_UNPROVEN"; }
        r.OutputOverflow=Interlocked.CompareExchange(ref output.Overflow,0,0)!=0;
        if(!interrupted && clock.ElapsedMilliseconds>=deadlineMs) { interrupted=true; r.Reason="SOURCE_DEADLINE"; }
        if(!interrupted && r.CustodyReleased && !output.Failed && !r.OutputOverflow && r.NormalRootExit && r.ExitCode==0) {
          string observed=output.Text.Trim();
          if(System.Text.RegularExpressions.Regex.IsMatch(observed,"^[a-f0-9]{40}$")) r.ObservedSourceHead=observed;
          r.SourceHeadMatched=observed==expectedMain;
          if(r.SourceHeadMatched) { r.Passed=true; r.Reason=""; }
          else r.Reason="SOURCE_IDENTITY_UNPROVEN";
        } else if(!interrupted) r.Reason="SOURCE_TERMINAL_UNPROVEN";
        return r;
      } catch {
        r.Passed=false; r.Reason="SOURCE_NATIVE_CUSTODY_UNPROVEN";
        if(launched && job!=IntPtr.Zero) {
          r.CancellationRequested=true;
          try {
            Require(TerminateJobObject(job,80)); var drain=Stopwatch.StartNew();
            while((!empty() || WaitForSingleObject(pi.process,0)!=0) && drain.ElapsedMilliseconds<5000) Thread.Sleep(10);
            r.ZeroActiveProcessesObserved=empty() && WaitForSingleObject(pi.process,0)==0;
            r.CustodyReleased=r.ZeroActiveProcessesObserved;
          } catch { r.CustodyReleased=false; r.ZeroActiveProcessesObserved=false; }
        }
        return r;
      } finally {
        r.ElapsedMilliseconds=clock.ElapsedMilliseconds;
        // Job close is fail-safe cleanup, never a replacement for positive drain.
        if(job!=IntPtr.Zero) CloseHandle(job);
        if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
        if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
        foreach(IntPtr handle in new IntPtr[]{outputRead,outputWrite,inputRead,inputWrite}) if(handle!=IntPtr.Zero) CloseHandle(handle);
        if(initialized) DeleteProcThreadAttributeList(attributes);
        foreach(IntPtr memory in new IntPtr[]{attributes,jobList,handleList,environment}) if(memory!=IntPtr.Zero) Marshal.FreeHGlobal(memory);
      }
    }

  }
}
