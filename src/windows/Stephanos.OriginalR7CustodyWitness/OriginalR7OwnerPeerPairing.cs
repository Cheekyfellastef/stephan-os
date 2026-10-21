using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Stephanos.OriginalR7CustodyWitness;

// Canonical public pairing intent only. This object cannot serve as an OS
// decision, owner enrollment, adopted policy or a permission to access keys.
internal sealed record OriginalR7OwnerPeerTranscript(string Wire, string Fingerprint,
    string ApprovalComment, string RunUrl, string ExpectedMain, string RunId,
    string RunAttempt, string PermitSha256, string NativeAudience,
    string NativeIssuedAtUtc, string NativeExpiresAtUtc)
{
    internal bool NativeEndpointAuthenticated => false;
    internal bool OwnerEnrollmentAuthenticated => false;
    internal bool OsConsentProven => false;
    internal bool HostPolicyAdopted => false;
    internal bool RootEnrollmentAuthorized => false;
    internal bool CanonicalLeaseReleaseAuthorized => false;
}

internal static class OriginalR7OwnerPeerPairing
{
    internal const string Schema = "stephanos.r7-native-owner-peer-pairing.v1";
    internal const string Domain = "stephanos.r7.native-owner-peer-pairing.v1\0";
    internal const string Purpose = "ENROLL_EPHEMERAL_R7_OWNER_POLICY_PEER_ONLY";
    internal const string Repository = "Cheekyfellastef/stephan-os";
    internal const string Workflow = Repository + "/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main";

    internal static OriginalR7OwnerPeerTranscript PrepareCurrent(
        OriginalR7OwnerEnvelopeTransport retainedSession, string expectedMain, string runId, string runAttempt)
        => Build(retainedSession.PublicChallenge(), expectedMain, runId, runAttempt,
            DateTimeOffset.UtcNow, null);

    // Public RSA/test windows only. No native private session is bound and no
    // fresh OS/owner decision can be produced through this fixture seam.
    internal static OriginalR7OwnerPeerTranscript BuildUntrustedFixture(
        OriginalR7OwnerTransportChallenge publicChallenge, string expectedMain, string runId,
        string runAttempt, DateTimeOffset fixtureNow, string? exactPermitSha256 = null)
        => Build(publicChallenge, expectedMain, runId, runAttempt, fixtureNow, exactPermitSha256);

    private static OriginalR7OwnerPeerTranscript Build(OriginalR7OwnerTransportChallenge challenge,
        string expectedMain, string runId, string runAttempt, DateTimeOffset now, string? expectedPermit)
    {
        if (!Hex(expectedMain, 40) || !DecimalId(runId) || runAttempt != "1") throw Invalid();
        using RSA publicRecipient = OriginalR7OwnerEnvelopeTransport.ImportChallengeRecipient(challenge, now);
        const string prefix = "stephanos:r7:first-root-owner-permit:v1:";
        string permit = challenge.Audience[prefix.Length..].Split(':')[0];
        if (expectedPermit is not null && (!Hex(expectedPermit, 64) || permit != expectedPermit)) throw Invalid();
        using MemoryStream bytes = new();
        using (var writer = new Utf8JsonWriter(bytes, new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            writer.WriteStartObject();
            writer.WriteString("schemaVersion", Schema);
            writer.WriteString("purpose", Purpose);
            writer.WriteString("repository", Repository);
            writer.WriteString("workflowRef", Workflow);
            writer.WriteString("expectedMain", expectedMain);
            writer.WriteString("runId", runId);
            writer.WriteString("runAttempt", runAttempt);
            writer.WriteString("permitSha256", permit);
            writer.WriteString("nativeAudience", challenge.Audience);
            writer.WriteString("nativeRecipientSpkiSha256", challenge.PublicSpkiSha256);
            writer.WriteString("nativeIssuedAtUtc", challenge.IssuedAtUtc);
            writer.WriteString("nativeExpiresAtUtc", challenge.ExpiresAtUtc);
            writer.WriteEndObject();
        }
        byte[] wire = bytes.ToArray();
        if (wire.Length > 12288 || wire.Any(b => b > 127)) throw Invalid();
        using IncrementalHash digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        digest.AppendData(Encoding.ASCII.GetBytes(Domain));
        digest.AppendData(wire);
        string fingerprint = Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant();
        return new(Encoding.UTF8.GetString(wire), fingerprint, Purpose + ":" + fingerprint,
            "https://github.com/" + Repository + "/actions/runs/" + runId + "/attempts/1",
            expectedMain, runId, runAttempt, permit, challenge.Audience,
            challenge.IssuedAtUtc, challenge.ExpiresAtUtc);
    }

    private static bool Hex(string value, int bytes) => value is not null && value.Length == bytes
        && value.Any(c => c != '0') && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static bool DecimalId(string value) => value is { Length: >= 1 and <= 20 } && value[0] is >= '1' and <= '9'
        && value.All(char.IsAsciiDigit) && ulong.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out ulong id) && id != 0;
    private static InvalidOperationException Invalid() => new("R7_NATIVE_OWNER_PEER_PAIRING_BINDING_INVALID");
}
