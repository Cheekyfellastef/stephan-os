using Stephanos.OriginalR7DaclReadback;
using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Stephanos.OriginalR7CustodyWitness;

// Current OS actor observation, never inferred historical identity or proof
// of human consent, repository-owner enrollment or host authorization.
internal sealed record OriginalR7CommissioningOwnerObservation(
    string Classification, bool NativeElevatedInteractiveContextObserved,
    int ProcessId, string CreationFileTimeUtc, string CurrentSid,
    int SessionId, bool PrimaryToken, bool TokenElevated,
    string NativePrincipalIdentityDigest, string NativePrincipalMutationDigest)
{
    internal bool HumanConsentProven => false;
    internal bool RepositoryOwnerAuthenticated => false;
    internal bool ExecutorAdmitted => false;
    internal bool PolicyAdopted => false;
    internal bool HostExecutionAuthorized => false;
    internal bool RootEnrollmentAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

internal static class OriginalR7CommissioningOwnerContext
{
    // Actual token/process facts are collected here. No request-supplied
    // SID, PID, elevation Boolean, environment username or profile can replace
    // them. A separate admitted owner/source/OS ceremony must still authorize
    // its exact operation; an elevated process alone is not human consent.
    internal static OriginalR7CommissioningOwnerObservation ObserveCurrent()
    {
        if (!OperatingSystem.IsWindows()) return Held("WINDOWS_REQUIRED");
        try
        {
            using Process process = Process.GetCurrentProcess();
            using WindowsIdentity identity = WindowsIdentity.GetCurrent();
            var first = R7NativePrincipalIdentity.ObserveRetained(identity.AccessToken);
            bool primary = GetTokenInformation(identity.AccessToken, 8, out int type, 4, out uint typeSize)
                && typeSize == 4 && type == 1;
            bool elevated = GetTokenInformation(identity.AccessToken, 20, out int elevation, 4, out uint elevationSize)
                && elevationSize == 4 && elevation == 1;
            bool administrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            string sid = identity.User?.Value ?? "";
            long creation = process.StartTime.ToUniversalTime().ToFileTimeUtc();
            var last = R7NativePrincipalIdentity.ObserveRetained(identity.AccessToken);
            bool observed = primary && elevated && administrator && !identity.IsSystem
                && Environment.UserInteractive && process.SessionId > 0 && sid.Length is >= 8 and <= 184
                && first.NativeType == 1 && R7NativePrincipalIdentity.SameRetainedObjectAndState(first, last);
            return new(observed ? "R7_NATIVE_OWNER_CONTEXT_ONLY_NOT_CONSENT"
                    : "R7_INTERACTIVE_ELEVATED_OWNER_CONTEXT_UNPROVEN",
                observed, process.Id, creation.ToString(System.Globalization.CultureInfo.InvariantCulture),
                sid, process.SessionId, primary, elevated,
                last.NativeIdentityObserved ? last.IdentityDigest : "",
                last.NativeIdentityObserved ? last.MutationDigest : "");
        }
        catch { return Held("NATIVE_OWNER_CONTEXT_UNOBSERVABLE"); }
    }
    private static OriginalR7CommissioningOwnerObservation Held(string code)
        => new("R7_OWNER_" + code, false, 0, "", "", -1, false, false, "", "");

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token,
        int informationClass, out int information, uint length, out uint returned);
}
