using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Stephanos.OriginalR7CustodyWitness;

internal sealed record OriginalR7OwnerWorkflowObservation(
    string Classification, bool IssuerSignatureAuthenticated,
    bool CurrentNativeActorBound, string TokenDigest, string WorkflowSha, string RunId, string RunAttempt)
{
    internal bool PairedRunMatched { get; init; }
    internal bool OsPeerPairingDecisionAuthenticated { get; init; }
    // Authenticating an owner workflow is one input to a future adopted native
    // ceremony. Existing merge approval is deliberately not host adoption.
    internal bool HumanOsConsentProven => false;
    internal bool HostPolicyAdopted => false;
    internal bool ExecutorAdmitted => false;
    internal bool RootProvisioningAuthorized => false;
    internal bool PhysicalContainmentProven => false;
    internal bool LeaseReleaseAuthorized => false;
}

// Real issuer-signature intake for the existing protected-owner workflow.
// No production command/registration invokes this preparation. There is no
// first-root producer in the current merge workflow and no host permission can
// follow from this result. A reviewed explicit producer/adoption transition and
// independently admitted native OS ceremony are still required.
internal sealed class OriginalR7OwnerWorkflowAuthentication : IDisposable
{
    private const string Issuer = "https://token.actions.githubusercontent.com";
    private const string Repository = "Cheekyfellastef/stephan-os";
    private const string Workflow = Repository + "/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main";
    private const string Subject = "repo:" + Repository + ":environment:operator-merge-approval";
    private const string ImmutableSubject = "repo:Cheekyfellastef@267490109/stephan-os@1179385578:environment:operator-merge-approval";
    private readonly OriginalR7CommissioningOwnerObservation actor;
    private readonly OriginalR7OwnerOperationPurpose purpose;
    private readonly long opened = Stopwatch.GetTimestamp();
    private readonly DateTimeOffset issued = DateTimeOffset.UtcNow;
    private readonly string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private int terminal;
    private int issuerAuthenticated;

    private OriginalR7OwnerWorkflowAuthentication(OriginalR7CommissioningOwnerObservation actualActor,
        OriginalR7OwnerOperationPurpose operationPurpose)
    { actor = actualActor; purpose = operationPurpose; }

    internal DateTimeOffset SessionIssuedAtUtc => issued;

    internal bool HasCurrentUnclaimedNativeActor()
    {
        try { return Volatile.Read(ref terminal) == 0 && DateTimeOffset.UtcNow >= issued
            && DateTimeOffset.UtcNow - issued <= TimeSpan.FromMinutes(5)
            && Stopwatch.GetElapsedTime(opened) <= TimeSpan.FromMinutes(5)
            && SameNativeActor(OriginalR7CommissioningOwnerContext.ObserveCurrent()); }
        catch { return false; }
    }

    internal static OriginalR7OwnerWorkflowAuthentication BeginCurrentNativeOwner(
        OriginalR7OwnerOperationPurpose purpose = OriginalR7OwnerOperationPurpose.AuthenticatePeer)
    {
        _ = OriginalR7OwnerPeerPairing.AudiencePrefix(purpose);
        var actual = OriginalR7CommissioningOwnerContext.ObserveCurrent();
        if (!actual.NativeElevatedInteractiveContextObserved)
            throw new InvalidOperationException("R7_OWNER_WORKFLOW_NATIVE_OWNER_CONTEXT_REQUIRED");
        return new(actual, purpose);
    }

    // Only the retained session whose actual fixed-issuer verification completed
    // can remain current for its narrow in-process transaction. This accessor
    // neither consumes a caller observation nor adopts policy from a Boolean.
    internal OriginalR7CommissioningOwnerObservation RequireAuthenticatedCurrentActor()
    {
        if (Volatile.Read(ref terminal) != 1 || Volatile.Read(ref issuerAuthenticated) != 1 || DateTimeOffset.UtcNow < issued
            || DateTimeOffset.UtcNow - issued > TimeSpan.FromMinutes(5)
            || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
            || !SameNativeActor(OriginalR7CommissioningOwnerContext.ObserveCurrent()))
            throw new InvalidOperationException("R7_AUTHENTICATED_OWNER_NATIVE_CONTINUITY_REQUIRED");
        return actor;
    }

    // The purpose-bound challenge contains no key material. The native nonce
    // is never imported from a request or replayed into a different process.
    internal string ChallengeAudience(string exactPermitDigest, string recipientSpkiSha256)
    {
        if (Volatile.Read(ref terminal) != 0 || !Hex(exactPermitDigest, 64) || !Hex(recipientSpkiSha256, 64)) throw new InvalidOperationException("R7_OWNER_WORKFLOW_CHALLENGE_INVALID");
        if (Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
            || DateTimeOffset.UtcNow < issued || DateTimeOffset.UtcNow - issued > TimeSpan.FromMinutes(5))
        {
            Interlocked.Exchange(ref terminal, 1);
            throw new InvalidOperationException("R7_OWNER_WORKFLOW_CHALLENGE_EXPIRED");
        }
        return Audience(exactPermitDigest, nonce, recipientSpkiSha256);
    }

    internal async Task<OriginalR7OwnerWorkflowObservation> ObserveIssuerAsync(
        string untrustedToken, string exactPermitDigest, string expectedMain, string recipientSpkiSha256,
        string expectedPairedRunId, string expectedPairedRunAttempt)
    {
        // Claim before any await. Concurrent consumers cannot share a native
        // nonce or race the one-attempt boundary.
        if (Interlocked.CompareExchange(ref terminal, 1, 0) != 0) return Held("SESSION_TERMINAL");
        try
        {
            if (!PositiveDecimal(expectedPairedRunId) || expectedPairedRunAttempt != "1"
                || !Hex(exactPermitDigest, 64) || !Hex(expectedMain, 40) || !Hex(recipientSpkiSha256, 64)
                || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)) return Held("SESSION_EXPIRED_OR_UNBOUND");
            var before = OriginalR7CommissioningOwnerContext.ObserveCurrent();
            if (!SameNativeActor(before)) return Held("NATIVE_ACTOR_CHANGED");
            using var handler = new HttpClientHandler { AllowAutoRedirect = false,
                UseCookies = false, Credentials = null, UseDefaultCredentials = false };
            // OS certificate validation remains intact. No custom roots,
            // credential discovery, user URL or alternate JWKS is accepted.
            using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
            using var request = new HttpRequestMessage(HttpMethod.Get, Issuer + "/.well-known/jwks");
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentLength > 65536)
                return Held("ISSUER_KEYS_UNAVAILABLE");
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var bytes = new MemoryStream();
            byte[] block = new byte[4096];
            for (int count; (count = await stream.ReadAsync(block, deadline.Token)) != 0; )
            {
                if (bytes.Length + count > 65536) return Held("ISSUER_KEYS_BOUND");
                bytes.Write(block, 0, count);
            }
            DateTimeOffset now = DateTimeOffset.UtcNow;
            if (now < issued || now - issued > TimeSpan.FromMinutes(5)
                || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
                || !SameNativeActor(OriginalR7CommissioningOwnerContext.ObserveCurrent()))
                return Held("NATIVE_SESSION_CONTINUITY_LOST");
            var verified = VerifyCore(untrustedToken, bytes.ToArray(),
                Audience(exactPermitDigest, nonce, recipientSpkiSha256), expectedMain, issued, now,
                expectedPairedRunId, expectedPairedRunAttempt);
            if (Volatile.Read(ref terminal) != 1 || DateTimeOffset.UtcNow < issued
                || DateTimeOffset.UtcNow - issued > TimeSpan.FromMinutes(5)
                || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
                || !SameNativeActor(OriginalR7CommissioningOwnerContext.ObserveCurrent()))
                return Held("NATIVE_SESSION_CONTINUITY_LOST");
            if (verified.IssuerSignatureAuthenticated) Volatile.Write(ref issuerAuthenticated, 1);
            return verified with { CurrentNativeActorBound = verified.IssuerSignatureAuthenticated };
        }
        catch { return Held("ISSUER_OR_NATIVE_OBSERVATION_FAILED_CLOSED"); }
    }

    private bool SameNativeActor(OriginalR7CommissioningOwnerObservation current)
        => current.NativeElevatedInteractiveContextObserved && current.ProcessId == actor.ProcessId
            && current.CreationFileTimeUtc == actor.CreationFileTimeUtc && current.CurrentSid == actor.CurrentSid
            && current.SessionId == actor.SessionId
            && current.NativePrincipalIdentityDigest == actor.NativePrincipalIdentityDigest
            && current.NativePrincipalMutationDigest == actor.NativePrincipalMutationDigest;

    // Synthetic issuer keys are accepted only by this internal fixture seam.
    // Its result never binds a native actor, adopts policy or authorizes roots.
    internal static OriginalR7OwnerWorkflowObservation VerifyUntrustedFixture(
        string token, byte[] fixtureJwks, string expectedAudience, string expectedMain,
        DateTimeOffset challengeIssued, DateTimeOffset now)
        => VerifyCore(token, fixtureJwks, expectedAudience, expectedMain, challengeIssued, now);

    internal static OriginalR7OwnerWorkflowObservation VerifyPairedRunUntrustedFixture(
        string token, byte[] fixtureJwks, string expectedAudience, string expectedMain,
        DateTimeOffset challengeIssued, DateTimeOffset now, string expectedRunId, string expectedRunAttempt)
        => !PositiveDecimal(expectedRunId) || expectedRunAttempt != "1" ? Held("PAIRED_RUN_EXPECTATION_INVALID")
            : VerifyCore(token, fixtureJwks, expectedAudience, expectedMain, challengeIssued, now, expectedRunId, expectedRunAttempt);

    private static OriginalR7OwnerWorkflowObservation VerifyCore(string token, byte[] jwks,
        string audience, string expectedMain, DateTimeOffset challengeIssued, DateTimeOffset now,
        string? expectedRunId = null, string? expectedRunAttempt = null)
    {
        try
        {
            if (token is null || token.Length is < 32 or > 32768 || token.Any(c => c > 127)
                || jwks.Length is < 16 or > 65536 || !Hex(expectedMain, 40)
                || now < challengeIssued || now - challengeIssued > TimeSpan.FromMinutes(5))
                return Held("TOKEN_OR_SESSION_BOUND");
            string[] parts = token.Split('.');
            if (parts.Length != 3) return Held("COMPACT_JWS_REQUIRED");
            using var header = JsonDocument.Parse(Decode(parts[0]), new() { MaxDepth = 2 });
            using var payload = JsonDocument.Parse(Decode(parts[1]), new() { MaxDepth = 4 });
            using var keys = JsonDocument.Parse(jwks, new() { MaxDepth = 4 });
            JsonElement h = header.RootElement, p = payload.RootElement;
            if (!UniqueObject(h) || !UniqueObject(p) || !UniqueObject(keys.RootElement)
                || h.EnumerateObject().Any(x => x.Name is not ("alg" or "kid" or "typ" or "x5t"))
                || S(h, "alg") != "RS256" || S(h, "typ") != "JWT") return Held("JWS_HEADER_OR_DUPLICATE");
            // GitHub documents this optional certificate hint. It is bounded
            // opaque metadata only: never a trust anchor or key/URL selector.
            if (h.TryGetProperty("x5t", out var thumbprint))
            {
                string hint = thumbprint.GetString() ?? "";
                if (hint.Length is < 1 or > 128
                    || hint.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
                    return Held("CERTIFICATE_HINT_BOUND");
            }
            string kid = S(h, "kid");
            if (kid.Length is < 1 or > 128 || kid.Any(c => c < 33 || c > 126)) return Held("KEY_ID_BOUND");
            JsonElement list = keys.RootElement.GetProperty("keys");
            if (list.ValueKind != JsonValueKind.Array || list.GetArrayLength() is < 1 or > 16)
                return Held("ISSUER_KEY_SET_BOUND");
            if (list.EnumerateArray().Any(x => !UniqueObject(x))) return Held("ISSUER_KEY_OBJECT_INVALID");
            var matching = list.EnumerateArray().Where(x => S(x, "kid") == kid).ToArray();
            if (matching.Length != 1) return Held("ISSUER_KEY_NOT_UNIQUE");
            var key = matching[0];
            if (S(key, "kty") != "RSA" || S(key, "use") != "sig" || S(key, "alg") != "RS256"
                || S(key, "e") != "AQAB") return Held("ISSUER_KEY_PARAMETERS");
            byte[] modulus = Decode(S(key, "n")), signature = Decode(parts[2]);
            if (modulus.Length is < 256 or > 512 || modulus[0] < 128 || signature.Length != modulus.Length)
                return Held("RSA_SIZE_OR_ENCODING");
            using RSA rsa = RSA.Create();
            rsa.ImportParameters(new() { Modulus = modulus, Exponent = new byte[] { 1, 0, 1 } });
            if (!rsa.VerifyData(Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]), signature,
                HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) return Held("ISSUER_SIGNATURE_INVALID");
            if (S(p, "iss") != Issuer || S(p, "aud") != audience
                || (S(p, "sub") != Subject && S(p, "sub") != ImmutableSubject)
                || S(p, "repository") != Repository || S(p, "repository_id") != "1179385578"
                || S(p, "repository_owner_id") != "267490109" || S(p, "actor_id") != "267490109"
                || S(p, "workflow_ref") != Workflow || S(p, "workflow_sha") != expectedMain
                || S(p, "sha") != expectedMain || S(p, "ref") != "refs/heads/main"
                || S(p, "ref_type") != "branch" || S(p, "event_name") != "workflow_dispatch"
                || S(p, "runner_environment") != "github-hosted") return Held("OWNER_WORKFLOW_BINDING_MISMATCH");
            if (p.TryGetProperty("environment", out var environment)
                && environment.GetString() != "operator-merge-approval") return Held("ENVIRONMENT_MISMATCH");
            long iat = p.GetProperty("iat").GetInt64(), nbf = p.GetProperty("nbf").GetInt64(), exp = p.GetProperty("exp").GetInt64();
            long clock = now.ToUnixTimeSeconds();
            if (iat < challengeIssued.ToUnixTimeSeconds() || iat > clock || nbf > clock || nbf > iat
                || exp <= clock || exp <= iat || exp - iat > 300 || clock - iat > 300)
                return Held("TOKEN_FRESHNESS_UNPROVEN");
            string run = S(p, "run_id"), attempt = S(p, "run_attempt"), jti = S(p, "jti");
            if (!PositiveDecimal(run) || !PositiveDecimal(attempt) || jti.Length is < 8 or > 128
                || jti.Any(c => c < 33 || c > 126)) return Held("RUN_OR_REPLAY_ID_INVALID");
            if (expectedRunId is not null && (run != expectedRunId || attempt != expectedRunAttempt))
                return Held("SIGNED_RUN_DIFFERS_FROM_PAIRED_NATIVE_DECISION");
            return new("R7_OWNER_WORKFLOW_SIGNATURE_OBSERVED_NOT_HOST_ADOPTION", true, false,
                Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token))).ToLowerInvariant(), expectedMain, run, attempt)
                { PairedRunMatched = expectedRunId is not null };
        }
        catch { return Held("TOKEN_INVALID_FAILED_CLOSED"); }
    }

    private static bool UniqueObject(JsonElement value)
        => value.ValueKind == JsonValueKind.Object
            && value.EnumerateObject().Select(x => x.Name).Distinct(StringComparer.Ordinal).Count() == value.EnumerateObject().Count();
    private static string S(JsonElement value, string key) => value.GetProperty(key).GetString() ?? "";
    private static bool PositiveDecimal(string value) => value.Length is >= 1 and <= 20 && value[0] is >= '1' and <= '9'
        && value.All(char.IsAsciiDigit) && ulong.TryParse(value, System.Globalization.NumberStyles.None,
            System.Globalization.CultureInfo.InvariantCulture, out ulong number) && number > 0;
    private static bool Hex(string value, int length) => value is not null && value.Length == length && value.Any(c => c != '0')
        && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private string Audience(string digest, string challenge, string recipientSpkiSha256)
        => OriginalR7OwnerPeerPairing.AudiencePrefix(purpose) + digest + ":" + challenge + ":" + recipientSpkiSha256;
    private static byte[] Decode(string value)
    {
        if (value.Length is < 1 or > 24576 || value.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
            throw new InvalidOperationException("R7_OWNER_WORKFLOW_BASE64URL_INVALID");
        byte[] decoded = Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
        if (Convert.ToBase64String(decoded).TrimEnd('=').Replace('+', '-').Replace('/', '_') != value)
            throw new InvalidOperationException("R7_OWNER_WORKFLOW_BASE64URL_NONCANONICAL");
        return decoded;
    }
    private static OriginalR7OwnerWorkflowObservation Held(string code) => new("R7_OWNER_WORKFLOW_" + code, false, false, "", "", "", "");
    public void Dispose() { Interlocked.Exchange(ref terminal, 2); }
}
