using Microsoft.Win32.SafeHandles;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Stephanos.OriginalR7DaclReadback;

// Kernel object identity and its mutation stamp, not an enrollment, capability
// inventory, consent, original-source identity or whole-estate exclusion.
public sealed record R7NativePrincipalStamp(
    bool NativeIdentityObserved, int NativeType, string IdentityDigest, string MutationDigest)
{
    public bool SourcePrincipalAuthenticated => false;
    public bool CompleteCapabilityInventoryProven => false;
    public bool HostPolicyAdopted => false;
    public bool LeaseReleaseAuthorized => false;
}

public static class R7NativePrincipalIdentity
{
    // Reuse the existing process probe's native statistics AND complete bounded
    // privilege inventory. ModifiedId alone misses removals on some Windows.
    // A PID, SID, handle number or caller Boolean cannot supply this readback.
    // https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_statistics
    public static R7NativePrincipalStamp ObserveRetained(SafeAccessTokenHandle retained)
        => ObserveRetained(retained, R7NativeTokenStampKind.Primary);

    // This typed INTERNAL overload supplies metadata for retained thread tokens.
    // It never authenticates that token as the original writer/enrolled owner.
    internal static R7NativePrincipalStamp ObserveRetained(SafeAccessTokenHandle retained,
        R7NativeTokenStampKind kind)
    {
        if (!OperatingSystem.IsWindows() || retained is null || retained.IsInvalid || retained.IsClosed)
            return Unknown();
        try
        {
            var value = R7ProcessBoundWriteDenial.ReadStamp(retained, kind);
            // Object ID and logon session ID have distinct meanings. A newly
            // duplicated object can share a SID/logon session while differing
            // in object ID; duplicate HANDLEs to the same object do not.
            string identity = Digest("stephanos.r7.native-principal-object.v1\0"
                + value.TokenId.ToString("x16", CultureInfo.InvariantCulture) + ":"
                + value.AuthenticationId.ToString("x16", CultureInfo.InvariantCulture) + ":"
                + value.NativeType.ToString(CultureInfo.InvariantCulture));
            string mutation = Digest("stephanos.r7.native-principal-mutation.v1\0"
                + identity + ":" + value.ModifiedId.ToString("x16", CultureInfo.InvariantCulture)
                + ":" + value.GroupCount.ToString(CultureInfo.InvariantCulture)
                + ":" + value.PrivilegeCount.ToString(CultureInfo.InvariantCulture) + ":" + value.PrivilegeDigest
                + ":" + value.GroupInventoryDigest
                + (kind == R7NativeTokenStampKind.Impersonation
                    ? ":impersonation-level:" + value.ImpersonationLevel.ToString(CultureInfo.InvariantCulture) : ""));
            return new(true, value.NativeType, identity, mutation);
        }
        catch { return Unknown(); }
    }

    public static bool SameRetainedObjectAndState(R7NativePrincipalStamp first,
        R7NativePrincipalStamp second)
        => first is { NativeIdentityObserved: true } && second is { NativeIdentityObserved: true }
            && first.NativeType == second.NativeType && first.IdentityDigest == second.IdentityDigest
            && first.MutationDigest == second.MutationDigest;

    private static string Digest(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(value))).ToLowerInvariant();
    private static R7NativePrincipalStamp Unknown() => new(false, 0, "", "");
}
