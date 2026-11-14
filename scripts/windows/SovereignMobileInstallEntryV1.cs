// One on-demand fixed task entry and one LOCAL authenticated pipe. No new
// controller, queue, scheduler, public listener, caller path or command lane.
// The browser cannot supply a release/candidate/key; PREPARE is the native WAL.
namespace Stephanos.Sovereign {
  using System;
  using System.Diagnostics;
  using System.Globalization;
  using System.IO;
  using System.IO.Pipes;
  using System.Reflection;
  using System.Runtime.InteropServices;
  using System.Security.AccessControl;
  using System.Security.Principal;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Threading.Tasks;
  using Microsoft.Win32.SafeHandles;

  internal sealed class MobileInstallPipeRequestV1 {
    internal readonly string Operation,RequestId,AssertionJson;
    private MobileInstallPipeRequestV1(string operation,string request,string assertion) {Operation=operation;RequestId=request;AssertionJson=assertion;}
    internal static MobileInstallPipeRequestV1 Parse(string wire) {
      if(wire==null || wire.Length<1 || wire.Length>32768)throw new InvalidOperationException("MOBILE_PIPE_REQUEST_BOUND");
      foreach(char ch in wire)if(ch<32 || ch>126)throw new InvalidOperationException("MOBILE_PIPE_REQUEST_ASCII");
      string[] fields=wire.Split('|');
      if(fields.Length<2 || fields[0]!="STEPHANOS_MOBILE_INSTALL_PIPE_V1")throw new InvalidOperationException("MOBILE_PIPE_REQUEST_VERSION");
      string operation=fields[1];
      if(operation=="PREPARE" && fields.Length==2)return new MobileInstallPipeRequestV1(operation,null,null);
      if((operation!="APPROVE" && operation!="RECONCILE" && operation!="CANCEL") ||
          fields.Length!=(operation=="APPROVE"?4:3) || !Regex.IsMatch(fields[2],"\\Amobile-install-[a-z0-9][a-z0-9-]{7,63}\\z",RegexOptions.CultureInvariant))
        throw new InvalidOperationException("MOBILE_PIPE_REQUEST_SHAPE");
      string assertion=null;
      if(operation=="APPROVE") {
        if(fields[3].Length<4 || fields[3].Length>21848)throw new InvalidOperationException("MOBILE_PIPE_ASSERTION_BOUND");
        byte[] bytes;try {bytes=Convert.FromBase64String(fields[3]);}
        catch {throw new InvalidOperationException("MOBILE_PIPE_ASSERTION_ENCODING");}
        if(bytes.Length<2 || bytes.Length>16384 || Convert.ToBase64String(bytes)!=fields[3])throw new InvalidOperationException("MOBILE_PIPE_ASSERTION_ENCODING");
        try {assertion=new UTF8Encoding(false,true).GetString(bytes);}
        catch {throw new InvalidOperationException("MOBILE_PIPE_ASSERTION_ENCODING");}
      }
      return new MobileInstallPipeRequestV1(operation,fields[2],assertion);
    }
  }

  internal static class SovereignMobileInstallEntryV1 {
    internal const string PipeName="Stephanos.SovereignMobileInstallerV1";
    internal const int ClientRights=0x00120083,MaximumFrame=32768;
    const uint FirstInstance=0x00080000,Overlapped=0x40000000,RejectRemote=8;
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 retainedCandidate;
    static readonly object operationLock=new object();
    static Task<SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1> originalOperation;
    static bool PendingOperation() {
      lock(operationLock)return (originalOperation!=null && !originalOperation.IsCompleted) || SovereignMobileInstallExecutorV1.HasRetainedCustody;
    }
    static bool ReserveApproval(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,string assertion) {
      lock(operationLock) {
        if((originalOperation!=null && !originalOperation.IsCompleted) || SovereignMobileInstallExecutorV1.HasRetainedCustody) {
          if(retainedCandidate==null || retainedCandidate.RequestId!=candidate.RequestId)throw new InvalidOperationException("MOBILE_INSTALLER_ORIGINAL_CUSTODY_HELD");
          return false;
        }
        if(!SovereignMobileInstallExecutorV1.ReserveProtectedRequest(candidate.RequestId))throw new InvalidOperationException("MOBILE_INSTALLER_ORIGINAL_CUSTODY_HELD");
        retainedCandidate=candidate;
        // One task carries the already-persisted request in the same native
        // owner. No request queue, second executor or browser cancellation token.
        originalOperation=Task.Factory.StartNew(delegate {return SovereignMobileInstallExecutorV1.RunProtected(candidate.RequestId,assertion);},
          System.Threading.CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
        return true;
      }
    }
    static SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 CompletedEvidence(string request) {
      lock(operationLock) {
        if(originalOperation==null || !originalOperation.IsCompleted || retainedCandidate==null || retainedCandidate.RequestId!=request)return null;
        if(originalOperation.Status==TaskStatus.RanToCompletion)return originalOperation.Result;
        var observed=originalOperation.Exception;return null;
      }
    }
    static void ObserveOriginalDrain() {
      string request=null;
      lock(operationLock)if(originalOperation!=null && originalOperation.IsCompleted && retainedCandidate!=null)
        request=retainedCandidate.RequestId;
      // Only the original native owner can prove its retained Job empty. This
      // never replays execution or opens its exclusive WAL behind a live task.
      if(request!=null && SovereignMobileInstallExecutorV1.HasRetainedCustody)
        SovereignMobileInstallExecutorV1.ReconcileRetainedCustody(request);
    }
    static void RetainOriginalUntilDrained() {
      while(PendingOperation()) {
        if(SovereignMobileInstallExecutorV1.HasRetainedCustody && retainedCandidate!=null)
          try {SovereignMobileInstallExecutorV1.ReconcileRetainedCustody(retainedCandidate.RequestId);}catch { }
        System.Threading.Thread.Sleep(250);
      }
    }
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {internal int Length;internal IntPtr Descriptor;internal int Inherit;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern SafePipeHandle CreateNamedPipeW(string name,uint openMode,uint pipeMode,uint instances,uint outSize,uint inSize,uint timeout,ref SecurityAttributes security);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder path,ref int length);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint rights,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafePipeHandle handle,uint type,uint information,
      out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static NamedPipeServerStream CreateServer(string name,string sid) {
      if(name!=PipeName && !Regex.IsMatch(name??"","\\AStephanos\\.MobileInstallFixture\\.[a-f0-9]{32}\\z"))
        throw new InvalidOperationException("MOBILE_PIPE_NAME_UNPROVEN");
      var identity=new SecurityIdentifier(sid);bool production=name==PipeName;
      string owner=production?"S-1-5-32-544":identity.Value;
      var acl=new PipeSecurity();
      // No FILE_CREATE_PIPE_INSTANCE(4), generic write, WRITE_DAC or OWNER.
      // Explicit BA production ownership prevents the unelevated operator from
      // using implicit owner WRITE_DAC. The nonadmin private fixture confines
      // its owner with OWNER_RIGHTS; no production policy depends on that path.
      acl.SetSecurityDescriptorSddlForm("O:"+owner+"D:P(A;;0x00120083;;;"+identity.Value+
        ")"+(production?"":"(A;;0x00020000;;;S-1-3-4)"));
      byte[] bytes=acl.GetSecurityDescriptorBinaryForm();IntPtr descriptor=Marshal.AllocHGlobal(bytes.Length);
      try {
        Marshal.Copy(bytes,0,descriptor,bytes.Length);
        var security=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};
        var handle=CreateNamedPipeW(@"\\.\pipe\"+name,3|FirstInstance|Overlapped,RejectRemote,1,MaximumFrame,MaximumFrame,5000,ref security);
        if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new InvalidOperationException("MOBILE_PIPE_FIRST_LOCAL_INSTANCE_UNPROVEN:"+error);}
        try{VerifyPipeSecurity(handle,owner,identity.Value,production);return new NamedPipeServerStream(PipeDirection.InOut,true,false,handle);}
        catch{handle.Dispose();throw;}
      }finally{Marshal.FreeHGlobal(descriptor);}
    }
    static void VerifyPipeSecurity(SafePipeHandle handle,string owner,string sid,bool production) {
      IntPtr actualOwner,group,dacl,sacl,descriptor;
      if(GetSecurityInfo(handle,6,5,out actualOwner,out group,out dacl,out sacl,out descriptor)!=0)
        throw new InvalidOperationException("MOBILE_PIPE_SECURITY_UNPROVEN");
      try {
        uint length=GetSecurityDescriptorLength(descriptor);
        if(length<20 || length>4096)throw new InvalidOperationException("MOBILE_PIPE_SECURITY_BOUND");
        var bytes=new byte[(int)length];Marshal.Copy(descriptor,bytes,0,bytes.Length);
        var actual=new RawSecurityDescriptor(bytes,0);
        if(actual.Owner==null || actual.Owner.Value!=owner || (actual.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0 ||
            actual.DiscretionaryAcl==null || actual.DiscretionaryAcl.Count!=(production?1:2))
          throw new InvalidOperationException("MOBILE_PIPE_OWNER_DACL_UNPROVEN");
        bool client=false,ownerRights=production;
        foreach(GenericAce entry in actual.DiscretionaryAcl) {
          var ace=entry as CommonAce;
          if(ace==null || ace.IsCallback || ace.AceFlags!=AceFlags.None || ace.AceQualifier!=AceQualifier.AccessAllowed)
            throw new InvalidOperationException("MOBILE_PIPE_DACL_UNPROVEN");
          if(ace.SecurityIdentifier.Value==sid && ace.AccessMask==ClientRights && !client)client=true;
          else if(!production && ace.SecurityIdentifier.Value=="S-1-3-4" && ace.AccessMask==0x00020000 && !ownerRights)ownerRights=true;
          else throw new InvalidOperationException("MOBILE_PIPE_DACL_UNPROVEN");
        }
        if(!client || !ownerRights)throw new InvalidOperationException("MOBILE_PIPE_DACL_UNPROVEN");
      }finally{LocalFree(descriptor);}
    }
    static void VerifyClient(NamedPipeServerStream pipe,string expectedSid) {
      uint pid;if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out pid) || pid==0)throw new InvalidOperationException("MOBILE_PIPE_CLIENT_PID_UNPROVEN");
      bool matches=false;
      pipe.RunAsClient(delegate {using(var identity=WindowsIdentity.GetCurrent(true))matches=identity!=null && identity.User!=null && identity.User.Value==expectedSid;});
      if(!matches)throw new InvalidOperationException("MOBILE_PIPE_CLIENT_OPERATOR_UNPROVEN");
    }
    static void VerifyServer(NamedPipeClientStream pipe) {
      uint pid;if(!GetNamedPipeServerProcessId(pipe.SafePipeHandle,out pid) || pid==0)throw new InvalidOperationException("MOBILE_PIPE_SERVER_PID_UNPROVEN");
      IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;
      try {
        if(process==IntPtr.Zero)throw new InvalidOperationException("MOBILE_PIPE_SERVER_PROCESS_UNPROVEN");
        var path=new StringBuilder(1024);int length=path.Capacity;
        if(!QueryFullProcessImageNameW(process,0,path,ref length) ||
            !String.Equals(path.ToString(),MobileInstallQualifiedEnrollmentV1.Helper,StringComparison.OrdinalIgnoreCase) ||
            !OpenProcessToken(process,8,out token))throw new InvalidOperationException("MOBILE_PIPE_SERVER_IMAGE_UNPROVEN");
        using(var server=new WindowsIdentity(token))using(var caller=WindowsIdentity.GetCurrent())
          if(server.User==null || caller.User==null || server.User.Value!=caller.User.Value)
            throw new InvalidOperationException("MOBILE_PIPE_SERVER_OPERATOR_UNPROVEN");
      }finally{if(token!=IntPtr.Zero)CloseHandle(token);if(process!=IntPtr.Zero)CloseHandle(process);}
    }
    static void Complete(IAsyncResult pending,int milliseconds,Action<IAsyncResult> end,IDisposable owner) {
      using(var wait=pending.AsyncWaitHandle) {
        if(!wait.WaitOne(milliseconds)){owner.Dispose();throw new InvalidOperationException("MOBILE_PIPE_IO_DEADLINE");}
        end(pending);
      }
    }
    static byte[] ReadExactly(PipeStream pipe,int count,Stopwatch clock,int deadline) {
      byte[] bytes=new byte[count];int offset=0;
      while(offset<count) {
        int remaining=deadline-(int)clock.ElapsedMilliseconds;
        if(remaining<=0)throw new InvalidOperationException("MOBILE_PIPE_IO_DEADLINE");
        int observed=0;
        Complete(pipe.BeginRead(bytes,offset,count-offset,null,null),remaining,delegate(IAsyncResult pending){observed=pipe.EndRead(pending);},pipe);
        if(observed<=0)throw new InvalidOperationException("MOBILE_PIPE_DISCONNECTED");offset+=observed;
      }
      return bytes;
    }
    static string ReadFrame(PipeStream pipe) {
      var clock=Stopwatch.StartNew();byte[] prefix=ReadExactly(pipe,4,clock,10000);int count=BitConverter.ToInt32(prefix,0);
      if(count<1 || count>MaximumFrame)throw new InvalidOperationException("MOBILE_PIPE_FRAME_BOUND");
      return Utf8.GetString(ReadExactly(pipe,count,clock,10000));
    }
    static void WriteFrame(PipeStream pipe,string text) {
      byte[] bytes=Utf8.GetBytes(text);
      if(bytes.Length<1 || bytes.Length>MaximumFrame)throw new InvalidOperationException("MOBILE_PIPE_FRAME_BOUND");
      byte[] frame=new byte[bytes.Length+4];Buffer.BlockCopy(BitConverter.GetBytes(bytes.Length),0,frame,0,4);Buffer.BlockCopy(bytes,0,frame,4,bytes.Length);
      Complete(pipe.BeginWrite(frame,0,frame.Length,null,null),10000,delegate(IAsyncResult pending){pipe.EndWrite(pending);},pipe);
      // No acknowledgement of dispatch or installation is inferred from write.
    }
    static void WriteResponseAndDisconnect(NamedPipeServerStream pipe,string response) {
      WriteFrame(pipe,response);
      // Disconnect discards unread output. A transport-only acknowledgement is
      // accepted only after the client has consumed the entire bounded frame.
      // Never use unbounded FlushFileBuffers, or infer installation authority.
      byte[] ack=ReadExactly(pipe,1,Stopwatch.StartNew(),3000);
      if(ack[0]!=6)throw new InvalidOperationException("MOBILE_PIPE_TRANSPORT_ACK_INVALID");
      pipe.Disconnect();
    }
    static string ReadResponseAndAcknowledge(PipeStream pipe) {
      string response=ReadFrame(pipe);byte[] ack=new byte[]{6};
      Complete(pipe.BeginWrite(ack,0,1,null,null),3000,delegate(IAsyncResult pending){pipe.EndWrite(pending);},pipe);
      return response;
    }
    static string Envelope(SovereignMobileInstallJournalV1 journal,
      SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,string enrollment,
      SovereignMobileInstallExecutorV1.NativeExecutionEvidenceV1 execution=null) {
      var receipt=MobileInstallReceiptV1.FromNative(journal,candidate,execution);
      using(var anchor=SovereignMobileInstallAnchorV1.OpenProtected())
        return Response(candidate,enrollment,anchor.SignReceipt(receipt));
    }
    static string Response(SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate,string enrollment,string signed) {
      return "{\"schemaVersion\":\"stephanos.mobile-install-pipe-response.v1\",\"candidate\":"+candidate.CanonicalJson+
        ",\"enrollment\":"+enrollment+",\"receipt\":"+signed+"}";
    }
    static string Handle(MobileInstallPipeRequestV1 command,MobileInstallQualifiedEnrollmentV1 qualified) {
      if(!qualified.IsIntact())throw new InvalidOperationException("MOBILE_INSTALLER_ENROLLMENT_CHANGED");
      ObserveOriginalDrain();
      if(PendingOperation()) {
        if(retainedCandidate==null || (command.RequestId!=null && command.RequestId!=retainedCandidate.RequestId))
          throw new InvalidOperationException("MOBILE_INSTALLER_ORIGINAL_CUSTODY_HELD");
        if(command.Operation=="CANCEL")SovereignMobileInstallExecutorV1.CancelActive(retainedCandidate.RequestId);
        var active=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(retainedCandidate.RequestId);
        if(active==null)throw new InvalidOperationException("MOBILE_INSTALLER_ORIGINAL_OUTCOME_UNCONFIRMED");
        using(var anchor=SovereignMobileInstallAnchorV1.OpenProtected())return Response(retainedCandidate,qualified.EnrollmentJson,anchor.SignReceipt(active));
      }
      SovereignMobileInstallAssertionV1.MobileInstallCandidateBindingV1 candidate;
      using(var journal=SovereignMobileInstallJournalV1.OpenProtected()) {
        candidate=command.Operation=="PREPARE"?journal.PrepareNative(qualified):journal.LoadPreparedCandidate(command.RequestId);
        if(command.Operation=="CANCEL")journal.CancelPrepared(candidate.RequestId);
        if(command.Operation=="APPROVE" && (journal.ReceiptSnapshot(candidate.RequestId,candidate.CandidateSha256).State!="PREPARED" ||
            candidate.ExpiresAtUtc<=DateTime.UtcNow))return Envelope(journal,candidate,qualified.EnrollmentJson,CompletedEvidence(candidate.RequestId));
        if(command.Operation!="APPROVE")return Envelope(journal,candidate,qualified.EnrollmentJson,CompletedEvidence(candidate.RequestId));
      }
      // Reserve the same original before scheduling its single task. The pipe
      // remains available for real native progress/cancellation, without opening
      // the exclusive WAL behind its active execution owner.
      ReserveApproval(candidate,command.AssertionJson);
      var firstObservation=Stopwatch.StartNew();
      while(PendingOperation() && firstObservation.ElapsedMilliseconds<1000) {
        var active=SovereignMobileInstallExecutorV1.ReconcileActiveReceipt(candidate.RequestId);
        if(active!=null)using(var anchor=SovereignMobileInstallAnchorV1.OpenProtected())return Response(candidate,qualified.EnrollmentJson,anchor.SignReceipt(active));
        System.Threading.Thread.Sleep(25);
      }
      if(PendingOperation())throw new InvalidOperationException("MOBILE_INSTALLER_ORIGINAL_OUTCOME_UNCONFIRMED");
      using(var journal=SovereignMobileInstallJournalV1.OpenProtected())
        return Envelope(journal,journal.LoadPreparedCandidate(candidate.RequestId),qualified.EnrollmentJson,CompletedEvidence(candidate.RequestId));
    }
    // Fixed task executable target. No request, source, path or command argv.
    public static int Main(string[] args) {
      if(args==null || args.Length!=0)return 64;
      try {
        using(var qualified=MobileInstallQualifiedEnrollmentV1.OpenProtected())
        using(var pipe=CreateServer(PipeName,qualified.OperatorSid)) {
          var age=Stopwatch.StartNew();int completed=0;
          while(true) {
            IAsyncResult waiting=pipe.BeginWaitForConnection(null,null);var idle=Stopwatch.StartNew();
            using(var wait=waiting.AsyncWaitHandle)while(!wait.WaitOne(250)) {
              // Keep the SAME pending connect and native owner alive while its
              // admitted task or uncertain Job still owns execution custody.
              ObserveOriginalDrain();if(!PendingOperation() && idle.ElapsedMilliseconds>=5000)return 0;
            }
            pipe.EndWaitForConnection(waiting);
            string response;
            try {
              VerifyClient(pipe,qualified.OperatorSid);
              var request=MobileInstallPipeRequestV1.Parse(ReadFrame(pipe));response=Handle(request,qualified);
            }catch {
              // Unsigned failures are never an actionable native state. Clients
              // retain the original request and reconcile; they cannot retry a
              // possibly delivered approval under a fresh identity.
              response="{\"schemaVersion\":\"stephanos.mobile-install-pipe-error.v1\",\"reasonCode\":\"MOBILE_INSTALL_NATIVE_STATE_UNPROVEN\"}";
            }
            // One response attempt only. Failed/absent ACK leaves the original
            // operation uncertain and retains its native owner without replay.
            try {WriteResponseAndDisconnect(pipe,response);}catch {RetainOriginalUntilDrained();return 75;}
            completed++;
            if((completed>=16 || age.ElapsedMilliseconds>600000) && !PendingOperation())return 0;
          }
        }
      }catch {RetainOriginalUntilDrained();return 75;}
    }
    static void RunFixedTask() {
      object service=null,folder=null,task=null,running=null;
      try {
        service=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service",true));
        service.GetType().InvokeMember("Connect",BindingFlags.InvokeMethod,null,service,null,CultureInfo.InvariantCulture);
        folder=service.GetType().InvokeMember("GetFolder",BindingFlags.InvokeMethod,null,service,new object[]{"\\"},CultureInfo.InvariantCulture);
        task=folder.GetType().InvokeMember("GetTask",BindingFlags.InvokeMethod,null,folder,new object[]{MobileInstallQualifiedEnrollmentV1.TaskName},CultureInfo.InvariantCulture);
        running=task.GetType().InvokeMember("Run",BindingFlags.InvokeMethod,null,task,new object[]{null},CultureInfo.InvariantCulture);
      }finally{foreach(object value in new[]{running,task,folder,service})if(value!=null && Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);}
    }
    static NamedPipeClientStream Client() {
      return new NamedPipeClientStream(".",PipeName,(PipeAccessRights)ClientRights,PipeOptions.Asynchronous,
        TokenImpersonationLevel.Identification,HandleInheritability.None);
    }
    // Loaded from the protected installer assembly by the fixed private shim.
    // Before write: one optional fixed task wake. After write: NEVER redispatch.
    // Returned JSON still requires the protected pinned-key receipt verifier.
    internal static string CallProtectedPipeV1(string closedRequest) {
      MobileInstallPipeRequestV1.Parse(closedRequest);
      if(!String.Equals(Assembly.GetExecutingAssembly().Location,MobileInstallQualifiedEnrollmentV1.Helper,StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("MOBILE_PIPE_PROTECTED_CLIENT_ASSEMBLY_REQUIRED");
      NamedPipeClientStream pipe=Client();
      try {
        try {pipe.Connect(500);}catch(TimeoutException) {pipe.Dispose();RunFixedTask();pipe=Client();pipe.Connect(10000);}
        VerifyServer(pipe);WriteFrame(pipe,closedRequest);
        // A disconnect/deadline here is UNKNOWN, not approval rejection. The
        // adapter must reconcile the same persisted request without replay.
        return ReadResponseAndAcknowledge(pipe);
      }catch {throw new InvalidOperationException("MOBILE_PIPE_ORIGINAL_OUTCOME_UNCONFIRMED");}
      finally{pipe.Dispose();}
    }
  }
}
