using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

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
    private const uint QueryDuplicateAndImpersonateToken = 0x000e;
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
            if (!OpenProcessToken(process, QueryDuplicateAndImpersonateToken,
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

    private static bool MatchesLiveProcess(SafeProcessHandle process, long expected)
        => WaitForSingleObject(process, 0) == WaitTimeout
            && GetProcessTimes(process, out long created, out _, out _, out _)
            && created == expected;

    private readonly record struct TokenStamp(ulong TokenId, ulong AuthenticationId, ulong ModifiedId);

    private static TokenStamp ReadStamp(SafeAccessTokenHandle token)
    {
        int size = Marshal.SizeOf<TokenStatistics>();
        if (!GetTokenInformation(token, 10 /* TokenStatistics */,
            out TokenStatistics info, size, out int actual)
            || actual != size || info.TokenType != 1 /* TokenPrimary */)
            throw new InvalidOperationException();
        return new(info.TokenId, info.AuthenticationId, info.ModifiedId);
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
}
