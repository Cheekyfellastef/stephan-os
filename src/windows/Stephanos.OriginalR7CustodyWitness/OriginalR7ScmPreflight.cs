using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32;

namespace Stephanos.OriginalR7CustodyWitness;

// Read-only SCM configuration inspection for the exact original r7 witness.
// This is a necessary installation preflight, NEVER old-writer exclusion,
// a signer, historical execution proof, or any source/lease mutation authority.
internal sealed record OriginalR7ScmObservation(
    string Classification,
    bool ScmConfigurationObserved,
    bool OriginalWriterExclusionProven,
    bool ProtectedAuditProven,
    bool IndependentSigningProven,
    bool LeaseReleaseAuthorized);

internal static class OriginalR7ScmPreflight
{
    private const string ServiceName = "StephanosOriginalR7CustodyWitness";
    private const string ServiceKey = @"SYSTEM\CurrentControlSet\Services\StephanosOriginalR7CustodyWitness";
    private const string FixedAccount = @"NT SERVICE\StephanosOriginalR7CustodyWitness";
    // Windows SERVICE_WIN32_OWN_PROCESS=0x10,
    // SERVICE_AUTO_START=2, SERVICE_SID_TYPE_RESTRICTED=3.
    private const int OwnProcess = 0x10;
    private const int AutoStart = 2;
    private const int RestrictedServiceSid = 3;

    private static OriginalR7ScmObservation Held(string reason, bool shape = false)
        => new(reason, shape, false, false, false, false);

    // Caller cannot choose a service, identity, binary, or source path.
    // Evaluation is internal to this assembly for bounded Windows CI tests.
    internal static OriginalR7ScmObservation Evaluate(
        string? objectName, int? type, int? start, int? sidType,
        string? registeredImage, string? actualImage,
        string? pinnedImageDigest, string? observedImageDigest)
    {
        if (!OperatingSystem.IsWindows())
            return Held("R7_SCM_WINDOWS_REQUIRED");
        if (!String.Equals(objectName, FixedAccount, StringComparison.OrdinalIgnoreCase)
            || type != OwnProcess || start != AutoStart
            || sidType != RestrictedServiceSid)
            return Held("R7_SCM_FIXED_SERVICE_CONFIGURATION_UNPROVEN");
        if (String.IsNullOrWhiteSpace(registeredImage)
            || String.IsNullOrWhiteSpace(actualImage))
            return Held("R7_SCM_EXECUTABLE_IDENTITY_UNPROVEN");

        // A service binary accepting command-line arguments could impersonate
        // this host's image, or be loaded through an env-var/reparse alias.
        // Permit only the exact unexpanded full image path, optionally quoted.
        string raw = registeredImage.Trim();
        if (raw.Length >= 2 && raw[0] == '"' && raw[^1] == '"')
            raw = raw[1..^1];
        if (raw.IndexOfAny(new[] { '"', '%', '\r', '\n', '\0' }) >= 0
            || raw != raw.Trim()
            || !Path.IsPathFullyQualified(raw)
            || !Path.IsPathFullyQualified(actualImage))
            return Held("R7_SCM_EXECUTABLE_IDENTITY_UNPROVEN");
        try
        {
            string canonicalRegistered = Path.GetFullPath(raw);
            string canonicalActual = Path.GetFullPath(actualImage);
            if (!String.Equals(raw, canonicalRegistered, StringComparison.OrdinalIgnoreCase)
                || !String.Equals(canonicalRegistered, canonicalActual,
                    StringComparison.OrdinalIgnoreCase))
                return Held("R7_SCM_EXECUTABLE_IDENTITY_UNPROVEN");
        }
        catch
        {
            return Held("R7_SCM_EXECUTABLE_IDENTITY_UNPROVEN");
        }

        // A path-equal but changed image cannot even qualify as a service
        // shape. This digest is pinned in SCM configuration, NOT an independent
        // protected trust root; its ACL and provenance still require separate
        // physical proof. No signing or lease authority follows a match.
        if (!ExactLowerSha256(pinnedImageDigest) || !ExactLowerSha256(observedImageDigest)
            || !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(pinnedImageDigest!),
                Convert.FromHexString(observedImageDigest!)))
            return Held("R7_SCM_PINNED_IMAGE_DIGEST_UNPROVEN");

        // A matching registry digest is only read-only commissioning
        // readiness, not protected image provenance, source-writer exclusion,
        // an independently provisioned signer, or a custody attestation.
        return Held("R7_SCM_SHAPE_OBSERVED_NOT_PHYSICAL_CUSTODY", true);
    }

    private static bool ExactLowerSha256(string? value)
    {
        if (value is null || value.Length != 64) return false;
        foreach (char ch in value)
            if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')))
                return false;
        return true;
    }

    // A framework-dependent apphost hash does not cover its adjacent witness
    // DLL. Require the executing witness AND managed core to be loaded from
    // a self-contained bundle before considering the executable digest.
    // Empty Location is the .NET single-file contract, not proof of protected
    // mapped-code provenance or native extraction-directory protection.
    internal static bool BundledPayloadObserved()
    {
        try
        {
            Assembly witness = typeof(OriginalR7ScmPreflight).Assembly;
#pragma warning disable IL3000 // Deliberately reject separately loaded assemblies.
            return ReferenceEquals(Assembly.GetEntryAssembly(), witness)
                && witness.Location == String.Empty
                && typeof(object).Assembly.Location == String.Empty;
#pragma warning restore IL3000
        }
        catch
        {
            return false;
        }
    }

    // Physical read of the currently executing image path. Any directory
    // junction, symlink or other reparse point in the chain is an unsafe
    // image alias. This still cannot attest to the image mapped at service
    // launch or prove the registry pin's independent write protection.
    private static bool LocalImageHasNoReparseAncestors(string path)
    {
        if (path.StartsWith(@"\\", StringComparison.Ordinal)
            || path.Length < 3
            || !Char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\'
            || !String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
            return false;
        string? current = path;
        while (!String.IsNullOrEmpty(current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                return false;
            string? parent = Path.GetDirectoryName(current);
            if (String.IsNullOrEmpty(parent) || String.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                break;
            current = parent;
        }
        return true;
    }

    internal static OriginalR7ScmObservation Inspect()
    {
        if (!OperatingSystem.IsWindows())
            return Held("R7_SCM_WINDOWS_REQUIRED");
        if (!BundledPayloadObserved())
            return Held("R7_SCM_BUNDLED_PAYLOAD_UNPROVEN");
        try
        {
            using RegistryKey? key = Registry.LocalMachine.OpenSubKey(ServiceKey, writable: false);
            if (key is null) return Held("R7_SCM_SERVICE_NOT_REGISTERED");

            SecurityIdentifier serviceSid = (SecurityIdentifier)new NTAccount(
                "NT SERVICE", ServiceName).Translate(typeof(SecurityIdentifier));
            byte[]? registrationSecurity = OriginalR7RegistryProtection.ReadDescriptor(key);
            if (!OriginalR7RegistryProtection.Evaluate(registrationSecurity, serviceSid))
                return Held("R7_SCM_REGISTRY_PROTECTION_UNPROVEN");

            string? image = key.GetValue("ImagePath", null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            string? account = key.GetValue("ObjectName", null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            string? pinnedDigest = key.GetValue("PinnedImageSha256", null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            int? type = key.GetValue("Type") is int t ? t : null;
            int? start = key.GetValue("Start") is int s ? s : null;
            int? sidType = key.GetValue("ServiceSidType") is int st ? st : null;

            string? runningBinary = Environment.ProcessPath;
            if (String.IsNullOrWhiteSpace(runningBinary)
                || !File.Exists(runningBinary)
                || !LocalImageHasNoReparseAncestors(runningBinary))
                return Held("R7_SCM_EXECUTABLE_FILE_UNPROVEN");
            if (!ExactLowerSha256(pinnedDigest))
                return Held("R7_SCM_PINNED_IMAGE_DIGEST_UNPROVEN");

            // The binary is only read, never modified. Detect changes in
            // length/write time around hashing and always remain fail-closed
            // about protected pin provenance and historical source custody.
            var before = new FileInfo(runningBinary);
            long length = before.Length;
            DateTime modified = before.LastWriteTimeUtc;
            string observedDigest;
            using (FileStream stream = new(runningBinary, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete))
                observedDigest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            var after = new FileInfo(runningBinary);
            if (length != after.Length || modified != after.LastWriteTimeUtc
                || !LocalImageHasNoReparseAncestors(runningBinary))
                return Held("R7_SCM_EXECUTABLE_FILE_UNPROVEN");

            // Detect a changed sampled descriptor on the retained key, rather
            // than reading security from a second path-selected registration.
            // This is not continuous protection or parent-key replacement proof.
            byte[]? afterSecurity = OriginalR7RegistryProtection.ReadDescriptor(key);
            if (afterSecurity is null || !CryptographicOperations.FixedTimeEquals(
                registrationSecurity!, afterSecurity))
                return Held("R7_SCM_REGISTRY_PROTECTION_CHANGED");

            return Evaluate(account, type, start, sidType, image, runningBinary,
                pinnedDigest, observedDigest);
        }
        catch
        {
            // Never expose local service paths, SIDs, or registry data.
            return Held("R7_SCM_CONFIGURATION_READ_FAILED_CLOSED");
        }
    }
}
