// Installer-only bounded native compilation unit; compiled with the pinned Core unit.
// Existing Core loaders compile only their original bounded unit. No new public command surface.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Threading;
  using System.Threading.Tasks;
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

  public static partial class CoreJobCustodyV1 {
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
