using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

// A native observation, NEVER a signed custody assertion. In particular,
// a denied open does not prove the absence of old writable handles/mappings,
// alternate tokens, task/service authority, COM/WMI reentry or key isolation.
public sealed record R7EffectiveWriteObservation(
    string Classification,
    bool SuppliedTokenSidMatched,
    bool DataWriteOpenDenied,
    bool DaclWriteOpenDenied,
    bool OwnerWriteOpenDenied,
    bool TargetIdentityStable,
    bool SuppliedPrincipalOwnsTarget,
    bool TokenHasBypassAuthority)
{
    public bool AuthenticatedOsWitness => false;
    public bool OriginalPrincipalProvenanceAuthenticated => false;
    public bool LeaseReleaseAuthorized => false;
    public bool SourceMutationAuthorized => false;
    public bool HistoricalReceiptReconstructed => false;
}

public static class R7EffectiveWriteDenial
{
    private const uint FileWriteData = 0x2; // FILE_ADD_FILE for directories
    private const uint FileAppendData = 0x4;
    private const uint WriteDac = 0x40000;
    private const uint WriteOwner = 0x80000;
    private const uint ReadControl = 0x20000;
    private const uint ReadAttributes = 0x80;
    private const uint ShareReadWriteDelete = 0x7;
    private const uint OpenExisting = 3;
    private const uint OpenReparsePointAndBackupSemantics = 0x02200000;
    private const uint ReparseAttribute = 0x400;
    private const uint DirectoryAttribute = 0x10;
    private const int AccessDenied = 5;
    private const int InsufficientBuffer = 122;
    private const int MaxTokenBytes = 65536;

    private static R7EffectiveWriteObservation Held(string code, bool matched = false)
        => new(code, matched, false, false, false, false, false, true);

    // The host must supply a real retained OS token for the independently
    // identified original principal. SID equality alone is NOT authentication
    // of historical identity or an unmodified token's provenance. Never manufacture a token from a SID,
    // drop its privileges/groups, or use the witness's token as a substitute.
    // This method performs OPEN_EXISTING access requests only. It does not
    // create files, modify data/ACLs, adjust privileges or launch processes.
    public static R7EffectiveWriteObservation Observe(
        string targetPath, SafeAccessTokenHandle originalToken, string expectedOriginalSid)
    {
        if (!OperatingSystem.IsWindows() || originalToken is null
            || originalToken.IsClosed || originalToken.IsInvalid)
            return Held("R7_NATIVE_SUPPLIED_TOKEN_UNAVAILABLE");
        bool retained = false;
        try
        {
            originalToken.DangerousAddRef(ref retained);
            if (IsTokenRestricted(originalToken)
                || TokenFlag(originalToken, 21 /* TokenHasRestrictions: ever filtered */)
                || TokenFlag(originalToken, 29 /* TokenIsAppContainer */)
                || TokenFlag(originalToken, 15 /* TokenSandBoxInert */)
                || TokenFlag(originalToken, 47 /* TokenIsSandboxed: independent sandbox flag */)
                || TokenFlag(originalToken, 26 /* TokenUIAccess */))
                return Held("R7_NATIVE_FILTERED_OR_SPECIAL_TOKEN_UNQUALIFIED");
            return SampleSuppliedTokenAccess(targetPath, originalToken, expectedOriginalSid);
        }
        catch { return Held("R7_NATIVE_TOKEN_QUALIFICATION_FAILED_CLOSED"); }
        finally { if (retained) originalToken.DangerousRelease(); }
    }

    // Private mechanism: actual access facts for the supplied token, without
    // historical identity or qualification claims. The public entry point
    // admits it only after native token-form checks. Tests exercise this
    // mechanism separately from that admission, without claiming original
    // writer authentication or a qualified token on the test machine.
    private static R7EffectiveWriteObservation SampleSuppliedTokenAccess(
        string targetPath, SafeAccessTokenHandle originalToken, string expectedOriginalSid)
    {
        if (!OperatingSystem.IsWindows() || originalToken is null
            || originalToken.IsClosed || originalToken.IsInvalid)
            return Held("R7_NATIVE_SUPPLIED_TOKEN_UNAVAILABLE");
        bool retained = false;
        try
        {
            originalToken.DangerousAddRef(ref retained);
            SecurityIdentifier expected = new(expectedOriginalSid);
            using WindowsIdentity identity = new(originalToken.DangerousGetHandle());
            if (identity.User is null || !identity.User.Equals(expected))
                return Held("R7_NATIVE_SUPPLIED_TOKEN_IDENTITY_MISMATCH");

            // The token remains unmodified. Disabled privileges are included:
            // a writer can enable a privilege already present in its token.
            bool bypass = HasBypassAuthority(originalToken, identity);
            string path = NormalizeLocalPath(targetPath);
            using NativeTarget? before = NativeTarget.TryOpen(path);
            if (before is null || !TryIdentity(before.Handle, out FileIdentity first))
                return Held("R7_NATIVE_TARGET_NONCANONICAL_OR_UNAVAILABLE", true);
            SecurityIdentifier? owner = ReadOwner(before.Handle);
            if (owner is null) return Held("R7_NATIVE_TARGET_OWNER_UNAVAILABLE", true);

            // Never let failed impersonation fall through to the service's
            // identity. RunImpersonated throws and restores on every exit.
            var opens = WindowsIdentity.RunImpersonated(originalToken, () => new[] {
                Request(path, FileWriteData),
                Request(path, FileAppendData),
                Request(path, WriteDac),
                Request(path, WriteOwner)
            });

            using NativeTarget? after = NativeTarget.TryOpen(path);
            bool stable = after is not null && TryIdentity(after.Handle, out FileIdentity last)
                && first == last;
            bool owns = owner.Equals(expected);
            bool dataDenied = opens[0] == AccessDenied && opens[1] == AccessDenied;
            bool daclDenied = opens[2] == AccessDenied;
            bool ownerDenied = opens[3] == AccessDenied;
            string classification = !stable ? "R7_NATIVE_TARGET_CHANGED"
                : opens.Any(code => code != 0 && code != AccessDenied)
                    ? "R7_NATIVE_ACCESS_RESULT_UNKNOWN"
                : !dataDenied ? "R7_NATIVE_SUPPLIED_TOKEN_CAN_WRITE"
                : owns ? "R7_NATIVE_DATA_DENIED_BUT_SUPPLIED_PRINCIPAL_OWNS_TARGET"
                : bypass ? "R7_NATIVE_DATA_DENIED_BUT_TOKEN_CAN_BYPASS_POLICY"
                : !daclDenied || !ownerDenied ? "R7_NATIVE_POLICY_REWRITE_NOT_DENIED"
                : "R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY";
            return new(classification, true, dataDenied, daclDenied, ownerDenied,
                stable, owns, bypass);
        }
        catch
        {
            // Private Windows paths, SID, token, DACL and exception messages
            // must not escape through any public mailbox projection.
            return Held("R7_NATIVE_WRITE_PROBE_FAILED_CLOSED");
        }
        finally { if (retained) originalToken.DangerousRelease(); }
    }

    private static string NormalizeLocalPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)
            || path.Length > 240 || path.Contains('/') || path.Contains('\0') || path.StartsWith(@"\\")
            || path.Length < 4 || !char.IsAsciiLetter(path[0]) || path[1] != ':'
            || path[2] != '\\' || path.AsSpan(2).Contains(':'))
            throw new ArgumentException();
        string[] parts = path[3..].Split('\\');
        if (parts.Any(p => p.Length == 0 || p is "." or ".."
            || p.EndsWith('.') || p.EndsWith(' ')
            || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
            || IsDosDevice(p))) throw new ArgumentException();
        string canonical = Path.GetFullPath(path);
        if (!string.Equals(path, canonical, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException();
        return canonical;
    }

    private static bool IsDosDevice(string component)
    {
        string stem = component.Split('.')[0].TrimEnd(' ').ToUpperInvariant();
        return stem is "CON" or "PRN" or "AUX" or "NUL"
            || (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT"))
                && "123456789\u00b9\u00b2\u00b3".Contains(stem[3]));
    }

    // Target identity belongs to retained native handles, not to a normalized
    // .NET string. Keep the object and every ancestor open without DELETE
    // sharing while probing, and require Windows' normalized final path to
    // match the supplied path. This rejects 8.3 aliases (including ancestors),
    // SUBST/other namespace aliases and reparse redirections without forbidding
    // legitimate long filenames merely because they contain a tilde.
    private sealed class NativeTarget : IDisposable
    {
        private readonly List<SafeFileHandle> handles = new();
        internal SafeFileHandle Handle => handles[0];

        internal static NativeTarget? TryOpen(string path)
        {
            NativeTarget target = new();
            try
            {
                string? current = path;
                for (int count = 0; current is not null && count < 128; count++)
                {
                    SafeFileHandle handle = CreateFileW(current,
                        count == 0 ? ReadControl | ReadAttributes : ReadAttributes,
                        3 /* FILE_SHARE_READ | FILE_SHARE_WRITE; never DELETE */,
                        IntPtr.Zero, OpenExisting, OpenReparsePointAndBackupSemantics, IntPtr.Zero);
                    target.handles.Add(handle);
                    if (handle.IsInvalid || !GetFileInformationByHandle(handle, out ByHandleInfo info)
                        || (info.Attributes & ReparseAttribute) != 0) break;
                    DirectoryInfo? parent = Directory.GetParent(current);
                    if (parent is null)
                    {
                        StringBuilder finalPath = new(512);
                        uint length = GetFinalPathNameByHandleW(target.Handle, finalPath,
                            (uint)finalPath.Capacity, 0 /* FILE_NAME_NORMALIZED | VOLUME_NAME_DOS */);
                        if (length > 0 && length < finalPath.Capacity
                            && NativeNameMatches(path, finalPath.ToString())) return target;
                        break;
                    }
                    current = parent.FullName;
                }
            }
            catch { target.Dispose(); throw; }
            target.Dispose();
            return null;
        }

        public void Dispose()
        {
            for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose();
            handles.Clear();
        }
    }

    private static bool NativeNameMatches(string supplied, string native)
        => native.StartsWith(@"\\?\", StringComparison.Ordinal)
            && string.Equals(supplied, native[4..], StringComparison.OrdinalIgnoreCase);

    private static SafeFileHandle Open(string path, uint access)
        => CreateFileW(path, access, ShareReadWriteDelete, IntPtr.Zero,
            OpenExisting, OpenReparsePointAndBackupSemantics, IntPtr.Zero);

    private static int Request(string path, uint access)
    {
        using SafeFileHandle handle = Open(path, access);
        return handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
    }

    internal readonly record struct FileIdentity(uint Volume, uint High, uint Low);

    internal static bool TryIdentity(SafeFileHandle handle, out FileIdentity identity)
    {
        identity = default;
        if (!GetFileInformationByHandle(handle, out ByHandleInfo info)
            || (info.Attributes & (ReparseAttribute | DirectoryAttribute)) != 0
            || info.Links != 1) return false;
        identity = new(info.VolumeSerial, info.IndexHigh, info.IndexLow);
        return true;
    }

    private static SecurityIdentifier? ReadOwner(SafeFileHandle handle)
    {
        uint code = GetSecurityInfo(handle, 1 /* SE_FILE_OBJECT */, 1 /* OWNER */,
            out IntPtr owner, out _, out _, out _, out IntPtr descriptor);
        if (code != 0 || descriptor == IntPtr.Zero) return null;
        try { return owner == IntPtr.Zero ? null : new SecurityIdentifier(owner); }
        finally { LocalFree(descriptor); }
    }

    private static bool HasBypassAuthority(SafeAccessTokenHandle token, WindowsIdentity identity)
    {
        if (identity.IsSystem) return true;
        SecurityIdentifier administrators = new(WellKnownSidType.BuiltinAdministratorsSid, null);
        // Include deny-only Administrators membership. A split admin token is
        // insufficient evidence that an old actor cannot regain elevation.
        if (identity.Groups?.Contains(administrators) == true) return true;
        byte[] elevation = TokenBytes(token, 18 /* TokenElevationType */);
        if (BitConverter.ToInt32(elevation) != 1 /* TokenElevationTypeDefault */) return true;
        return HasUnqualifiedPrivileges(TokenBytes(token, 3 /* TokenPrivileges */));
    }

    private static bool HasUnqualifiedPrivileges(byte[] privileges)
    {
        if (privileges.Length < 4) throw new InvalidDataException();
        uint count = BitConverter.ToUInt32(privileges);
        if (count > 256 || privileges.Length != 4 + count * 12) throw new InvalidDataException();
        // Closed-world qualification, rather than a list of known dangerous
        // privileges that silently admits an omitted or newly added privilege.
        // Only ordinary traversal notification is admitted. Every other
        // present privilege (including disabled SeRelabelPrivilege) holds.
        if (!LookupPrivilegeValueW(null, "SeChangeNotifyPrivilege", out Luid traversal))
            throw new Win32Exception();
        for (int i = 0; i < count; i++)
        {
            int at = 4 + i * 12;
            if (BitConverter.ToUInt32(privileges, at) != traversal.Low
                || BitConverter.ToInt32(privileges, at + 4) != traversal.High) return true;
        }
        return false;
    }

    private static byte[] TokenBytes(SafeAccessTokenHandle token, int kind)
    {
        if (GetTokenInformation(token, kind, IntPtr.Zero, 0, out int size)
            || Marshal.GetLastWin32Error() != InsufficientBuffer
            || size < 4 || size > MaxTokenBytes) throw new Win32Exception();
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!GetTokenInformation(token, kind, buffer, size, out int actual)
                || actual != size) throw new Win32Exception();
            byte[] bytes = new byte[size];
            Marshal.Copy(buffer, bytes, 0, size);
            return bytes;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool TokenFlag(SafeAccessTokenHandle token, int kind)
    {
        // These classes have a fixed DWORD result. Unlike variable-length
        // token information, a zero-length sizing query is not portable for
        // every fixed flag class. Query the documented four-byte result.
        IntPtr buffer = Marshal.AllocHGlobal(4);
        try
        {
            Marshal.WriteInt32(buffer, 1); // unread/untouched means HOLD
            if (!GetTokenInformation(token, kind, buffer, 4, out int actual)
                || (actual != 4 && !(kind == 21 && actual == 1))) throw new Win32Exception();
            // Windows returns TokenHasRestrictions as BOOLEAN on this host;
            // other documented flags have a DWORD result. Both are nonzero=true.
            return actual == 1 ? Marshal.ReadByte(buffer) != 0 : Marshal.ReadInt32(buffer) != 0;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleInfo
    {
        internal uint Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        internal uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { internal uint Low; internal int High; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out ByHandleInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint length, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind,
        IntPtr buffer, int size, out int actual);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsTokenRestricted(SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValueW(string? system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, int objectType, uint information,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
