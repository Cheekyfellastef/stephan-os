using System.Collections.Immutable;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
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
Run("native decoder conservatively reports directory sync and other non-exempt privilege families", () =>
{
    string[] names = ["SeSyncAgentPrivilege", "SeSystemtimePrivilege", "SeAuditPrivilege",
        "SeCreateGlobalPrivilege", "SeCreateSymbolicLinkPrivilege", "SeIncreaseWorkingSetPrivilege",
        "SeLockMemoryPrivilege", "SeShutdownPrivilege", "SeSystemEnvironmentPrivilege"];
    foreach (uint attributes in new[] { 0u, 2u })
    {
        var assigned = names.Reverse().Select(name => (Name: name, Attributes: attributes))
            .Append(("SeChangeNotifyPrivilege", attributes)).Append(("SeTimeZonePrivilege", attributes)).ToArray();
        if (!NativePrivilegeFixture.Classify(assigned).SequenceEqual(names.OrderBy(name => name, StringComparer.Ordinal)))
            throw new Exception("NON_EXEMPT_ASSIGNED_PRIVILEGE_SILENTLY_OMITTED");
    }
});
Run("conservative rule covers the complete documented privilege inventory", () =>
{
    // Independent Microsoft inventory, not a copy of a production sensitive list.
    // Pure name classification also covers documented names that this OS may
    // not resolve, without pretending they are assigned to the hosted account.
    // https://learn.microsoft.com/windows/win32/secauthz/privilege-constants
    string[] inventory = ["SeAssignPrimaryTokenPrivilege", "SeAuditPrivilege", "SeBackupPrivilege",
        "SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege", "SeCreatePagefilePrivilege",
        "SeCreatePermanentPrivilege", "SeCreateSymbolicLinkPrivilege", "SeCreateTokenPrivilege",
        "SeDebugPrivilege", "SeDelegateSessionUserImpersonatePrivilege", "SeEnableDelegationPrivilege",
        "SeImpersonatePrivilege", "SeIncreaseBasePriorityPrivilege", "SeIncreaseQuotaPrivilege",
        "SeIncreaseWorkingSetPrivilege", "SeLoadDriverPrivilege", "SeLockMemoryPrivilege",
        "SeMachineAccountPrivilege", "SeManageVolumePrivilege", "SeProfileSingleProcessPrivilege",
        "SeRelabelPrivilege", "SeRemoteShutdownPrivilege", "SeRestorePrivilege", "SeSecurityPrivilege",
        "SeShutdownPrivilege", "SeSyncAgentPrivilege", "SeSystemEnvironmentPrivilege", "SeSystemProfilePrivilege",
        "SeSystemtimePrivilege", "SeTakeOwnershipPrivilege", "SeTcbPrivilege", "SeTimeZonePrivilege",
        "SeTrustedCredManAccessPrivilege", "SeUndockPrivilege", "SeUnsolicitedInputPrivilege"];
    var omitted = inventory.Where(name => !NativePrivilegeFixture.ReportsResolvedName(name)).ToArray();
    if (inventory.Length != 36 || inventory.Distinct(StringComparer.Ordinal).Count() != inventory.Length
        || !omitted.SequenceEqual(new[] { "SeChangeNotifyPrivilege", "SeTimeZonePrivilege" }))
        throw new Exception("DOCUMENTED_PRIVILEGE_CLASSIFICATION_INVARIANT_BROKEN");
});
Run("future and near-match names cannot inherit ordinary privilege exclusions", () =>
{
    var names = Enumerable.Range(0, 128).Select(i => "SeFutureFixture" + i + "Privilege").ToList();
    foreach (string ordinary in new[] { "SeChangeNotifyPrivilege", "SeTimeZonePrivilege" })
    {
        if (NativePrivilegeFixture.ReportsResolvedName(ordinary))
            throw new Exception("EXACT_ORDINARY_EXCLUSION_LOST");
        names.AddRange([ordinary.ToLowerInvariant(), ordinary.ToUpperInvariant(),
            "Future" + ordinary, ordinary + "Future", " " + ordinary, ordinary + " "]);
    }
    if (names.Any(name => !NativePrivilegeFixture.ReportsResolvedName(name)))
        throw new Exception("NON_EXACT_NAME_INHERITED_ORDINARY_EXCLUSION");
});
Run("unresolvable native privilege LUID fails observation instead of disappearing", () =>
{
    try
    {
        _ = NativePrivilegeFixture.ClassifyUnresolvableLuid();
        throw new Exception("UNRESOLVABLE_PRIVILEGE_WAS_SILENTLY_ACCEPTED");
    }
    catch (TargetInvocationException e) when (e.InnerException is CustodyException c
        && c.Blocker == "ISLAND_HOST_PRIVILEGE_NAME_UNAVAILABLE" && c.NativeError != 0) { }
});
Run("complete synthetic privilege inventory retains LUIDs, disabled rights and raw attributes", () =>
{
    (string Name, uint Attributes)[] entries = [("SeSyncAgentPrivilege", 0u),
        ("SeChangeNotifyPrivilege", 2u), ("SeTimeZonePrivilege", 0x80000000u),
        ("SeShutdownPrivilege", 0x40000002u), ("SeDebugPrivilege", 0u)];
    var inventory = NativePrivilegeFixture.Decode(entries);
    if (inventory.Length != entries.Length) throw new Exception("ASSIGNED_PRIVILEGE_INVENTORY_INCOMPLETE");
    for (int i = 0; i < entries.Length; i++)
    {
        var expectedLuid = NativePrivilegeFixture.Resolve(entries[i].Name);
        if (inventory[i].Name != entries[i].Name || inventory[i].Attributes != entries[i].Attributes
            || (inventory[i].LuidLowPart, inventory[i].LuidHighPart) != expectedLuid)
            throw new Exception("ASSIGNED_PRIVILEGE_NATIVE_EVIDENCE_LOST");
    }
    if (!NativePrivilegeFixture.Project(inventory).SequenceEqual(
        new[] { "SeDebugPrivilege", "SeShutdownPrivilege", "SeSyncAgentPrivilege" }))
        throw new Exception("UNLISTED_OR_DISABLED_PRIVILEGE_NOT_REVIEW_REQUIRED");
});
Run("compatibility projection retains unfamiliar names and cannot accept missing inventory", () =>
{
    ImmutableArray<WindowsAssignedPrivilegeObservation> inventory =
        [new("FuturePrivilegeFixture", 123u, 456, 0u), new("SeChangeNotifyPrivilege", 789u, 0, 2u)];
    if (!NativePrivilegeFixture.Project(inventory).SequenceEqual(new[] { "FuturePrivilegeFixture" }))
        throw new Exception("UNFAMILIAR_PRIVILEGE_OMITTED");
    NativePrivilegeFixture.ExpectProjectionRejected();
});
Run("production privilege decoder rejects malformed, duplicate and unresolvable native entries", () =>
{
    NativePrivilegeFixture.ExpectRejected(3, 0, [], "ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
    NativePrivilegeFixture.ExpectRejected(4, 1, [], "ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
    NativePrivilegeFixture.ExpectRejected(4, 129, [], "ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
    var luid = NativePrivilegeFixture.Resolve("SeSyncAgentPrivilege");
    NativePrivilegeFixture.ExpectRejected(28, 2,
        [(luid.LowPart, luid.HighPart, 0u), (luid.LowPart, luid.HighPart, 2u)],
        "ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
    NativePrivilegeFixture.ExpectRejected(16, 1, [(uint.MaxValue, int.MaxValue, 0u)],
        "ISLAND_HOST_PRIVILEGE_NAME_UNAVAILABLE");
});
Run("primary token SID matches actual process; observations do not grant authority", () =>
{
    var facts = WindowsProcessPrincipalObservation.ObserveCurrentProcess();
    using var identity = WindowsIdentity.GetCurrent();
    if (facts.ProcessUserSid != identity.User!.Value || facts.ThreadImpersonating
        || facts.ElevationType is not ("Default" or "Full" or "Limited")
        || facts.AssignedSensitivePrivileges.IsDefault
        || facts.AssignedPrivileges.IsDefault
        || !facts.AssignedSensitivePrivileges.SequenceEqual(NativePrivilegeFixture.Project(facts.AssignedPrivileges))
        || facts.AdministratorsGroupPresent != facts.AdministratorsGroupAttributes.HasValue)
        throw new Exception("PRIMARY_TOKEN_OBSERVATION_INVALID");
});
Run("native group observation retains a real deny-only SID and its raw attributes", () =>
{
    using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query | TokenAccessLevels.Duplicate);
    var admin = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
    var enabled = identity.Groups?.OfType<SecurityIdentifier>().ToArray()
        ?? throw new Exception("RESTRICTED_TOKEN_GROUP_FIXTURE_UNAVAILABLE");
    // Prefer the Administrators SID when enabled, but the same native parser
    // must work on an ordinary non-administrator runner without provisioning.
    var group = enabled.FirstOrDefault(sid => sid.Equals(admin)) ?? enabled.FirstOrDefault()
        ?? throw new Exception("RESTRICTED_TOKEN_ENABLED_GROUP_REQUIRED");
    var original = WindowsProcessPrincipalObservation.ObserveTokenGroup(identity.AccessToken, group);
    if (!original.Present || (original.Attributes.GetValueOrDefault() & 4) == 0)
        throw new Exception("RESTRICTED_TOKEN_GROUP_FIXTURE_INVALID");
    using var restricted = TokenFixture.DenyOnly(identity.AccessToken, group);
    using var filtered = new WindowsIdentity(restricted.DangerousGetHandle());
    if (filtered.Groups is null || filtered.Groups.Contains(group))
        throw new Exception("RESTRICTED_TOKEN_DID_NOT_ESTABLISH_MANAGED_FILTER");
    var observed = WindowsProcessPrincipalObservation.ObserveTokenGroup(restricted, group);
    if (!observed.Present || !observed.Attributes.HasValue
        || (observed.Attributes.Value & 0x10) == 0 || (observed.Attributes.Value & 4) != 0)
        throw new Exception("DENY_ONLY_GROUP_PRESENCE_OR_ATTRIBUTES_LOST");
    if (WindowsProcessPrincipalObservation.ObserveTokenGroup(identity.AccessToken, group) != original)
        throw new Exception("ORIGINAL_TOKEN_GROUP_WAS_CHANGED");
    Console.WriteLine("ISLAND_DENY_ONLY_GROUP_OBSERVATION=VERIFIED");
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
        || facts.GetProperty("principal").GetProperty("assignedPrivileges").ValueKind != JsonValueKind.Array
        || facts.GetProperty("blocker").GetString() != "RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED")
        throw new Exception("REAL_HOST_IDENTITY_OR_HOLD_INVALID");
    foreach (string field in new[] { "installedIdentityAuthenticated", "principalEnrollmentAuthenticated",
        "independentOwnershipAuthenticated", "gamingBudgetAuthenticated", "originalWriterExclusionProven",
        "hostCommissioned", "physicalPickupAllowed", "sourceMutationAllowed", "executionAllowed",
        "canonicalLeaseAccessAllowed", "seedForgeQueueAccessAllowed" })
        if (facts.GetProperty(field).GetBoolean()) throw new Exception("HOST_FORGED_AUTHORITY_ACCEPTED:" + field);
});
Run("supervised command rejects caller authority fields before source access", () =>
{
    var result = Invoke(["--supervised-once"]);
    if (result.ExitCode != 3 || result.Facts.GetProperty("executionAllowed").GetBoolean()
        || result.Facts.GetProperty("blocker").GetString() != "ISLAND_HOST_REQUEST_INVALID"
        || result.Facts.GetProperty("assuranceProfile").GetString() != "SUPERVISED_COOPERATIVE_V1")
        throw new Exception("SUPERVISED_CALLER_AUTHORITY_ADMITTED");
});
Run("run, recovery, arbitrary paths, stdin and extra arguments have no admitted host operation", () =>
{
    foreach (string[] args in new[] { Array.Empty<string>(), new[] { "--run" }, new[] { "--recover" },
        new[] { "--inspect-principal", "--run" }, new[] { "--supervised-once", "--run" }, new[] { "--inspect-principal=approved" },
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
        => Project(Decode(entries));

    internal static ImmutableArray<WindowsAssignedPrivilegeObservation> Decode(
        params (string Name, uint Attributes)[] entries)
    {
        int size = checked(4 + entries.Length * 12);
        IntPtr data = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.WriteInt32(data, entries.Length);
            for (int i = 0; i < entries.Length; i++)
            {
                var luid = Resolve(entries[i].Name);
                int offset = checked(4 + i * 12);
                Marshal.WriteInt32(data, offset, unchecked((int)luid.LowPart));
                Marshal.WriteInt32(data, offset + 4, luid.HighPart);
                Marshal.WriteInt32(data, offset + 8, unchecked((int)entries[i].Attributes));
            }
            return DecodeBuffer(data, size);
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    internal static ImmutableArray<string> Project(ImmutableArray<WindowsAssignedPrivilegeObservation> entries)
        => Invoke("ClassifySensitivePrivileges", entries) is ImmutableArray<string> result
            ? result : throw new Exception("PRODUCTION_PRIVILEGE_PROJECTION_RESULT_INVALID");

    internal static (uint LowPart, int HighPart) Resolve(string name)
    {
        if (!LookupPrivilegeValueW(null, name, out var luid))
            throw new Exception("FIXTURE_PRIVILEGE_LUID_UNAVAILABLE:" + Marshal.GetLastWin32Error());
        return (luid.LowPart, luid.HighPart);
    }

    internal static void ExpectProjectionRejected()
    {
        try { Project(default); }
        catch (TargetInvocationException e) when (e.InnerException is CustodyException c
            && c.Message == "ISLAND_HOST_TOKEN_PRIVILEGES_INVALID") { return; }
        throw new Exception("MISSING_PRIVILEGE_INVENTORY_ACCEPTED");
    }

    internal static void ExpectRejected(int size, int count,
        (uint LowPart, int HighPart, uint Attributes)[] entries, string expectedCode)
    {
        int allocation = Math.Max(4, checked(4 + entries.Length * 12));
        if (size > allocation) throw new Exception("FIXTURE_BUFFER_TOO_SMALL");
        IntPtr data = Marshal.AllocHGlobal(allocation);
        try
        {
            Marshal.WriteInt32(data, count);
            for (int i = 0; i < entries.Length; i++)
            {
                int offset = checked(4 + i * 12);
                Marshal.WriteInt32(data, offset, unchecked((int)entries[i].LowPart));
                Marshal.WriteInt32(data, offset + 4, entries[i].HighPart);
                Marshal.WriteInt32(data, offset + 8, unchecked((int)entries[i].Attributes));
            }
            try { DecodeBuffer(data, size); }
            catch (TargetInvocationException e) when (e.InnerException is CustodyException c
                && c.Message == expectedCode) { return; }
            throw new Exception("MALFORMED_PRIVILEGE_INVENTORY_ACCEPTED");
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    internal static bool ReportsResolvedName(string name)
    {
        var predicate = typeof(WindowsProcessPrincipalObservation).GetMethod("IsOrdinaryAssignedPrivilegeName",
            BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new Exception("PRODUCTION_ORDINARY_PRIVILEGE_PREDICATE_UNAVAILABLE");
        return predicate.Invoke(null, new object[] { name }) is bool ordinary
            ? !ordinary : throw new Exception("PRODUCTION_ORDINARY_PRIVILEGE_PREDICATE_RESULT_INVALID");
    }

    internal static ImmutableArray<string> ClassifyUnresolvableLuid()
    {
        IntPtr data = Marshal.AllocHGlobal(16);
        try
        {
            Marshal.WriteInt32(data, 0, 1);
            Marshal.WriteInt32(data, 4, -1);
            Marshal.WriteInt32(data, 8, -1);
            Marshal.WriteInt32(data, 12, 0);
            return Decode(data, 16);
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    private static ImmutableArray<string> Decode(IntPtr data, int size)
        => Project(DecodeBuffer(data, size));

    private static ImmutableArray<WindowsAssignedPrivilegeObservation> DecodeBuffer(IntPtr data, int size)
        => Invoke("DecodeAssignedPrivileges", data, size) is ImmutableArray<WindowsAssignedPrivilegeObservation> result
            ? result : throw new Exception("PRODUCTION_PRIVILEGE_DECODER_RESULT_INVALID");

    private static object? Invoke(string method, params object[] args)
    {
        var decoder = typeof(WindowsProcessPrincipalObservation).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new Exception("PRODUCTION_PRIVILEGE_DECODER_UNAVAILABLE");
        return decoder.Invoke(null, args);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint LowPart; public int HighPart; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValueW(string? system, string name, out Luid luid);
}

static class TokenFixture
{
    internal static SafeAccessTokenHandle DenyOnly(SafeAccessTokenHandle token, SecurityIdentifier group)
    {
        byte[] bytes = new byte[group.BinaryLength];
        group.GetBinaryForm(bytes, 0);
        IntPtr sid = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, sid, bytes.Length);
            SidAndAttributes[] disabled = [new() { Sid = sid, Attributes = 0 }];
            // Creates only a restricted copy of this test's token. It is never
            // installed, impersonated or used to launch a process.
            if (!CreateRestrictedToken(token, 0, 1, disabled, 0, IntPtr.Zero, 0, IntPtr.Zero, out var restricted))
            {
                int error = Marshal.GetLastWin32Error();
                restricted?.Dispose();
                throw new Exception("RESTRICTED_TOKEN_CREATION_FAILED:" + error);
            }
            return restricted;
        }
        finally { Marshal.FreeHGlobal(sid); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existingToken, uint flags,
        uint disableSidCount, [In] SidAndAttributes[] sidsToDisable, uint deletePrivilegeCount,
        IntPtr privilegesToDelete, uint restrictedSidCount, IntPtr sidsToRestrict,
        out SafeAccessTokenHandle newToken);
}
