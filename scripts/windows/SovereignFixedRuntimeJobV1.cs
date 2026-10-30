// Fixed runtime adapter of the existing Commander/Mission Worker.
// Draft source: no public command, installer, lease or scheduler authority.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.ComponentModel;
  using System.Diagnostics;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Security.Cryptography;
  using System.Text;
  using System.Threading;
  using System.Threading.Tasks;

  public sealed class FixedRuntimeStageV1 {
    public string Stage = "", Reason = "NATIVE_STAGE_UNPROVEN", RootCreatedAtUtc = "";
    public string RootLifecycle = "NOT_CREATED";
    public int RootPid, ObservedLiveDescendantPid;
    public string ObservedLiveDescendantCreatedAtUtc = "";
    public uint ActiveProcesses, ExitCode;
    public bool Launched, AssignedBeforeExecution, ParentBindingAccepted, ResumeConfirmed, NormalRootExit, CancellationRequested;
    public bool ZeroActiveProcessesObserved, ExecutionCustodyReleased, OutputComplete;
    public bool OutputOverflow, OperationOk;
    public string Output = "", OutputSha256 = "";
    public long ElapsedMilliseconds;
  }

  public sealed class FixedRuntimeReceiptV1 {
    public string SchemaVersion = "stephanos.fixed-runtime-job.v1";
    public string RequestId = "", RuntimeSourceHead = "", Profile = "", FrameSha256 = "";
    public string Reason = "NATIVE_RUNTIME_UNPROVEN", CustodyRecordSha256 = "";
    public long NativeRecordId;
    public string ActionId="", MissionId="", ClaimSha256="";
    public int OwnerPid, LauncherPid;
    public string OwnerCreatedAtUtc = "", LauncherCreatedAtUtc = "";
    public string TaskLifecycle = "NOT_CREATED";
    public bool SourceHeadMatched, TaskRootCreated, TaskResumed, TaskExecuted, OperationOk, ExecutionCustodyReleased;
    public long ElapsedMilliseconds;
    public FixedRuntimeStageV1 SourceStage, TaskStage;
  }

  public static partial class CoreJobCustodyV1 {
    [StructLayout(LayoutKind.Sequential)] struct RUNTIME_PIPE_SECURITY_V1 {
      public int Length; public IntPtr Descriptor; public int Inherit;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(
      out IntPtr read,out IntPtr write,ref RUNTIME_PIPE_SECURITY_V1 security,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(
      IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(
      IntPtr handle,byte[] bytes,uint length,out uint read,IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteFile(
      IntPtr handle,byte[] bytes,uint length,out uint written,IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true,EntryPoint="OpenProcess")] static extern IntPtr RuntimeOpenProcessV1(
      uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll", SetLastError=true,EntryPoint="GetProcessTimes")]
    static extern bool RuntimeProcessTimesV1(IntPtr process,out long created,out long exited,
      out long kernel,out long user);

    sealed class RuntimeOutputV1 {
      public string Text = "", Sha256 = "";
      public int Overflow; public volatile bool Failed, Complete;
    }
    static string RuntimeHashV1(byte[] bytes) {
      using(var sha=SHA256.Create())
        return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
    }
    static string RuntimeEnvironmentV1() {
      var rows=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string key in new string[]{"APPDATA","HOMEDRIVE","HOMEPATH","LOCALAPPDATA",
        "PROGRAMDATA","SYSTEMDRIVE","SYSTEMROOT","TEMP","TMP","USERDOMAIN","USERNAME","USERPROFILE","WINDIR"}) {
        string value=Environment.GetEnvironmentVariable(key);
        if(!String.IsNullOrEmpty(value) && value.Length<=4096 &&
          value.IndexOfAny(new char[]{'\0','\r','\n'})<0) rows[key]=value;
      }
      rows["PATH"]=@"C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Program Files\nodejs;C:\Program Files\Git\cmd";
      rows["PATHEXT"]=".COM;.EXE;.BAT;.CMD";
      rows["STEPHANOS_SHARED_WORKSPACE_ROOT"]=@"C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace";
      rows["STEPHANOS_SHARED_AGENT_WORKSPACE"]=rows["STEPHANOS_SHARED_WORKSPACE_ROOT"];
      rows["STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN"]="1";
      rows["STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_TRANSPORT"]="fixed-native-runtime-v1";
      rows["STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP"]="0";
      rows["STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY"]="0";
      var text=new StringBuilder();
      foreach(var row in rows) text.Append(row.Key).Append('=').Append(row.Value).Append('\0');
      return text.Append('\0').ToString();
    }
    static IntPtr RuntimeOwnerHandleV1(int pid,long expectedCreated) {
      if(pid<=0 || expectedCreated<=0) throw new InvalidOperationException("OWNER_IDENTITY_UNPROVEN");
      IntPtr handle=RuntimeOpenProcessV1(0x101000,false,(uint)pid);
      if(handle==IntPtr.Zero) throw new InvalidOperationException("OWNER_HANDLE_UNPROVEN");
      try {
        long created,exited,kernel,user;
        Require(RuntimeProcessTimesV1(handle,out created,out exited,out kernel,out user));
        if(created!=expectedCreated || WaitForSingleObject(handle,0)!=258)
          throw new InvalidOperationException("OWNER_BIRTH_UNPROVEN");
        return handle;
      } catch { CloseHandle(handle); throw; }
    }
    static bool RuntimeParentsAliveV1(IntPtr owner,IntPtr launcher) {
      return owner!=IntPtr.Zero && launcher!=IntPtr.Zero &&
        WaitForSingleObject(owner,0)==258 && WaitForSingleObject(launcher,0)==258;
    }


    [DllImport("kernel32.dll", SetLastError=true,EntryPoint="QueryInformationJobObject")]
    static extern bool RuntimeQueryJobListV1(IntPtr job,int type,IntPtr value,uint size,out uint returned);
    static bool RuntimeHasLiveOtherProcessV1(IntPtr job,int rootPid,FixedRuntimeStageV1 receipt) {
      const int capacity=16; int size=8+IntPtr.Size*capacity;
      IntPtr buffer=Marshal.AllocHGlobal(size);
      try {
        uint returned; Require(RuntimeQueryJobListV1(job,3,buffer,(uint)size,out returned));
        uint assigned=unchecked((uint)Marshal.ReadInt32(buffer,0));
        uint count=unchecked((uint)Marshal.ReadInt32(buffer,4));
        if(count>capacity || assigned!=count) throw new InvalidOperationException("JOB_LIST_UNPROVEN");
        for(int i=0;i<(int)count;i++) {
          long pid=Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64();
          if(pid==rootPid) continue;
          if(pid<=0 || pid>UInt32.MaxValue) throw new InvalidOperationException("JOB_IDENTITY_UNPROVEN");
          IntPtr process=RuntimeOpenProcessV1(0x101000,false,(uint)pid);
          if(process==IntPtr.Zero) {
            // Exited-between-queries is pending accounting, never subtraction.
            if(Marshal.GetLastWin32Error()==87) continue;
            throw new InvalidOperationException("JOB_MEMBER_STATE_UNPROVEN");
          }
          try {
            bool member; Require(IsProcessInJob(process,job,out member));
            if(!member) throw new InvalidOperationException("JOB_MEMBER_CHANGED");
            uint state=WaitForSingleObject(process,0);
            if(state==258) {
              long created,exited,kernel,user;
              Require(RuntimeProcessTimesV1(process,out created,out exited,out kernel,out user));
              receipt.ObservedLiveDescendantPid=(int)pid;
              receipt.ObservedLiveDescendantCreatedAtUtc=DateTime.FromFileTimeUtc(created).ToString("O");
              return true;
            }
            if(state!=0) throw new InvalidOperationException("JOB_MEMBER_WAIT_UNPROVEN");
          } finally { CloseHandle(process); }
        }
        return false;
      } finally { Marshal.FreeHGlobal(buffer); }
    }

    // PRIVATE fixture seam. Production host supplies only fixed profile data.
    // No public CLI/MCP argument can select these executable/argument values.
    static FixedRuntimeStageV1 RunRuntimeStageV1(IntPtr job,string stage,string executable,
      string arguments,string cwd,byte[] input,Stopwatch clock,int deadlineMs,
      IntPtr owner,IntPtr launcher,Func<bool> cancelled,Func<bool> queryFault,
      Func<FixedRuntimeStageV1,bool> bindBeforeResume,
      Action<FixedRuntimeStageV1> terminalDrainFixtureHook=null) {
      var r=new FixedRuntimeStageV1 { Stage=stage };
      var accounting=new CoreJobReceiptV1();
      Func<bool> empty=delegate {
        if(queryFault!=null && queryFault()) throw new InvalidOperationException("NATIVE_QUERY_UNPROVEN");
        bool zero=Empty(job,accounting); r.ActiveProcesses=accounting.ActiveProcesses; return zero;
      };
      IntPtr attributes=IntPtr.Zero,jobList=IntPtr.Zero,handleList=IntPtr.Zero,environment=IntPtr.Zero;
      IntPtr outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero;
      PROCESS_INFORMATION pi=new PROCESS_INFORMATION();
      bool initialized=false,interrupted=false;
      Task outputTask=null,inputTask=null;
      var output=new RuntimeOutputV1();
      int inputFailed=0;
      try {
        if(bindBeforeResume==null) throw new InvalidOperationException("PARENT_BINDING_REQUIRED");
        if(input==null || input.Length>32768) throw new InvalidOperationException("INPUT_BOUND_UNPROVEN");
        if(!RuntimeParentsAliveV1(owner,launcher) || Cancelled(cancelled)) {
          r.Reason="CANCELLED_BEFORE_LAUNCH"; r.ZeroActiveProcessesObserved=empty();
          r.ExecutionCustodyReleased=r.ZeroActiveProcessesObserved; return r;
        }
        if(clock.ElapsedMilliseconds>=deadlineMs) {
          r.Reason="DEADLINE_BEFORE_LAUNCH"; r.ZeroActiveProcessesObserved=empty();
          r.ExecutionCustodyReleased=r.ZeroActiveProcessesObserved; return r;
        }
        if(!empty()) throw new InvalidOperationException("STAGE_PREDECESSOR_NOT_EMPTY");
        var security=new RUNTIME_PIPE_SECURITY_V1 {
          Length=Marshal.SizeOf(typeof(RUNTIME_PIPE_SECURITY_V1)), Inherit=1 };
        Require(CreatePipe(out outputRead,out outputWrite,ref security,0));
        Require(SetHandleInformation(outputRead,1,0));
        Require(CreatePipe(out inputRead,out inputWrite,ref security,0));
        Require(SetHandleInformation(inputWrite,1,0));
        IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
        Require(size!=IntPtr.Zero); attributes=Marshal.AllocHGlobal(size);
        Require(InitializeProcThreadAttributeList(attributes,2,0,ref size)); initialized=true;
        jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobList,
          new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
        handleList=Marshal.AllocHGlobal(IntPtr.Size*2);
        Marshal.WriteIntPtr(handleList,0,inputRead); Marshal.WriteIntPtr(handleList,IntPtr.Size,outputWrite);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,
          new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
        environment=Marshal.StringToHGlobalUni(RuntimeEnvironmentV1());
        var startup=new STARTUPINFOEX(); startup.start.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));
        startup.attributes=attributes; startup.start.flags=0x100;
        startup.start.input=inputRead; startup.start.output=outputWrite; startup.start.error=outputWrite;
        // Suspended atomic JOB_LIST assignment, normal priority, detached console;
        // no CREATE_BREAKAWAY_FROM_JOB and no inherited Job handle.
        Require(CreateProcessW(executable,new StringBuilder(Quote(executable)+" "+arguments),
          IntPtr.Zero,IntPtr.Zero,true,0x80000|0x4|0x400|0x8|0x20,environment,cwd,ref startup,out pi));
        r.Launched=true; r.RootPid=(int)pi.pid; r.RootLifecycle="CREATED_SUSPENDED";
        long born,exited,kernel,user;
        Require(RuntimeProcessTimesV1(pi.process,out born,out exited,out kernel,out user));
        r.RootCreatedAtUtc=DateTime.FromFileTimeUtc(born).ToString("O");
        bool member; Require(IsProcessInJob(pi.process,job,out member));
        if(!member) throw new InvalidOperationException("ATOMIC_ASSIGNMENT_UNPROVEN");
        r.AssignedBeforeExecution=true; r.RootLifecycle="SUSPENDED_IN_OWNED_JOB";
        // Existing owner durably binds the exact suspended root to its claim
        // before it is allowed to execute. The fixed host bounds this exchange.
        if(!bindBeforeResume(r)) {
          r.Reason="PARENT_BINDING_UNPROVEN";
          throw new InvalidOperationException("PARENT_BINDING_UNPROVEN");
        }
        r.ParentBindingAccepted=true;
        CloseHandle(outputWrite); outputWrite=IntPtr.Zero;
        CloseHandle(inputRead); inputRead=IntPtr.Zero;
        IntPtr reader=outputRead;
        outputTask=Task.Factory.StartNew(delegate {
          var buffer=new byte[2048]; using(var captured=new MemoryStream()) {
            try {
              while(true) {
                uint count; bool ok=ReadFile(reader,buffer,(uint)buffer.Length,out count,IntPtr.Zero);
                if(!ok) { if(Marshal.GetLastWin32Error()!=109) output.Failed=true; break; }
                if(count==0) break;
                if(captured.Length+count>16384) Interlocked.Exchange(ref output.Overflow,1);
                else if(Interlocked.CompareExchange(ref output.Overflow,0,0)==0)
                  captured.Write(buffer,0,(int)count);
              }
              if(Interlocked.CompareExchange(ref output.Overflow,0,0)==0 && !output.Failed) {
                byte[] bytes=captured.ToArray();
                output.Text=new UTF8Encoding(false,true).GetString(bytes);
                output.Sha256=RuntimeHashV1(bytes); output.Complete=true;
              }
            } catch { output.Failed=true; }
          }
        },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
        IntPtr writer=inputWrite; inputWrite=IntPtr.Zero;
        inputTask=Task.Factory.StartNew(delegate {
          try {
            uint written;
            if(input.Length>0 && (!WriteFile(writer,input,(uint)input.Length,out written,IntPtr.Zero)
              || written!=(uint)input.Length)) Interlocked.Exchange(ref inputFailed,1);
          } catch { Interlocked.Exchange(ref inputFailed,1); }
          finally { CloseHandle(writer); }
        },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
        r.RootLifecycle="RESUME_UNPROVEN";
        Require(ResumeThread(pi.thread)==1); r.ResumeConfirmed=true; r.RootLifecycle="RESUME_CONFIRMED";
        while(true) {
          if(!RuntimeParentsAliveV1(owner,launcher)) { r.Reason="OWNER_ENDED"; interrupted=true; break; }
          if(Cancelled(cancelled)) { r.Reason="CANCELLED"; interrupted=true; break; }
          if(clock.ElapsedMilliseconds>=deadlineMs) { r.Reason="DEADLINE"; interrupted=true; break; }
          if(output.Failed || Interlocked.CompareExchange(ref inputFailed,0,0)!=0) {
            r.Reason="PIPE_UNPROVEN"; interrupted=true; break;
          }
          if(Interlocked.CompareExchange(ref output.Overflow,0,0)!=0) {
            r.Reason="OUTPUT_OVERFLOW"; interrupted=true; break;
          }
          empty(); // Current native accounting; never infer zero from PID absence.
          if(WaitForSingleObject(pi.process,0)==0) {
            r.NormalRootExit=true; Require(GetExitCodeProcess(pi.process,out r.ExitCode));
            var accountingDrain=Stopwatch.StartNew();
            while(!empty()) {
              if(RuntimeHasLiveOtherProcessV1(job,r.RootPid,r)) {
                r.Reason="LIVE_DESCENDANT_REMAINS"; interrupted=true; break;
              }
              if(clock.ElapsedMilliseconds>=deadlineMs || accountingDrain.ElapsedMilliseconds>=5000) {
                r.Reason="DESCENDANT_OR_ACCOUNTING_REMAINS"; interrupted=true; break;
              }
              if(!RuntimeParentsAliveV1(owner,launcher) || Cancelled(cancelled)) {
                r.Reason="CANCELLED"; interrupted=true; break;
              }
              Thread.Sleep(10);
            }
            break;
          }
          Thread.Sleep(10);
        }
        if(interrupted) { r.CancellationRequested=true; Require(TerminateJobObject(job,79)); }
        var drain=Stopwatch.StartNew();
        while((!empty() || WaitForSingleObject(pi.process,0)!=0) && drain.ElapsedMilliseconds<5000)
          Thread.Sleep(10);
        r.ZeroActiveProcessesObserved=empty() && WaitForSingleObject(pi.process,0)==0;
        r.ExecutionCustodyReleased=r.ZeroActiveProcessesObserved;
        Require(GetExitCodeProcess(pi.process,out r.ExitCode));
        int remaining=(int)Math.Max(0,5000-drain.ElapsedMilliseconds);
        if(outputTask!=null && !outputTask.Wait(remaining)) output.Failed=true;
        remaining=(int)Math.Max(0,5000-drain.ElapsedMilliseconds);
        if(inputTask!=null && !inputTask.Wait(remaining)) Interlocked.Exchange(ref inputFailed,1);
        r.OutputOverflow=Interlocked.CompareExchange(ref output.Overflow,0,0)!=0;
        r.OutputComplete=output.Complete && !output.Failed && !r.OutputOverflow;
        if(r.OutputComplete) { r.Output=output.Text; r.OutputSha256=output.Sha256; }
        if(!interrupted && clock.ElapsedMilliseconds>=deadlineMs) {
          interrupted=true; r.Reason="DEADLINE";
        }
        if(terminalDrainFixtureHook!=null) terminalDrainFixtureHook(r);
        if(!RuntimeParentsAliveV1(owner,launcher) || Cancelled(cancelled)) {
          interrupted=true; r.CancellationRequested=true; r.Reason=!RuntimeParentsAliveV1(owner,launcher)?"OWNER_ENDED":"CANCELLED";
        }
        r.OperationOk=!interrupted && r.NormalRootExit && r.ExitCode==0 &&
          r.ZeroActiveProcessesObserved && r.OutputComplete &&
          Interlocked.CompareExchange(ref inputFailed,0,0)==0;
        if(r.OperationOk) r.Reason="";
        else if(!interrupted) r.Reason=r.ExitCode==0?"TERMINAL_IO_UNPROVEN":"CHILD_FAILED";
        return r;
      } catch {
        r.OperationOk=false;
        if(r.Reason!="PARENT_BINDING_UNPROVEN") r.Reason="NATIVE_STAGE_UNPROVEN";
        if(r.Launched && job!=IntPtr.Zero) {
          r.CancellationRequested=true;
          try {
            Require(TerminateJobObject(job,80)); var drain=Stopwatch.StartNew();
            while((!empty() || WaitForSingleObject(pi.process,0)!=0) &&
              drain.ElapsedMilliseconds<5000) Thread.Sleep(10);
            r.ZeroActiveProcessesObserved=empty() && WaitForSingleObject(pi.process,0)==0;
            r.ExecutionCustodyReleased=r.ZeroActiveProcessesObserved;
          } catch { r.ExecutionCustodyReleased=false; r.ZeroActiveProcessesObserved=false; }
        } else {
          try { r.ZeroActiveProcessesObserved=empty();
            r.ExecutionCustodyReleased=r.ZeroActiveProcessesObserved; } catch {}
        }
        return r;
      } finally {
        r.ElapsedMilliseconds=clock.ElapsedMilliseconds;
        if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
        if(pi.process!=IntPtr.Zero) CloseHandle(pi.process);
        if(outputRead!=IntPtr.Zero) CloseHandle(outputRead);
        if(outputWrite!=IntPtr.Zero) CloseHandle(outputWrite);
        if(inputRead!=IntPtr.Zero) CloseHandle(inputRead);
        if(inputWrite!=IntPtr.Zero) CloseHandle(inputWrite);
        if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
        if(initialized) DeleteProcThreadAttributeList(attributes);
        if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
        if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);
        if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      }
    }
  }
}
