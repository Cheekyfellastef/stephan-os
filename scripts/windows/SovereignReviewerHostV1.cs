// Fixed CLI of the original reviewer, not a command runner/controller. Only the
// installed producer, exact native tools and closed candidate entrypoints run.
namespace Stephanos.Sovereign {
  using System;
  using System.Collections.Generic;
  using System.Diagnostics;
  using System.IO;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Threading;
  using System.Threading.Tasks;
  public static class SovereignReviewerHostV1 {
    public static int Main(string[] args) { return CoreJobCustodyV1.ReviewerMainV1(args); }
  }
  public static partial class CoreJobCustodyV1 {
    [StructLayout(LayoutKind.Sequential)] struct REVIEWER_PIPE_SECURITY_V1 { public int Length; public IntPtr Descriptor; public int Inherit; }
    [StructLayout(LayoutKind.Sequential)] struct REVIEWER_PROCESS_BASIC_V1 { public IntPtr Reserved, Peb, Reserved2, Reserved3, Pid, Parent; }
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="CreatePipe")]
    static extern bool ReviewerCreatePipeV1(out IntPtr read,out IntPtr write,ref REVIEWER_PIPE_SECURITY_V1 security,uint size);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="SetHandleInformation")]
    static extern bool ReviewerSetHandleInformationV1(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="ReadFile")]
    static extern bool ReviewerReadFileV1(IntPtr handle,byte[] bytes,uint length,out uint read,IntPtr overlapped);
    [DllImport("kernel32.dll",EntryPoint="GetCurrentProcess")] static extern IntPtr ReviewerCurrentProcessV1();
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process,int kind,ref REVIEWER_PROCESS_BASIC_V1 value,int size,out int returned);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="OpenProcess")] static extern IntPtr ReviewerOpenProcessV1(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="GetProcessTimes")]
    static extern bool ReviewerProcessTimesV1(IntPtr process,out long created,out long exited,out long kernel,out long user);
    sealed class ReviewerOutputV1 { internal string Text=""; internal volatile bool Failed,Complete,Overflow; }
    sealed class ReviewerChildV1 { internal bool Ok,ZeroActive; internal uint ExitCode; internal string Output=""; }
    static IntPtr ReviewerActualParentV1() {
      var info=new REVIEWER_PROCESS_BASIC_V1();int returned;
      if(NtQueryInformationProcess(ReviewerCurrentProcessV1(),0,ref info,Marshal.SizeOf(info),out returned)!=0
        ||returned!=Marshal.SizeOf(info)||info.Parent.ToInt64()<=0||info.Parent.ToInt64()>UInt32.MaxValue)
        throw new IOException("REVIEWER_PARENT_IDENTITY_UNPROVEN");
      IntPtr parent=ReviewerOpenProcessV1(0x101000,false,(uint)info.Parent.ToInt64());
      if(parent==IntPtr.Zero)throw new IOException("REVIEWER_PARENT_HANDLE_UNPROVEN");
      try {
        long parentBorn,selfBorn,exited,kernel,user;
        Require(ReviewerProcessTimesV1(parent,out parentBorn,out exited,out kernel,out user));
        Require(ReviewerProcessTimesV1(ReviewerCurrentProcessV1(),out selfBorn,out exited,out kernel,out user));
        if(parentBorn>selfBorn||WaitForSingleObject(parent,0)!=258)throw new IOException("REVIEWER_PARENT_BIRTH_UNPROVEN");
        return parent;
      }catch{CloseHandle(parent);throw;}
    }
    static readonly string[] ReviewerRequestKeysV1={
      "STEPHANOS_REVIEW_EXACT_HEAD","STEPHANOS_REVIEW_EXACT_BASE","STEPHANOS_REVIEW_EXACT_BRANCH",
      "STEPHANOS_REVIEW_REPOSITORY","STEPHANOS_REVIEW_ISSUE","STEPHANOS_REVIEW_PR",
      "STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER","STEPHANOS_REVIEW_IMPLEMENTER_SESSION","STEPHANOS_REVIEW_SESSION",
      "STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL","STEPHANOS_REVIEW_REVIEWER_PRINCIPAL","STEPHANOS_SOVEREIGN_REVIEW_MODEL"};
    static string ReviewerEnvironmentV1() {
      var values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string key in ReviewerRequestKeysV1)values[key]=Environment.GetEnvironmentVariable(key)??"";
      if(!ReviewerHexV1(values[ReviewerRequestKeysV1[0]],40)||!ReviewerHexV1(values[ReviewerRequestKeysV1[1]],40)
        ||values[ReviewerRequestKeysV1[0]]==values[ReviewerRequestKeysV1[1]])throw new IOException("REVIEWER_EXACT_PAIR_REQUIRED");
      string branch=values[ReviewerRequestKeysV1[2]];
      if(!Regex.IsMatch(branch,"\\A[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}\\z")||branch.Contains("..")||branch.Contains("//")
        ||branch.EndsWith("/")||branch.StartsWith("refs/")||values[ReviewerRequestKeysV1[3]]!="Cheekyfellastef/stephan-os")
        throw new IOException("REVIEWER_REQUEST_INVALID");
      for(int i=4;i<6;i++)if(!Regex.IsMatch(values[ReviewerRequestKeysV1[i]],"\\A[1-9][0-9]{0,8}\\z"))throw new IOException("REVIEWER_REQUEST_INVALID");
      for(int i=6;i<11;i++)if(!Regex.IsMatch(values[ReviewerRequestKeysV1[i]],"\\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\\z"))throw new IOException("REVIEWER_REQUEST_INVALID");
      if(values[ReviewerRequestKeysV1[7]]==values[ReviewerRequestKeysV1[8]]||values[ReviewerRequestKeysV1[9]]==values[ReviewerRequestKeysV1[10]])
        throw new IOException("REVIEWER_LOGICAL_IDENTITY_COLLISION");
      if(values[ReviewerRequestKeysV1[11]]=="")values[ReviewerRequestKeysV1[11]]="qwen:14b";
      if(!Regex.IsMatch(values[ReviewerRequestKeysV1[11]],"\\A[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}\\z"))throw new IOException("REVIEWER_MODEL_INVALID");
      values["SystemRoot"]=@"C:\Windows";values["WINDIR"]=@"C:\Windows";
      values["PATH"]=@"C:\Windows\System32;C:\Windows;C:\Program Files\Git\cmd;C:\Program Files\nodejs";
      values["STEPHANOS_SHARED_AGENT_WORKSPACE"]=ReviewerWorkspaceV1;
      var env=new StringBuilder();foreach(var row in values)env.Append(row.Key).Append('=').Append(row.Value).Append('\0');
      return env.Append('\0').ToString();
    }
    static Task ReviewerCaptureV1(IntPtr reader,ReviewerOutputV1 output) {
      return Task.Factory.StartNew(delegate {
        try {using(var memory=new MemoryStream()) {
          var buffer=new byte[2048];
          while(true) {
            uint count;bool ok=ReviewerReadFileV1(reader,buffer,(uint)buffer.Length,out count,IntPtr.Zero);
            if(!ok){if(Marshal.GetLastWin32Error()!=109)output.Failed=true;break;}
            if(count==0)break;
            if(memory.Length+count>65536)output.Overflow=true;
            if(!output.Overflow)memory.Write(buffer,0,(int)count);
          }
          if(!output.Failed&&!output.Overflow){output.Text=new UTF8Encoding(false,true).GetString(memory.ToArray());output.Complete=true;}
        }}catch{output.Failed=true;}
      },CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
    }
    // Private native lifecycle primitive. Production supplies only the fixed
    // installed Node entry. Hosted tests may reflect it for benign job vectors.
    static ReviewerChildV1 ReviewerRunChildV1(string executable,string arguments,string cwd,string environment,
      IntPtr parent,Func<bool> gamingSafe,int deadlineMs) {
      var result=new ReviewerChildV1();var accounting=new CoreJobReceiptV1();
      IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,jobList=IntPtr.Zero,handleList=IntPtr.Zero,env=IntPtr.Zero;
      IntPtr inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero,outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,errorRead=IntPtr.Zero,errorWrite=IntPtr.Zero;
      var pi=new PROCESS_INFORMATION();bool initialized=false,launched=false,interrupted=false;
      Task outputTask=null,errorTask=null;var output=new ReviewerOutputV1();var error=new ReviewerOutputV1();
      var clock=Stopwatch.StartNew();long nextGaming=0;
      Func<bool> alive=delegate{return parent!=IntPtr.Zero&&WaitForSingleObject(parent,0)==258;};
      try {
        if(deadlineMs<100||deadlineMs>780000||!alive()||!Safe(gamingSafe))return result;
        job=CreateJobObjectW(IntPtr.Zero,IntPtr.Zero);Require(job!=IntPtr.Zero);
        var limits=new EXTENDED_LIMIT();limits.basic.flags=0x2000|0x400|0x8|0x200;
        limits.basic.activeLimit=8;limits.jobMemory=new UIntPtr(1073741824u);
        Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
        var security=new REVIEWER_PIPE_SECURITY_V1{Length=Marshal.SizeOf(typeof(REVIEWER_PIPE_SECURITY_V1)),Inherit=1};
        Require(ReviewerCreatePipeV1(out inputRead,out inputWrite,ref security,0));
        Require(ReviewerCreatePipeV1(out outputRead,out outputWrite,ref security,0));
        Require(ReviewerCreatePipeV1(out errorRead,out errorWrite,ref security,0));
        Require(ReviewerSetHandleInformationV1(inputWrite,1,0));
        Require(ReviewerSetHandleInformationV1(outputRead,1,0));Require(ReviewerSetHandleInformationV1(errorRead,1,0));
        CloseHandle(inputWrite);inputWrite=IntPtr.Zero;
        IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);Require(size!=IntPtr.Zero);
        attributes=Marshal.AllocHGlobal(size);Require(InitializeProcThreadAttributeList(attributes,2,0,ref size));initialized=true;
        jobList=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobList,job);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
        handleList=Marshal.AllocHGlobal(IntPtr.Size*3);Marshal.WriteIntPtr(handleList,0,inputRead);
        Marshal.WriteIntPtr(handleList,IntPtr.Size,outputWrite);Marshal.WriteIntPtr(handleList,IntPtr.Size*2,errorWrite);
        Require(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
        env=Marshal.StringToHGlobalUni(environment);
        var start=new STARTUPINFOEX();start.start.cb=Marshal.SizeOf(typeof(STARTUPINFOEX));start.attributes=attributes;
        start.start.flags=0x100;start.start.input=inputRead;start.start.output=outputWrite;start.start.error=errorWrite;
        if(!alive()||!Safe(gamingSafe))return result;
        Require(CreateProcessW(executable,new StringBuilder(Quote(executable)+" "+arguments),IntPtr.Zero,IntPtr.Zero,true,
          0x80000|0x4|0x400|0x8|0x20,env,cwd,ref start,out pi));launched=true;
        bool member;Require(IsProcessInJob(pi.process,job,out member));if(!member)throw new IOException("REVIEWER_JOB_ASSIGNMENT_UNPROVEN");
        CloseHandle(inputRead);inputRead=IntPtr.Zero;CloseHandle(outputWrite);outputWrite=IntPtr.Zero;CloseHandle(errorWrite);errorWrite=IntPtr.Zero;
        outputTask=ReviewerCaptureV1(outputRead,output);errorTask=ReviewerCaptureV1(errorRead,error);
        if(!alive()||!Safe(gamingSafe))throw new IOException("REVIEWER_CANCELLED_BEFORE_RESUME");
        Require(ResumeThread(pi.thread)==1);
        long rootExit=-1;
        while(true) {
          if(!alive()||clock.ElapsedMilliseconds>=deadlineMs||output.Failed||error.Failed||output.Overflow||error.Overflow){interrupted=true;break;}
          if(clock.ElapsedMilliseconds>=nextGaming){if(!Safe(gamingSafe)){interrupted=true;break;}nextGaming=clock.ElapsedMilliseconds+500;}
          bool empty=Empty(job,accounting);
          if(WaitForSingleObject(pi.process,0)==0) {
            if(rootExit<0)rootExit=clock.ElapsedMilliseconds;
            if(empty)break;
            if(clock.ElapsedMilliseconds-rootExit>=5000){interrupted=true;break;}
          }
          Thread.Sleep(20);
        }
        if(interrupted)Require(TerminateJobObject(job,79));
        var drain=Stopwatch.StartNew();
        while((!Empty(job,accounting)||WaitForSingleObject(pi.process,0)!=0)&&drain.ElapsedMilliseconds<5000)Thread.Sleep(10);
        result.ZeroActive=Empty(job,accounting)&&WaitForSingleObject(pi.process,0)==0;
        if(!result.ZeroActive)throw new IOException("REVIEWER_JOB_DRAIN_UNPROVEN");
        Require(GetExitCodeProcess(pi.process,out result.ExitCode));
        bool complete=outputTask.Wait(2000)&&errorTask.Wait(2000);
        result.Ok=!interrupted&&complete&&output.Complete&&error.Complete&&!output.Failed&&!error.Failed
          &&!output.Overflow&&!error.Overflow&&error.Text.Length==0&&result.ExitCode==0&&alive()
          &&clock.ElapsedMilliseconds<deadlineMs&&Safe(gamingSafe);
        if(result.Ok)result.Output=output.Text;
        return result;
      }catch{return result;}
      finally {
        // The caller retains every code/tool/directory pin until this terminal
        // barrier completes. Never return a candidate while descendants live.
        if(launched&&job!=IntPtr.Zero&&!result.ZeroActive) {
          try {Require(TerminateJobObject(job,80));var drain=Stopwatch.StartNew();
            while((!Empty(job,accounting)||WaitForSingleObject(pi.process,0)!=0)&&drain.ElapsedMilliseconds<5000)Thread.Sleep(10);
            result.ZeroActive=Empty(job,accounting)&&WaitForSingleObject(pi.process,0)==0;
          }catch{result.ZeroActive=false;}
          if(!result.ZeroActive)Environment.FailFast("REVIEWER_JOB_DRAIN_UNPROVEN");
        }
        foreach(IntPtr h in new[]{inputRead,inputWrite,outputWrite,errorWrite,pi.thread,pi.process,job})if(h!=IntPtr.Zero)CloseHandle(h);
        if(outputTask!=null&&!outputTask.IsCompleted)try{outputTask.Wait(2000);}catch{}
        if(errorTask!=null&&!errorTask.IsCompleted)try{errorTask.Wait(2000);}catch{}
        foreach(IntPtr h in new[]{outputRead,errorRead})if(h!=IntPtr.Zero)CloseHandle(h);
        if(initialized)DeleteProcThreadAttributeList(attributes);
        foreach(IntPtr memory in new[]{attributes,jobList,handleList,env})if(memory!=IntPtr.Zero)Marshal.FreeHGlobal(memory);
      }
    }
    static bool ReviewerTerminalV1(string raw,string entry,out string payload,out int exit) {
      payload="";exit=1;
      try {
        if(String.IsNullOrEmpty(raw)||Encoding.UTF8.GetByteCount(raw)>65536)return false;
        string line=raw.TrimEnd('\r','\n');if(line.IndexOfAny(new[]{'\r','\n'})>=0)return false;
        var result=ReviewerJsonV1().Deserialize<Dictionary<string,object>>(line);
        if(result==null||!result.ContainsKey("status")||!(result["status"] is string))return false;
        foreach(var row in result)if((row.Key.EndsWith("Authority")||row.Key=="qualifiedWindowsSpecialist"
          ||row.Key=="independentAttestationProven"||row.Key=="independentHostAttestation"||row.Key=="signatureVerified")
          && !(row.Value is bool && !(bool)row.Value))return false;
        string status=(string)result["status"];
        string held=entry.StartsWith("windows-calibration")?"WINDOWS_CALIBRATION_HELD":entry=="coverage"?"REVIEW_COVERAGE_HELD":"SOVEREIGN_HIGH_RISK_REVIEW_HELD";
        bool allowed=status==held||(entry.StartsWith("windows-calibration")?status=="WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED":
          entry=="coverage"?(status=="HIGH_RISK_LOCAL_CANDIDATE_SCOPE_ONLY"||status=="STANDARD_LOCAL_CANDIDATE_SCOPE_ONLY"):
          status=="HIGH_RISK_LOCAL_CANDIDATE_READY");
        if(!allowed)return false;
        exit=status==held?(entry.StartsWith("windows-calibration")?2:1):0;
        if(entry=="advisory"&&(!result.ContainsKey("publicationOk")||!(result["publicationOk"] is bool)||!(bool)result["publicationOk"]))exit=1;
        payload=line;return true;
      }catch{return false;}
    }
    static string ReviewerNodeArgumentsV1(string source,string entry) {
      // Node's ESM loader flag requires a URL on Windows: a drive-letter path
      // is otherwise parsed as the unsupported URL scheme "c:".
      string loader=new Uri(Path.Combine(source,"scripts","sovereign-installed-reviewer-loader-v1.mjs")).AbsoluteUri;
      return "--no-warnings --experimental-loader "+Quote(loader)
        +" "+Quote(Path.Combine(source,"scripts","sovereign-installed-reviewer-v1.mjs"))+" "+entry;
    }
    internal static int ReviewerMainV1(string[] args) {
      try {
        if(args==null||args.Length!=1)throw new IOException("REVIEWER_FIXED_ENTRY_REQUIRED");
        string entry=args[0];
        if(entry!="--inspect"&&entry!="--governor"&&entry!="--advisory"&&entry!="--coverage"
          &&entry!="--windows-calibration"&&entry!="--windows-calibration-remote")throw new IOException("REVIEWER_FIXED_ENTRY_REQUIRED");
        using(var pins=OpenReviewerProfileV1(entry!="--governor")) {
          if(entry=="--inspect") {
            Console.WriteLine("SOVEREIGN_REVIEWER_PROFILE_V1="+ReviewerJsonV1().Serialize(ReviewerObservationV1(pins)));return 0;
          }
          if(entry=="--governor") {
            bool allowed=ReviewerInferencePrincipalV1(pins)&&ReviewerGamingSafeV1();
            Console.WriteLine("SOVEREIGN_REVIEWER_GOVERNOR_V1="+ReviewerJsonV1().Serialize(new {
              schemaVersion="stephanos.reviewer-governor-observation.v1",allowed=allowed,
              independentPrincipalObserved=false,qualified=false}));return allowed?0:1;
          }
          if(!ReviewerInferencePrincipalV1(pins))throw new IOException("REVIEWER_PRINCIPAL_NOT_ADMITTED");
          string environment=ReviewerEnvironmentV1();entry=entry.Substring(2);
          string source=Path.Combine(pins.VersionRoot,"source");
          string arguments=ReviewerNodeArgumentsV1(source,entry);
          IntPtr parent=ReviewerActualParentV1();ReviewerChildV1 child;
          try{child=ReviewerRunChildV1(ReviewerNodeV1,arguments,source,environment,parent,
            entry=="coverage"?(Func<bool>)delegate{return true;}:ReviewerGamingSafeV1,
            entry=="coverage"?45000:entry.StartsWith("windows-calibration")?180000:780000);}finally{CloseHandle(parent);}
          string payload;int exit;
          if(!child.Ok||!child.ZeroActive||!ReviewerTerminalV1(child.Output,entry,out payload,out exit))throw new IOException("REVIEWER_TERMINAL_UNPROVEN");
          string prefix=entry=="advisory"?"SOVEREIGN_HIGH_RISK_ADVISORY_RESULT":entry=="coverage"?"SOVEREIGN_REVIEW_COVERAGE_RESULT":
            entry=="windows-calibration-remote"?"SOVEREIGN_WINDOWS_CALIBRATION_REMOTE_RESULT":"SOVEREIGN_WINDOWS_CALIBRATION_RESULT";
          Console.WriteLine(prefix+"="+payload);return exit;
        }
      }catch{
        Console.WriteLine("SOVEREIGN_REVIEWER_PROFILE_HELD={\"reason\":\"PROTECTED_REVIEWER_PROFILE_UNAVAILABLE\",\"qualified\":false,\"independentPrincipalObserved\":false}");return 1;
      }
    }
  }
}
