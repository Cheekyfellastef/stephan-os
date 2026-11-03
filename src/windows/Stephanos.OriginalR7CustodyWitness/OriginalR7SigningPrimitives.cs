using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using BcEd25519 = Org.BouncyCastle.Math.EC.Rfc8032.Ed25519;

namespace Stephanos.OriginalR7CustodyWitness;

internal enum OriginalR7SignaturePurpose { Witness, Operator }

// A software primitive, NOT a trust/custody provider. It never opens a host
// key, creates/enrolls a root, consumes request authority, or issues a lease.
internal static class OriginalR7SigningPrimitives
{
    internal const int MaxPayloadBytes = 16 * 1024;
    internal const string PackageVersion = "2.7.0";
    internal const string PublisherNet6Sha256 = "ef92fc661e8d7ba8ec4d39a7cdfcdba41f14cb327f0d24fe79d0b5bb428899b5";
    internal const string SourceCommit = "4007498b13582d90ee1eda5d9920c324428b98b3";
    internal const string WitnessDomain = "stephanos.legacy-orphan-os-witness.v1\0";
    internal const string OperatorDomain = "stephanos.legacy-orphan-operator-approval.v1\0";
    private static readonly UTF8Encoding Utf8 = new(false, true);

    internal static byte[] PublicKey(ReadOnlySpan<byte> seed)
    {
        if (seed.Length != 32) throw Held("SEED_SIZE");
        Span<byte> owned = stackalloc byte[32];
        seed.CopyTo(owned);
        try
        {
            byte[] key = new byte[32];
            BcEd25519.GeneratePublicKey(owned, key);
            return key;
        }
        finally { CryptographicOperations.ZeroMemory(owned); }
    }

    // Only supplied in-memory algorithm material, including public RFC8032
    // test vectors. No operational endpoint calls this with caller claims.
    internal static byte[] SignDetached(ReadOnlySpan<byte> seed, ReadOnlySpan<byte> message)
    {
        if (seed.Length != 32 || message.Length > MaxPayloadBytes + 128)
            throw Held("SEED_OR_MESSAGE_BOUND");
        Span<byte> owned = stackalloc byte[32];
        seed.CopyTo(owned);
        byte[] signature = new byte[64];
        try
        {
            BcEd25519.Sign(owned, message, signature);
            Span<byte> publicKey = stackalloc byte[32];
            BcEd25519.GeneratePublicKey(owned, publicKey);
            if (!BcEd25519.Verify(signature, publicKey, message)) throw Held("SELF_VERIFY_FAILED");
            return signature;
        }
        catch
        {
            CryptographicOperations.ZeroMemory(signature);
            throw Held("SIGN_FAILED_CLOSED");
        }
        finally { CryptographicOperations.ZeroMemory(owned); }
    }

    internal static bool Verify(ReadOnlySpan<byte> publicKey, ReadOnlySpan<byte> message, ReadOnlySpan<byte> signature)
    {
        if (publicKey.Length != 32 || signature.Length != 64 || message.Length > MaxPayloadBytes + 128) return false;
        try { return BcEd25519.Verify(signature, publicKey, message); }
        catch { return false; }
    }

    // RFC8410 SPKI wrapper for Ed25519. Public output only; the two digests
    // deliberately distinguish SPKI identity from a PEM trust-file byte pin.
    internal static byte[] PublicSpki(ReadOnlySpan<byte> publicKey)
    {
        if (publicKey.Length != 32) throw Held("PUBLIC_KEY_SIZE");
        byte[] result = new byte[44];
        Convert.FromHexString("302a300506032b6570032100").CopyTo(result, 0);
        publicKey.CopyTo(result.AsSpan(12));
        return result;
    }
    internal static string PublicPem(ReadOnlySpan<byte> publicKey)
        => "-----BEGIN PUBLIC KEY-----\n" + Convert.ToBase64String(PublicSpki(publicKey))
            + "\n-----END PUBLIC KEY-----\n";

    internal static byte[] DomainMessage(OriginalR7SignaturePurpose purpose, ReadOnlySpan<byte> canonicalClaims)
    {
        string domain = purpose switch {
            OriginalR7SignaturePurpose.Witness => WitnessDomain,
            OriginalR7SignaturePurpose.Operator => OperatorDomain,
            _ => throw Held("PURPOSE_INVALID")
        };
        if (canonicalClaims.Length is < 2 or > MaxPayloadBytes) throw Held("CLAIMS_BOUND");
        byte[] claims = canonicalClaims.ToArray();
        try
        {
            string wire = Utf8.GetString(claims);
            // Fail closed on unsupported Unicode rather than sign bytes that
            // JSON.stringify may canonicalize differently. Current identifiers
            // and this target's paths are ASCII. This is not a universal encoder.
            if (wire.Any(c => c > 0x7f)) throw Held("NON_ASCII_WIRE_UNSUPPORTED");
            using JsonDocument parsed = JsonDocument.Parse(claims, new() { MaxDepth = 2 });
            if (parsed.RootElement.ValueKind != JsonValueKind.Object) throw Held("CLAIMS_OBJECT_REQUIRED");
            HashSet<string> seen = new(StringComparer.Ordinal);
            using MemoryStream normalized = new();
            using (Utf8JsonWriter writer = new(normalized, new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            {
                writer.WriteStartObject();
                foreach (JsonProperty item in parsed.RootElement.EnumerateObject())
                {
                    if (seen.Count >= 64 || !seen.Add(item.Name)) throw Held("CLAIMS_DUPLICATE_OR_LIMIT");
                    if (item.Name.Any(c => c < 0x20 || c >= 0x7f) || IsJavaScriptArrayIndex(item.Name))
                        throw Held("CLAIMS_NAME_UNSUPPORTED");
                    writer.WritePropertyName(item.Name);
                    switch (item.Value.ValueKind)
                    {
                        case JsonValueKind.String:
                            string text = item.Value.GetString() ?? throw Held("CLAIMS_STRING_REQUIRED");
                            if (text.Any(c => c < 0x20 || c >= 0x7f)) throw Held("CLAIMS_STRING_UNSUPPORTED");
                            writer.WriteStringValue(text); break;
                        case JsonValueKind.True: writer.WriteBooleanValue(true); break;
                        case JsonValueKind.False: writer.WriteBooleanValue(false); break;
                        case JsonValueKind.Number:
                            if (!item.Value.TryGetInt64(out long n) || n is < -9007199254740991L or > 9007199254740991L)
                                throw Held("CLAIMS_NUMBER_UNSUPPORTED");
                            writer.WriteNumberValue(n); break;
                        default: throw Held("CLAIMS_VALUE_UNSUPPORTED");
                    }
                }
                writer.WriteEndObject();
            }
            if (!normalized.ToArray().AsSpan().SequenceEqual(claims)) throw Held("CLAIMS_NONCANONICAL");
            byte[] prefix = Utf8.GetBytes(domain);
            byte[] output = new byte[prefix.Length + claims.Length];
            prefix.CopyTo(output, 0);
            claims.CopyTo(output, prefix.Length);
            return output;
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("R7_SOFTWARE_", StringComparison.Ordinal)) { throw; }
        catch { throw Held("CLAIMS_INVALID"); }
        finally { CryptographicOperations.ZeroMemory(claims); }
    }

    // The exact JSON.stringify interpretation of the signed part, including
    // Base64 + / = characters, is what the canonical operator witnessDigest
    // hashes. Never hash a default serializer's differently escaped envelope.
    internal static byte[] CanonicalSignaturePart(OriginalR7SignaturePurpose purpose,
        ReadOnlySpan<byte> canonicalClaims, OriginalR7SoftwareSignature signature)
    {
        byte[] message = DomainMessage(purpose, canonicalClaims);
        try
        {
            if (signature.Algorithm != "Ed25519"
                || Convert.FromBase64String(signature.SignatureBase64).Length != 64
                || Convert.ToBase64String(Convert.FromBase64String(signature.SignatureBase64)) != signature.SignatureBase64)
                throw Held("SIGNATURE_SHAPE");
            using MemoryStream output = new();
            using (Utf8JsonWriter writer = new(output, new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
            {
                writer.WriteStartObject();
                writer.WriteString("algorithm", "Ed25519");
                writer.WritePropertyName("claims");
                writer.WriteRawValue(canonicalClaims, skipInputValidation: false);
                writer.WriteString("signatureBase64", signature.SignatureBase64);
                writer.WriteEndObject();
            }
            return output.ToArray();
        }
        finally { CryptographicOperations.ZeroMemory(message); }
    }

    // JSON.stringify sorts canonical array-index names ahead of other keys.
    // This bounded encoder preserves insertion order, so reject that subset.
    private static bool IsJavaScriptArrayIndex(string name)
        => name.Length is >= 1 and <= 10 && (name == "0" || name[0] != '0')
            && uint.TryParse(name, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out uint index)
            && index != uint.MaxValue;

    private static InvalidOperationException Held(string code) => new("R7_SOFTWARE_" + code);
}

internal sealed record OriginalR7SoftwareSignature(
    string Algorithm, string PublicKeyPem, string PublicSpkiSha256,
    string PublicPemSha256, string SignatureBase64)
{
    internal bool PolicyAdopted => false;
    internal bool KeyCustodyProven => false;
    internal bool HardwareNonExportableKeyProven => false;
    internal bool NativeContainmentProven => false;
    internal bool LeaseReleaseAuthorized => false;
}

// Bounded retained-stream material adapter for algorithm/lifecycle preparation.
// The stream constructor is an INTERNAL UNTRUSTED fixture seam; it does not
// attest a Windows path, descriptor, principal or enrolled production key.
// Production opening remains behind the real fixed-host admission boundary.
internal sealed class OriginalR7SoftwareSeedSession : IDisposable
{
    private readonly object sync = new();
    private readonly FileStream retained;
    private readonly OriginalR7SignaturePurpose purpose;
    private readonly byte[] seed = new byte[32];
    private bool disposed, poisoned;

    internal OriginalR7SoftwareSeedSession(FileStream untrustedRetainedStream, OriginalR7SignaturePurpose fixedPurpose)
    {
        retained = untrustedRetainedStream ?? throw Held("STREAM_REQUIRED");
        purpose = fixedPurpose;
        try
        {
            if (!Enum.IsDefined(purpose) || !retained.CanRead || retained.CanWrite || !retained.CanSeek
                || RandomAccess.GetLength(retained.SafeFileHandle) != 32) throw Held("READ_ONLY_32_BYTE_MATERIAL_REQUIRED");
            ReadRetained(seed);
            Span<byte> readback = stackalloc byte[32];
            try
            {
                ReadRetained(readback);
                if (RandomAccess.GetLength(retained.SafeFileHandle) != 32 || !CryptographicOperations.FixedTimeEquals(seed, readback))
                    throw Held("MATERIAL_READBACK_CHANGED");
            }
            finally { CryptographicOperations.ZeroMemory(readback); }
        }
        catch
        {
            CryptographicOperations.ZeroMemory(seed);
            retained.Dispose();
            disposed = true;
            throw Held("MATERIAL_IMPORT_FAILED_CLOSED");
        }
    }

    internal OriginalR7SoftwareSignature SignForAlgorithmPreparation(
        OriginalR7SignaturePurpose requestedPurpose, ReadOnlySpan<byte> canonicalClaims)
    {
        lock (sync)
        {
            if (disposed || poisoned) throw Held("SESSION_OR_PURPOSE_UNQUALIFIED");
            if (requestedPurpose != purpose)
            {
                poisoned = true;
                CryptographicOperations.ZeroMemory(seed);
                throw Held("SESSION_OR_PURPOSE_UNQUALIFIED");
            }
            byte[]? message = null;
            try
            {
                // Recheck the retained bytes for every operation. This is still
                // not an authenticated Windows custody or key-enrollment fact.
                Span<byte> current = stackalloc byte[32];
                try
                {
                    ReadRetained(current);
                    if (RandomAccess.GetLength(retained.SafeFileHandle) != 32 || !CryptographicOperations.FixedTimeEquals(seed, current))
                        throw Held("MATERIAL_CHANGED");
                }
                finally { CryptographicOperations.ZeroMemory(current); }
                message = OriginalR7SigningPrimitives.DomainMessage(purpose, canonicalClaims);
                byte[] signature = OriginalR7SigningPrimitives.SignDetached(seed, message);
                byte[] pub = OriginalR7SigningPrimitives.PublicKey(seed);
                byte[] spki = OriginalR7SigningPrimitives.PublicSpki(pub);
                string pem = OriginalR7SigningPrimitives.PublicPem(pub);
                return new("Ed25519", pem,
                    Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant(),
                    Convert.ToHexString(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(pem))).ToLowerInvariant(),
                    Convert.ToBase64String(signature));
            }
            catch
            {
                poisoned = true;
                CryptographicOperations.ZeroMemory(seed);
                throw Held("PREPARATION_SIGN_FAILED_CLOSED");
            }
            finally { if (message is not null) CryptographicOperations.ZeroMemory(message); }
        }
    }

    // RandomAccess bypasses FileStream's read cache, so repeated retained
    // readback is a new OS read rather than a replay of imported bytes.
    private void ReadRetained(Span<byte> destination)
    {
        int offset = 0;
        while (offset < destination.Length)
        {
            int read = RandomAccess.Read(retained.SafeFileHandle, destination[offset..], offset);
            if (read <= 0) throw Held("MATERIAL_SHORT_READ");
            offset += read;
        }
    }

    public void Dispose()
    {
        lock (sync)
        {
            if (disposed) return;
            disposed = true;
            CryptographicOperations.ZeroMemory(seed);
            retained.Dispose();
        }
    }
    private static InvalidOperationException Held(string code) => new("R7_SOFTWARE_SEED_" + code);
}
