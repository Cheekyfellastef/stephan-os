using System;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

namespace Stephanos.OriginalR7CustodyWitness;

// A real kernel access-open probe using an externally retained Windows token.
// Neither the caller-supplied SID nor an observed denial authenticates the
// historic #2962/r7 principal, excludes existing writable handles, or grants
// signer/lease authority. No production token acquisition exists in this host.
internal sealed record OriginalR7WriterAccessObservation(
    string Classification,
    bool OneTargetNegativeWriteProbeObserved,
    bool TargetIdentityStable,
    bool SuppliedSidMatched,
    bool OriginalPrincipalProvenanceAuthenticated,
    bool WholeSourceAndRelaunchExcluded,
    bool ProtectedAuditVerified,
    bool SigningAuthorityGranted,
    bool LeaseReleaseAuthorized);

internal static class OriginalR7WriterAccessPreflight
{
    private static OriginalR7WriterAccessObservation Held(
        string reason,
        bool oneTargetDenied = false,
        bool stable = false,
        bool sidMatched = false) => new(
            reason, oneTargetDenied, stable, sidMatched,
            false, false, false, false, false);

    // Exact native mechanism shared with the DACL/writer-exclusion test
    // project. Caller must provide the unmodified OS handle acquired and
    // authenticated by an independent protected Windows security owner.
    // The witness service intentionally has NO way to obtain that handle
    // from a GitHub command, ordinary Core/OpenClaw, a claimed SID, or CI.
    internal static OriginalR7WriterAccessObservation ObserveSingleTarget(
        string targetPath, SafeAccessTokenHandle originalToken, string expectedOriginalSid)
    {
        if (!OperatingSystem.IsWindows()
            || string.IsNullOrWhiteSpace(targetPath)
            || string.IsNullOrWhiteSpace(expectedOriginalSid)
            || originalToken is null || originalToken.IsInvalid || originalToken.IsClosed)
            return Held("R7_WRITER_ACCESS_PROBE_INPUT_UNAVAILABLE");
        try
        {
            R7EffectiveWriteObservation observed =
                R7EffectiveWriteDenial.Observe(targetPath, originalToken, expectedOriginalSid);
            bool singleTargetDenied =
                observed.Classification == "R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY"
                && observed.SuppliedTokenSidMatched
                && observed.DataWriteOpenDenied
                && observed.DaclWriteOpenDenied
                && observed.OwnerWriteOpenDenied
                && observed.TargetIdentityStable
                && !observed.SuppliedPrincipalOwnsTarget
                && !observed.TokenHasBypassAuthority;
            // This covers only ONE retained target and ONE unmodified token.
            // Further native original principal/handle/re-entry authentication,
            // scope enumeration, continuous audit and outside-repo signer are
            // separate independently administered commissioning operations.
            return Held(singleTargetDenied
                ? "R7_ONE_TARGET_OPEN_DENIAL_OBSERVED_NOT_CUSTODY"
                : "R7_WRITER_ACCESS_PROBE_HELD_" + SafeReason(observed.Classification),
                oneTargetDenied: singleTargetDenied,
                stable: observed.TargetIdentityStable,
                sidMatched: observed.SuppliedTokenSidMatched);
        }
        catch
        {
            // Never return SID, path, process token or exception text.
            return Held("R7_WRITER_ACCESS_PROBE_UNAVAILABLE");
        }
    }

    private static string SafeReason(string reason) => reason switch
    {
        "R7_NATIVE_SUPPLIED_TOKEN_UNAVAILABLE" => "TOKEN_UNAVAILABLE",
        "R7_NATIVE_FILTERED_OR_SPECIAL_TOKEN_UNQUALIFIED" => "TOKEN_UNQUALIFIED",
        "R7_NATIVE_SUPPLIED_TOKEN_IDENTITY_MISMATCH" => "SID_MISMATCH",
        "R7_NATIVE_TARGET_NONCANONICAL_OR_UNAVAILABLE" => "TARGET_UNAVAILABLE",
        "R7_NATIVE_TARGET_OWNER_UNAVAILABLE" => "OWNER_UNKNOWN",
        "R7_NATIVE_TARGET_CHANGED" => "TARGET_CHANGED",
        "R7_NATIVE_ACCESS_RESULT_UNKNOWN" => "ACCESS_UNKNOWN",
        "R7_NATIVE_SUPPLIED_TOKEN_CAN_WRITE" => "STILL_WRITABLE",
        "R7_NATIVE_DATA_DENIED_BUT_SUPPLIED_PRINCIPAL_OWNS_TARGET" => "WRITER_OWNS_TARGET",
        "R7_NATIVE_DATA_DENIED_BUT_TOKEN_CAN_BYPASS_POLICY" => "TOKEN_BYPASS",
        "R7_NATIVE_POLICY_REWRITE_NOT_DENIED" => "POLICY_REWRITE_POSSIBLE",
        _ => "UNKNOWN",
    };
}
