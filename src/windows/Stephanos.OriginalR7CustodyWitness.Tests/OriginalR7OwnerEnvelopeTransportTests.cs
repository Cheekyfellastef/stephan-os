using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Stephanos.OriginalR7CustodyWitness;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7OwnerEnvelopeTransportTests
{
    private static int total;
    private const string Token = "eyJhbGciOiJSUzI1NiJ9.eyJmaXh0dXJlIjp0cnVlfQ.ZGlzcG9zYWJsZS10ZXN0LXNpZ25hdHVyZQ";
    private static string B64(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] Un64(string value) => Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
    private static void Check(bool ok, string code)
    { total++; if (!ok) throw new InvalidOperationException("R7_OWNER_TOKEN_FIXTURE_FAILED_" + code); }
    private static void Reject(Action action, string code)
    {
        bool rejected = false;
        try { action(); }
        catch (InvalidOperationException error) when (error.Message.StartsWith("R7_OWNER_TOKEN_", StringComparison.Ordinal)) { rejected = true; }
        Check(rejected, code);
    }
    private static OriginalR7OwnerEnvelopeTransport Session(char nonce = 'b')
        => OriginalR7OwnerEnvelopeTransport.CreateUntrustedFixture(new string('a', 64), new string(nonce, 64));
    private static string Encrypt(OriginalR7OwnerTransportChallenge challenge, string token = Token)
        => OriginalR7OwnerEnvelopeTransport.EncryptForUntrustedChallenge(challenge, token, DateTimeOffset.UtcNow);
    private static void EqualAndClear(byte[] actual, string expected, string code)
    { try { Check(Encoding.ASCII.GetString(actual) == expected, code); } finally { CryptographicOperations.ZeroMemory(actual); } }

    internal static int Run()
    {
        using (var session = Session())
        {
            var challenge = session.PublicChallenge();
            Check(!challenge.NativeEndpointAuthenticated && !challenge.SourceApprovalAuthenticated
                && !challenge.HostExecutionAuthorized && !challenge.RootEnrollmentAuthorized
                && !challenge.LeaseReleaseAuthorized, "UNTRUSTED_CHALLENGE_NO_AUTHORITY");
            string envelope = Encrypt(challenge);
            Check(!envelope.Contains(Token, StringComparison.Ordinal) && envelope.Split('.').Length == 5, "CIPHERTEXT_ONLY_COMPACT_JWE");
            EqualAndClear(session.ConsumeUntrustedFixture(envelope), Token, "DISPOSABLE_ROUNDTRIP");
            Reject(() => session.ConsumeUntrustedFixture(envelope), "REPLAY_TERMINAL");
            Reject(() => session.PublicChallenge(), "NO_CHALLENGE_AFTER_CONSUMPTION");
        }
        // A fresh recipient and nonce cannot consume another session's packet.
        using (var first = Session())
        using (var second = Session('c'))
        {
            string envelope = Encrypt(first.PublicChallenge());
            Reject(() => second.ConsumeUntrustedFixture(envelope), "OTHER_NONCE_AND_RECIPIENT");
            Reject(() => second.ConsumeUntrustedFixture(Encrypt(second.PublicChallenge())), "FAILED_ATTEMPT_TERMINAL");
            EqualAndClear(first.ConsumeUntrustedFixture(envelope), Token, "OTHER_SESSION_FAILURE_DOES_NOT_CONSUME_ORIGINAL");
        }
        using (var first = Session())
        using (var second = Session())
        {
            string envelope = Encrypt(first.PublicChallenge());
            Reject(() => second.ConsumeUntrustedFixture(envelope), "SAME_NONCE_DIFFERENT_KEY");
        }
        // Independently mutate each protected component, including canonical
        // header byte order, duplicate fields, padding and algorithm/key URLs.
        foreach (string kind in new[] { "header", "wrapped", "iv", "ciphertext", "tag", "extra", "padding", "duplicate", "algorithm", "keyurl", "reorder", "oversize", "null", "empty" })
        {
            using var session = Session();
            string envelope = Encrypt(session.PublicChallenge());
            string[] parts = envelope.Split('.');
            string header = Encoding.ASCII.GetString(Un64(parts[0]));
            switch (kind)
            {
                case "header": parts[0] = B64(Encoding.ASCII.GetBytes(header.Replace("first-root", "other-root", StringComparison.Ordinal))); break;
                case "duplicate": parts[0] = B64(Encoding.ASCII.GetBytes(header[..^1] + ",\"alg\":\"RSA-OAEP-256\"}")); break;
                case "algorithm": parts[0] = B64(Encoding.ASCII.GetBytes(header.Replace("RSA-OAEP-256", "RSA1_5", StringComparison.Ordinal))); break;
                case "keyurl": parts[0] = B64(Encoding.ASCII.GetBytes(header[..^1] + ",\"jku\":\"https://untrusted.invalid\"}")); break;
                case "reorder": parts[0] = B64(Encoding.ASCII.GetBytes(" " + header)); break;
                case "padding": parts[1] += "="; break;
                case "wrapped": case "iv": case "ciphertext": case "tag":
                    int index = kind == "wrapped" ? 1 : kind == "iv" ? 2 : kind == "ciphertext" ? 3 : 4;
                    byte[] bytes = Un64(parts[index]); bytes[0] ^= 1; parts[index] = B64(bytes); break;
            }
            string bad = kind switch { "extra" => envelope + ".extra", "oversize" => new string('A', 49153),
                "null" => null!, "empty" => "", _ => string.Join('.', parts) };
            Reject(() => session.ConsumeUntrustedFixture(bad), "MUTATION_" + kind);
            Reject(() => session.PublicChallenge(), "MUTATION_IS_TERMINAL_" + kind);
        }
        using (var session = Session())
        {
            var good = session.PublicChallenge();
            using (var substitute = Session())
            {
                var other = substitute.PublicChallenge();
                Reject(() => Encrypt(good with { PublicSpkiBase64 = other.PublicSpkiBase64,
                    PublicSpkiSha256 = other.PublicSpkiSha256 }), "RECIPIENT_SUBSTITUTION_BREAKS_SIGNED_AUDIENCE_BINDING");
                // Replacing the WHOLE unauthenticated challenge is still
                // possible. This codec deliberately cannot authenticate its
                // carrier: no real token producer is wired to this method.
                Check(!other.NativeEndpointAuthenticated, "WHOLE_CHALLENGE_REPLACEMENT_REQUIRES_ADMITTED_PICKUP");
            }
            foreach (var bad in new[] {
                good with { Audience = "wrong-purpose" },
                good with { Audience = "stephanos:r7:first-root-owner-permit:v1:" + new string('0',64) + ":" + new string('b',64) },
                good with { PublicSpkiSha256 = new string('c',64) },
                good with { PublicSpkiSha256 = new string('0',64) },
                good with { PublicSpkiBase64 = good.PublicSpkiBase64 + "=" },
                good with { PublicSpkiBase64 = new string('a',1537) },
                good with { IssuedAtUtc = "tomorrow" },
                good with { ExpiresAtUtc = "2000-01-01T00:00:00.000Z" },
                good with { ExpiresAtUtc = DateTimeOffset.UtcNow.AddMinutes(6).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") },
                good with { IssuedAtUtc = DateTimeOffset.UtcNow.AddMinutes(1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") },
            }) Reject(() => Encrypt(bad), "MALFORMED_OR_STALE_CHALLENGE");
            foreach (string bad in new[] { "", "a.b.c", new string('a',32769), Token + "é", Token + "!", "." + new string('a',32) + ".", new string('a',32) + "..b" })
                Reject(() => Encrypt(good, bad), "TOKEN_PROFILE_BOUND");
            foreach (int bits in new[] { 1024, 3072 })
            {
                using RSA wrongProfile = RSA.Create(bits);
                byte[] spki = wrongProfile.ExportSubjectPublicKeyInfo();
                string digest = Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant();
                var changed = good with { PublicSpkiBase64 = Convert.ToBase64String(spki), PublicSpkiSha256 = digest,
                    Audience = good.Audience[..^64] + digest };
                Reject(() => Encrypt(changed), "EXACT_RSA_2048_RECIPIENT_PROFILE");
            }
            EqualAndClear(session.ConsumeUntrustedFixture(Encrypt(good)), Token, "ENCRYPT_REJECTION_NO_NATIVE_CONSUMPTION");
        }
        using (var session = Session())
        {
            string maximum = new string('a',16383) + "." + new string('b',16383) + ".";
            // 32KiB exact with three nonempty JWT-shaped segments.
            maximum = maximum[..^2] + ".c";
            Check(maximum.Length == 32768, "EXACT_TOKEN_MAXIMUM_FIXTURE");
            EqualAndClear(session.ConsumeUntrustedFixture(Encrypt(session.PublicChallenge(), maximum)), maximum, "TOKEN_MAXIMUM_ROUNDTRIP");
        }
        using (var session = Session())
        {
            string envelope = Encrypt(session.PublicChallenge());
            var observation = session.ConsumeOwnerTokenAsync(envelope, new string('d',40), null).GetAwaiter().GetResult();
            Check(!observation.IssuerSignatureAuthenticated && !observation.CurrentNativeActorBound
                && !observation.RootProvisioningAuthorized && !observation.LeaseReleaseAuthorized,
                "FIXTURE_CANNOT_ENTER_NATIVE_ISSUER_ROUTE");
        }
        // Purpose separation is inside the authenticated JWE header/audience,
        // not a caller Boolean. Even keeping the SAME recipient and nonce while
        // switching purpose cannot turn a peer token into provisioning consent.
        foreach (var purpose in Enum.GetValues<OriginalR7OwnerOperationPurpose>())
        {
            using var session = OriginalR7OwnerEnvelopeTransport.CreateUntrustedFixture(new string('a', 64),
                new string('b', 64), purpose);
            var challenge = session.PublicChallenge();
            string expected = OriginalR7OwnerPeerPairing.AudiencePrefix(purpose);
            Check(challenge.Audience.StartsWith(expected, StringComparison.Ordinal), "FIXED_PURPOSE_NATIVE_AUDIENCE");
            string other = OriginalR7OwnerPeerPairing.AudiencePrefix(purpose == OriginalR7OwnerOperationPurpose.AuthenticatePeer
                ? OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots : OriginalR7OwnerOperationPurpose.AuthenticatePeer);
            var substituted = challenge with { Audience = other + challenge.Audience[expected.Length..] };
            Reject(() => session.ConsumeUntrustedFixture(Encrypt(substituted)), "SAME_KEY_NONCE_CROSS_PURPOSE_ENVELOPE_REFUSED");
        }
        using (var session = OriginalR7OwnerEnvelopeTransport.CreateUntrustedFixture(new string('a', 64),
            new string('b', 64), OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots))
        {
            EqualAndClear(session.ConsumeUntrustedFixture(Encrypt(session.PublicChallenge())), Token,
                "INACTIVE_PURPOSE_DISPOSABLE_CRYPTO_ROUNDTRIP_HAS_NO_GRANT");
        }
        foreach (var purpose in Enum.GetValues<OriginalR7OwnerOperationPurpose>())
        {
            using var session = OriginalR7OwnerEnvelopeTransport.CreateUntrustedFixture(new string('a', 64),
                new string('b', 64), purpose);
            using var forged = new OriginalR7OwnerEnvelopeTransport.InactiveRootProvisioningGrant(session);
            Reject(() => forged.RequireCurrent(), "CALLER_CONSTRUCTED_GRANT_NOT_REGISTERED_BY_AUTHENTICATED_NATIVE_SESSION");
            Reject(() => forged.ClaimTransaction(), "CALLER_GRANT_CANNOT_START_SEED_TRANSACTION");
            string envelope = Encrypt(session.PublicChallenge());
            Check(session.ConsumeInactiveRootProvisioningAsync(envelope, null).GetAwaiter().GetResult() is null,
                "FIXTURE_OR_PEER_CANNOT_MINT_INACTIVE_PROVISIONING_GRANT");
        }
        NodeInterop();
        using (var session = Session())
        {
            string envelope = Encrypt(session.PublicChallenge());
            int success = 0, denied = 0;
            Parallel.For(0, 16, _ =>
            {
                byte[]? bytes = null;
                try { bytes = session.ConsumeUntrustedFixture(envelope); Interlocked.Increment(ref success); }
                catch (InvalidOperationException error) when (error.Message.StartsWith("R7_OWNER_TOKEN_", StringComparison.Ordinal))
                { Interlocked.Increment(ref denied); }
                finally { if (bytes is not null) CryptographicOperations.ZeroMemory(bytes); }
            });
            Check(success == 1 && denied == 15, "ATOMIC_CONCURRENT_SINGLE_CONSUMER");
        }
        Console.WriteLine("R7_OWNER_TOKEN_TRANSPORT_FIXTURE_ASSERTIONS_PASSED=" + total);
        Console.WriteLine("R7_OWNER_TOKEN_NATIVE_CARRIER_ADOPTED=false");
        return total;
    }

    private static void NodeInterop()
    {
        using var session = Session();
        var challenge = session.PublicChallenge();
        // Node's standard crypto implementation encrypts independently. Only
        // disposable fixture text and a public recipient key cross stdin.
        const string script = "const c=require('node:crypto');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>{const p=JSON.parse(s),b=v=>Buffer.from(v).toString('base64url'),k=c.randomBytes(32),iv=c.randomBytes(12),h=b(JSON.stringify({alg:'RSA-OAEP-256',enc:'A256GCM',kid:p.challenge.PublicSpkiSha256,typ:'stephanos.r7-first-root-owner-token.v1',aud:p.challenge.Audience})),a=c.createCipheriv('aes-256-gcm',k,iv);a.setAAD(Buffer.from(h));const ct=Buffer.concat([a.update(p.token,'ascii'),a.final()]),w=c.publicEncrypt({key:Buffer.from(p.challenge.PublicSpkiBase64,'base64'),format:'der',type:'spki',oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},k);process.stdout.write([h,b(w),b(iv),b(ct),b(a.getAuthTag())].join('.'));k.fill(0);});";
        var info = new ProcessStartInfo("node") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add("-e"); info.ArgumentList.Add(script);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("R7_OWNER_TOKEN_FIXTURE_NODE_START");
        Task<string> stdout = process.StandardOutput.ReadToEndAsync(), stderr = process.StandardError.ReadToEndAsync();
        process.StandardInput.Write(JsonSerializer.Serialize(new { challenge, token = Token }));
        process.StandardInput.Close();
        if (!process.WaitForExit(10000)) { process.Kill(entireProcessTree: true); throw new InvalidOperationException("R7_OWNER_TOKEN_FIXTURE_NODE_TIMEOUT"); }
        Check(process.ExitCode == 0 && stderr.GetAwaiter().GetResult().Length == 0, "NODE_CRYPTO_ENCRYPTION_EXIT");
        EqualAndClear(session.ConsumeUntrustedFixture(stdout.GetAwaiter().GetResult()), Token, "NODE_RSA_OAEP_256_AES_256_GCM_INTEROP");
    }
}
