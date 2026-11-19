using System.Collections.Immutable;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

[assembly: InternalsVisibleTo("Stephanos.RescueIslandHost.Tests")]

namespace Stephanos.RescueIslandCustody;

/// <summary>A complete assigned entry from one native TOKEN_PRIVILEGES snapshot.</summary>
public sealed record WindowsAssignedPrivilegeObservation(
    string Name, uint LuidLowPart, int LuidHighPart, uint Attributes);

/// <summary>
/// Actual TOKEN_QUERY observations, never an enrollment or exclusion grant.
/// No caller identity, token, clock or eligibility flags are accepted.
/// AssignedSensitivePrivileges conservatively reports every assigned privilege
/// except the two ordinary diagnostic exclusions; it is not an isolation verdict.
/// </summary>
public sealed record WindowsProcessPrincipalObservation(
    string ProcessUserSid, bool ThreadImpersonating, bool Elevated,
    string ElevationType, bool AdministratorsGroupPresent,
    ImmutableArray<string> AssignedSensitivePrivileges)
{
    // Null means the SID was absent, not that a disabled/deny-only SID was
    // filtered out. These are raw TokenGroups attributes, never a grant.
    public uint? AdministratorsGroupAttributes { get; init; }

    // Complete native inventory, including disabled and ordinary privileges.
    // A default array means it was not observed; it must never mean no rights.
    // AssignedSensitivePrivileges is only the conservative compatibility view
    // of names requiring further review, never an eligibility verdict.
    public ImmutableArray<WindowsAssignedPrivilegeObservation> AssignedPrivileges { get; init; }

    // Inspect the primary process token explicitly: WindowsIdentity.GetCurrent
    // alone could silently observe a different, impersonated thread identity.
    public static WindowsProcessPrincipalObservation ObserveCurrentProcess()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out var processToken))
        {
            int error = Marshal.GetLastWin32Error();
            processToken?.Dispose();
            throw new CustodyException("ISLAND_HOST_PROCESS_TOKEN_UNAVAILABLE", error);
        }
        using (processToken)
        using (var identity = new WindowsIdentity(processToken.DangerousGetHandle()))
        {
            if (ReadUInt32(processToken, 8) != 1)
                throw new CustodyException("ISLAND_HOST_PRIMARY_TOKEN_REQUIRED");
            string sid = identity.User?.Value
                ?? throw new CustodyException("ISLAND_HOST_PROCESS_SID_UNAVAILABLE");
            uint elevation = ReadUInt32(processToken, 20);
            uint type = ReadUInt32(processToken, 18);
            if (elevation > 1 || type is < 1 or > 3)
                throw new CustodyException("ISLAND_HOST_TOKEN_INFORMATION_INVALID");
            bool impersonating = OpenThreadToken(GetCurrentThread(), 0x0008, true, out var threadToken);
            int threadError = impersonating ? 0 : Marshal.GetLastWin32Error();
            threadToken?.Dispose();
            if (!impersonating && threadError != 1008) // ERROR_NO_TOKEN is the only negative proof.
                throw new CustodyException("ISLAND_HOST_THREAD_TOKEN_UNAVAILABLE", threadError);
            var admin = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
            var adminGroup = ObserveTokenGroup(processToken, admin);
            var privileges = ReadAssignedPrivileges(processToken);
            return new(sid, impersonating, elevation == 1,
                type switch { 1 => "Default", 2 => "Full", _ => "Limited" },
                adminGroup.Present, ClassifySensitivePrivileges(privileges))
                { AdministratorsGroupAttributes = adminGroup.Attributes, AssignedPrivileges = privileges };
        }
    }

    // Query-only helper for the actual restricted-token regression. The public
    // observation path still obtains its own primary token; no caller token is
    // admitted by the host. WindowsIdentity.Groups hides disabled/deny-only SIDs.
    internal static (bool Present, uint? Attributes) ObserveTokenGroup(
        SafeAccessTokenHandle token, SecurityIdentifier expectedSid)
    {
        ArgumentNullException.ThrowIfNull(token);
        ArgumentNullException.ThrowIfNull(expectedSid);
        IntPtr data = ReadInformation(token, 2, out int size); // TokenGroups
        try
        {
            uint count = unchecked((uint)Marshal.ReadInt32(data));
            if (count == 0) return (false, null);
            int first = checked((int)Marshal.OffsetOf<TokenGroupsLayout>(nameof(TokenGroupsLayout.Groups)));
            int stride = Marshal.SizeOf<SidAndAttributes>();
            if (count > 4096 || first + (long)count * stride > size)
                throw new CustodyException("ISLAND_HOST_TOKEN_GROUPS_INVALID");
            uint? attributes = null;
            for (int i = 0; i < count; i++)
            {
                var group = Marshal.PtrToStructure<SidAndAttributes>(IntPtr.Add(data, checked(first + i * stride)));
                // TOKEN_GROUPS owns the pointed-to SIDs in this returned buffer.
                // Bound the SID header and subauthorities before any dereference.
                nuint start = (nuint)data, address = (nuint)group.Sid;
                if (address < start || address - start > (nuint)(size - 8))
                    throw new CustodyException("ISLAND_HOST_TOKEN_GROUPS_INVALID");
                int remaining = size - checked((int)(address - start));
                int subAuthorities = Marshal.ReadByte(group.Sid, 1);
                int sidLength = 8 + 4 * subAuthorities;
                if (Marshal.ReadByte(group.Sid) != 1 || subAuthorities > 15 || sidLength > remaining)
                    throw new CustodyException("ISLAND_HOST_TOKEN_GROUPS_INVALID");
                byte[] sidBytes = new byte[sidLength];
                Marshal.Copy(group.Sid, sidBytes, 0, sidLength);
                if (!new SecurityIdentifier(sidBytes, 0).Equals(expectedSid)) continue;
                if (attributes.HasValue) throw new CustodyException("ISLAND_HOST_TOKEN_GROUPS_INVALID");
                attributes = group.Attributes;
            }
            return (attributes.HasValue, attributes);
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    private static uint ReadUInt32(SafeAccessTokenHandle token, int informationClass)
    {
        // These information classes have a fixed DWORD contract. Some Windows
        // builds return ERROR_BAD_LENGTH for a zero-length elevation-type
        // probe, rather than ERROR_INSUFFICIENT_BUFFER. Read the exact size.
        IntPtr data = Marshal.AllocHGlobal(4);
        try
        {
            if (!GetTokenInformation(token, informationClass, data, 4, out int size))
                throw new CustodyException("ISLAND_HOST_TOKEN_READ_FAILED", Marshal.GetLastWin32Error());
            if (size != 4) throw new CustodyException("ISLAND_HOST_TOKEN_INFORMATION_INVALID");
            return unchecked((uint)Marshal.ReadInt32(data));
        }
        finally { Marshal.FreeHGlobal(data); }
    }

    private static ImmutableArray<WindowsAssignedPrivilegeObservation> ReadAssignedPrivileges(SafeAccessTokenHandle token)
    {
        IntPtr data = ReadInformation(token, 3, out int size);
        try { return DecodeAssignedPrivileges(data, size); }
        finally { Marshal.FreeHGlobal(data); }
    }

    // The native query and untrusted fixture buffers use this same decoder.
    // Preserve every assigned entry and raw attribute bit. No policy list can
    // remove evidence before future admission policy inspects this inventory.
    private static ImmutableArray<WindowsAssignedPrivilegeObservation> DecodeAssignedPrivileges(IntPtr data, int size)
    {
        if (data == IntPtr.Zero || size is < 4 or > 65536)
            throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
        uint count = unchecked((uint)Marshal.ReadInt32(data));
        if (count > 128 || 4L + count * 12L > size)
            throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
        var result = ImmutableArray.CreateBuilder<WindowsAssignedPrivilegeObservation>();
        var identifiers = new HashSet<(uint, int)>();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < count; i++)
        {
            int offset = checked(4 + i * 12);
            var luid = new Luid { LowPart = unchecked((uint)Marshal.ReadInt32(data, offset)),
                HighPart = Marshal.ReadInt32(data, offset + 4) };
            if (!identifiers.Add((luid.LowPart, luid.HighPart)))
                throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
            var name = new StringBuilder(128);
            uint length = (uint)name.Capacity;
            if (!LookupPrivilegeNameW(null, ref luid, name, ref length))
                throw new CustodyException("ISLAND_HOST_PRIVILEGE_NAME_UNAVAILABLE", Marshal.GetLastWin32Error());
            string value = name.ToString();
            if (value.Length == 0 || length != value.Length || !names.Add(value))
                throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
            uint attributes = unchecked((uint)Marshal.ReadInt32(data, offset + 8));
            result.Add(new(value, luid.LowPart, luid.HighPart, attributes));
        }
        return result.ToImmutable();
    }

    private static ImmutableArray<string> ClassifySensitivePrivileges(
        ImmutableArray<WindowsAssignedPrivilegeObservation> assigned)
    {
        if (assigned.IsDefault) throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
        // Compatibility diagnostic: every name requires further review except
        // these two ordinary observations. New names default to review-required.
        // Neither this exemption nor an empty result proves isolation/admission;
        // future admission must inspect AssignedPrivileges and its raw evidence.
        return assigned.Where(entry => !IsOrdinaryAssignedPrivilegeName(entry.Name))
            .Select(entry => entry.Name).OrderBy(name => name, StringComparer.Ordinal).ToImmutableArray();
    }

    // Exact ordinal names only: neither prefixes, case variants nor a future
    // OS privilege may inherit an exclusion. These omissions grant no authority.
    private static bool IsOrdinaryAssignedPrivilegeName(string name)
        => name is "SeChangeNotifyPrivilege" or "SeTimeZonePrivilege";

    private static IntPtr ReadInformation(SafeAccessTokenHandle token, int informationClass, out int size)
    {
        bool initial = GetTokenInformation(token, informationClass, IntPtr.Zero, 0, out int required);
        int error = Marshal.GetLastWin32Error();
        if (initial || error != 122 || required is < 4 or > 65536)
            throw new CustodyException("ISLAND_HOST_TOKEN_SIZE_UNAVAILABLE", error);
        IntPtr data = Marshal.AllocHGlobal(required);
        try
        {
            if (!GetTokenInformation(token, informationClass, data, required, out size))
                throw new CustodyException("ISLAND_HOST_TOKEN_READ_FAILED", Marshal.GetLastWin32Error());
            if (size < 4 || size > required)
                throw new CustodyException("ISLAND_HOST_TOKEN_INFORMATION_INVALID");
            return data;
        }
        catch { Marshal.FreeHGlobal(data); throw; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct TokenGroupsLayout { public uint GroupCount; public SidAndAttributes Groups; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { public uint LowPart; public int HighPart; }
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentThread();
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenThreadToken(IntPtr thread, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool openAsSelf, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass,
        IntPtr buffer, int length, out int returned);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeNameW(string? system, ref Luid luid, StringBuilder name, ref uint length);
}
