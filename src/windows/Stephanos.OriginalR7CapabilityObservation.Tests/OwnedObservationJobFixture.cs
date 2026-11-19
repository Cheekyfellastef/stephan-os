using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

// Test-only lifecycle mechanism. No production entry invokes this class. It
// launches only this fixture's own fixed child modes; no supplied command/PID.
// This is NOT whole-estate containment or proof that every kernel call cancels.
internal static class OwnedObservationJobFixture
{
    private const string Normal = "--owned-observer-normal", Stall = "--owned-observer-stall";
    private const string EventPrefix = "Local\\Stephanos.R7.OwnedObserverFixture.";
    private static readonly string[] SnapshotProbeModes = ["--owned-snapshot-none", "--owned-snapshot-handles", "--owned-snapshot-regions", "--owned-snapshot-basic"];
    private static int assertions;
    private static void Check(bool value, string code)
    { assertions++; if (!value) throw new InvalidOperationException("R7_OWNED_JOB_FIXTURE_FAILED_" + code); }

    internal static bool TryRunChild(string[] args, out int result)
    {
        result = 2;
        if (args.Length != 1 || (args[0] is not (Normal or Stall) && !SnapshotProbeModes.Contains(args[0]))) return false;
        string name = Environment.GetEnvironmentVariable("R7_OWNED_JOB_EVENT") ?? "";
        if (!name.StartsWith(EventPrefix, StringComparison.Ordinal) || name.Length != EventPrefix.Length + 32
            || name[EventPrefix.Length..].Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            return true;
        using var ready = OpenEventW(2 /* EVENT_MODIFY_STATE */, false, name);
        if (ready.IsInvalid || !SetEvent(ready)) return true;
        // The event is a fixture barrier, not caller/endpoint authentication.
        if (args[0] == Stall) Thread.Sleep(Timeout.Infinite);
        if (SnapshotProbeModes.Contains(args[0]))
        {
            uint flags = args[0] switch { "--owned-snapshot-none" => 0u, "--owned-snapshot-handles" => 4u,
                "--owned-snapshot-regions" => 0x800u, "--owned-snapshot-basic" => 0x814u, _ => throw Failure("INVALID_FIXED_PROBE") };
            uint captured = ProbeCapture(GetCurrentProcess(), flags, 0, out IntPtr snapshot);
            Console.WriteLine(JsonSerializer.Serialize(new { diagnosticOnly = true, flags, captured, snapshotCreated = snapshot != 0 }));
            if (snapshot != 0 && ProbeFree(GetCurrentProcess(), snapshot) != 0) return true;
            result = captured == 0 ? 0 : 2;
            return true;
        }
        result = 0;
        return true;
    }

    internal static int Run()
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64) return 2;
        Check(Marshal.SizeOf<ExtendedLimits>() == 144, "EXACT_X64_LAYOUT");
        Exercise(stall: false);
        Exercise(stall: true);
        Console.WriteLine(JsonSerializer.Serialize(new {
            schemaVersion = "stephanos.r7-owned-observer-job-fixture.v1", assertions, result = "PASS",
            ownChildCreatedSuspended = true, jobAssignedBeforeResume = true,
            actualJobLimitsReadBack = true, normalChildExitObserved = true,
            deliberatelyStalledOwnChildExitObserved = true, unknownProcessTouched = false,
            timedOutChildResultAcceptedAsSuccess = false,
            productionObserverAdmitted = false, kernelHangCancellationUniversallyProven = false,
            originalWriterContainmentProven = false, leaseReleaseAuthorized = false,
        }));
        return 0;
    }

    internal static int RunSnapshotProbes()
    {
        foreach (string mode in SnapshotProbeModes) Exercise(false, mode);
        Console.WriteLine("OWNED_SNAPSHOT_API_DIAGNOSTICS_COMPLETE_RESULTS_NOT_QUALIFICATION");
        return 0;
    }

    private static void Exercise(bool stall, string? probeMode = null)
    {
        string exe = Environment.ProcessPath ?? throw Failure("OWN_IMAGE_UNAVAILABLE");
        string assembly = typeof(OwnedObservationJobFixture).Assembly.Location;
        // Qualified only for the ordinary DLL fixture; no guessed bundle path.
        Check(Path.GetFileName(exe).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase)
            && Path.IsPathFullyQualified(exe) && Path.IsPathFullyQualified(assembly)
            && File.Exists(exe) && File.Exists(assembly), "OWN_FIXED_IMAGE");
        Check(!exe.Contains('"') && !assembly.Contains('"') && !exe.Contains('\0') && !assembly.Contains('\0'), "UNAMBIGUOUS_IMAGE_PATHS");
        string name = EventPrefix + Guid.NewGuid().ToString("N");
        using var ready = CreateEventW(IntPtr.Zero, true, false, name);
        Check(!ready.IsInvalid && Marshal.GetLastWin32Error() != 183, "FRESH_OWN_BARRIER");
        using var job = CreateJobObjectW(IntPtr.Zero, null);
        Check(!job.IsInvalid, "FRESH_UNNAMED_OWN_JOB");
        var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2008, ActiveProcessLimit = 1 } };
        uint limitSize = checked((uint)Marshal.SizeOf<ExtendedLimits>());
        Check(SetInformationJobObject(job, 9, ref limits, limitSize), "SET_KILL_ON_CLOSE_SINGLE_PROCESS");
        Check(QueryInformationJobObject(job, 9, out ExtendedLimits readback, limitSize, out uint returned)
            && returned == limitSize && readback.Basic.Flags == 0x2008 && readback.Basic.ActiveProcessLimit == 1,
            "NO_BREAKAWAY_LIMIT_READBACK");
        var env = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["SystemRoot"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            ["DOTNET_ROOT"] = Path.GetDirectoryName(exe)!, ["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1",
            ["DOTNET_GENERATE_ASPNET_CERTIFICATE"] = "false", ["DOTNET_ADD_GLOBAL_TOOLS_TO_PATH"] = "false",
            ["DOTNET_NOLOGO"] = "1", ["R7_OWNED_JOB_EVENT"] = name,
        };
        string block = string.Join('\0', env.Select(p => p.Key + "=" + p.Value)) + "\0\0";
        IntPtr environment = Marshal.StringToHGlobalUni(block);
        ProcessInfo created = default;
        bool started = false;
        try
        {
            var startup = new Startup { Size = Marshal.SizeOf<Startup>() };
            var command = new StringBuilder("\"" + exe + "\" \"" + assembly + "\" " + (probeMode ?? (stall ? Stall : Normal)));
            started = CreateProcessW(exe, command, IntPtr.Zero, IntPtr.Zero, false,
                0x08000404 /* NO_WINDOW | UNICODE_ENVIRONMENT | SUSPENDED */,
                environment, Path.GetDirectoryName(assembly)!, ref startup, out created);
            if (!started) throw Failure("CREATE_OWN_SUSPENDED_CHILD");
        }
        finally { Marshal.FreeHGlobal(environment); }
        using var process = new KernelObject(created.Process);
        using var thread = new KernelObject(created.Thread);
        bool assigned = false, exited = false;
        try
        {
            Check(!process.IsInvalid && !thread.IsInvalid && GetProcessId(process) == created.ProcessId
                && GetProcessTimes(process, out long birth, out _, out _, out _) && birth > 0,
                "ACTUAL_RETAINED_CHILD_OBJECT_IDENTITY");
            Check(WaitForSingleObject(process, 0) == 258, "NEW_SUSPENDED_CHILD_LIVE");
            assigned = AssignProcessToJobObject(job, process);
            Check(assigned && IsProcessInJob(process, job, out bool inJob) && inJob, "ASSIGN_BEFORE_ANY_USER_CODE");
            Check(ResumeThread(thread) == 1, "RESUME_SINGLE_OWN_SUSPEND_COUNT");
            Check(WaitForSingleObject(ready, 5000) == 0, "ACTUAL_FIXED_CHILD_MANAGED_ENTRY_BARRIER");
            uint waited = WaitForSingleObject(process, stall ? 200u : 5000u);
            if (stall)
            {
                Check(waited == 258, "ACTUAL_STALLED_OWN_CHILD_REACHED_DEADLINE");
                var began = Stopwatch.GetTimestamp();
                job.Dispose(); // Only this fresh job/retained own child.
                exited = WaitForSingleObject(process, 5000) == 0;
                Check(exited && Stopwatch.GetElapsedTime(began) < TimeSpan.FromSeconds(6), "OBSERVED_EXIT_AFTER_OWN_JOB_CLOSE");
                // KILL_ON_JOB_CLOSE may produce kernel exit code0. Timeout is
                // an independent terminal outcome and can never be promoted
                // to a successful observation merely because that code is0.
                Check(GetExitCodeProcess(process, out uint code) && code != 259,
                    "STALLED_CHILD_EXIT_STATUS_OBSERVED");
                Check(waited == 258, "TIMEOUT_CLASSIFICATION_NOT_CLEARED_BY_KERNEL_EXIT_CODE");
            }
            else
            {
                exited = waited == 0;
                if (probeMode is not null)
                {
                    Check(exited && GetExitCodeProcess(process, out _), "DIAGNOSTIC_CHILD_EXIT_OBSERVED");
                    GetExitCodeProcess(process, out uint diagnosticCode);
                    Console.WriteLine(JsonSerializer.Serialize(new { diagnosticOnly = true, mode = probeMode,
                        nativeExitCode = diagnosticCode, collectorQualified = false, leaseReleaseAuthorized = false }));
                }
                else Check(exited && GetExitCodeProcess(process, out uint code) && code == 0, "NORMAL_CHILD_EXIT_PRESERVED");
            }
        }
        finally
        {
            if (!exited)
            {
                if (assigned) job.Dispose();
                else if (started && !process.IsInvalid)
                    TerminateProcess(process, 0x52570002); // Our own still-suspended creation only.
                if (WaitForSingleObject(process, 5000) != 0)
                    throw Failure("OWN_CHILD_CLEANUP_UNPROVEN");
            }
        }
    }

    private static InvalidOperationException Failure(string code) => new("R7_OWNED_JOB_" + code);
    private sealed class KernelObject : SafeHandleZeroOrMinusOneIsInvalid
    {
        public KernelObject() : base(true) { }
        internal KernelObject(IntPtr value) : base(true) { SetHandle(value); }
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
        internal long ProcessTime, JobTime; internal uint Flags;
        internal nuint MinimumWorkingSet, MaximumWorkingSet; internal uint ActiveProcessLimit;
        internal nuint Affinity; internal uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
        internal ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits {
        internal BasicLimits Basic; internal IoCounters Io;
        internal nuint ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup {
        internal int Size; internal IntPtr Reserved, Desktop, Title;
        internal uint X, Y, Width, Height, XChars, YChars, Fill, Flags;
        internal ushort ShowWindow, ReservedBytes; internal IntPtr ReservedBuffer, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo {
        internal IntPtr Process, Thread; internal uint ProcessId, ThreadId;
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern KernelObject CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(KernelObject job, int information, ref ExtendedLimits limits, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(KernelObject job, int information, out ExtendedLimits limits, uint length, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(KernelObject job, KernelObject process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsProcessInJob(KernelObject process, KernelObject job, [MarshalAs(UnmanagedType.Bool)] out bool inJob);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags,
        IntPtr environment, string directory, ref Startup startup, out ProcessInfo created);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(KernelObject thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(KernelObject value, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(KernelObject process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(KernelObject process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(KernelObject process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(KernelObject process, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern KernelObject CreateEventW(IntPtr attributes, [MarshalAs(UnmanagedType.Bool)] bool manual,
        [MarshalAs(UnmanagedType.Bool)] bool initial, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern KernelObject OpenEventW(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetEvent(KernelObject value);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", EntryPoint = "PssCaptureSnapshot")] private static extern uint ProbeCapture(IntPtr process, uint flags, uint context, out IntPtr snapshot);
    [DllImport("kernel32.dll", EntryPoint = "PssFreeSnapshot")] private static extern uint ProbeFree(IntPtr process, IntPtr snapshot);
}
