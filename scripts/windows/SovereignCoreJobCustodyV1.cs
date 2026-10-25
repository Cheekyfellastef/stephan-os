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
  }
}
