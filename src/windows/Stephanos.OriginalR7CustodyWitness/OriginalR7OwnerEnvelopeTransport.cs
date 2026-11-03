using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Security.Principal;

namespace Stephanos.OriginalR7CustodyWitness;

internal enum OriginalR7OwnerOperationPurpose { AuthenticatePeer, ProvisionInactiveRoots }

internal sealed record OriginalR7OwnerTransportChallenge(
    string Audience, string PublicSpkiBase64, string PublicSpkiSha256,
    string IssuedAtUtc, string ExpiresAtUtc)
{
    internal bool NativeEndpointAuthenticated => false;
    internal bool SourceApprovalAuthenticated => false;
    internal bool HostExecutionAuthorized => false;
    internal bool RootEnrollmentAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

// Purpose-bound compact JWE (RSA-OAEP-256/A256GCM), not a new issuer or route.
// The transport key is ephemeral encryption material, NOT a third signing root.
// No endpoint, carrier, process launch, credential store or production root is
// created. A carrier/OS context still needs independent admission before use.
internal sealed class OriginalR7OwnerEnvelopeTransport : IDisposable
{
    private const string Type = "stephanos.r7-first-root-owner-token.v1";
    private const int MaxTokenBytes = 32768, MaxEnvelopeCharacters = 49152;
    private readonly RSA recipient;
    private readonly OriginalR7OwnerWorkflowAuthentication? owner;
    private readonly OriginalR7OwnerOperationPurpose purpose;
    private readonly OriginalR7NativeProvisioningSource? provisioningSource;
    private readonly string audience, permitDigest;
    private readonly DateTimeOffset issued;
    private readonly long opened = Stopwatch.GetTimestamp();
    private readonly byte[] publicSpki;
    private readonly string keyDigest;
    private int terminal;
    private int osPairingAttempt;
    private InactiveRootProvisioningGrant? nativeGrant;
    private int provisioningClaim;
    private string operatorSid = "", witnessSid = "";

    internal OriginalR7OwnerOperationPurpose OperationPurpose => purpose;

    private OriginalR7OwnerEnvelopeTransport(string exactPermitDigest,
        DateTimeOffset issuedAt, OriginalR7OwnerWorkflowAuthentication? nativeOwner, string? fixtureNonce = null,
        OriginalR7OwnerOperationPurpose operationPurpose = OriginalR7OwnerOperationPurpose.AuthenticatePeer,
        OriginalR7NativeProvisioningSource? sourceBinding = null)
    {
        permitDigest = exactPermitDigest; issued = issuedAt; owner = nativeOwner;
        purpose = operationPurpose; provisioningSource = sourceBinding;
        recipient = RSA.Create(2048);
        try
        {
            publicSpki = recipient.ExportSubjectPublicKeyInfo();
            keyDigest = Hash(publicSpki);
            audience = owner is not null ? owner.ChallengeAudience(permitDigest, keyDigest)
                : OriginalR7OwnerPeerPairing.AudiencePrefix(purpose) + permitDigest + ":" + fixtureNonce + ":" + keyDigest;
        }
        catch { recipient.Dispose(); throw; }
    }

    internal static OriginalR7OwnerEnvelopeTransport BeginCurrentNativeOwner(string exactPermitDigest)
    {
        var owner = OriginalR7OwnerWorkflowAuthentication.BeginCurrentNativeOwner();
        try { return new(exactPermitDigest, owner.SessionIssuedAtUtc, owner); }
        catch { owner.Dispose(); throw; }
    }

    internal static OriginalR7OwnerEnvelopeTransport BeginCurrentInactiveRootProvisioning(
        OriginalR7NativeProvisioningSource sourceBinding)
    {
        ArgumentNullException.ThrowIfNull(sourceBinding);
        sourceBinding.RequireCurrent();
        var owner = OriginalR7OwnerWorkflowAuthentication.BeginCurrentNativeOwner(
            OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots);
        try { return new(sourceBinding.PermitSha256, owner.SessionIssuedAtUtc, owner, null,
            OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots, sourceBinding); }
        catch { owner.Dispose(); throw; }
    }

    internal OriginalR7OwnerTransportChallenge PublicChallenge()
    {
        RequireLive();
        return new(audience, Convert.ToBase64String(publicSpki), keyDigest,
            issued.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
            issued.AddMinutes(5).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture));
    }

    // No plaintext token is returned by the native intake. Successful AEAD is
    // not owner authenticity: the fixed GitHub issuer verifier still runs.
    internal async Task<OriginalR7OwnerWorkflowObservation> ConsumeOwnerTokenAsync(string envelope, string expectedMain,
        OriginalR7OperatingSystemPeerDecision? operatingSystemDecision)
    {
        byte[]? token = null;
        bool claimed = false;
        try
        {
            ClaimLive();
            claimed = true;
            if (owner is null || purpose != OriginalR7OwnerOperationPurpose.AuthenticatePeer)
                throw Failure("FIXTURE_OR_OTHER_PURPOSE_CANNOT_CONSUME_PEER_TOKEN");
            if (operatingSystemDecision is null
                || !operatingSystemDecision.TryConsumeFor(this, expectedMain, out var paired) || paired is null)
                throw Failure("REAL_PAIRED_OS_DECISION_REQUIRED");
            token = Decrypt(envelope);
            // Owned byte buffers are cleared below. Managed strings/provider
            // scratch memory are not claimed to be hardware-erased.
            var observed = await owner.ObserveIssuerAsync(Encoding.ASCII.GetString(token), permitDigest, expectedMain,
                keyDigest, paired.RunId, paired.RunAttempt);
            return observed with { OsPeerPairingDecisionAuthenticated = observed.IssuerSignatureAuthenticated
                && observed.CurrentNativeActorBound && observed.PairedRunMatched };
        }
        catch
        {
            return new("R7_OWNER_TOKEN_TRANSPORT_FAILED_CLOSED", false, false, "", "", "", "");
        }
        finally
        {
            if (token is not null) CryptographicOperations.ZeroMemory(token);
            operatingSystemDecision?.Dispose();
            if (claimed) Dispose();
        }
    }

    // The capability is retained only in this authenticated native process. A
    // record, serialized success, copied public challenge, fixture verifier or
    // caller-created Grant cannot register itself as this session's grant.
    internal sealed class InactiveRootProvisioningGrant : IDisposable
    {
        private readonly OriginalR7OwnerEnvelopeTransport origin;
        internal InactiveRootProvisioningGrant(OriginalR7OwnerEnvelopeTransport actualOrigin) { origin = actualOrigin; }
        internal string PermitSha256 { get { RequireCurrent(); return origin.permitDigest; } }
        internal string OriginalLeaseDigest { get { RequireCurrent(); return origin.provisioningSource!.OriginalLeaseDigest; } }
        internal string SourceExecutionId { get { RequireCurrent(); return origin.provisioningSource!.SourceExecutionId; } }
        internal string OperatorSid { get { RequireCurrent(); return origin.operatorSid; } }
        internal string WitnessSid { get { RequireCurrent(); return origin.witnessSid; } }
        internal void ClaimTransaction() => origin.ClaimInactiveProvisioning(this);
        internal void RequireCurrent() => origin.RequireInactiveProvisioning(this);
        public void Dispose()
        {
            if (ReferenceEquals(origin.nativeGrant, this)) origin.Dispose();
        }
    }

    internal async Task<InactiveRootProvisioningGrant?> ConsumeInactiveRootProvisioningAsync(
        string envelope, OriginalR7OperatingSystemPeerDecision? operatingSystemDecision)
    {
        byte[]? token = null;
        bool complete = false;
        try
        {
            ClaimLive();
            if (owner is null || provisioningSource is null
                || purpose != OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots)
                throw Failure("INACTIVE_ROOT_NATIVE_SOURCE_AND_PURPOSE_REQUIRED");
            provisioningSource.RequireCurrent();
            if (operatingSystemDecision is null
                || !operatingSystemDecision.TryConsumeFor(this, provisioningSource.ExpectedMain, out var paired)
                || paired is null || paired.Purpose != OriginalR7OwnerPeerPairing.InactiveRootPurpose)
                throw Failure("REAL_FULL_PURPOSE_OS_DECISION_REQUIRED");
            token = Decrypt(envelope);
            var observed = await owner.ObserveIssuerAsync(Encoding.ASCII.GetString(token), permitDigest,
                provisioningSource.ExpectedMain, keyDigest, paired.RunId, paired.RunAttempt);
            if (!observed.IssuerSignatureAuthenticated || !observed.CurrentNativeActorBound || !observed.PairedRunMatched)
                throw Failure("INACTIVE_ROOT_EXACT_SIGNED_OWNER_REQUIRED");
            provisioningSource.RequireCurrent();
            var actor = owner.RequireAuthenticatedCurrentActor();
            operatorSid = actor.CurrentSid;
            witnessSid = ((SecurityIdentifier)new NTAccount("NT SERVICE", "StephanosOriginalR7CustodyWitness")
                .Translate(typeof(SecurityIdentifier))).Value;
            if (!witnessSid.StartsWith("S-1-5-80-", StringComparison.Ordinal)
                || witnessSid == operatorSid || operatorSid is "S-1-5-18" or "S-1-5-32-544")
                throw Failure("INACTIVE_ROOT_DISTINCT_NATIVE_ROLES_REQUIRED");
            nativeGrant = new(this);
            RequireInactiveProvisioning(nativeGrant);
            complete = true;
            return nativeGrant;
        }
        catch { return null; }
        finally
        {
            if (token is not null) CryptographicOperations.ZeroMemory(token);
            operatingSystemDecision?.Dispose();
            if (!complete) Dispose();
        }
    }

    private void RequireInactiveProvisioning(InactiveRootProvisioningGrant grant)
    {
        if (!ReferenceEquals(nativeGrant, grant) || owner is null || provisioningSource is null
            || purpose != OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots
            || Volatile.Read(ref terminal) != 1 || Volatile.Read(ref provisioningClaim) is < 0 or > 1
            || DateTimeOffset.UtcNow < issued || DateTimeOffset.UtcNow - issued > TimeSpan.FromMinutes(5)
            || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
            || owner.RequireAuthenticatedCurrentActor().CurrentSid != operatorSid
            || ((SecurityIdentifier)new NTAccount("NT SERVICE", "StephanosOriginalR7CustodyWitness")
                .Translate(typeof(SecurityIdentifier))).Value != witnessSid)
            throw Failure("INACTIVE_ROOT_NATIVE_GRANT_NOT_CURRENT");
        provisioningSource.RequireCurrent();
    }

    private void ClaimInactiveProvisioning(InactiveRootProvisioningGrant grant)
    {
        RequireInactiveProvisioning(grant);
        if (Interlocked.CompareExchange(ref provisioningClaim, 1, 0) != 0)
            throw Failure("INACTIVE_ROOT_PROVISIONING_ALREADY_CONSUMED");
        RequireInactiveProvisioning(grant);
    }

    internal void ClaimOperatingSystemPairingAttempt()
    {
        RequireLive();
        if (owner is null || !owner.HasCurrentUnclaimedNativeActor()
            || Interlocked.CompareExchange(ref osPairingAttempt, 1, 0) != 0)
            throw Failure("NATIVE_OS_PAIRING_ATTEMPT_UNAVAILABLE");
    }

    internal bool ClaimedSessionMatchesPeer(OriginalR7OwnerPeerTranscript paired)
    {
        return Volatile.Read(ref terminal) == 1 && Volatile.Read(ref osPairingAttempt) == 1
            && owner is not null && owner.HasCurrentUnclaimedNativeActor()
            && DateTimeOffset.UtcNow >= issued && DateTimeOffset.UtcNow - issued <= TimeSpan.FromMinutes(5)
            && Stopwatch.GetElapsedTime(opened) <= TimeSpan.FromMinutes(5)
            && paired.NativeAudience == audience && paired.PermitSha256 == permitDigest
            && paired.Purpose == (purpose == OriginalR7OwnerOperationPurpose.ProvisionInactiveRoots
                ? OriginalR7OwnerPeerPairing.InactiveRootPurpose : OriginalR7OwnerPeerPairing.Purpose)
            && paired.NativeIssuedAtUtc == issued.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture)
            && paired.NativeExpiresAtUtc == issued.AddMinutes(5).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
    }

    internal static string EncryptForUntrustedChallenge(OriginalR7OwnerTransportChallenge challenge,
        string ownerToken, DateTimeOffset now)
    {
        byte[]? plaintext = null, aesKey = null;
        try
        {
            ValidateChallenge(challenge, now);
            if (ownerToken is null || ownerToken.Length is < 32 or > MaxTokenBytes)
                throw Failure("COMPACT_OWNER_TOKEN_REQUIRED");
            plaintext = Encoding.ASCII.GetBytes(ownerToken);
            ValidateToken(plaintext, ownerToken);
            using RSA key = ImportChallengeRecipient(challenge, now);
            string header = Header(challenge.Audience, challenge.PublicSpkiSha256);
            string protectedHeader = B64(Encoding.ASCII.GetBytes(header));
            aesKey = RandomNumberGenerator.GetBytes(32);
            byte[] iv = RandomNumberGenerator.GetBytes(12), tag = new byte[16];
            byte[] ciphertext = new byte[plaintext.Length];
            using (var aes = new AesGcm(aesKey, 16))
                aes.Encrypt(iv, plaintext, ciphertext, tag, Encoding.ASCII.GetBytes(protectedHeader));
            byte[] wrapped = key.Encrypt(aesKey, RSAEncryptionPadding.OaepSHA256);
            return string.Join('.', protectedHeader, B64(wrapped), B64(iv), B64(ciphertext), B64(tag));
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("R7_OWNER_TOKEN_", StringComparison.Ordinal)) { throw; }
        catch { throw Failure("ENCRYPT_FAILED_CLOSED"); }
        finally
        {
            if (plaintext is not null) CryptographicOperations.ZeroMemory(plaintext);
            if (aesKey is not null) CryptographicOperations.ZeroMemory(aesKey);
        }
    }

    private byte[] Decrypt(string envelope)
    {
        if (envelope is null || envelope.Length is < 64 or > MaxEnvelopeCharacters)
            throw Failure("ENVELOPE_BOUND");
        string[] parts = envelope.Split('.');
        if (parts.Length != 5) throw Failure("COMPACT_JWE_REQUIRED");
        byte[] headerBytes = Decode(parts[0], 2048);
        string header = Encoding.ASCII.GetString(headerBytes);
        // Exact canonical header binds algorithm, recipient and this session's
        // purpose/nonce. It accepts no jku/jwk/x5u/zip/alternate algorithm.
        if (headerBytes.Any(b => b > 127) || header != Header(audience, keyDigest))
            throw Failure("PROTECTED_HEADER_BINDING");
        byte[] wrapped = Decode(parts[1], 256), iv = Decode(parts[2], 12),
            ciphertext = Decode(parts[3], MaxTokenBytes), tag = Decode(parts[4], 16);
        if (wrapped.Length != 256 || iv.Length != 12 || tag.Length != 16 || ciphertext.Length < 32)
            throw Failure("ENCRYPTION_PROFILE_BOUND");
        byte[]? aesKey = null; byte[] plaintext = new byte[ciphertext.Length];
        try
        {
            aesKey = recipient.Decrypt(wrapped, RSAEncryptionPadding.OaepSHA256);
            if (aesKey.Length != 32) throw Failure("CONTENT_KEY_SIZE");
            using var aes = new AesGcm(aesKey, 16);
            aes.Decrypt(iv, ciphertext, tag, plaintext, Encoding.ASCII.GetBytes(parts[0]));
            ValidateToken(plaintext);
            return plaintext;
        }
        catch { CryptographicOperations.ZeroMemory(plaintext); throw Failure("DECRYPT_FAILED_CLOSED"); }
        finally { if (aesKey is not null) CryptographicOperations.ZeroMemory(aesKey); }
    }

    private void RequireLive()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        if (Volatile.Read(ref terminal) != 0) throw Failure("SESSION_TERMINAL_OR_EXPIRED");
        if (now < issued || now - issued > TimeSpan.FromMinutes(5)
            || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5))
        { Dispose(); throw Failure("SESSION_TERMINAL_OR_EXPIRED"); }
    }

    private void ClaimLive()
    {
        RequireLive();
        if (Interlocked.CompareExchange(ref terminal, 1, 0) != 0)
            throw Failure("SESSION_TERMINAL_OR_EXPIRED");
    }

    // One canonical recipient/key/window validator shared with the native peer
    // transcript. Importing a public key is not endpoint authentication.
    internal static RSA ImportChallengeRecipient(OriginalR7OwnerTransportChallenge challenge, DateTimeOffset now)
    {
        ValidateChallenge(challenge, now);
        byte[] spki = Convert.FromBase64String(challenge.PublicSpkiBase64);
        if (Convert.ToBase64String(spki) != challenge.PublicSpkiBase64 || Hash(spki) != challenge.PublicSpkiSha256)
            throw Failure("RECIPIENT_ENCODING_OR_DIGEST");
        RSA key = RSA.Create();
        try
        {
            key.ImportSubjectPublicKeyInfo(spki, out int consumed);
            if (consumed != spki.Length || key.KeySize != 2048
                || !key.ExportSubjectPublicKeyInfo().AsSpan().SequenceEqual(spki)
                || key.ExportParameters(false).Exponent is not { Length: 3 } exponent
                || !exponent.AsSpan().SequenceEqual(new byte[] { 1, 0, 1 }))
                throw Failure("RECIPIENT_KEY_PROFILE");
            return key;
        }
        catch { key.Dispose(); throw; }
    }

    private static void ValidateChallenge(OriginalR7OwnerTransportChallenge challenge, DateTimeOffset now)
    {
        string prefix = OriginalR7OwnerPeerPairing.AudiencePrefix(
            OriginalR7OwnerPeerPairing.OperationPurpose(challenge.Audience));
        string[] binding = challenge.Audience.StartsWith(prefix, StringComparison.Ordinal)
            ? challenge.Audience[prefix.Length..].Split(':') : Array.Empty<string>();
        bool Hex(string value) => value.Length == 64 && value.Any(c => c != '0')
            && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
        if (binding.Length != 3 || binding.Any(s => !Hex(s)) || !Hex(challenge.PublicSpkiSha256)
            || binding[2] != challenge.PublicSpkiSha256
            || challenge.PublicSpkiBase64.Length is < 128 or > 1536
            || !DateTimeOffset.TryParseExact(challenge.IssuedAtUtc, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var issued)
            || !DateTimeOffset.TryParseExact(challenge.ExpiresAtUtc, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var expires)
            || issued > now || expires <= now || expires <= issued || expires - issued > TimeSpan.FromMinutes(5))
            throw Failure("CHALLENGE_BOUND");
    }

    private static void ValidateToken(byte[] bytes, string? original = null)
    {
        if (bytes.Length is < 32 or > MaxTokenBytes || bytes.Any(b => !(char.IsAsciiLetterOrDigit((char)b)
            || b is (byte)'-' or (byte)'_' or (byte)'.')) || bytes.Count(b => b == '.') != 2
            || bytes[0] == '.' || bytes[^1] == '.'
            || bytes.Zip(bytes.Skip(1), (a, b) => a == '.' && b == '.').Any(pair => pair)
            || (original is not null && original.Any(c => c > 127))) throw Failure("COMPACT_OWNER_TOKEN_REQUIRED");
    }
    private static string Header(string audience, string kid)
        => JsonSerializer.Serialize(new Dictionary<string, string> {
            ["alg"] = "RSA-OAEP-256", ["enc"] = "A256GCM", ["kid"] = kid, ["typ"] = Type, ["aud"] = audience,
        });
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static byte[] Decode(string value, int maximum)
    {
        if (value.Length < 1 || value.Length > ((maximum + 2) / 3) * 4
            || value.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_')))
            throw Failure("BASE64URL_BOUND");
        byte[] bytes = Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
        if (bytes.Length > maximum || B64(bytes) != value) throw Failure("BASE64URL_NONCANONICAL");
        return bytes;
    }
    private static InvalidOperationException Failure(string code) => new("R7_OWNER_TOKEN_" + code);
    public void Dispose()
    {
        Interlocked.Exchange(ref terminal, 2); Interlocked.Exchange(ref provisioningClaim, 2);
        recipient.Dispose(); owner?.Dispose(); provisioningSource?.Dispose();
    }

    // Only disposable-fixture code can receive plaintext. No production
    // handler exports a key/decrypt/sign-any-payload endpoint or native grant.
    internal static OriginalR7OwnerEnvelopeTransport CreateUntrustedFixture(string permitDigest, string nonce,
        OriginalR7OwnerOperationPurpose purpose = OriginalR7OwnerOperationPurpose.AuthenticatePeer)
        => new(permitDigest, DateTimeOffset.UtcNow, null, nonce, purpose);
    internal byte[] ConsumeUntrustedFixture(string envelope)
    {
        if (owner is not null) throw Failure("NATIVE_SESSION_CANNOT_EXPORT_PLAINTEXT");
        ClaimLive();
        try { return Decrypt(envelope); }
        finally { Dispose(); }
    }
}
