// Source-only Win32 process containment candidate. No receipt signing authority.
// A caller must not treat a successful exit as proof of historical writer custody.
// Build only for Windows (PowerShell Add-Type); never expose arbitrary shell.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Stephanos.SourceCustody {
  public sealed class Result {
    public bool Completed;
    // Only in-job members. WMI/COM can create source writers outside this job.
    public bool JobMembersExited;
    public bool WholeSourceWriterExclusionProven { get { return false; } }
    public bool JobClosed;
    public bool AssignedBeforeResume;
    public bool KillOnJobClose;
    public bool BreakawayPermitted;
    public int RootPid;
    public int ExitCode;
    public uint LastActiveProcessCount;
  }

  public static class JobRunner {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int JobObjectBasicAccountingInformation = 1;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint WAIT_FAILED = 0xFFFFFFFF;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO {
      public int cb;
      public IntPtr lpReserved, lpDesktop, lpTitle;
      public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
      public int dwFillAttribute, dwFlags;
      public short wShowWindow, cbReserved2;
      public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
      public IntPtr hProcess, hThread;
      public uint dwProcessId, dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
      public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
      public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit, JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
      public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
      public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int kind, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint size, IntPtr returnLength);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes,
      IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
      ref STARTUPINFO startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr GetStdHandle(int kind);

    private static string Quote(string input) {
      if (input == null) throw new ArgumentNullException("input");
      var result = new StringBuilder("\"");
      var slashes = 0;
      foreach (var c in input) {
        if (c == '\\') { slashes++; continue; }
        if (c == '"') {
          result.Append('\\', slashes * 2 + 1);
          result.Append('"');
          slashes = 0;
          continue;
        }
        result.Append('\\', slashes);
        slashes = 0;
        result.Append(c);
      }
      result.Append('\\', slashes * 2);
      result.Append('"');
      return result.ToString();
    }

    public static Result Run(string executable, string[] args, string cwd, int timeoutMilliseconds) {
      if (!System.IO.Path.IsPathRooted(executable) || !System.IO.File.Exists(executable)
        || !System.IO.Path.IsPathRooted(cwd) || !System.IO.Directory.Exists(cwd)
        || timeoutMilliseconds < 1000 || timeoutMilliseconds > 600000
        || args == null || args.Length > 128) throw new ArgumentException("CUSTODY_INPUT_INVALID");
      foreach (var arg in args) if (arg == null || arg.IndexOf('\0') >= 0) throw new ArgumentException("CUSTODY_ARG_INVALID");
      var line = Quote(executable);
      foreach (var arg in args) line += " " + Quote(arg);
      if (line.Length > 30000) throw new ArgumentException("CUSTODY_COMMANDLINE_UNBOUNDED");

      IntPtr job = IntPtr.Zero;
      var child = new PROCESS_INFORMATION();
      var created = false;
      var allExited = false;
      var result = new Result();
      try {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "JOB_CREATE_FAILED");

        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        var size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        var pointer = Marshal.AllocHGlobal(size);
        try {
          Marshal.StructureToPtr(info, pointer, false);
          if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)size))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "JOB_KILL_ON_CLOSE_REQUIRED");
        } finally { Marshal.FreeHGlobal(pointer); }

        var start = new STARTUPINFO();
        start.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        start.dwFlags = (int)STARTF_USESTDHANDLES;
        start.hStdInput = GetStdHandle(-10);
        start.hStdOutput = GetStdHandle(-11);
        start.hStdError = GetStdHandle(-12);
        if (!CreateProcess(executable, new StringBuilder(line), IntPtr.Zero, IntPtr.Zero,
          true, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref start, out child))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "SUSPENDED_PROCESS_CREATE_FAILED");
        created = true;
        result.RootPid = checked((int)child.dwProcessId);
        if (!AssignProcessToJobObject(job, child.hProcess))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "ASSIGN_BEFORE_RESUME_FAILED");
        result.AssignedBeforeResume = true;
        result.KillOnJobClose = true;
        result.BreakawayPermitted = false;
        if (ResumeThread(child.hThread) == WAIT_FAILED)
          throw new Win32Exception(Marshal.GetLastWin32Error(), "PROCESS_RESUME_FAILED");

        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMilliseconds);
        while (DateTime.UtcNow < deadline) {
          uint wait = WaitForSingleObject(child.hProcess, 50);
          if (wait == WAIT_OBJECT_0) break;
          if (wait != WAIT_TIMEOUT) throw new Win32Exception(Marshal.GetLastWin32Error(), "ROOT_WAIT_FAILED");
        }
        if (WaitForSingleObject(child.hProcess, 0) != WAIT_OBJECT_0)
          throw new TimeoutException("SOURCE_CUSTODY_ROOT_TIMEOUT");
        uint exit;
        if (!GetExitCodeProcess(child.hProcess, out exit))
          throw new Win32Exception(Marshal.GetLastWin32Error(), "SOURCE_CUSTODY_EXIT_CODE_UNAVAILABLE");
        result.ExitCode = unchecked((int)exit);

        // Root exit alone is NOT sufficient: detached descendants keep the job active.
        var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
        var accountingSize = (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        while (DateTime.UtcNow < deadline) {
          if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
            out accounting, accountingSize, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SOURCE_CUSTODY_ACCOUNTING_UNKNOWN");
          result.LastActiveProcessCount = accounting.ActiveProcesses;
          if (accounting.ActiveProcesses == 0) { allExited = true; break; }
          Thread.Sleep(50);
        }
        if (!allExited) throw new TimeoutException("SOURCE_CUSTODY_DESCENDANTS_STILL_ACTIVE");
        result.JobMembersExited = true;
        result.Completed = true;
        return result;
      } finally {
        // Every unsuccessful exit kills the exact job tree. No PID enumeration,
        // force-delete, process-name guessing or detached-grandchild exception.
        if (job != IntPtr.Zero && !allExited) TerminateJobObject(job, 1);
        if (created && child.hProcess != IntPtr.Zero && !result.AssignedBeforeResume)
          TerminateProcess(child.hProcess, 1);
        if (child.hThread != IntPtr.Zero) CloseHandle(child.hThread);
        if (child.hProcess != IntPtr.Zero) CloseHandle(child.hProcess);
        if (job != IntPtr.Zero) { CloseHandle(job); result.JobClosed = true; }
      }
    }
  }
}
