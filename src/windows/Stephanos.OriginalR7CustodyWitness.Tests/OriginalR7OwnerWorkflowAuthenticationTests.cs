using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Stephanos.OriginalR7CustodyWitness;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7OwnerWorkflowAuthenticationTests
{
    private static int total;
    private static void Check(bool ok, string code)
    { total++; if (!ok) throw new InvalidOperationException("R7_OWNER_WORKFLOW_FIXTURE_FAILED_" + code); }
    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    internal static int Run()
    {
        using RSA issuer = RSA.Create(2048); // Disposable fixture issuer, never GitHub trust.
        var parameters = issuer.ExportParameters(false);
        var now = DateTimeOffset.Parse("2026-10-21T18:00:00Z", System.Globalization.CultureInfo.InvariantCulture);
        string sha = new('a', 40), audience = "stephanos:r7:first-root-owner-permit:v1:" + new string('b', 64) + ":" + new string('c', 64) + ":" + new string('d', 64);
        var header = new Dictionary<string, object> { ["alg"] = "RS256", ["kid"] = "fixture-issuer", ["typ"] = "JWT" };
        var key = new Dictionary<string, object> { ["kty"] = "RSA", ["use"] = "sig", ["alg"] = "RS256",
            ["kid"] = "fixture-issuer", ["n"] = B64(parameters.Modulus!), ["e"] = B64(parameters.Exponent!) };
        var claims = new Dictionary<string, object> {
            ["iss"] = "https://token.actions.githubusercontent.com", ["aud"] = audience,
            ["sub"] = "repo:Cheekyfellastef/stephan-os:environment:operator-merge-approval",
            ["repository"] = "Cheekyfellastef/stephan-os", ["repository_id"] = "1179385578",
            ["repository_owner_id"] = "267490109", ["actor_id"] = "267490109",
            ["workflow_ref"] = "Cheekyfellastef/stephan-os/.github/workflows/operator-merge-approval-gate.yml@refs/heads/main",
            ["workflow_sha"] = sha, ["sha"] = sha, ["ref"] = "refs/heads/main", ["ref_type"] = "branch",
            ["event_name"] = "workflow_dispatch", ["runner_environment"] = "github-hosted",
            ["environment"] = "operator-merge-approval", ["run_id"] = "123456789", ["run_attempt"] = "2",
            ["jti"] = "disposable-fixture-token-id", ["iat"] = now.ToUnixTimeSeconds(),
            ["nbf"] = now.ToUnixTimeSeconds(), ["exp"] = now.ToUnixTimeSeconds() + 120,
        };
        string Token(Dictionary<string, object> value, string? rawHeader = null, string? rawPayload = null)
        {
            string signed = B64(Encoding.UTF8.GetBytes(rawHeader ?? JsonSerializer.Serialize(header))) + "."
                + B64(Encoding.UTF8.GetBytes(rawPayload ?? JsonSerializer.Serialize(value)));
            return signed + "." + B64(issuer.SignData(Encoding.ASCII.GetBytes(signed), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        }
        byte[] Keys(params Dictionary<string, object>[] values) => JsonSerializer.SerializeToUtf8Bytes(new { keys = values });
        OriginalR7OwnerWorkflowObservation Verify(string token, byte[]? jwks = null, string? aud = null,
            DateTimeOffset? challenge = null, DateTimeOffset? clock = null, string? main = null)
            => OriginalR7OwnerWorkflowAuthentication.VerifyUntrustedFixture(token, jwks ?? Keys(key),
                aud ?? audience, main ?? sha, challenge ?? now, clock ?? now);
        void NoAuthority(OriginalR7OwnerWorkflowObservation result)
        {
            Check(!result.CurrentNativeActorBound && !result.HumanOsConsentProven && !result.HostPolicyAdopted
                && !result.ExecutorAdmitted && !result.RootProvisioningAuthorized && !result.PhysicalContainmentProven
                && !result.LeaseReleaseAuthorized, "NO_FIXTURE_NATIVE_OR_HOST_AUTHORITY");
        }
        void Reject(OriginalR7OwnerWorkflowObservation result, string code)
        { Check(!result.IssuerSignatureAuthenticated, code); NoAuthority(result); }
        string good = Token(claims);
        var valid = Verify(good);
        Check(valid.IssuerSignatureAuthenticated && valid.WorkflowSha == sha && valid.RunId == "123456789"
            && valid.RunAttempt == "2" && valid.TokenDigest.Length == 64, "REAL_RSA_FIXTURE_SIGNATURE_BOUND");
        NoAuthority(valid);
        var pairedClaims = new Dictionary<string, object>(claims) { ["run_attempt"] = "1" };
        OriginalR7OwnerWorkflowObservation VerifyPaired(Dictionary<string, object> value,
            string expectedRun = "123456789", string expectedAttempt = "1")
            => OriginalR7OwnerWorkflowAuthentication.VerifyPairedRunUntrustedFixture(Token(value), Keys(key),
                audience, sha, now, now, expectedRun, expectedAttempt);
        var pairedValid = VerifyPaired(pairedClaims);
        Check(pairedValid.IssuerSignatureAuthenticated && pairedValid.PairedRunMatched
            && !pairedValid.OsPeerPairingDecisionAuthenticated, "EXACT_PAIRED_SIGNED_RUN_ONLY_NOT_OS_CONSENT");
        NoAuthority(pairedValid);
        Reject(VerifyPaired(new(pairedClaims) { ["run_id"] = "123456790" }), "OTHER_VALID_SIGNED_OWNER_RUN_REJECTED");
        Reject(VerifyPaired(new(pairedClaims) { ["run_attempt"] = "2" }), "SIGNED_RERUN_NOT_FRESH_FIRST_PAIRING");
        foreach (string invalid in new[] { "0", "01", "123456789 ", "18446744073709551616" })
            Reject(VerifyPaired(pairedClaims, invalid), "PAIRED_RUN_EXPECTATION_MUST_BE_CANONICAL");
        Reject(VerifyPaired(pairedClaims, expectedAttempt: "2"), "NO_SECOND_ATTEMPT_NATIVE_ENROLLMENT");
        Reject(Verify(good, aud: audience[..^64] + new string('e', 64)), "SIGNED_AUDIENCE_BINDS_RECIPIENT_SPKI_DIGEST");
        var immutable = new Dictionary<string, object>(claims) {
            ["sub"] = "repo:Cheekyfellastef@267490109/stephan-os@1179385578:environment:operator-merge-approval"
        };
        var immutableResult = Verify(Token(immutable));
        Check(immutableResult.IssuerSignatureAuthenticated, "FIXED_IMMUTABLE_OWNER_AND_REPOSITORY_SUBJECT_SUPPORTED");
        NoAuthority(immutableResult);
        immutable["sub"] = "repo:Cheekyfellastef@267490109/stephan-os@1179385579:environment:operator-merge-approval";
        Reject(Verify(Token(immutable)), "IMMUTABLE_SUBJECT_CANNOT_REBIND_REPOSITORY_ID");
        header["x5t"] = "example-thumbprint"; // Documented GitHub header member; not a key source.
        var withHint = Verify(Token(claims));
        Check(withHint.IssuerSignatureAuthenticated, "DOCUMENTED_OPTIONAL_X5T_HEADER_SUPPORTED"); NoAuthority(withHint);
        Reject(Verify(Token(claims), Keys(new Dictionary<string, object>(key) { ["kid"] = "unrelated" })),
            "X5T_CANNOT_SELECT_AN_UNRELATED_KEY");
        foreach (object hint in new object[] { "", new string('a', 129), "https://example.com/keys", new[] { "hint" } })
        {
            header["x5t"] = hint;
            Reject(Verify(Token(claims)), "OPTIONAL_CERTIFICATE_HINT_BOUNDED_AND_NON_EXECUTABLE");
        }
        header["x5t"] = "example-thumbprint";
        Reject(Verify(Token(claims, rawHeader: "{\"alg\":\"RS256\",\"kid\":\"fixture-issuer\",\"typ\":\"JWT\",\"x5t\":\"one\",\"x5t\":\"two\"}")),
            "DUPLICATE_OPTIONAL_CERTIFICATE_HINT_REJECTED");
        header.Remove("x5t");
        foreach (string field in new[] { "iss", "aud", "sub", "repository", "repository_id", "repository_owner_id",
            "actor_id", "workflow_ref", "workflow_sha", "sha", "ref", "ref_type", "event_name",
            "runner_environment", "environment", "run_id", "run_attempt", "jti" })
        {
            var bad = new Dictionary<string, object>(claims) { [field] = "other" };
            Reject(Verify(Token(bad)), "WRONG_" + field);
            bad.Remove(field);
            if (field != "environment") Reject(Verify(Token(bad)), "MISSING_" + field);
        }
        foreach (var change in new Dictionary<string, object>[] {
            new() { ["exp"] = now.ToUnixTimeSeconds() }, new() { ["exp"] = now.ToUnixTimeSeconds() + 301 },
            new() { ["iat"] = now.ToUnixTimeSeconds() - 1 }, new() { ["iat"] = now.ToUnixTimeSeconds() + 1 },
            new() { ["nbf"] = now.ToUnixTimeSeconds() + 1 }, new() { ["iat"] = "not-an-integer" },
            new() { ["run_id"] = "0123456789" }, new() { ["run_attempt"] = "0" },
            new() { ["run_id"] = "99999999999999999999" },
            new() { ["aud"] = new[] { audience } }, new() { ["jti"] = "short" },
        })
        {
            var bad = new Dictionary<string, object>(claims);
            foreach (var item in change) bad[item.Key] = item.Value;
            Reject(Verify(Token(bad)), "FRESHNESS_TYPE_OR_REPLAY_ID_BOUND");
        }
        Reject(Verify(good, aud: audience + "other-process"), "NATIVE_CHALLENGE_AUDIENCE_BOUND");
        Reject(Verify(good, main: new string('d', 40)), "EXACT_WORKFLOW_SOURCE_BOUND");
        Reject(Verify(good, clock: now.AddSeconds(-1)), "CLOCK_ROLLBACK");
        Reject(Verify(good, clock: now.AddMinutes(6)), "SESSION_EXPIRED");
        Reject(Verify(good[..^1] + (good[^1] == 'A' ? "B" : "A")), "SIGNATURE_TAMPER_OR_NONCANONICAL");
        Reject(Verify(good + "="), "PADDED_BASE64URL_REJECTED");
        Reject(Verify(good + ".extra"), "EXTRA_JWS_SEGMENT");
        Reject(Verify(new string('a', 32769)), "TOKEN_BUDGET");
        Reject(Verify(good, new byte[65537]), "JWKS_BUDGET");
        Reject(Verify(good, Keys(key, key)), "DUPLICATE_ISSUER_KEY");
        var wrongKey = new Dictionary<string, object>(key) { ["kid"] = "unrelated" };
        Reject(Verify(good, Keys(wrongKey)), "NO_MATCHING_KEY");
        foreach (string field in new[] { "alg", "kty", "use", "e", "n" })
        {
            wrongKey = new(key) { [field] = "other" };
            Reject(Verify(good, Keys(wrongKey)), "ISSUER_KEY_" + field);
        }
        Reject(Verify(Token(claims, rawHeader: "{\"alg\":\"RS256\",\"alg\":\"RS256\",\"kid\":\"fixture-issuer\",\"typ\":\"JWT\"}")), "DUPLICATE_HEADER");
        string payload = JsonSerializer.Serialize(claims);
        Reject(Verify(Token(claims, rawPayload: payload[..^1] + ",\"actor_id\":\"267490109\"}")), "DUPLICATE_CLAIM");
        header["alg"] = "none";
        Reject(Verify(Token(claims)), "UNSIGNED_ALGORITHM_REJECTED");
        header["alg"] = "RS256"; header["jku"] = "https://example.com/keys";
        Reject(Verify(Token(claims)), "CALLER_KEY_LOCATION_REJECTED");
        var actual = OriginalR7CommissioningOwnerContext.ObserveCurrent();
        if (!actual.NativeElevatedInteractiveContextObserved)
        {
            bool refused = false;
            try { using var session = OriginalR7OwnerWorkflowAuthentication.BeginCurrentNativeOwner(); }
            catch (InvalidOperationException) { refused = true; }
            Check(refused, "ACTUAL_UNADMITTED_OS_CONTEXT_REFUSED_BEFORE_NETWORK");
        }
        else
        {
            using var session = OriginalR7OwnerWorkflowAuthentication.BeginCurrentNativeOwner();
            string challenge = session.ChallengeAudience(new string('b', 64), new string('d', 64));
            Check(challenge.StartsWith("stephanos:r7:first-root-owner-permit:v1:" + new string('b', 64) + ":", StringComparison.Ordinal)
                && challenge.Length == audience.Length, "ACTUAL_NATIVE_NONCE_CHALLENGE_BOUND");
            // The malformed exact digest is rejected before any HTTP request.
            Reject(session.ObserveIssuerAsync("not-a-token", new string('0', 64), sha, new string('d', 64), "123456789", "1").GetAwaiter().GetResult(),
                "ACTUAL_SESSION_INVALID_INPUT_TERMINAL_WITHOUT_NETWORK");
            Reject(session.ObserveIssuerAsync("not-a-token", new string('b', 64), sha, new string('d', 64), "123456789", "1").GetAwaiter().GetResult(),
                "ACTUAL_NATIVE_SESSION_SINGLE_ATTEMPT");
            bool terminal = false;
            try { session.ChallengeAudience(new string('b', 64), new string('d', 64)); } catch (InvalidOperationException) { terminal = true; }
            Check(terminal, "NO_CHALLENGE_AFTER_TERMINAL_SESSION");
        }
        Console.WriteLine("R7_OWNER_WORKFLOW_AUTHENTICATION_ASSERTIONS_PASSED=" + total);
        Console.WriteLine("R7_OWNER_WORKFLOW_FIXTURE_KEYS_ONLY=true");
        Console.WriteLine("R7_OWNER_WORKFLOW_HOST_ADOPTION=false");
        return total;
    }
}
