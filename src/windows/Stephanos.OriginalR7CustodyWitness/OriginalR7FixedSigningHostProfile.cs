using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stephanos.OriginalR7CustodyWitness;

internal sealed record OriginalR7FixedSigningProfileCandidate(
    string SourceHead, string BaseSha, string TreeSha, string ImageSha256,
    string OriginalLeaseDigest, string SourceExecutionId, string WorktreePath,
    string WorktreeNativeIdentityDigest, string WitnessSid, string OperatorSid,
    string ExecutorSid, string[] SourcePrincipalSids,
    string WitnessKeySpkiSha256, string OperatorKeySpkiSha256,
    string CommissioningRootSpkiSha256, string PolicyProposalDigest,
    string IssuedAtUtc, string ExpiresAtUtc)
{
    internal bool PolicyAdopted => false;
    internal bool ActualPrincipalEnrollmentProven => false;
    internal bool ProductionKeyAccessAllowed => false;
}

internal sealed record OriginalR7FirstRootCeremonyPlan(
    string Classification, string CandidateDigest, int RequiredIndependentKeyCount,
    bool OperatorMayBeExecutor, bool OperatorRootMayCommissionWitness,
    string[] FixedLocationIds)
{
    internal bool PreExistingThirdRootRequired => false;
    internal bool ActualProtectedOwnerOsConsentRequired => true;
    internal bool ExactSourceReviewAndProtectedApprovalRequired => true;
    internal bool ActualSourcePrincipalIsolationRequired => true;
    internal bool KeyCreationExecuted => false;
    internal bool RootTrustEnrolled => false;
    internal bool HostExecutionAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

internal sealed record OriginalR7SigningContextObservation(string Classification, bool NativeContextObserved)
{
    internal bool AuthenticatedRepositoryOwner => false;
    internal bool AdoptedPolicyProven => false;
    internal bool CompleteNativeCustodyProven => false;
    internal bool ProductionKeyAccessAllowed => false;
}

// Fixed-profile definition and actual kernel-context observation, not a new
// privileged lane. No path/command/key arguments come from this proposal.
// A first-root ceremony can be reviewed under actual protected owner/OS
// authentication without demanding a circular third pre-existing signing root.
// This class never performs that ceremony or treats its candidate as adopted.
internal static class OriginalR7FixedSigningHostProfile
{
    private static readonly string[] Keys = {
        "schemaVersion", "state", "repository", "leaseId", "revision", "serviceName",
        "sourceHead", "baseSha", "treeSha", "imageSha256", "originalLeaseDigest",
        "sourceExecutionId", "worktreePath", "worktreeNativeIdentityDigest",
        "witnessSid", "operatorSid", "executorSid", "sourcePrincipalSids",
        "witnessKeySpkiSha256", "operatorKeySpkiSha256", "commissioningRootSpkiSha256",
        "policyProposalDigest", "providerVersion", "providerNet6Sha256", "issuedAtUtc", "expiresAtUtc"
    };
    private static readonly UTF8Encoding Utf8 = new(false, true);

    internal static OriginalR7FixedSigningProfileCandidate ParseCandidate(string wire, DateTimeOffset now)
    {
        try
        {
            if (wire is null || Utf8.GetByteCount(wire) > 8192 || wire.Any(c => c > 0x7f))
                throw Held("CANDIDATE_BOUND");
            using JsonDocument document = JsonDocument.Parse(wire, new() { MaxDepth = 3 });
            JsonElement value = document.RootElement;
            if (value.ValueKind != JsonValueKind.Object) throw Held("CANDIDATE_OBJECT");
            HashSet<string> seen = new(StringComparer.Ordinal);
            foreach (JsonProperty property in value.EnumerateObject())
                if (!seen.Add(property.Name) || !Keys.Contains(property.Name)) throw Held("CANDIDATE_CLOSED_WORLD");
            if (seen.Count != Keys.Length) throw Held("CANDIDATE_FIELDS");
            string S(string name) => value.GetProperty(name).GetString() ?? throw Held("CANDIDATE_VALUE");
            if (S("schemaVersion") != "stephanos.r7-fixed-signing-host-profile-candidate.v1"
                || S("state") != "UNADOPTED_PREPARATION_ONLY"
                || S("repository") != "Cheekyfellastef/stephan-os"
                || S("leaseId") != "critical-2962-elastic-goal-r7-lease"
                || value.GetProperty("revision").GetInt32() != 7
                || S("serviceName") != "StephanosOriginalR7CustodyWitness"
                || S("providerVersion") != OriginalR7SigningPrimitives.PackageVersion
                || S("providerNet6Sha256") != OriginalR7SigningPrimitives.PublisherNet6Sha256)
                throw Held("CANDIDATE_FIXED_IDENTITY");
            foreach (string name in new[] { "sourceHead", "baseSha", "treeSha" })
                if (!Hex(S(name), 40)) throw Held("CANDIDATE_SOURCE");
            foreach (string name in new[] { "imageSha256", "originalLeaseDigest", "worktreeNativeIdentityDigest",
                "witnessKeySpkiSha256", "operatorKeySpkiSha256", "commissioningRootSpkiSha256", "policyProposalDigest" })
                if (!Hex(S(name), 64) || S(name) == new string('0', 64)) throw Held("CANDIDATE_DIGEST");
            if (S("sourceHead") == S("baseSha")
                || !Regex.IsMatch(S("sourceExecutionId"), "\\Acritical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}\\z")
                || !SafeWorktree(S("worktreePath"))) throw Held("CANDIDATE_SOURCE_BINDING");
            string witness = Sid(S("witnessSid")), op = Sid(S("operatorSid")), executor = Sid(S("executorSid"));
            if (!Regex.IsMatch(witness, "\\AS-1-5-80-(?:[0-9]+-){4}[0-9]+\\z")
                || witness == op || witness == executor || S("witnessKeySpkiSha256") == S("operatorKeySpkiSha256")
                || S("commissioningRootSpkiSha256") == S("witnessKeySpkiSha256"))
                throw Held("CANDIDATE_WITNESS_OPERATOR_SEPARATION");
            JsonElement list = value.GetProperty("sourcePrincipalSids");
            if (list.ValueKind != JsonValueKind.Array || list.GetArrayLength() is < 1 or > 16)
                throw Held("CANDIDATE_SOURCE_PRINCIPALS");
            string[] principals = list.EnumerateArray().Select(item => Sid(item.GetString() ?? "")).ToArray();
            if (principals.Distinct(StringComparer.Ordinal).Count() != principals.Length
                || principals.Contains(witness) || principals.Contains(op) || principals.Contains(executor))
                throw Held("CANDIDATE_SOURCE_PRINCIPAL_SEPARATION");
            DateTimeOffset issued = Time(S("issuedAtUtc")), expires = Time(S("expiresAtUtc"));
            if (issued > now || expires <= now || expires <= issued || expires - issued > TimeSpan.FromMinutes(5))
                throw Held("CANDIDATE_VALIDITY");
            return new(S("sourceHead"), S("baseSha"), S("treeSha"), S("imageSha256"), S("originalLeaseDigest"),
                S("sourceExecutionId"), S("worktreePath"), S("worktreeNativeIdentityDigest"),
                witness, op, executor, principals, S("witnessKeySpkiSha256"), S("operatorKeySpkiSha256"),
                S("commissioningRootSpkiSha256"), S("policyProposalDigest"), S("issuedAtUtc"), S("expiresAtUtc"));
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("R7_SIGNING_PROFILE_", StringComparison.Ordinal)) { throw; }
        catch { throw Held("CANDIDATE_INVALID"); }
    }

    internal static OriginalR7FirstRootCeremonyPlan PlanFirstRootCeremony(OriginalR7FixedSigningProfileCandidate candidate)
    {
        if (candidate is null) throw Held("CANDIDATE_REQUIRED");
        // This is a plan, not an authority capability. Revalidate a freshly
        // decoded candidate through ParseCandidate at any real future intake.
        string digest = Convert.ToHexString(SHA256.HashData(Utf8.GetBytes(
            JsonSerializer.Serialize(candidate)))).ToLowerInvariant();
        return new("FIRST_ROOT_CEREMONY_PROPOSED_NOT_AUTHORIZED", digest, 2,
            candidate.ExecutorSid == candidate.OperatorSid,
            candidate.CommissioningRootSpkiSha256 == candidate.OperatorKeySpkiSha256,
            new[] {
                "PROGRAMDATA_FIXED_WITNESS_PRIVATE_SEED",
                "PROGRAMDATA_SEPARATE_OPERATOR_PRIVATE_SEED",
                "FIXED_PROTECTED_HKLM_PUBLIC_PINS",
                "FIXED_PROTECTED_AUDIT_AND_REPLAY_STATE"
            });
    }

    internal static OriginalR7SigningContextObservation ObserveCurrentWitnessContext()
    {
        if (!OperatingSystem.IsWindows()) return new("R7_SIGNING_WINDOWS_REQUIRED", false);
        if (Environment.UserInteractive || Process.GetCurrentProcess().SessionId != 0)
            return new("R7_SIGNING_SESSION0_SERVICE_CONTEXT_REQUIRED", false);
        try
        {
            using WindowsIdentity identity = WindowsIdentity.GetCurrent();
            WindowsPrincipal principal = new(identity);
            if (identity.IsSystem || principal.IsInRole(WindowsBuiltInRole.Administrator))
                return new("R7_SIGNING_LEAST_PRIVILEGE_SERVICE_REQUIRED", false);
            SecurityIdentifier expected = (SecurityIdentifier)new NTAccount("NT SERVICE",
                "StephanosOriginalR7CustodyWitness").Translate(typeof(SecurityIdentifier));
            if (identity.User?.Equals(expected) != true || !principal.IsInRole(expected))
                return new("R7_SIGNING_FIXED_SERVICE_IDENTITY_UNPROVEN", false);
            return new("R7_SIGNING_NATIVE_CONTEXT_ONLY_NOT_ADOPTION", true);
        }
        catch { return new("R7_SIGNING_CONTEXT_UNOBSERVABLE", false); }
    }

    // No positive production signer is exported. Current native receipts are
    // bounded observations and have PhysicalContainmentProven fixed false.
    // They cannot be relabeled as complete custody by a profile or test key.
    internal static OriginalR7SigningContextObservation PreflightProductionWitness(
        OriginalR7ObservationReceipt? observation, OriginalR7FixedSigningProfileCandidate? candidate)
    {
        if (observation is null || candidate is null)
            return new("R7_SIGNING_ADOPTED_POLICY_AND_COMPLETE_NATIVE_EVIDENCE_REQUIRED", false);
        if (!candidate.PolicyAdopted || !observation.PhysicalContainmentProven)
            return new("R7_SIGNING_UNADOPTED_OR_OBSERVATION_ONLY", false);
        // Remains unavailable until a real admitted-policy verifier and complete
        // native custody capability replace proposal/diagnostic inputs. No
        // caller boolean, signature or source-review receipt may reach key I/O.
        return new("R7_SIGNING_PRODUCTION_CAPABILITY_NOT_IMPLEMENTED", false);
    }

    private static string Sid(string value)
        => new SecurityIdentifier(value).Value == value ? value : throw Held("SID_NONCANONICAL");
    private static bool Hex(string value, int n) => value.Length == n && value.Any(c => c != '0')
        && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static bool SafeWorktree(string p)
    {
        if (p.Length is < 4 or > 240 || !char.IsAsciiLetter(p[0]) || p[1] != ':' || p[2] != '\\'
            || p.Contains('/') || p.Contains('\0') || p.AsSpan(2).Contains(':')
            || p.Any(c => c < 0x20 || c >= 0x7f)
            || !String.Equals(Path.GetFullPath(p), p, StringComparison.OrdinalIgnoreCase)) return false;
        return p.Split('\\').Skip(1).All(s => s.Length > 0 && s is not "." and not ".."
            && !s.EndsWith('.') && !s.EndsWith(' ') && !s.Any(c => "<>\"|?*".Contains(c)));
    }
    private static DateTimeOffset Time(string value)
    {
        if (!DateTimeOffset.TryParseExact(value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out DateTimeOffset result)) throw Held("TIME_FORMAT");
        return result;
    }
    private static InvalidOperationException Held(string code) => new("R7_SIGNING_PROFILE_" + code);
}
