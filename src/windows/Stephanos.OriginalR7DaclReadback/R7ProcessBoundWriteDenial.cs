using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

internal enum R7NativeTokenStampKind { Primary = 1, Impersonation = 2 }

// An instantaneous kernel process/token binding, not historical enrollment,
// executable provenance, whole-source exclusion or continuous containment.
// Do not publish the input PID, SID or creation time through a public mailbox.
public sealed record R7ProcessBoundWriteObservation(
    string Classification,
    bool ProcessBindingObserved,
    R7EffectiveWriteObservation? WriteAccess)
{
    public bool OriginalPrincipalProvenanceAuthenticated => false;
    public bool AuthenticatedOsWitness => false;
    public bool ContainmentRemainsEnforced => false;
    public bool LeaseReleaseAuthorized => false;
    public bool SourceMutationAuthorized => false;
    public bool HistoricalReceiptReconstructed => false;
}

public static class R7ProcessBoundWriteDenial
{
    private const uint QueryLimitedInformationAndSynchronize = 0x00101000;
    // A primary token needs TOKEN_QUERY | TOKEN_DUPLICATE for
    // ImpersonateLoggedOnUser. TOKEN_IMPERSONATE is an unnecessary extra
    // right here and a least-privilege token DACL may intentionally deny it.
    private const uint QueryAndDuplicateToken = 0x000a;
    private const uint WaitTimeout = 0x102;

    private static R7ProcessBoundWriteObservation Held(string reason)
        => new(reason, false, null);

    // The expected PID + exact native FILETIME + SID must come from separately
    // authenticated original-writer enrollment. This API does NOT enroll a
    // writer, select one by name, or accept a caller-created/filtered token.
    // No process/token handle escapes. No privileges are enabled or removed.
    // The existing probe performs only OPEN_EXISTING access requests.
    public static R7ProcessBoundWriteObservation ObserveWriteAccess(
        int processId, long expectedCreationFileTimeUtc,
        string expectedOriginalSid, string targetPath)
    {
        if (!OperatingSystem.IsWindows()) return Held("R7_PROCESS_WINDOWS_REQUIRED");
        if (processId <= 0 || expectedCreationFileTimeUtc <= 0)
            return Held("R7_PROCESS_ENROLLMENT_INPUT_INVALID");
        try
        {
            SecurityIdentifier expected = new(expectedOriginalSid);
            // SYNCHRONIZE is needed for the nonblocking exit check. No VM,
            // terminate, suspend, create-thread or process-write rights.
            using SafeProcessHandle process = OpenProcess(
                QueryLimitedInformationAndSynchronize, false, processId);
            if (process.IsInvalid) return Held("R7_PROCESS_HANDLE_UNAVAILABLE");
            if (!MatchesLiveProcess(process, expectedCreationFileTimeUtc))
                return Held("R7_PROCESS_CREATION_OR_LIVENESS_UNPROVEN");
            if (!OpenProcessToken(process, QueryAndDuplicateToken,
                out SafeAccessTokenHandle token))
            {
                token?.Dispose();
                return Held("R7_PROCESS_PRIMARY_TOKEN_UNAVAILABLE");
            }
            using (token)
            {
                TokenStamp before = ReadStamp(token);
                using (WindowsIdentity identity = new(token.DangerousGetHandle()))
                {
                    if (identity.User is null || !identity.User.Equals(expected))
                        return Held("R7_PROCESS_PRIMARY_TOKEN_SID_MISMATCH");
                }

                R7EffectiveWriteObservation access = R7EffectiveWriteDenial.Observe(
                    targetPath, token, expectedOriginalSid);

                // Reopen the primary token through the SAME retained process
                // object, never by PID again. Detect primary-token replacement
                // and modifications to the retained token during sampling.
                if (!OpenProcessToken(process, 0x0008 /* TOKEN_QUERY */,
                    out SafeAccessTokenHandle current))
                {
                    current?.Dispose();
                    return Held("R7_PROCESS_TOKEN_RECHECK_UNAVAILABLE");
                }
                using (current)
                {
                    if (before != ReadStamp(token) || before != ReadStamp(current))
                        return Held("R7_PROCESS_PRIMARY_TOKEN_CHANGED");
                }
                if (!MatchesLiveProcess(process, expectedCreationFileTimeUtc))
                    return Held("R7_PROCESS_EXITED_OR_CHANGED_DURING_PROBE");

                // A successful binding is not a successful access denial.
                // Preserve the underlying probe's filtered/bypass/unknown result.
                return new("R7_PROCESS_TOKEN_SAMPLE_OBSERVED_NOT_CUSTODY", true, access);
            }
        }
        catch
        {
            // Never leak process identities, native errors, paths or token data.
            return Held("R7_PROCESS_BINDING_FAILED_CLOSED");
        }
    }

    internal static bool MatchesLiveProcess(SafeProcessHandle process, long expected)
        => WaitForSingleObject(process, 0) == WaitTimeout
            && GetProcessTimes(process, out long created, out _, out _, out _)
            && created == expected;

    internal readonly record struct TokenStamp(ulong TokenId, ulong AuthenticationId,
        ulong ModifiedId, uint GroupCount, uint PrivilegeCount, string PrivilegeDigest, string GroupInventoryDigest,
        int NativeType = 1, int ImpersonationLevel = -1);

    internal static TokenStamp ReadStamp(SafeAccessTokenHandle token)
        => ReadStamp(token, R7NativeTokenStampKind.Primary);

    // Explicit internal metadata observation only. Default/public source-writer
    // callers remain primary-only. Reuse the ONE native statistics layout.
    internal static TokenStamp ReadStamp(SafeAccessTokenHandle token, R7NativeTokenStampKind kind)
    {
        if (kind is not (R7NativeTokenStampKind.Primary or R7NativeTokenStampKind.Impersonation))
            throw new InvalidOperationException();
        int size = Marshal.SizeOf<TokenStatistics>();
        if (!GetTokenInformation(token, 10 /* TokenStatistics */,
            out TokenStatistics info, size, out int actual)
            || actual != size || info.TokenType != (int)kind
            || (kind == R7NativeTokenStampKind.Impersonation && info.ImpersonationLevel is < 0 or > 3))
            throw new InvalidOperationException();
        // On some Windows versions privilege removal changes the privilege
        // inventory without advancing ModifiedId. Bind the actual bounded,
        // pointer-free TOKEN_PRIVILEGES bytes as well as native statistics.
        byte[] privileges = ReadPrivileges(token);
        if (BitConverter.ToUInt32(privileges) != info.PrivilegeCount)
            throw new InvalidOperationException();
        var groups = R7TokenGroupInventory.ReadBoundedInventory(token);
        if (groups.Groups.Count != info.GroupCount
            || !GetTokenInformation(token, 10, out TokenStatistics after, size, out int afterSize)
            || afterSize != size || after.TokenType != (int)kind
            || (kind == R7NativeTokenStampKind.Impersonation && after.ImpersonationLevel != info.ImpersonationLevel)
            || after.TokenId != info.TokenId || after.AuthenticationId != info.AuthenticationId
            || after.ModifiedId != info.ModifiedId || after.GroupCount != info.GroupCount
            || after.PrivilegeCount != info.PrivilegeCount)
            throw new InvalidOperationException();
        return new(info.TokenId, info.AuthenticationId, info.ModifiedId,
            info.GroupCount, info.PrivilegeCount, Convert.ToHexString(SHA256.HashData(privileges)), groups.Digest,
            (int)kind, kind == R7NativeTokenStampKind.Impersonation ? info.ImpersonationLevel : -1);
    }

    private static byte[] ReadPrivileges(SafeAccessTokenHandle token)
    {
        if (GetTokenInformationBytes(token, 3 /* TokenPrivileges */, null, 0, out int size)
            || Marshal.GetLastWin32Error() != 122 || size < 4 || size > 65536)
            throw new InvalidOperationException();
        byte[] bytes = new byte[size];
        if (!GetTokenInformationBytes(token, 3, bytes, size, out int actual) || actual != size)
            throw new InvalidOperationException();
        uint count = BitConverter.ToUInt32(bytes);
        if (count > 256 || size != 4 + count * 12)
            throw new InvalidOperationException();
        return bytes;
    }

    // Native TOKEN_STATISTICS layout, including the 8-byte LARGE_INTEGER.
    [StructLayout(LayoutKind.Sequential)]
    private struct TokenStatistics
    {
        public ulong TokenId, AuthenticationId;
        public long ExpirationTime;
        public int TokenType, ImpersonationLevel;
        public uint DynamicCharged, DynamicAvailable, GroupCount, PrivilegeCount;
        public ulong ModifiedId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(SafeProcessHandle process, uint milliseconds);

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
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token,
        int kind, out TokenStatistics statistics, int size, out int actual);

    [DllImport("advapi32.dll", EntryPoint = "GetTokenInformation", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformationBytes(SafeAccessTokenHandle token,
        int kind, [Out] byte[]? bytes, int size, out int actual);
}
