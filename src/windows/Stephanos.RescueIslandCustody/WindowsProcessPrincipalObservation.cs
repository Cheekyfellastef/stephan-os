using System.Collections.Immutable;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.RescueIslandCustody;

/// <summary>
/// Actual TOKEN_QUERY observations, never an enrollment or exclusion grant.
/// No caller identity, token, clock or eligibility flags are accepted.
/// </summary>
public sealed record WindowsProcessPrincipalObservation(
    string ProcessUserSid, bool ThreadImpersonating, bool Elevated,
    string ElevationType, bool AdministratorsGroupPresent,
    ImmutableArray<string> AssignedSensitivePrivileges)
{
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
            bool adminPresent = identity.Groups?.Contains(admin)
                ?? throw new CustodyException("ISLAND_HOST_TOKEN_GROUPS_UNAVAILABLE");
            return new(sid, impersonating, elevation == 1,
                type switch { 1 => "Default", 2 => "Full", _ => "Limited" },
                adminPresent, ReadSensitivePrivileges(processToken));
        }
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

    private static ImmutableArray<string> ReadSensitivePrivileges(SafeAccessTokenHandle token)
    {
        // Presence includes disabled privileges: they may be enabled later.
        // This deliberately makes no assertion about complete OS isolation.
        string[] sensitive = ["SeTcbPrivilege", "SeCreateTokenPrivilege", "SeAssignPrimaryTokenPrivilege",
            "SeDebugPrivilege", "SeImpersonatePrivilege", "SeBackupPrivilege", "SeRestorePrivilege",
            "SeTakeOwnershipPrivilege", "SeLoadDriverPrivilege", "SeSecurityPrivilege",
            "SeManageVolumePrivilege", "SeRelabelPrivilege", "SeTrustedCredManAccessPrivilege"];
        IntPtr data = ReadInformation(token, 3, out int size);
        try
        {
            if (size < 4) throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
            uint count = unchecked((uint)Marshal.ReadInt32(data));
            if (count > 128 || 4L + count * 12L > size)
                throw new CustodyException("ISLAND_HOST_TOKEN_PRIVILEGES_INVALID");
            var result = ImmutableArray.CreateBuilder<string>();
            for (int i = 0; i < count; i++)
            {
                int offset = checked(4 + i * 12);
                var luid = new Luid { LowPart = unchecked((uint)Marshal.ReadInt32(data, offset)),
                    HighPart = Marshal.ReadInt32(data, offset + 4) };
                var name = new StringBuilder(128);
                uint length = (uint)name.Capacity;
                if (!LookupPrivilegeNameW(null, ref luid, name, ref length))
                    throw new CustodyException("ISLAND_HOST_PRIVILEGE_NAME_UNAVAILABLE", Marshal.GetLastWin32Error());
                string value = name.ToString();
                if (sensitive.Contains(value, StringComparer.Ordinal)) result.Add(value);
            }
            return result.ToImmutable().Sort(StringComparer.Ordinal);
        }
        finally { Marshal.FreeHGlobal(data); }
    }

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
