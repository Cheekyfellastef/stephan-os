using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Stephanos.OriginalR7DaclReadback;

// Untrusted local DACL observations must NEVER authorize original source
// custody, access revocation, a historical success receipt or lease release.
public sealed record R7DaclObservation(
    string Classification,
    bool PolicyShapeObserved,
    bool PhysicalWriterDenialProven,
    bool AuthenticatedOsWitness,
    bool SourceMutationAuthorized,
    bool LeaseReleaseAuthorized,
    bool HistoricalReceiptReconstructed);

public static class R7DaclReadback
{
    private static R7DaclObservation Result(string classification, bool structural = false)
        => new(classification, structural, false, false, false, false, false);

    // Invoked only by future independently protected service code with
    // machine-attested target identity. There is deliberately no executable
    // CLI, network listener, arbitrary shell, signer or caller-supplied result.
    public static R7DaclObservation ObservePolicyShape(string directoryPath, string originalWriterSid)
    {
        if (!OperatingSystem.IsWindows()
            || string.IsNullOrWhiteSpace(directoryPath)
            || string.IsNullOrWhiteSpace(originalWriterSid)
            || !Path.IsPathFullyQualified(directoryPath))
            return Result("R7_DACL_IDENTITY_OR_WINDOWS_UNPROVEN");

        try
        {
            var writer = new SecurityIdentifier(originalWriterSid);
            var directory = new DirectoryInfo(directoryPath);
            if (!directory.Exists
                || (directory.Attributes & FileAttributes.ReparsePoint) != 0)
                return Result("R7_DACL_DIRECTORY_UNTRUSTED_OR_UNAVAILABLE");

            var security = directory.GetAccessControl(
                AccessControlSections.Access | AccessControlSections.Owner);
            // An original source writer which still owns the directory may
            // rewrite its DACL. Refuse even structurally plausible deny rules.
            var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
            if (owner is null || owner.Equals(writer))
                return Result("R7_DACL_ORIGINAL_WRITER_STILL_OWNER_OR_UNKNOWN");

            // Strict shape check only. Effective group privileges, alternate
            // tokens, direct/WMI/COM/task launches, TOCTOU and real negative
            // write probes are NOT validated here.
            var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier))
                .OfType<FileSystemAccessRule>();
            var inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            bool deny = security.AreAccessRulesProtected
                && rules.Any(rule =>
                    !rule.IsInherited
                    && rule.AccessControlType == AccessControlType.Deny
                    && rule.IdentityReference is SecurityIdentifier sid
                    && sid.Equals(writer)
                    && (rule.FileSystemRights & FileSystemRights.FullControl)
                        == FileSystemRights.FullControl
                    && (rule.InheritanceFlags & inheritance) == inheritance
                    && rule.PropagationFlags == PropagationFlags.None);
            return deny
                ? Result("R7_DACL_STRUCTURAL_DENY_OBSERVED_NOT_OS_CUSTODY", true)
                : Result("R7_DACL_EXPLICIT_DENY_POLICY_UNPROVEN");
        }
        catch
        {
            // Never leak a protected path, SID, process identity or ACL body.
            return Result("R7_DACL_READBACK_FAILED_CLOSED");
        }
    }
}
