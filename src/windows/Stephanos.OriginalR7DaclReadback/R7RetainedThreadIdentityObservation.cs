using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

// Private instantaneous metadata, not a source-authority or thread-selection
// interface. Missing/anonymous/inaccessible/changed tokens are UNKNOWN.
internal sealed record R7RetainedThreadTokenObservation(
    string Classification, bool ThreadAndTokenSampleStable,
    string ThreadIdentityDigest, R7NativePrincipalStamp Token,
    int ImpersonationLevel)
{
    public bool SourcePrincipalAuthenticated => false;
    public bool CompleteCapabilityInventoryProven => false;
    public bool WholeEstateProven => false;
    public bool ContinuousCustodyProven => false;
    public bool SourceMutationAuthorized => false;
    public bool LeaseReleaseAuthorized => false;
    public bool HostPolicyAdopted => false;
}

internal static class R7RetainedThreadTokenObserver
{
    private const string Observed = "R7_RETAINED_THREAD_IMPERSONATION_SAMPLE_OBSERVED_NOT_CUSTODY";
    private const uint WaitTimeout = 0x102;
    private readonly record struct ThreadBinding(uint ProcessId, long ProcessCreated,
        uint ThreadId, long ThreadCreated);

    // Both live kernel objects must already be retained by the independently
    // trusted host. Never open a process/thread using caller-supplied PID/TID.
    // Query-only TOKEN_QUERY opens. No impersonation/set-token/privilege changes.
    internal static R7RetainedThreadTokenObservation ObserveRetained(
        SafeProcessHandle retainedProcess, SafeWaitHandle retainedThread)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || retainedProcess is null || retainedThread is null
            || retainedProcess.IsInvalid || retainedProcess.IsClosed
            || retainedThread.IsInvalid || retainedThread.IsClosed)
            return Unknown("R7_THREAD_RETAINED_OBJECT_OR_PLATFORM_UNAVAILABLE");
        bool processAdded = false, threadAdded = false;
        try
        {
            retainedProcess.DangerousAddRef(ref processAdded);
            retainedThread.DangerousAddRef(ref threadAdded);
            ThreadBinding before = ReadBinding(retainedProcess, retainedThread);
            if (!OpenThreadToken(retainedThread, 8 /* TOKEN_QUERY */, true, out var firstToken))
            {
                firstToken?.Dispose();
                return Unknown("R7_THREAD_IMPERSONATION_TOKEN_UNAVAILABLE");
            }
            using (firstToken)
            {
                var first = R7ProcessBoundWriteDenial.ReadStamp(firstToken, R7NativeTokenStampKind.Impersonation);
                var principalBefore = R7NativePrincipalIdentity.ObserveRetained(firstToken,
                    R7NativeTokenStampKind.Impersonation);
                if (!principalBefore.NativeIdentityObserved || principalBefore.NativeType != 2)
                    return Unknown("R7_THREAD_TOKEN_IDENTITY_UNAVAILABLE");
                // Reopen through the same retained THREAD object. A previously
                // retained token by itself would miss assignment replacement.
                if (!OpenThreadToken(retainedThread, 8, true, out var secondToken))
                {
                    secondToken?.Dispose();
                    return Unknown("R7_THREAD_TOKEN_REMOVED_OR_UNAVAILABLE");
                }
                using (secondToken)
                {
                    var second = R7ProcessBoundWriteDenial.ReadStamp(secondToken, R7NativeTokenStampKind.Impersonation);
                    var principalAfter = R7NativePrincipalIdentity.ObserveRetained(secondToken,
                        R7NativeTokenStampKind.Impersonation);
                    var firstAgain = R7ProcessBoundWriteDenial.ReadStamp(firstToken, R7NativeTokenStampKind.Impersonation);
                    ThreadBinding after = ReadBinding(retainedProcess, retainedThread);
                    if (before != after || first != second || first != firstAgain
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(principalBefore, principalAfter))
                        return Unknown("R7_THREAD_TOKEN_OR_BINDING_CHANGED");
                    return new(Observed, true, BindingDigest(after), principalAfter, second.ImpersonationLevel);
                }
            }
        }
        catch { return Unknown("R7_THREAD_SAMPLE_UNAVAILABLE_OR_CHANGED"); }
        finally
        {
            if (threadAdded) retainedThread.DangerousRelease();
            if (processAdded) retainedProcess.DangerousRelease();
        }
    }

    internal static bool SameRetainedThreadAndTokenState(
        R7RetainedThreadTokenObservation left, R7RetainedThreadTokenObservation right)
        => left is { Classification: Observed, ThreadAndTokenSampleStable: true }
            && right is { Classification: Observed, ThreadAndTokenSampleStable: true }
            && left.ThreadIdentityDigest == right.ThreadIdentityDigest
            && left.ImpersonationLevel == right.ImpersonationLevel
            && left.Token.NativeType == 2 && right.Token.NativeType == 2
            && R7NativePrincipalIdentity.SameRetainedObjectAndState(left.Token, right.Token);

    private static ThreadBinding ReadBinding(SafeProcessHandle process, SafeWaitHandle thread)
    {
        if (process.DangerousGetHandle().ToInt64() <= 0 || thread.DangerousGetHandle().ToInt64() <= 0
            || WaitForProcess(process, 0) != WaitTimeout || WaitForThread(thread, 0) != WaitTimeout)
            throw new InvalidOperationException();
        uint pid = GetProcessId(process), tid = GetThreadId(thread);
        if (pid == 0 || tid == 0 || GetProcessIdOfThread(thread) != pid
            || !GetProcessTimes(process, out long pc, out _, out _, out _)
            || !GetThreadTimes(thread, out long tc, out _, out _, out _)
            || pc <= 0 || tc <= 0
            || WaitForProcess(process, 0) != WaitTimeout || WaitForThread(thread, 0) != WaitTimeout)
            throw new InvalidOperationException();
        return new(pid, pc, tid, tc);
    }

    private static string BindingDigest(ThreadBinding binding)
        => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(
            "stephanos.r7.retained-thread-object.v1\0"
            + binding.ProcessId.ToString(CultureInfo.InvariantCulture) + ":"
            + binding.ProcessCreated.ToString(CultureInfo.InvariantCulture) + ":"
            + binding.ThreadId.ToString(CultureInfo.InvariantCulture) + ":"
            + binding.ThreadCreated.ToString(CultureInfo.InvariantCulture)))).ToLowerInvariant();
    private static R7RetainedThreadTokenObservation Unknown(string code)
        => new(code, false, "", new(false, 0, "", ""), -1);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenThreadToken(SafeWaitHandle thread, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool openAsSelf, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject")]
    private static extern uint WaitForProcess(SafeProcessHandle process, uint timeout);
    [DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject")]
    private static extern uint WaitForThread(SafeWaitHandle thread, uint timeout);
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll")] private static extern uint GetThreadId(SafeWaitHandle thread);
    [DllImport("kernel32.dll")] private static extern uint GetProcessIdOfThread(SafeWaitHandle thread);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(SafeProcessHandle process,
        out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetThreadTimes(SafeWaitHandle thread,
        out long created, out long exited, out long kernel, out long user);
}
