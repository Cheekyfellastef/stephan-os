using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

internal static class ProcessBoundWriteDenialTests
{
    private static int checks;
    private static void Check(bool condition, string code)
    {
        checks++;
        if (!condition) throw new InvalidOperationException(code);
    }

    private static void NoAuthority(R7ProcessBoundWriteObservation value)
    {
        Check(!value.OriginalPrincipalProvenanceAuthenticated && !value.AuthenticatedOsWitness
            && !value.ContainmentRemainsEnforced && !value.LeaseReleaseAuthorized
            && !value.SourceMutationAuthorized && !value.HistoricalReceiptReconstructed,
            "PROCESS_BINDING_MUST_NOT_GRANT_CUSTODY");
    }

    internal static void Run()
    {
        string temp = Path.GetFullPath(Path.GetTempPath());
        string scratch = Path.GetFullPath(Path.Combine(temp, "stephanos-r7-process-test-" + Guid.NewGuid().ToString("N")));
        if (!scratch.StartsWith(temp.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("UNSAFE_PROCESS_TEST_ROOT");
        Directory.CreateDirectory(scratch);
        string file = Path.Combine(scratch, "probe.txt");
        const string sentinel = "unchanged process-binding sentinel";
        File.WriteAllText(file, sentinel);
        try
        {
            using Process self = Process.GetCurrentProcess();
            Check(GetProcessTimes(self.SafeHandle, out long created, out _, out _, out _),
                "PROCESS_TEST_CREATION_TIME_UNAVAILABLE");
            Check(OpenProcessToken(self.SafeHandle, 0x000e, out var primary),
                "PROCESS_TEST_PRIMARY_TOKEN_UNAVAILABLE");
            using SafeAccessTokenHandle primaryToken = primary;
            using WindowsIdentity identity = new(primaryToken.DangerousGetHandle());
            string sid = identity.User!.Value;
            R7ProcessBoundWriteObservation Observe(int? pid = null, long? birth = null, string? who = null)
                => R7ProcessBoundWriteDenial.ObserveWriteAccess(pid ?? self.Id, birth ?? created, who ?? sid, file);

            var bound = Observe();
            NoAuthority(bound);
            Check(bound.ProcessBindingObserved && bound.WriteAccess is not null,
                "REAL_PRIMARY_TOKEN_MUST_BIND_TO_RETAINED_LIVE_PROCESS");
            // The host may be filtered/admin. Binding must not promote that
            // token or translate the existing probe's refusal into denial.
            var direct = R7EffectiveWriteDenial.Observe(file, primaryToken, sid);
            Check(bound.WriteAccess == direct, "PROCESS_ADAPTER_MUST_PRESERVE_PROBE_RESULT");
            Check(!bound.WriteAccess!.DataWriteOpenDenied, "WRITABLE_SCRATCH_MUST_NOT_BECOME_DENIAL");

            var wrongBirth = Observe(birth: created + 1);
            NoAuthority(wrongBirth);
            Check(wrongBirth.Classification == "R7_PROCESS_CREATION_OR_LIVENESS_UNPROVEN"
                && !wrongBirth.ProcessBindingObserved && wrongBirth.WriteAccess is null,
                "REUSED_PID_OR_WRONG_CREATION_MUST_NOT_PROBE");
            foreach (var invalid in new[] { Observe(pid: 0), Observe(pid: -1), Observe(pid: int.MaxValue),
                Observe(birth: 0), Observe(who: "invalid-sid"),
                Observe(who: "S-1-5-21-1000-2000-3000-4000") })
            {
                NoAuthority(invalid);
                Check(!invalid.ProcessBindingObserved && invalid.WriteAccess is null,
                    "INVALID_OR_MISMATCHED_PROCESS_MUST_NOT_PROBE");
            }
            Check(Observe(who: "S-1-5-21-1000-2000-3000-4000").Classification
                == "R7_PROCESS_PRIMARY_TOKEN_SID_MISMATCH", "WRONG_TOKEN_SID_MUST_FAIL");

            // Native TOKEN_STATISTICS must distinguish a different token
            // object even when it has the SAME user and authentication LUID.
            MethodInfo stamp = typeof(R7ProcessBoundWriteDenial).GetMethod("ReadStamp",
                BindingFlags.Static | BindingFlags.NonPublic)!;
            object before = stamp.Invoke(null, new object[] { primaryToken })!;
            Check(before.Equals(stamp.Invoke(null, new object[] { primaryToken })),
                "UNCHANGED_NATIVE_TOKEN_STAMP_MUST_MATCH");
            Check(DuplicateTokenEx(primaryToken, 0x0008, IntPtr.Zero,
                2 /* SecurityImpersonation */, 1 /* TokenPrimary */, out var duplicate),
                "PROCESS_TEST_DUPLICATE_UNAVAILABLE");
            using (duplicate)
                Check(!before.Equals(stamp.Invoke(null, new object[] { duplicate })),
                    "SAME_SID_DIFFERENT_PRIMARY_TOKEN_MUST_NOT_MATCH");

            Check(File.ReadAllText(file) == sentinel, "PROCESS_PROBE_MUST_NOT_MUTATE_DATA");
            string json = JsonSerializer.Serialize(bound);
            Check(!json.Contains(sid, StringComparison.Ordinal) && !json.Contains(file, StringComparison.Ordinal),
                "PROCESS_OBSERVATION_MUST_REDACT_PRIVATE_INPUTS");
            ExitedProcessHandleIsRejected();
            Console.WriteLine("R7_PROCESS_BOUND_NATIVE_CHECKS_PASSED=" + checks);
            Console.WriteLine("R7_PROCESS_ORIGINAL_WRITER_ENROLLED=false");
        }
        finally
        {
            // Only the verified unique TEMP subtree created above.
            Directory.Delete(scratch, recursive: true);
        }
    }

    private static void ExitedProcessHandleIsRejected()
    {
        // Fixed test-assembly fixture, no shell or caller-selected executable.
        // stdin closure lets it exit normally; there is no kill/terminate path.
        string executable = Path.Combine(AppContext.BaseDirectory, "Stephanos.OriginalR7DaclReadback.Tests.exe");
        ProcessStartInfo start = new(executable) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true
        };
        start.ArgumentList.Add("--r7-process-fixture");
        using Process child = Process.Start(start) ?? throw new InvalidOperationException("PROCESS_FIXTURE_START_FAILED");
        try
        {
            SafeProcessHandle retained = child.SafeHandle;
            Check(GetProcessTimes(retained, out long birth, out _, out _, out _),
                "PROCESS_FIXTURE_CREATION_UNAVAILABLE");
            MethodInfo matches = typeof(R7ProcessBoundWriteDenial).GetMethod("MatchesLiveProcess",
                BindingFlags.Static | BindingFlags.NonPublic)!;
            Check((bool)matches.Invoke(null, new object[] { retained, birth })!,
                "LIVE_RETAINED_PROCESS_MUST_MATCH");
            child.StandardInput.Close();
            Check(child.WaitForExit(10000), "PROCESS_FIXTURE_EXIT_TIMEOUT");
            Check(!(bool)matches.Invoke(null, new object[] { retained, birth })!,
                "EXITED_PROCESS_MUST_FAIL_EVEN_WITH_RETAINED_HANDLE_AND_EXACT_BIRTH");
        }
        finally { child.StandardInput.Close(); }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(SafeProcessHandle process,
        out long created, out long exited, out long kernel, out long user);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(SafeProcessHandle process,
        uint access, out SafeAccessTokenHandle token);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateTokenEx(SafeAccessTokenHandle existing,
        uint access, IntPtr attributes, int impersonationLevel, int tokenType,
        out SafeAccessTokenHandle duplicate);
}
