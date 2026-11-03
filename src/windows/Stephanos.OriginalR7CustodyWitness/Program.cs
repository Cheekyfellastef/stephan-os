using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;

namespace Stephanos.OriginalR7CustodyWitness;

// Native Windows SCM host for the single original #2962/r7 custody witness.
// Source-stage only: no signer, ACL changes or lease authority.
internal static class Program
{
    private static int Main(string[] args)
    {
        // Purpose-bound one-shot peer authentication only. No signing/root or
        // custody grant follows; the SCM commissioning refusal below remains.
        if (args.Length == 1 && args[0] == OriginalR7OwnerPeerOperation.Argument)
        {
            if (!OperatingSystem.IsWindows() || !Environment.UserInteractive || !Console.IsInputRedirected)
                return 2;
            return OriginalR7OwnerPeerOperation.RunAsync(Console.OpenStandardInput(), Console.Out)
                .GetAwaiter().GetResult();
        }
        // Fixed read-only package diagnostic. It inspects this process's
        // bundle layout and its own bytes only: no SCM, registry, identity,
        // custody or signing. A self-computed digest is explicitly untrusted.
        if (args.Length == 1 && args[0] == "--inspect-bundle-only")
        {
            if (!OperatingSystem.IsWindows()) return 2;
            if (!OriginalR7ScmPreflight.BundledPayloadObserved()) return 4;
            try
            {
                string? image = Environment.ProcessPath;
                if (image is null) return 5;
                using FileStream stream = new(image, FileMode.Open, FileAccess.Read,
                    FileShare.Read, 4096, FileOptions.SequentialScan);
                if (stream.Length <= 0 || stream.Length > OriginalR7ImagePinPreflight.MaxImageBytes)
                    return 5;
                string untrustedDigest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
                OriginalR7ImagePinObservation report = OriginalR7ImagePinPreflight.Evaluate(image, untrustedDigest);
                return report.ImageDigestMatchesConfiguredPin
                    && !report.IndependentlyProtectedPinProven && !report.OriginalWriterExclusionProven
                    && !report.SignedWitnessIssued && !report.LeaseReleaseAuthorized ? 0 : 5;
            }
            catch { return 5; }
        }

        if (args.Length != 0 || !OperatingSystem.IsWindows()
            || Environment.UserInteractive)
        {
            return 2;
        }

        try
        {
            ServiceBase.Run(new OriginalR7CustodyWitnessService());
            return 0;
        }
        catch
        {
            // Do not leak Windows identities, paths, secrets or audit data.
            return 3;
        }
    }
}

internal sealed class OriginalR7CustodyWitnessService : ServiceBase
{
    internal const string FixedServiceName = "StephanosOriginalR7CustodyWitness";
    internal const string FixedLeaseId = "critical-2962-elastic-goal-r7-lease";

    internal OriginalR7CustodyWitnessService()
    {
        ServiceName = FixedServiceName;
        CanStop = true;
        CanShutdown = true;
        CanPauseAndContinue = false;
        AutoLog = false;
    }

    protected override void OnStart(string[] args)
    {
        if (args.Length != 0 || Environment.UserInteractive
            || Process.GetCurrentProcess().SessionId != 0)
        {
            throw new InvalidOperationException("WINDOWS_WITNESS_SCM_IDENTITY_UNPROVEN");
        }

        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        SecurityIdentifier? actual = identity.User;
        SecurityIdentifier expected;
        try
        {
            expected = (SecurityIdentifier)new NTAccount(
                "NT SERVICE", FixedServiceName).Translate(typeof(SecurityIdentifier));
        }
        catch
        {
            throw new InvalidOperationException("WINDOWS_WITNESS_SERVICE_SID_NOT_PROVISIONED");
        }

        // A raw group list can include deny-only SIDs, and an unrelated
        // elevated service account could carry the same service SID. A valid
        // witness must use its own virtual account, or a restricted LocalService
        // token with the *enabled* pinned service SID. Never run as an admin.
        WindowsPrincipal principal = new(identity);
        bool exactVirtualServiceAccount = actual?.Equals(expected) == true;
        bool localServiceWithEnabledSid = actual?.Value == "S-1-5-19"
            && principal.IsInRole(expected);
        bool elevatedAdministrator = principal.IsInRole(WindowsBuiltInRole.Administrator);
        if ((!exactVirtualServiceAccount && !localServiceWithEnabledSid)
            || identity.IsSystem || elevatedAdministrator)
        {
            throw new InvalidOperationException("WINDOWS_WITNESS_SERVICE_SID_NOT_ISOLATED");
        }

        // Independently check the fixed SCM registration and exact image
        // that Windows launched. This prevents an isolated service token
        // alone from being mistaken for a correctly commissioned host.
        // A positive shape result still grants NO custody or signing rights.
        OriginalR7ScmObservation scm = OriginalR7ScmPreflight.Inspect();
        if (!scm.ScmConfigurationObserved)
        {
            throw new InvalidOperationException(scm.Classification);
        }

        // A registry value can pin bytes, but cannot prove the provenance
        // or immutability of the pin, original writer exclusion or signer trust.
        // Refuse startup if no fixed-host hash shape is configured.
        OriginalR7ImagePinObservation imagePin = OriginalR7ImagePinPreflight.Inspect();
        if (!imagePin.ImageDigestMatchesConfiguredPin)
        {
            throw new InvalidOperationException(imagePin.Classification);
        }

        // Even a successful hash check supplies NO custody or signing rights:
        // a separately protected OS security owner must authenticate the pin,
        // original token/handles/re-entry denial, audit and distinct signers.
        throw new InvalidOperationException("WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED");
    }

    protected override void OnStop()
    {
        // No source, task, lease, process, ACL or audit-log mutation.
    }

    protected override void OnShutdown()
    {
        // Never claim a historical terminal execution receipt.
    }
}
