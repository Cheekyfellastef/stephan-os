using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
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
            Check(OpenProcessToken(self.SafeHandle, 0x000a, out var primary),
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
                BindingFlags.Static | BindingFlags.NonPublic, binder: null,
                types: new[] { typeof(SafeAccessTokenHandle) }, modifiers: null)!;
            object before = stamp.Invoke(null, new object[] { primaryToken })!;
            Check(before.Equals(stamp.Invoke(null, new object[] { primaryToken })),
                "UNCHANGED_NATIVE_TOKEN_STAMP_MUST_MATCH");
            Check(DuplicateTokenEx(primaryToken, 0x0028 /* QUERY | ADJUST_PRIVILEGES */, IntPtr.Zero,
                2 /* SecurityImpersonation */, 1 /* TokenPrimary */, out var duplicate),
                "PROCESS_TEST_DUPLICATE_UNAVAILABLE");
            using (duplicate)
            {
                Check(!before.Equals(stamp.Invoke(null, new object[] { duplicate })),
                    "SAME_SID_DIFFERENT_PRIMARY_TOKEN_MUST_NOT_MATCH");
                object duplicateBefore = stamp.Invoke(null, new object[] { duplicate })!;
                MethodInfo privilegeBytes = typeof(R7EffectiveWriteDenial).GetMethod("TokenBytes",
                    BindingFlags.Static | BindingFlags.NonPublic)!;
                byte[] privilegesBefore = (byte[])privilegeBytes.Invoke(null, new object[] { duplicate, 3 })!;
                // Mutate only an unattached disposable duplicate. The parent,
                // child and enrolled production process tokens are untouched.
                Check(LookupPrivilegeValueW(null, "SeChangeNotifyPrivilege", out var traversal),
                    "DISPOSABLE_TOKEN_PRIVILEGE_LOOKUP_FAILED");
                TokenPrivileges removal = new() { Count = 1, Privilege = traversal,
                    Attributes = 4 /* SE_PRIVILEGE_REMOVED */ };
                bool adjusted = AdjustTokenPrivileges(duplicate, false, ref removal,
                    0, IntPtr.Zero, IntPtr.Zero);
                int adjustError = Marshal.GetLastWin32Error();
                Check(adjusted && adjustError == 0, "DISPOSABLE_TOKEN_PRIVILEGE_REMOVAL_FAILED");
                object duplicateAfter = stamp.Invoke(null, new object[] { duplicate })!;
                byte[] privilegesAfter = (byte[])privilegeBytes.Invoke(null, new object[] { duplicate, 3 })!;
                Check(!privilegesBefore.SequenceEqual(privilegesAfter),
                    "DISPOSABLE_TOKEN_PRIVILEGE_INVENTORY_MUST_CHANGE");
                object? Field(object value, string name) => value.GetType().GetProperty(name)!.GetValue(value);
                Check(Equals(Field(duplicateBefore, "TokenId"), Field(duplicateAfter, "TokenId"))
                    && Equals(Field(duplicateBefore, "AuthenticationId"), Field(duplicateAfter, "AuthenticationId")),
                    "IN_PLACE_CHANGE_MUST_RETAIN_TOKEN_AND_AUTHENTICATION_ID");
                Check(!Equals(Field(duplicateBefore, "PrivilegeDigest"), Field(duplicateAfter, "PrivilegeDigest"))
                    && !duplicateBefore.Equals(duplicateAfter),
                    "IN_PLACE_TOKEN_CHANGE_MUST_INVALIDATE_NATIVE_STAMP");
            }

            Check(File.ReadAllText(file) == sentinel, "PROCESS_PROBE_MUST_NOT_MUTATE_DATA");
            string json = JsonSerializer.Serialize(bound);
            Check(!json.Contains(sid, StringComparison.Ordinal) && !json.Contains(file, StringComparison.Ordinal),
                "PROCESS_OBSERVATION_MUST_REDACT_PRIVATE_INPUTS");
            RestrictedPrimaryTokenAndExitedProcessAreHandled(file, sid, primaryToken);
            Console.WriteLine("R7_PROCESS_BOUND_NATIVE_CHECKS_PASSED=" + checks);
            Console.WriteLine("R7_PROCESS_ORIGINAL_WRITER_ENROLLED=false");
        }
        finally
        {
            // Only the verified unique TEMP subtree created above.
            Directory.Delete(scratch, recursive: true);
        }
    }

    private static void RestrictedPrimaryTokenAndExitedProcessAreHandled(
        string target, string sid, SafeAccessTokenHandle parentToken)
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

            // Restrict only the disposable child's primary-token object DACL.
            // The real original writer and the test parent's token are untouched.
            // Explicitly deny TOKEN_IMPERSONATE while allowing QUERY/DUPLICATE
            // and descriptor restoration rights. A 0x000e open must fail;
            // the production 0x000a open must still bind the actual token.
            Check(OpenProcessToken(retained, 0x0006000a, out var configurable),
                "CHILD_TOKEN_DACL_HANDLE_UNAVAILABLE");
            using (configurable)
            {
                MethodInfo stamp = typeof(R7ProcessBoundWriteDenial).GetMethod("ReadStamp",
                    BindingFlags.Static | BindingFlags.NonPublic, binder: null,
                    types: new[] { typeof(SafeAccessTokenHandle) }, modifiers: null)!;
                Check(!stamp.Invoke(null, new object[] { configurable })!.Equals(
                    stamp.Invoke(null, new object[] { parentToken })),
                    "CHILD_TOKEN_MUST_BE_DISTINCT_BEFORE_TEST_DACL_CHANGE");
                Check(GetKernelObjectSecurity(configurable, 4, null, 0, out uint required)
                    == false && Marshal.GetLastWin32Error() == 122 && required > 0 && required <= 65536,
                    "CHILD_TOKEN_ORIGINAL_DACL_SIZE_UNAVAILABLE");
                byte[] original = new byte[required];
                Check(GetKernelObjectSecurity(configurable, 4, original, required, out _),
                    "CHILD_TOKEN_ORIGINAL_DACL_UNAVAILABLE");
                RawSecurityDescriptor descriptor = new($"D:(D;;0x4;;;{sid})(A;;0x6000a;;;{sid})");
                byte[] restricted = new byte[descriptor.BinaryLength];
                descriptor.GetBinaryForm(restricted, 0);
                try
                {
                    Check(SetKernelObjectSecurity(configurable, 4, restricted),
                        "CHILD_TOKEN_RESTRICTED_DACL_NOT_SET");
                    bool excessive = OpenProcessToken(retained, 0x000e, out var denied);
                    int openError = Marshal.GetLastWin32Error();
                    denied?.Dispose();
                    Check(!excessive && openError == 5,
                        "CHILD_TOKEN_MUST_DENY_UNNECESSARY_IMPERSONATE_RIGHT");
                    var minimal = R7ProcessBoundWriteDenial.ObserveWriteAccess(child.Id, birth, sid, target);
                    NoAuthority(minimal);
                    Check(minimal.ProcessBindingObserved && minimal.WriteAccess is not null,
                        "MINIMAL_PRIMARY_TOKEN_RIGHTS_MUST_SUPPORT_PROCESS_BINDING");
                }
                finally
                {
                    Check(SetKernelObjectSecurity(configurable, 4, original),
                        "CHILD_TOKEN_DACL_RESTORE_FAILED");
                }
            }
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

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint Low; public int High; }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenPrivileges { public uint Count; public Luid Privilege; public uint Attributes; }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValueW(string? system, string name, out Luid luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AdjustTokenPrivileges(SafeAccessTokenHandle token,
        [MarshalAs(UnmanagedType.Bool)] bool disableAll, ref TokenPrivileges state,
        uint bufferSize, IntPtr previousState, IntPtr returnLength);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetKernelObjectSecurity(SafeAccessTokenHandle token,
        uint information, byte[]? descriptor, uint length, out uint required);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetKernelObjectSecurity(SafeAccessTokenHandle token,
        uint information, byte[] descriptor);

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
