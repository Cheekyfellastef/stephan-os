using System;
using System.IO;
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
        string? registeredImage, string? actualImage)
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

        // This result is intentionally not source custody. In particular it
        // does not check the original worker's SIDs, old write handles,
        // alternate launch tokens or authorise an attestation.
        return Held("R7_SCM_SHAPE_OBSERVED_NOT_PHYSICAL_CUSTODY", true);
    }

    internal static OriginalR7ScmObservation Inspect()
    {
        if (!OperatingSystem.IsWindows())
            return Held("R7_SCM_WINDOWS_REQUIRED");
        try
        {
            using RegistryKey? key = Registry.LocalMachine.OpenSubKey(ServiceKey, writable: false);
            if (key is null) return Held("R7_SCM_SERVICE_NOT_REGISTERED");

            string? image = key.GetValue("ImagePath", null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            string? account = key.GetValue("ObjectName", null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            int? type = key.GetValue("Type") is int t ? t : null;
            int? start = key.GetValue("Start") is int s ? s : null;
            int? sidType = key.GetValue("ServiceSidType") is int st ? st : null;

            string? runningBinary = Environment.ProcessPath;
            if (String.IsNullOrWhiteSpace(runningBinary)
                || !File.Exists(runningBinary)
                || (File.GetAttributes(runningBinary) & FileAttributes.ReparsePoint) != 0)
                return Held("R7_SCM_EXECUTABLE_FILE_UNPROVEN");

            return Evaluate(account, type, start, sidType, image, runningBinary);
        }
        catch
        {
            // Never expose local service paths, SIDs, or registry data.
            return Held("R7_SCM_CONFIGURATION_READ_FAILED_CLOSED");
        }
    }
}
