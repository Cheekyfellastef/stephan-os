using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7CustodyWitness;

// Single-directory kernel OPEN_EXISTING rights probe. It never creates entries,
// changes an ACL, acquires an original token or grants Windows custody authority.
internal sealed record OriginalR7DirectoryRightsObservation(
    string Classification,
    bool SuppliedSidMatched,
    bool DirectoryIdentityStable,
    bool AddFileDenied,
    bool AddDirectoryDenied,
    bool DeleteChildDenied,
    bool RewriteDaclDenied,
    bool RewriteOwnerDenied)
{
    internal bool BoundedDirectoryMutationDenied =>
        SuppliedSidMatched && DirectoryIdentityStable && AddFileDenied
        && AddDirectoryDenied && DeleteChildDenied && RewriteDaclDenied && RewriteOwnerDenied;
    internal bool OriginalPrincipalProvenanceAuthenticated => false;
    internal bool OriginalExistingHandlesExcluded => false;
    internal bool OtherWriterTokensExcluded => false;
    internal bool RelaunchRoutesExcluded => false;
    internal bool WholeSourceWriterExclusionProven => false;
    internal bool ProtectedAuditVerified => false;
    internal bool SigningAuthorityGranted => false;
    internal bool LeaseReleaseAuthorized => false;
}

internal static class OriginalR7DirectoryRightsPreflight
{
    private const uint FileAddFile = 0x2;
    private const uint FileAddSubdirectory = 0x4;
    private const uint FileDeleteChild = 0x40;
    private const uint WriteDac = 0x40000;
    private const uint WriteOwner = 0x80000;
    private const uint ReadAttributes = 0x80;
    private const uint FileShareReadWrite = 3; // No FILE_SHARE_DELETE while observing.
    private const uint OpenExisting = 3;
    private const uint OpenDirectoryNoFollow = 0x02200000; // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
    private const uint ReparseAttribute = 0x400;
    private const uint DirectoryAttribute = 0x10;
    private const int AccessDenied = 5;

    private static OriginalR7DirectoryRightsObservation Held(string code)
        => new(code, false, false, false, false, false, false, false);

    // The retained token MUST already have been qualified independently by
    // the protected OS security owner. SID equality cannot establish historic
    // provenance. Even a full negative probe remains a single instant/scope.
    internal static OriginalR7DirectoryRightsObservation Observe(
        string directoryPath, SafeAccessTokenHandle suppliedToken, string expectedSid)
    {
        if (!OperatingSystem.IsWindows() || suppliedToken is null
            || suppliedToken.IsInvalid || suppliedToken.IsClosed
            || string.IsNullOrWhiteSpace(expectedSid) || !Canonical(directoryPath))
            return Held("R7_DIRECTORY_INPUT_OR_TOKEN_UNAVAILABLE");
        bool retained = false;
        try
        {
            suppliedToken.DangerousAddRef(ref retained);
            using WindowsIdentity identity = new(suppliedToken.DangerousGetHandle());
            SecurityIdentifier expected = new(expectedSid);
            if (identity.User is null || !identity.User.Equals(expected))
                return Held("R7_DIRECTORY_TOKEN_IDENTITY_MISMATCH");

            // Refuse any ancestor reparse point, not just the terminal name.
            DirectoryInfo? cursor = new(directoryPath);
            while (cursor is not null)
            {
                FileAttributes attributes = cursor.Attributes;
                if ((attributes & FileAttributes.Directory) == 0
                    || (attributes & FileAttributes.ReparsePoint) != 0)
                    return Held("R7_DIRECTORY_REPARSE_OR_TYPE_UNSAFE");
                cursor = cursor.Parent;
            }

            using SafeFileHandle before = Open(directoryPath, ReadAttributes);
            if (before.IsInvalid || !Identity(before, out var first))
                return Held("R7_DIRECTORY_NATIVE_IDENTITY_UNAVAILABLE");

            // All five are read-only access-rights requests, OPEN_EXISTING.
            // Even success does not mutate disk contents or security policy.
            int[] opens = WindowsIdentity.RunImpersonated(suppliedToken, () => new[] {
                Request(directoryPath, FileAddFile),
                Request(directoryPath, FileAddSubdirectory),
                Request(directoryPath, FileDeleteChild),
                Request(directoryPath, WriteDac),
                Request(directoryPath, WriteOwner),
            });
            using SafeFileHandle after = Open(directoryPath, ReadAttributes);
            bool stable = !after.IsInvalid && Identity(after, out var last) && first == last;
            if (!stable) return Held("R7_DIRECTORY_IDENTITY_CHANGED");
            if (opens.Any(x => x != 0 && x != AccessDenied))
                return Held("R7_DIRECTORY_ACCESS_RESULT_UNKNOWN");

            bool allDenied = opens.All(x => x == AccessDenied);
            return new(
                allDenied ? "R7_SINGLE_DIRECTORY_RIGHTS_DENIED_NOT_CUSTODY"
                    : "R7_DIRECTORY_MUTATION_RIGHTS_STILL_AVAILABLE",
                true, true, opens[0] == AccessDenied, opens[1] == AccessDenied,
                opens[2] == AccessDenied, opens[3] == AccessDenied, opens[4] == AccessDenied);
        }
        catch { return Held("R7_DIRECTORY_NATIVE_PROBE_UNAVAILABLE"); }
        finally { if (retained) suppliedToken.DangerousRelease(); }
    }

    private static bool Canonical(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 220
            || !Path.IsPathFullyQualified(path) || path.StartsWith(@"\\")
            || path.Contains('/') || path.Contains('\0')
            || path.Length < 4 || !char.IsAsciiLetter(path[0]) || path[1] != ':'
            || path[2] != '\\' || path.AsSpan(2).Contains(':'))
            return false;
        try
        {
            if (!string.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                return false;
            string[] parts = path[3..].Split('\\');
            return parts.All(p => p.Length > 0 && p is not "." and not ".."
                && !p.EndsWith('.') && !p.EndsWith(' '));
        }
        catch { return false; }
    }

    private static SafeFileHandle Open(string path, uint rights)
        => CreateFileW(path, rights, FileShareReadWrite, IntPtr.Zero,
            OpenExisting, OpenDirectoryNoFollow, IntPtr.Zero);

    private static int Request(string path, uint rights)
    {
        using SafeFileHandle handle = Open(path, rights);
        return handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
    }

    private readonly record struct FileIdentity(uint Volume, uint IndexHigh, uint IndexLow);
    private static bool Identity(SafeFileHandle handle, out FileIdentity identity)
    {
        identity = default;
        if (!GetFileInformationByHandle(handle, out ByHandleInfo info)
            || (info.Attributes & DirectoryAttribute) == 0
            || (info.Attributes & ReparseAttribute) != 0) return false;
        identity = new(info.VolumeSerial, info.IndexHigh, info.IndexLow);
        return true;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleInfo
    {
        internal uint Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        internal uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out ByHandleInfo info);
}
