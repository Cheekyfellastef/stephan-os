using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

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
    // Stage-B and the SCM preflight protect and read the fixed service key.
    // Read that same pin, not a second unprovisioned Parameters value.
    private const string ServiceKey =
        @"SYSTEM\CurrentControlSet\Services\StephanosOriginalR7CustodyWitness";
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

    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("SingleFile", "IL3000",
        Justification = "Intentional bundle identity check: a nonempty managed assembly location is rejected; no location is used as a load path.")]
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
                ServiceKey, writable: false);
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

// Retained local source binding for the separate inactive-root purpose session.
// This is NOT issuer authentication, a protected-launch claim,
// source-principal exclusion, root adoption or a lease capability. The genuine
// owner issuer and fresh native OS decision must authenticate the exact permit
// before this object may join the in-process authenticated purpose capability.
// Actual key creation additionally requires continuous native creation custody.
internal sealed class OriginalR7NativeProvisioningSource : IDisposable
{
    internal sealed record Permit(string PermitSha256, string ExpectedMain,
        string OriginalLeaseDigest, string SourceExecutionId, string ImageSha256,
        DateTimeOffset IssuedAtUtc, DateTimeOffset ExpiresAtUtc);

    private readonly Permit permit;
    private readonly string imagePath;
    private readonly List<(string Path, SafeFileHandle Handle)> ancestors = new();
    private FileStream? image;
    private readonly long opened = Stopwatch.GetTimestamp();
    private bool disposed;
    internal string PermitSha256 => permit.PermitSha256;
    internal string ExpectedMain => permit.ExpectedMain;
    internal string OriginalLeaseDigest => permit.OriginalLeaseDigest;
    internal string SourceExecutionId => permit.SourceExecutionId;

    private OriginalR7NativeProvisioningSource(Permit permit, string path)
    { this.permit = permit; imagePath = path; }

    // No caller-selected filename, digest-only pin, clock or fixture opener is
    // accepted at the production boundary. The only file opened is this exact
    // installed bundle; all ancestors and its file object remain retained.
    internal static OriginalR7NativeProvisioningSource OpenCurrent(string exactPermitWire)
    {
        if (!OperatingSystem.IsWindows() || !Environment.UserInteractive
            || !OriginalR7ScmPreflight.BundledPayloadObserved())
            throw Held("CURRENT_NATIVE_BUNDLE_REQUIRED");
        Permit permit = ParsePermit(exactPermitWire, DateTimeOffset.UtcNow);
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string expected = Path.Combine(programFiles, "StephanosR7CustodyWitness",
            "Stephanos.OriginalR7CustodyWitness.exe");
        if (string.IsNullOrEmpty(programFiles) || !CanonicalLocal(expected)
            || !string.Equals(Environment.ProcessPath, expected, StringComparison.OrdinalIgnoreCase))
            throw Held("FIXED_INSTALLED_IMAGE_REQUIRED");
        OriginalR7NativeProvisioningSource retained = new(permit, expected);
        try
        {
            Stack<string> chain = new();
            for (DirectoryInfo? directory = new(Path.GetDirectoryName(expected)!);
                directory is not null; directory = directory.Parent)
            {
                if (chain.Count >= 32) throw Held("ANCESTOR_BOUND");
                chain.Push(directory.FullName);
            }
            while (chain.TryPop(out string? path))
                retained.ancestors.Add((path, OriginalR7AuditStorage.OpenPinnedDirectory(path, false)));
            SafeFileHandle handle = CreateFileW(expected, 0x80000000, 1, IntPtr.Zero,
                3, 0x08200000 /* SEQUENTIAL_SCAN | OPEN_REPARSE_POINT */, IntPtr.Zero);
            try
            {
                if (!OriginalR7AuditStorage.NativeIdentityMatches(handle, expected, false))
                    throw Held("IMAGE_IDENTITY");
                retained.image = new FileStream(handle, FileAccess.Read, 4096, false);
            }
            catch { handle.Dispose(); throw; }
            retained.RequireCurrent();
            return retained;
        }
        catch
        {
            retained.Dispose();
            throw Held("INSTALLED_SOURCE_UNAVAILABLE");
        }
    }

    internal void RequireCurrent()
    {
        if (disposed || image is null || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5)
            || DateTimeOffset.UtcNow < permit.IssuedAtUtc || DateTimeOffset.UtcNow >= permit.ExpiresAtUtc
            || !OriginalR7ScmPreflight.BundledPayloadObserved()
            || !string.Equals(Environment.ProcessPath, imagePath, StringComparison.OrdinalIgnoreCase))
            throw Held("SOURCE_BINDING_EXPIRED_OR_TERMINAL");
        try
        {
            foreach (var ancestor in ancestors)
                if (!OriginalR7AuditStorage.NativeIdentityMatches(ancestor.Handle, ancestor.Path, true))
                    throw Held("ANCESTOR_CHANGED");
            if (!OriginalR7AuditStorage.NativeIdentityMatches(image.SafeFileHandle, imagePath, false)
                || image.Length <= 0 || image.Length > OriginalR7ImagePinPreflight.MaxImageBytes)
                throw Held("IMAGE_CHANGED_OR_OUT_OF_BOUNDS");
            image.Position = 0;
            byte[] observed = SHA256.HashData(image);
            image.Position = 0;
            if (!CryptographicOperations.FixedTimeEquals(observed, Convert.FromHexString(permit.ImageSha256)))
                throw Held("IMAGE_DIGEST_MISMATCH");
            DateTimeOffset completedAt = DateTimeOffset.UtcNow;
            if (completedAt < permit.IssuedAtUtc || completedAt >= permit.ExpiresAtUtc
                || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromMinutes(5))
                throw Held("SOURCE_BINDING_EXPIRED_OR_TERMINAL");
        }
        catch (InvalidOperationException exception) when (exception.Message.StartsWith("R7_PROVISION_SOURCE_", StringComparison.Ordinal)) { throw; }
        catch { throw Held("SOURCE_READBACK_UNAVAILABLE"); }
    }

    // Pure closed-world parsing is testable independently. A parsed record has
    // no constructor/factory for the retained source capability or provisioning
    // grant. Actual source/review/package authentication belongs to the issuer.
    internal static Permit ParsePermit(string wire, DateTimeOffset now)
    {
        try
        {
            if (wire is null || wire.Length is < 2 or > 16384 || wire.Any(c => c > 0x7f))
                throw Held("PERMIT_BOUND");
            using JsonDocument document = JsonDocument.Parse(wire, new() { MaxDepth = 5 });
            JsonElement root = document.RootElement;
            RequireKeys(root, "schemaVersion", "purpose", "repository", "capabilityIssue", "prNumber",
                "requestId", "original", "candidate", "review", "hostPolicyProposalDigest",
                "fixedRecipeDigest", "issuedAtUtc", "expiresAtUtc");
            string canonical = JsonSerializer.Serialize(root, new JsonSerializerOptions {
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            });
            if (wire != canonical || Text(root, "schemaVersion") != "stephanos.r7-first-root-owner-intake-proposal.v1"
                || Text(root, "purpose") != "R7_FIRST_ROOT_OWNER_POLICY_INTAKE"
                || Text(root, "repository") != "Cheekyfellastef/stephan-os"
                || root.GetProperty("capabilityIssue").GetRawText() != "3123"
                || root.GetProperty("prNumber").GetRawText() != "3178"
                || !Regex.IsMatch(Text(root, "requestId"), @"\A[a-z0-9][a-z0-9._:-]{7,119}\z")
                || !Hex(Text(root, "hostPolicyProposalDigest"), 64)
                || !Hex(Text(root, "fixedRecipeDigest"), 64))
                throw Held("PERMIT_FIXED_IDENTITY");
            JsonElement original = root.GetProperty("original");
            RequireKeys(original, "missionId", "leaseId", "leaseRevision", "leaseDigest", "sourceExecutionId",
                "branch", "sourceHead", "historicalOutcome");
            if (Text(original, "missionId") != "critical-2962-elastic-goal"
                || Text(original, "leaseId") != "critical-2962-elastic-goal-r7-lease"
                || original.GetProperty("leaseRevision").GetRawText() != "7"
                || !Hex(Text(original, "leaseDigest"), 64)
                || !Regex.IsMatch(Text(original, "sourceExecutionId"), @"\Acritical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}\z")
                || Text(original, "branch") != "openclaw/elastic-goal-2962"
                || Text(original, "sourceHead") != "4e5023eef829b285095db4eeb09d6f2b365e33e4"
                || Text(original, "historicalOutcome") != "UNKNOWN")
                throw Held("ORIGINAL_IDENTITY");
            JsonElement candidate = root.GetProperty("candidate"), review = root.GetProperty("review");
            RequireKeys(candidate, "branch", "sourceHead", "sourceTree", "reviewedBase", "sourceMergeCommit",
                "expectedMain", "imageSha256", "bundleSha256", "manifestSha256");
            if (Text(candidate, "branch") != "feature/3123-r7-registry-protection-readback-20261020"
                || new[] { "sourceHead", "sourceTree", "reviewedBase", "sourceMergeCommit", "expectedMain" }
                    .Any(key => !Hex(Text(candidate, key), 40))
                || new[] { "imageSha256", "bundleSha256", "manifestSha256" }.Any(key => !Hex(Text(candidate, key), 64))
                || Text(candidate, "sourceHead") == Text(candidate, "reviewedBase"))
                throw Held("CANDIDATE_IDENTITY");
            RequireKeys(review, "runId", "runAttempt", "artifactId", "archiveSha256", "payloadSha256",
                "reviewedSourceHead", "reviewedSourceTree", "reviewedBase");
            if (new[] { "runId", "runAttempt", "artifactId" }.Any(key => !DecimalId(Text(review, key)))
                || new[] { "archiveSha256", "payloadSha256" }.Any(key => !Hex(Text(review, key), 64))
                || Text(review, "reviewedSourceHead") != Text(candidate, "sourceHead")
                || Text(review, "reviewedSourceTree") != Text(candidate, "sourceTree")
                || Text(review, "reviewedBase") != Text(candidate, "reviewedBase"))
                throw Held("EXACT_REVIEW_BINDING");
            DateTimeOffset issued = Time(Text(root, "issuedAtUtc")), expires = Time(Text(root, "expiresAtUtc"));
            if (issued > now || expires <= now || expires <= issued || expires - issued > TimeSpan.FromMinutes(5))
                throw Held("PERMIT_EXPIRED_OR_FUTURE");
            return new(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(wire))).ToLowerInvariant(),
                Text(candidate, "expectedMain"), Text(original, "leaseDigest"), Text(original, "sourceExecutionId"),
                Text(candidate, "imageSha256"), issued, expires);
        }
        catch (InvalidOperationException exception) when (exception.Message.StartsWith("R7_PROVISION_SOURCE_", StringComparison.Ordinal)) { throw; }
        catch { throw Held("PERMIT_INVALID"); }
    }

    private static void RequireKeys(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Held("PERMIT_OBJECT_REQUIRED");
        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (JsonProperty item in value.EnumerateObject())
            if (!seen.Add(item.Name) || !keys.Contains(item.Name, StringComparer.Ordinal))
                throw Held("PERMIT_CLOSED_WORLD");
        if (seen.Count != keys.Length) throw Held("PERMIT_FIELDS");
    }
    private static string Text(JsonElement value, string key)
        => value.GetProperty(key).GetString() ?? throw Held("PERMIT_STRING_REQUIRED");
    private static bool Hex(string value, int length) => value.Length == length && value.Any(c => c != '0')
        && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static bool DecimalId(string value) => Regex.IsMatch(value, @"\A[1-9][0-9]{0,19}\z")
        && ulong.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out _);
    private static DateTimeOffset Time(string value)
    {
        if (!DateTimeOffset.TryParseExact(value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out DateTimeOffset time))
            throw Held("PERMIT_TIME");
        return time;
    }
    private static bool CanonicalLocal(string path) => path.Length is >= 4 and <= 240
        && char.IsAsciiLetter(path[0]) && path[1] == ':' && path[2] == '\\'
        && !path.Contains('/') && !path.AsSpan(2).Contains(':')
        && string.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase);
    private static InvalidOperationException Held(string code) => new("R7_PROVISION_SOURCE_" + code);
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        image?.Dispose(); image = null;
        for (int index = ancestors.Count - 1; index >= 0; index--) ancestors[index].Handle.Dispose();
        ancestors.Clear();
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
}
