using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace Stephanos.OriginalR7CustodyWitness;

// This is one necessary image-integrity shape check. A registry digest
// is NOT independent trust unless a qualified Windows owner separately proves
// the registry DACL, original actor exclusion, audit and signer isolation.
// This component never creates keys, rewrites registry/ACLs or signs claims.
internal sealed record OriginalR7ImagePinObservation(
    string Classification,
    bool ImageDigestMatchesConfiguredPin,
    bool IndependentlyProtectedPinProven,
    bool OriginalWriterExclusionProven,
    bool SignedWitnessIssued,
    bool LeaseReleaseAuthorized);

internal static class OriginalR7ImagePinPreflight
{
    private const string ParametersKey =
        @"SYSTEM\CurrentControlSet\Services\StephanosOriginalR7CustodyWitness\Parameters";
    private const string DigestName = "PinnedImageSha256";
    // The self-contained, untrimmed win-x64 runtime exceeds 64 MiB. Keep a
    // bounded 128 MiB ceiling and exercise the retained executable in CI.
    internal const long MaxImageBytes = 128L * 1024 * 1024;

    private static OriginalR7ImagePinObservation Held(string code, bool digestMatches = false)
        => new(code, digestMatches, false, false, false, false);

    // Internal deterministic evaluator for disposable hosted Windows tests.
    // It only verifies that the bytes opened in this read-only operation match
    // a supplied digest; its caller must NOT claim the digest was independently
    // provisioned. Source control, CLI and mailbox cannot supply production pin.
    internal static OriginalR7ImagePinObservation Evaluate(string? imagePath, string? digestHex)
    {
        if (!OperatingSystem.IsWindows())
            return Held("R7_IMAGE_WINDOWS_REQUIRED");

        if (digestHex is null || !Regex.IsMatch(
                digestHex, @"\A[a-f0-9]{64}\z", RegexOptions.CultureInvariant))
            return Held("R7_IMAGE_PIN_MISSING_OR_MALFORMED");

        if (string.IsNullOrEmpty(imagePath) || imagePath.Length > 240
            || !Path.IsPathFullyQualified(imagePath)
            || imagePath.StartsWith(@"\\", StringComparison.Ordinal)
            || imagePath.Length < 4 || !char.IsAsciiLetter(imagePath[0])
            || imagePath[1] != ':' || imagePath[2] != '\\'
            || imagePath.AsSpan(2).Contains(':'))
            return Held("R7_IMAGE_PATH_NONCANONICAL");

        try
        {
            string canonical = Path.GetFullPath(imagePath);
            if (!string.Equals(canonical, imagePath, StringComparison.OrdinalIgnoreCase))
                return Held("R7_IMAGE_PATH_NONCANONICAL");

            // Even a matching digest can hide ancestor junctions or active
            // writable mappings. Protected OS commissioning must independently
            // exclude those before any attestation can be made.
            if ((File.GetAttributes(canonical) & FileAttributes.ReparsePoint) != 0)
                return Held("R7_IMAGE_REPARSE_POINT_UNQUALIFIED");

            // Only read sharing is permitted. If an old writer retains a
            // conflicting writable handle this probe FAILS, never steals it.
            using FileStream stream = new(canonical, FileMode.Open, FileAccess.Read,
                FileShare.Read, 4096, FileOptions.SequentialScan);
            if (stream.Length <= 0 || stream.Length > MaxImageBytes)
                return Held("R7_IMAGE_LENGTH_OUT_OF_BOUNDS");

            byte[] digest = SHA256.HashData(stream);
            byte[] expected = Convert.FromHexString(digestHex);
            if (!CryptographicOperations.FixedTimeEquals(digest, expected))
                return Held("R7_IMAGE_DIGEST_MISMATCH");

            if ((File.GetAttributes(canonical) & FileAttributes.ReparsePoint) != 0)
                return Held("R7_IMAGE_REPARSE_POINT_UNQUALIFIED");

            // Deliberately no authority follows from matched bytes.
            return Held("R7_IMAGE_DIGEST_MATCHED_PIN_UNATTESTED", true);
        }
        catch
        {
            // Never leak file paths, tokens, hashes or Windows exception text.
            return Held("R7_IMAGE_READ_OR_IDENTITY_UNAVAILABLE");
        }
    }

    internal static OriginalR7ImagePinObservation Inspect()
    {
        if (!OperatingSystem.IsWindows())
            return Held("R7_IMAGE_WINDOWS_REQUIRED");
        try
        {
            // A framework-dependent apphost alone does not pin adjacent DLLs.
            // Only a single-file bundle can enter this diagnostic image check.
            // Protected shared-runtime/configuration custody is still unproven.
            if (!string.IsNullOrEmpty(typeof(OriginalR7ImagePinPreflight).Assembly.Location)
                || Assembly.GetEntryAssembly() != typeof(OriginalR7ImagePinPreflight).Assembly)
                return Held("R7_IMAGE_MANAGED_PAYLOAD_NOT_BUNDLED");

            using RegistryKey? registry = Registry.LocalMachine.OpenSubKey(
                ParametersKey, writable: false);
            if (registry is null || registry.GetValueKind(DigestName) != RegistryValueKind.String)
                return Held("R7_IMAGE_PIN_NOT_PROVISIONED");
            string? pin = registry.GetValue(DigestName, null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            return Evaluate(Environment.ProcessPath, pin);
        }
        catch
        {
            return Held("R7_IMAGE_TRUST_CONFIG_UNAVAILABLE");
        }
    }
}
