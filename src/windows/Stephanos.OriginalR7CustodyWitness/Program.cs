using System;
using System.Diagnostics;
using System.Security.Principal;
using System.ServiceProcess;

namespace Stephanos.OriginalR7CustodyWitness;

// Native Windows SCM host for the single original #2962/r7 custody witness.
// Source-stage only: no signer, ACL changes or lease authority.
internal static class Program
{
    private static int Main(string[] args)
    {
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

        // Correct SCM identity is only a necessary prerequisite. A running
        // process cannot establish original-writer exclusion. No protected
        // OS enforcement, audit or separate signer is commissioned yet.
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
