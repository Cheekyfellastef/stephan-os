using System.Collections.Immutable;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using Stephanos.RescueIslandCustody;

if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("REAL_WINDOWS_TESTS_REQUIRED");
int passed = 0;
int failed = 0;
Run("synthetic assigned-but-disabled identity privileges remain sensitive", () =>
{
    string[] identityRights = ["SeTcbPrivilege", "SeCreateTokenPrivilege", "SeAssignPrimaryTokenPrivilege",
        "SeImpersonatePrivilege", "SeTrustedCredManAccessPrivilege", "SeDelegateSessionUserImpersonatePrivilege",
        "SeEnableDelegationPrivilege", "SeMachineAccountPrivilege"];
    var assigned = identityRights.Select(name => (Name: name, Attributes: 0u)).ToArray();
    var classified = NativePrivilegeFixture.Classify(assigned);
    if (!classified.SequenceEqual(identityRights.OrderBy(name => name, StringComparer.Ordinal)))
        throw new Exception("ASSIGNED_DISABLED_IDENTITY_PRIVILEGE_OMITTED");
});
Run("synthetic privilege classification ignores enablement and excludes ordinary rights", () =>
{
    string[] expected = ["SeDelegateSessionUserImpersonatePrivilege", "SeEnableDelegationPrivilege",
        "SeMachineAccountPrivilege"];
    foreach (uint attributes in new[] { 0u, 2u }) // Assigned disabled, then SE_PRIVILEGE_ENABLED.
    {
        var classified = NativePrivilegeFixture.Classify(
            ("SeMachineAccountPrivilege", attributes), ("SeChangeNotifyPrivilege", attributes),
            ("SeEnableDelegationPrivilege", attributes), ("SeTimeZonePrivilege", attributes),
            ("SeDelegateSessionUserImpersonatePrivilege", attributes));
        if (!classified.SequenceEqual(expected)
            || !NativePrivilegeFixture.Classify(("SeChangeNotifyPrivilege", attributes),
                ("SeTimeZonePrivilege", attributes)).IsEmpty)
            throw new Exception("PRIVILEGE_CLASSIFICATION_DEPENDS_ON_ENABLEMENT_OR_ORDINARY_RIGHTS");
    }
});
Run("primary token SID matches actual process; observations do not grant authority", () =>
{
    var facts = WindowsProcessPrincipalObservation.ObserveCurrentProcess();
    using var identity = WindowsIdentity.GetCurrent();
    if (facts.ProcessUserSid != identity.User!.Value || facts.ThreadImpersonating
        || facts.ElevationType is not ("Default" or "Full" or "Limited")
        || facts.AssignedSensitivePrivileges.IsDefault)
        throw new Exception("PRIMARY_TOKEN_OBSERVATION_INVALID");
});
Run("thread impersonation is independently detected without substituting process identity", () =>
{
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query | TokenAccessLevels.Duplicate);
    string processSid = WindowsProcessPrincipalObservation.ObserveCurrentProcess().ProcessUserSid;
    WindowsIdentity.RunImpersonated(identity.AccessToken, () =>
    {
        var facts = WindowsProcessPrincipalObservation.ObserveCurrentProcess();
        if (!facts.ThreadImpersonating || facts.ProcessUserSid != processSid)
            throw new Exception("IMPERSONATION_NOT_OBSERVED");
    });
    if (WindowsProcessPrincipalObservation.ObserveCurrentProcess().ThreadImpersonating)
        throw new Exception("THREAD_IDENTITY_NOT_RESTORED");
});
Run("real one-shot host identifies its child PID and remains held under forged flags", () =>
{
    var result = Invoke(["--inspect-principal"]);
    var facts = result.Facts;
    if (result.ExitCode != 3 || facts.GetProperty("processId").GetInt32() != result.Pid
        || facts.GetProperty("principal").GetProperty("processUserSid").GetString()
            != WindowsProcessPrincipalObservation.ObserveCurrentProcess().ProcessUserSid
        || facts.GetProperty("blocker").GetString() != "RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED")
        throw new Exception("REAL_HOST_IDENTITY_OR_HOLD_INVALID");
    foreach (string field in new[] { "installedIdentityAuthenticated", "principalEnrollmentAuthenticated",
        "independentOwnershipAuthenticated", "gamingBudgetAuthenticated", "originalWriterExclusionProven",
        "hostCommissioned", "physicalPickupAllowed", "sourceMutationAllowed", "executionAllowed",
        "canonicalLeaseAccessAllowed", "seedForgeQueueAccessAllowed" })
        if (facts.GetProperty(field).GetBoolean()) throw new Exception("HOST_FORGED_AUTHORITY_ACCEPTED:" + field);
});
Run("run, recovery, arbitrary paths, stdin and extra arguments have no admitted host operation", () =>
{
    foreach (string[] args in new[] { Array.Empty<string>(), new[] { "--run" }, new[] { "--recover" },
        new[] { "--inspect-principal", "--run" }, new[] { "--inspect-principal=approved" },
        new[] { "C:\\canonical\\.git" }, new[] { "--task", "{\"approvalAuthenticated\":true}" } })
    {
        var result = Invoke(args);
        if (result.ExitCode != 64 || result.Facts.GetProperty("executionAllowed").GetBoolean()
            || result.Facts.GetProperty("blocker").GetString() != "ISLAND_HOST_OPERATION_NOT_ADMITTED")
            throw new Exception("UNREGISTERED_HOST_OPERATION_ADMITTED");
    }
});
Console.WriteLine($"ISLAND_NATIVE_HOST_TESTS_PASSED={passed}");
Console.WriteLine("HOST_COMMISSIONED=false;ISLAND_EXECUTION_ALLOWED=false;R7_LEASE_ACCESSED=false");
return failed == 0 ? 0 : 1;

static (int ExitCode, int Pid, JsonElement Facts) Invoke(string[] args)
{
    string working = Path.Combine(Path.GetTempPath(), "island-host-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(working);
    try
    {
        string exe = Path.Combine(AppContext.BaseDirectory, "host", "Stephanos.RescueIslandHost.exe");
        var start = new ProcessStartInfo(exe)
        {
            WorkingDirectory = working, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true
        };
        foreach (string arg in args) start.ArgumentList.Add(arg);
        foreach (string flag in new[] { "ISLAND_EXECUTION_ALLOWED", "ISLAND_HOST_COMMISSIONED",
            "RESCUE_ISLAND_EXECUTION_CUSTODY_IMPLEMENTED", "APPROVAL_AUTHENTICATED",
            "OWNERSHIP_AUTHENTICATED", "GAMING_BUDGET_AUTHENTICATED" }) start.Environment[flag] = "true";
        using var child = Process.Start(start) ?? throw new Exception("REAL_HOST_START_FAILED");
        int pid = child.Id;
        var stdout = child.StandardOutput.ReadToEndAsync();
        var stderr = child.StandardError.ReadToEndAsync();
        try { child.StandardInput.WriteLine("{\"approvalAuthenticated\":true,\"operation\":\"run\"}"); }
        catch (IOException) { } // A host that exits before reading stdin is safe.
        child.StandardInput.Close();
        if (!child.WaitForExit(15_000))
        {
            child.Kill(entireProcessTree: true);
            throw new Exception("REAL_HOST_INSPECTION_TIMEOUT");
        }
        Task.WaitAll(stdout, stderr);
        if (stderr.Result.Length != 0 || stdout.Result.Length > 8192
            || Directory.EnumerateFileSystemEntries(working).Any())
            throw new Exception("REAL_HOST_UNEXPECTED_OUTPUT_OR_MUTATION");
        using var parsed = JsonDocument.Parse(stdout.Result);
        return (child.ExitCode, pid, parsed.RootElement.Clone());
    }
    finally
    {
        // Empty disposable fixture only; no recursive removal and no source state.
        Directory.Delete(working, recursive: false);
    }
}
void Run(string name, Action action)
{
    try { action(); passed++; Console.WriteLine("PASS " + name); }
    catch (Exception e)
    {
        failed++;
        Console.WriteLine("FAIL " + name + ": " + e.Message
            + (e is CustodyException c ? "; native=" + c.NativeError : ""));
    }
}

// Synthetic TOKEN_PRIVILEGES entries exercise the exact production decoder.
// Resolving real Windows LUIDs neither assigns these rights nor claims the
// hosted account possesses them. No token or account policy is changed.
internal static class NativePrivilegeFixture
{
    internal static ImmutableArray<string> Classify(params (string Name, uint Attributes)[] entries)
    {
        int size = checked(4 + entries.Length * 12);
        IntPtr data = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.WriteInt32(data, entries.Length);
            for (int i = 0; i < entries.Length; i++)
            {
                if (!LookupPrivilegeValueW(null, entries[i].Name, out var luid))
                    throw new Exception("FIXTURE_PRIVILEGE_LUID_UNAVAILABLE:" + Marshal.GetLastWin32Error());
                int offset = checked(4 + i * 12);
                Marshal.WriteInt32(data, offset, unchecked((int)luid.LowPart));
                Marshal.WriteInt32(data, offset + 4, luid.HighPart);
                Marshal.WriteInt32(data, offset + 8, unchecked((int)entries[i].Attributes));
            }
            var decoder = typeof(WindowsProcessPrincipalObservation).GetMethod("ClassifySensitivePrivileges",
                BindingFlags.NonPublic | BindingFlags.Static)
                ?? throw new Exception("PRODUCTION_PRIVILEGE_DECODER_UNAVAILABLE");
            return decoder.Invoke(null, new object[] { data, size }) is ImmutableArray<string> result
                ? result : throw new Exception("PRODUCTION_PRIVILEGE_DECODER_RESULT_INVALID");
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint LowPart; public int HighPart; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValueW(string? system, string name, out Luid luid);
}
