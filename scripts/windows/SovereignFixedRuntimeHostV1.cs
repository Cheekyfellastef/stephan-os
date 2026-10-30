// One fixed precompiled helper entry for the existing Commander/worker boundary.
// Installation, qualification, request authority and operation success are distinct.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.Globalization;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Threading;
  using System.Threading.Tasks;
  using System.Web.Script.Serialization;

  public sealed class FixedRuntimeRequestV1 {
    public string SchemaVersion="", RequestId="", Profile="", RuntimeSourceHead="";
    public int OwnerPid;
    public string TaskFrameBase64="", TaskBindingSha256="";
  }
  public static class FixedRuntimeHostV1 {
    public static int Main(string[] args) {
      if(args.Length==1 && args[0]=="--inspect-v1") return CoreJobCustodyV1.InspectFixedRuntimeHostV1();
      if(args.Length!=0) return 2;
      return CoreJobCustodyV1.RunFixedRuntimeHostV1();
    }
  }
  public static partial class CoreJobCustodyV1 {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    struct RUNTIME_PROCESS_ENTRY_V1 {
      public uint Size,Usage,Pid;
      public UIntPtr Heap;
      public uint Module,Threads,ParentPid;
      public int BasePriority;
      public uint Flags;
      [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string Name;
    }
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
    static extern bool Process32FirstW(IntPtr snapshot,ref RUNTIME_PROCESS_ENTRY_V1 row);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
    static extern bool Process32NextW(IntPtr snapshot,ref RUNTIME_PROCESS_ENTRY_V1 row);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,EntryPoint="QueryFullProcessImageNameW")]
    static extern bool RuntimeOwnerImageV1(IntPtr process,uint flags,StringBuilder image,ref uint length);

    static int RuntimeActualParentV1() {
      IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
      if(snapshot==new IntPtr(-1)) throw new InvalidOperationException("RUNTIME_PARENT_SNAPSHOT_UNPROVEN");
      try {
        var row=new RUNTIME_PROCESS_ENTRY_V1 { Size=(uint)Marshal.SizeOf(typeof(RUNTIME_PROCESS_ENTRY_V1)) };
        Require(Process32FirstW(snapshot,ref row)); int self=Process.GetCurrentProcess().Id;
        for(int count=0;count<65536;count++) {
          if(row.Pid==(uint)self && row.ParentPid>0 && row.ParentPid<=Int32.MaxValue) return (int)row.ParentPid;
          if(!Process32NextW(snapshot,ref row)) break;
        }
        throw new InvalidOperationException("RUNTIME_PARENT_IDENTITY_UNPROVEN");
      } finally { CloseHandle(snapshot); }
    }
    static string RuntimeBoundedLineV1(int maximum) {
      var text=new StringBuilder();
      while(true) {
        int next=Console.In.Read();
        if(next<0) return null;
        if(next==10) return text.ToString();
        if(next==13) continue;
        if(text.Length>=maximum) throw new InvalidOperationException("RUNTIME_INPUT_BOUND_EXCEEDED");
        text.Append((char)next);
      }
    }
    static string RuntimeReadLineV1(int maximum,int timeoutMs) {
      if(timeoutMs<1) throw new InvalidOperationException("RUNTIME_INPUT_DEADLINE");
      var read=Task.Factory.StartNew(delegate { return RuntimeBoundedLineV1(maximum); },
        CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
      if(!read.Wait(timeoutMs)) throw new InvalidOperationException("RUNTIME_INPUT_DEADLINE");
      return read.Result;
    }
    static FixedRuntimeRequestV1 ParseFixedRuntimeRequestV1(string raw) {
      if(raw==null || Encoding.UTF8.GetByteCount(raw)>32768)
        throw new InvalidOperationException("RUNTIME_FRAME_UNPROVEN");
      var parser=new JavaScriptSerializer { MaxJsonLength=32768,RecursionLimit=4 };
      var objectValue=RuntimeObjectV1(parser.DeserializeObject(raw));
      string[] keys={"SchemaVersion","RequestId","Profile","RuntimeSourceHead","OwnerPid",
        "TaskFrameBase64","TaskBindingSha256"};
      var seen=new HashSet<string>(StringComparer.Ordinal);
      foreach(Match match in Regex.Matches(raw,@"""([A-Za-z0-9]+)""\s*:")) {
        if(!seen.Add(match.Groups[1].Value)) throw new InvalidOperationException("RUNTIME_FRAME_DUPLICATE_FIELD");
      }
      if(objectValue.Count!=keys.Length || seen.Count!=keys.Length)
        throw new InvalidOperationException("RUNTIME_FRAME_SHAPE_UNPROVEN");
      foreach(string key in keys) if(!seen.Contains(key) || !objectValue.ContainsKey(key))
        throw new InvalidOperationException("RUNTIME_FRAME_SHAPE_UNPROVEN");
      long owner=RuntimeIntegerV1(objectValue,"OwnerPid");
      var frame=new FixedRuntimeRequestV1 {
        SchemaVersion=RuntimeStringV1(objectValue,"SchemaVersion"),
        RequestId=RuntimeStringV1(objectValue,"RequestId"),Profile=RuntimeStringV1(objectValue,"Profile"),
        RuntimeSourceHead=RuntimeStringV1(objectValue,"RuntimeSourceHead"),
        OwnerPid=owner>0 && owner<=Int32.MaxValue?(int)owner:0,
        TaskFrameBase64=RuntimeStringV1(objectValue,"TaskFrameBase64"),
        TaskBindingSha256=RuntimeStringV1(objectValue,"TaskBindingSha256") };
      if(frame.SchemaVersion!="stephanos.fixed-runtime-request.v1" ||
        !Regex.IsMatch(frame.RequestId,@"^[a-z0-9][a-z0-9._-]{7,79}$") ||
        !RuntimeHexV1(frame.RuntimeSourceHead,40) || frame.OwnerPid<=0 ||
        (frame.Profile!="MAINTENANCE_GOAL_BUILDER_V1" && frame.Profile!="SOURCE_TASK_V1") ||
        frame.TaskFrameBase64.Length>24000 || !RuntimeHexV1(frame.TaskBindingSha256,64))
        throw new InvalidOperationException("RUNTIME_FRAME_IDENTITY_UNPROVEN");
      byte[] body=Convert.FromBase64String(frame.TaskFrameBase64);
      if(body.Length>16384 || Convert.ToBase64String(body)!=frame.TaskFrameBase64 ||
        RuntimeHashV1(body)!=frame.TaskBindingSha256 ||
        (frame.Profile=="MAINTENANCE_GOAL_BUILDER_V1" && body.Length!=0))
        throw new InvalidOperationException("RUNTIME_TASK_BINDING_UNPROVEN");
      return frame;
    }
    static void RuntimeFixedEnvironmentV1() {
      var fixedValues=new Dictionary<string,string> {
        {"USERPROFILE",@"C:\Users\Stephan Callear"},{"HOMEDRIVE","C:"},{"HOMEPATH",@"\Users\Stephan Callear"},
        {"APPDATA",@"C:\Users\Stephan Callear\AppData\Roaming"},{"LOCALAPPDATA",@"C:\Users\Stephan Callear\AppData\Local"},
        {"PROGRAMDATA",@"C:\ProgramData"},{"SYSTEMDRIVE","C:"},{"SYSTEMROOT",@"C:\Windows"},{"WINDIR",@"C:\Windows"},
        {"TEMP",@"C:\Users\Stephan Callear\AppData\Local\Temp"},{"TMP",@"C:\Users\Stephan Callear\AppData\Local\Temp"} };
      foreach(var row in fixedValues) Environment.SetEnvironmentVariable(row.Key,row.Value);
    }
    static void ProjectRuntimeTaskEvidenceV1(FixedRuntimeReceiptV1 receipt,FixedRuntimeStageV1 stage) {
      receipt.TaskStage=stage; receipt.TaskRootCreated=stage.Launched;
      receipt.TaskResumed=stage.ResumeConfirmed; receipt.TaskLifecycle=stage.RootLifecycle;
      receipt.ExecutionCustodyReleased=stage.ExecutionCustodyReleased;
      receipt.TaskExecuted=false; receipt.OperationOk=false; receipt.Reason=stage.Reason;
      if(!stage.ResumeConfirmed ||
        !stage.ParentBindingAccepted || !stage.NormalRootExit || !stage.OutputComplete) return;
      bool source=receipt.Profile=="SOURCE_TASK_V1";
      string marker=source?"SOVEREIGN_RUNTIME_SOURCE_PROPOSAL_V1=":"SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=";
      string[] lines=stage.Output.Trim().Split('\n'); int markers=0;
      foreach(string line in lines) if(line.Trim().StartsWith(marker,StringComparison.Ordinal)) markers++;
      string terminal=lines.Length==0?"":lines[lines.Length-1].Trim();
      if(markers!=1 || !terminal.StartsWith(marker,StringComparison.Ordinal)) {
        receipt.Reason="ACTION_TERMINAL_PROTOCOL_UNPROVEN"; return;
      }
      try {
        var report=RuntimeObjectV1(new JavaScriptSerializer { MaxJsonLength=32768,RecursionLimit=32 }
          .DeserializeObject(terminal.Substring(marker.Length)));
        object result;
        if(RuntimeStringV1(report,"schemaVersion")!=(source?"stephanos.fixed-source-task-proposal-reference.v1":"stephanos.sovereign-commander-goal-builder-repair.v1") ||
          !report.TryGetValue(source?"success":"ok",out result) || !(result is bool) ||
          stage.ExitCode!=((bool)result?0u:2u)) {
          receipt.Reason="ACTION_TERMINAL_PROTOCOL_UNPROVEN"; return;
        }
        if(source && (RuntimeStringV1(report,"requestId")!=receipt.RequestId ||
          RuntimeStringV1(report,"claimSha256")!=receipt.ClaimSha256)) {
          receipt.Reason="ACTION_TERMINAL_SOURCE_BINDING_UNPROVEN";return;
        }
        receipt.TaskExecuted=true; receipt.TaskLifecycle="ENTRY_REPORTED";
        receipt.OperationOk=stage.OperationOk && (bool)result;
      } catch { receipt.Reason="ACTION_TERMINAL_PROTOCOL_UNPROVEN"; }
    }
    internal static int InspectFixedRuntimeHostV1() {
      // A read-only inventory, not an execution or enrolment endpoint.
      // The original parent still owns admission and reservation adjudication.
      try {
        using(var pins=OpenFixedRuntimeIdentityV1()) {
          var custody=ReadRuntimeCustodyV1(pins);
          bool sameMachine=custody.MachineHash==pins.MachineHash;
          bool bootOrdered=RuntimeInstantV1(custody.BootStartedAtUtc)<=RuntimeInstantV1(pins.BootStartedAtUtc);
          bool idle=sameMachine && bootOrdered && custody.Phase=="IDLE" && !RuntimeCurrentBootFenceExistsV1(pins);
          Console.WriteLine("SOVEREIGN_RUNTIME_INVENTORY_V1="+new JavaScriptSerializer().Serialize(new {
            SchemaVersion="stephanos.fixed-runtime-inventory.v1",Ok=true,SourceHead=pins.SourceHead,
            SourceTree=pins.SourceTree,HelperSha256=pins.HelperSha256,ManifestSha256=pins.ManifestSha256,
            BootStartedAtUtc=pins.BootStartedAtUtc,AuthenticatedCustodyPhase=custody.Phase,
            AuthenticatedCustodyIdle=idle,CustodyRecordSha256=custody.RecordSha256,NativeRecordId=custody.NativeRecordId,Profiles=new string[]{"MAINTENANCE_GOAL_BUILDER_V1","SOURCE_TASK_V1"},
            RuntimeActivationGranted=false,MutationAttempted=false }));
          return 0;
        }
      } catch(Exception error) {
        string reason=Regex.IsMatch(error.Message??"","^[A-Z][A-Z0-9_]{0,95}$")?
          error.Message:"FIXED_RUNTIME_INSPECTION_UNPROVEN";
        Console.WriteLine("SOVEREIGN_RUNTIME_INVENTORY_V1="+new JavaScriptSerializer().Serialize(new {
          SchemaVersion="stephanos.fixed-runtime-inventory.v1",Ok=false,Reason=reason,
          Profiles=new string[0],RuntimeActivationGranted=false,MutationAttempted=false }));
        return 2;
      }
    }
    internal static int RunFixedRuntimeHostV1() {
      var receipt=new FixedRuntimeReceiptV1(); var clock=Stopwatch.StartNew();
      IntPtr owner=IntPtr.Zero,launcher=IntPtr.Zero,job=IntPtr.Zero;
      FixedRuntimeIdentityPinsV1 pins=null;
      try {
        string raw=RuntimeReadLineV1(32768,10000);
        var frame=ParseFixedRuntimeRequestV1(raw);
        receipt.RequestId=frame.RequestId; receipt.Profile=frame.Profile;
        receipt.RuntimeSourceHead=frame.RuntimeSourceHead;
        receipt.FrameSha256=RuntimeHashV1(Encoding.UTF8.GetBytes(raw));
        receipt.OwnerPid=frame.OwnerPid; receipt.LauncherPid=frame.OwnerPid;
        if(RuntimeActualParentV1()!=frame.OwnerPid)
          throw new InvalidOperationException("RUNTIME_ACTUAL_PARENT_UNPROVEN");
        // Capture the real parent birth through a held OS handle. The only
        // creator of this request's private stdin pipe must acknowledge it.
        owner=RuntimeOpenProcessV1(0x101000,false,(uint)frame.OwnerPid);
        if(owner==IntPtr.Zero || WaitForSingleObject(owner,0)!=258)
          throw new InvalidOperationException("RUNTIME_PARENT_HANDLE_UNPROVEN");
        long born,exited,kernel,user;
        Require(RuntimeProcessTimesV1(owner,out born,out exited,out kernel,out user));
        launcher=RuntimeOwnerHandleV1(frame.OwnerPid,born);
        receipt.OwnerCreatedAtUtc=DateTime.FromFileTimeUtc(born).ToString("O");
        receipt.LauncherCreatedAtUtc=receipt.OwnerCreatedAtUtc;
        var image=new StringBuilder(32768); uint imageLength=32768;
        Require(RuntimeOwnerImageV1(owner,0,image,ref imageLength));
        if(!String.Equals(image.ToString(),@"C:\Program Files\nodejs\node.exe",StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("RUNTIME_CANONICAL_PARENT_IMAGE_UNPROVEN");
        pins=OpenFixedRuntimeIdentityV1();
        if(frame.RuntimeSourceHead!=pins.SourceHead)
          throw new InvalidOperationException("RUNTIME_INSTALLED_SOURCE_HEAD_CHANGED");
        receipt.SourceHeadMatched=true;
        var custody=ReadRuntimeCustodyV1(pins);
        receipt.CustodyRecordSha256=custody.RecordSha256; receipt.NativeRecordId=custody.NativeRecordId;
        bool source=frame.Profile=="SOURCE_TASK_V1";
        if(custody.MachineHash!=pins.MachineHash ||
          (source?RuntimeInstantV1(custody.BootStartedAtUtc)>RuntimeInstantV1(pins.BootStartedAtUtc):
            RuntimeInstantV1(custody.BootStartedAtUtc)!=RuntimeInstantV1(pins.BootStartedAtUtc)))
          throw new InvalidOperationException("RUNTIME_CURRENT_BOOT_CUSTODY_UNPROVEN");
        FixedRuntimeSourceBindingV1 sourceBinding=null;
        if(source) {
          if(custody.Phase!="IDLE" || RuntimeCurrentBootFenceExistsV1(pins)) throw new InvalidOperationException("RUNTIME_SOURCE_CUSTODY_NOT_IDLE");
          sourceBinding=RuntimeSourceBindingV1(frame,pins,born);
          receipt.ActionId=sourceBinding.ActionId;receipt.MissionId=sourceBinding.MissionId;receipt.ClaimSha256=sourceBinding.ClaimSha256;
        }
        if(!source && (custody.Phase!="ACTIVE" || custody.OwnerPid!=frame.OwnerPid ||
          custody.ReservationId!=frame.RequestId || custody.Operation!="repair-goal-builder-flow"))
          throw new InvalidOperationException("RUNTIME_EXACT_MAINTENANCE_OWNER_UNPROVEN");
        RuntimeFixedEnvironmentV1();
        job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero); Require(job!=IntPtr.Zero);
        var limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000|0x400|0x8; limits.basic.activeLimit=16;
        Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
        Task<string> cancellation=null;
        int deadline=source?RuntimeSourceDeadlineMsV1:145000;
        byte[] taskInput=source?Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new {
          schemaVersion="stephanos.fixed-source-task-input.v1",requestId=frame.RequestId,
          actionId=sourceBinding.ActionId,missionId=sourceBinding.MissionId,claimSha256=sourceBinding.ClaimSha256,
          frameSha256=receipt.FrameSha256,sourceHead=pins.SourceHead,
          remainingMs=(int)Math.Max(0,deadline-clock.ElapsedMilliseconds-30000) })):new byte[0];
        receipt.TaskStage=RunRuntimeStageV1(job,frame.Profile,
          @"C:\Program Files\nodejs\node.exe",
          Quote(Path.Combine(RuntimeSourceRootV1,"scripts",source?"sovereign-fixed-runtime-source-task-v1.mjs":"sovereign-commander-goal-builder-repair.mjs")),
          RuntimeSourceRootV1,taskInput,clock,deadline,owner,launcher,
          delegate { return cancellation!=null && cancellation.IsCompleted; },null,
          delegate(FixedRuntimeStageV1 root) {
            var prepared=new { SchemaVersion="stephanos.fixed-runtime-prepared.v1",RequestId=frame.RequestId,
              FrameSha256=receipt.FrameSha256,Profile=frame.Profile,RuntimeSourceHead=frame.RuntimeSourceHead,
              OwnerPid=frame.OwnerPid,OwnerCreatedAtUtc=receipt.OwnerCreatedAtUtc,
              RootPid=root.RootPid,RootCreatedAtUtc=root.RootCreatedAtUtc,
              HelperSha256=pins.HelperSha256,ManifestSha256=pins.ManifestSha256,
              CustodyRecordSha256=custody.RecordSha256,NativeRecordId=custody.NativeRecordId };
            Console.WriteLine("SOVEREIGN_RUNTIME_PREPARED_V1="+new JavaScriptSerializer().Serialize(prepared));
            Console.Out.Flush();
            int remaining=(int)Math.Min(5000,Math.Max(0,deadline-clock.ElapsedMilliseconds));
            string acknowledgement=RuntimeReadLineV1(512,remaining);
            string expected="ACK "+receipt.FrameSha256+" "+frame.OwnerPid.ToString(CultureInfo.InvariantCulture)+" "+receipt.OwnerCreatedAtUtc+" "+root.RootPid.ToString(CultureInfo.InvariantCulture)+" "+root.RootCreatedAtUtc;
            if(acknowledgement!=expected) return false;
            cancellation=Task.Factory.StartNew(delegate { return RuntimeBoundedLineV1(512); },
              CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
            return true;
          });
        ProjectRuntimeTaskEvidenceV1(receipt,receipt.TaskStage);
      } catch(Exception error) {
        receipt.OperationOk=false;
        receipt.Reason=Regex.IsMatch(error.Message??"","^[A-Z][A-Z0-9_]{0,95}$")?
          error.Message:"FIXED_RUNTIME_HELPER_UNPROVEN";
        if(job!=IntPtr.Zero) {
          try {
            Require(TerminateJobObject(job,82)); var drain=Stopwatch.StartNew(); var accounting=new CoreJobReceiptV1();
            while(!Empty(job,accounting) && drain.ElapsedMilliseconds<5000) Thread.Sleep(10);
            receipt.ExecutionCustodyReleased=Empty(job,accounting);
          } catch { receipt.ExecutionCustodyReleased=false; }
        }
      } finally {
        receipt.ElapsedMilliseconds=clock.ElapsedMilliseconds;
        if(job!=IntPtr.Zero) CloseHandle(job);
        if(owner!=IntPtr.Zero) CloseHandle(owner);
        if(launcher!=IntPtr.Zero) CloseHandle(launcher);
        if(pins!=null) pins.Dispose();
      }
      string terminal=new JavaScriptSerializer { MaxJsonLength=262144 }.Serialize(receipt);
      if(Encoding.UTF8.GetByteCount(terminal)>262144) return 2;
      Console.WriteLine("SOVEREIGN_RUNTIME_TERMINAL_V1="+terminal); Console.Out.Flush();
      return receipt.OperationOk?0:2;
    }
  }
}
