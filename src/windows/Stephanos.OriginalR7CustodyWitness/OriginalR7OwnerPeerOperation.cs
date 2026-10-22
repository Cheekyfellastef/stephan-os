using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Stephanos.OriginalR7CustodyWitness;

// One-shot authentication adapters, never a service/worker or an alternate
// commissioning authority. Only the ephemeral peer adapter is exposed by the
// fixed executable; the inactive-root purpose adapter remains in-process only.
// No key store, SCM, registry, ACL, process or lease mutation occurs.
// The exact source/package and endpoint-enrollment policy must be reviewed and
// admitted before an operator invokes its actual Windows dialog.
internal static class OriginalR7OwnerPeerOperation
{
    internal const string Argument = "--authenticate-owner-peer-only";

    internal static async Task<int> RunInactiveRootPurposeAuthenticationAsync(Stream input, TextWriter output)
    {
        try
        {
            var lines = new BoundedPublicLines(input);
            string[] start = ParseStrings(await lines.ReadAsync(32768, TimeSpan.FromSeconds(30)),
                "operation", "permitWire");
            if (start[0] != "begin-inactive-roots") throw Invalid();
            using var source = OriginalR7NativeProvisioningSource.OpenCurrent(start[1]);
            using var session = OriginalR7OwnerEnvelopeTransport.BeginCurrentInactiveRootProvisioning(source);
            long opened = Stopwatch.GetTimestamp();
            var challenge = session.PublicChallenge();
            await Emit(output, new { classification = "R7_INACTIVE_ROOT_PUBLIC_CHALLENGE_ONLY", challenge.Audience,
                challenge.PublicSpkiBase64, challenge.PublicSpkiSha256, challenge.IssuedAtUtc, challenge.ExpiresAtUtc,
                rootEnrollmentAuthorized = false, signingAuthorized = false, leaseReleaseAuthorized = false });
            string[] run = ParseStrings(await lines.ReadAsync(256, Remaining(opened)), "operation", "runId", "runAttempt");
            if (run[0] != "pair-protected-run") throw Invalid();
            var pairing = OriginalR7OwnerPeerPairing.PrepareCurrent(session, source.ExpectedMain, run[1], run[2]);
            if (pairing.Purpose != OriginalR7OwnerPeerPairing.InactiveRootPurpose) throw Invalid();
            await Emit(output, new { classification = "R7_INACTIVE_ROOT_COMPARE_FULL_PURPOSE_BEFORE_OS_AUTHENTICATION",
                pairing.Fingerprint, pairing.ApprovalComment, pairing.RunUrl, pairing.Wire,
                rootEnrollmentAuthorized = false, signingAuthorized = false, leaseReleaseAuthorized = false });
            string[] consent = ParseStrings(await lines.ReadAsync(256, Remaining(opened)), "operation", "peerFingerprint");
            if (consent[0] != "authenticate-displayed-inactive-root-purpose" || consent[1] != pairing.Fingerprint) throw Invalid();
            using var decision = OriginalR7OperatingSystemPeerDecision.AuthenticateCurrentPeer(session,
                source.ExpectedMain, run[1], run[2]);
            await Emit(output, new { classification = "R7_INACTIVE_ROOT_OS_FACTOR_OBSERVED_AWAITING_PROTECTED_ISSUER",
                pairing.Fingerprint, pairing.RunUrl, rootEnrollmentAuthorized = false, signingAuthorized = false,
                leaseReleaseAuthorized = false });
            string[] encrypted = ParseStrings(await lines.ReadAsync(50000, Remaining(opened)), "operation", "encryptedEnvelope");
            if (encrypted[0] != "consume-inactive-root-envelope") throw Invalid();
            using var grant = await session.ConsumeInactiveRootProvisioningAsync(encrypted[1], decision);
            if (grant is null) throw Invalid();
            grant.ClaimTransaction();
            // Completing owner/source/OS admission is not proof that another
            // current source-capable principal cannot copy material at creation.
            // In particular, creating provisional keys at their final paths and
            // hoping to trust them after a later fence would strand unsafe roots.
            // This explicit authentication-only endpoint therefore performs no
            // seed I/O; the actual continuous native creation-custody producer
            // must join this in-process capability before provisioning can run.
            await Emit(output, new {
                classification = "R7_INACTIVE_ROOT_PURPOSE_AUTHENTICATED_CREATION_CUSTODY_REQUIRED",
                exactSignedOwnerPurposeAuthenticated = true, nativeOsPurposeDecisionAuthenticated = true,
                currentSourceImageBound = true, inactiveSeedPairCreated = false, durableAttemptReserved = false,
                rootEnrollmentAuthorized = false, independentKeyCustodyProven = false,
                signingAuthorized = false, physicalContainmentProven = false, leaseReleaseAuthorized = false });
            return 7;
        }
        catch
        {
            // This authentication-only operation performs no seed I/O and
            // creates no durable provisioning transaction or reusable grant.
            try { await Emit(output, new { classification = "R7_INACTIVE_ROOT_PURPOSE_AUTHENTICATION_HELD",
                inactiveSeedPairCreated = false, durableAttemptReserved = false,
                rootEnrollmentAuthorized = false, signingAuthorized = false, leaseReleaseAuthorized = false }); }
            catch { }
            return 7;
        }
    }

    internal static async Task<int> RunAsync(Stream input, TextWriter output)
    {
        try
        {
            var lines = new BoundedPublicLines(input);
            string[] start = ParseStrings(await lines.ReadAsync(1024, TimeSpan.FromSeconds(30)),
                "operation", "permitSha256", "expectedMain");
            if (start[0] != "begin-owner-peer" || !Hex(start[1], 64) || !Hex(start[2], 40)) throw Invalid();
            // Retained native private material never leaves this process.
            using var session = OriginalR7OwnerEnvelopeTransport.BeginCurrentNativeOwner(start[1]);
            long opened = Stopwatch.GetTimestamp();
            var challenge = session.PublicChallenge();
            await Emit(output, new { classification = "R7_OWNER_PUBLIC_CHALLENGE_ONLY", challenge.Audience,
                challenge.PublicSpkiBase64, challenge.PublicSpkiSha256, challenge.IssuedAtUtc, challenge.ExpiresAtUtc,
                policyAdopted = false, rootEnrollmentAuthorized = false, leaseReleaseAuthorized = false });

            string[] run = ParseStrings(await lines.ReadAsync(256, Remaining(opened)), "operation", "runId", "runAttempt");
            if (run[0] != "pair-protected-run") throw Invalid();
            var pairing = OriginalR7OwnerPeerPairing.PrepareCurrent(session, start[2], run[1], run[2]);
            await Emit(output, new { classification = "R7_OWNER_COMPARE_EXACT_PEER_BEFORE_OS_AUTHENTICATION",
                pairing.Fingerprint, pairing.ApprovalComment, pairing.RunUrl, pairing.Wire,
                policyAdopted = false, rootEnrollmentAuthorized = false, leaseReleaseAuthorized = false });
            string[] consent = ParseStrings(await lines.ReadAsync(256, Remaining(opened)), "operation", "peerFingerprint");
            if (consent[0] != "authenticate-displayed-peer" || consent[1] != pairing.Fingerprint) throw Invalid();
            // The preceding line requests a dialog; it cannot substitute for
            // the actual OS transaction or construct its private decision.
            using var decision = OriginalR7OperatingSystemPeerDecision.AuthenticateCurrentPeer(
                session, start[2], run[1], run[2]);
            await Emit(output, new { classification = "R7_OWNER_OS_PEER_FACTOR_OBSERVED_AWAITING_PROTECTED_ISSUER",
                pairing.Fingerprint, pairing.RunUrl,
                policyAdopted = false, rootEnrollmentAuthorized = false, leaseReleaseAuthorized = false });
            string[] encrypted = ParseStrings(await lines.ReadAsync(50000, Remaining(opened)), "operation", "encryptedEnvelope");
            if (encrypted[0] != "consume-owner-envelope") throw Invalid();
            var observed = await session.ConsumeOwnerTokenAsync(encrypted[1], start[2], decision);
            bool authenticated = observed.IssuerSignatureAuthenticated && observed.CurrentNativeActorBound
                && observed.PairedRunMatched && observed.OsPeerPairingDecisionAuthenticated;
            await Emit(output, new { classification = authenticated ? "R7_OWNER_PEER_AUTHENTICATED_ONLY"
                    : "R7_OWNER_PEER_AUTHENTICATION_HELD", pairing.Fingerprint, pairing.RunUrl,
                observed.IssuerSignatureAuthenticated, observed.CurrentNativeActorBound, observed.PairedRunMatched,
                observed.OsPeerPairingDecisionAuthenticated,
                policyAdopted = false, rootEnrollmentAuthorized = false, physicalContainmentProven = false,
                leaseReleaseAuthorized = false });
            return authenticated ? 0 : 6;
        }
        catch
        {
            // Never echo input, provider exceptions, credentials or identities.
            try { await Emit(output, new { classification = "R7_OWNER_PEER_AUTHENTICATION_HELD",
                policyAdopted = false, rootEnrollmentAuthorized = false, leaseReleaseAuthorized = false }); }
            catch { /* A closed own output pipe supplies no authority. */ }
            return 6;
        }
    }

    private static async Task Emit(TextWriter output, object value)
    {
        await output.WriteLineAsync(JsonSerializer.Serialize(value));
        await output.FlushAsync();
    }

    private static TimeSpan Remaining(long opened)
    {
        TimeSpan left = TimeSpan.FromMinutes(5) - Stopwatch.GetElapsedTime(opened);
        if (left <= TimeSpan.Zero) throw Invalid();
        return left;
    }

    // Closed public protocol, including duplicate/unknown properties and depth.
    // No caller supplies a SID, OS-decision flag, file path, URL or command.
    internal static string[] ParseStrings(string wire, params string[] fields)
    {
        using JsonDocument document = JsonDocument.Parse(wire, new() { MaxDepth = 2 });
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw Invalid();
        JsonProperty[] properties = document.RootElement.EnumerateObject().ToArray();
        if (properties.Length != fields.Length || properties.Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != fields.Length
            || properties.Any(p => !fields.Contains(p.Name, StringComparer.Ordinal) || p.Value.ValueKind != JsonValueKind.String)) throw Invalid();
        return fields.Select(f => document.RootElement.GetProperty(f).GetString() ?? throw Invalid()).ToArray();
    }

    private static bool Hex(string value, int length) => value.Length == length && value.Any(c => c != '0')
        && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static InvalidOperationException Invalid() => new("R7_FIXED_OWNER_PEER_PROTOCOL_INVALID");

    // Byte-bounded redirected input, not Console.ReadLine's unbounded string.
    // The only credential-shaped input is ciphertext; plaintext JWTs are never
    // accepted by this operation. A pending own pipe read cannot extend the
    // native challenge: expiry is checked again by every actual consumer.
    internal sealed class BoundedPublicLines(Stream input)
    {
        private readonly byte[] chunk = new byte[512];
        private int offset, available;
        internal async Task<string> ReadAsync(int maximum, TimeSpan timeout)
        {
            using var deadline = new CancellationTokenSource(timeout);
            using var line = new MemoryStream();
            while (true)
            {
                if (offset == available)
                {
                    available = await input.ReadAsync(chunk, deadline.Token).AsTask().WaitAsync(deadline.Token);
                    offset = 0;
                    if (available == 0) throw Invalid();
                }
                byte next = chunk[offset++];
                if (next == 10)
                {
                    byte[] bytes = line.ToArray();
                    int length = bytes.Length;
                    if (length > 0 && bytes[length - 1] == 13) length--;
                    if (length == 0) throw Invalid();
                    return new UTF8Encoding(false, true).GetString(bytes, 0, length);
                }
                if (line.Length >= maximum) throw Invalid();
                line.WriteByte(next);
            }
        }
    }
}
