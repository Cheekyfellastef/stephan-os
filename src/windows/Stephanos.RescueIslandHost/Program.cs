using System.Diagnostics;
using System.Text.Json;
using Stephanos.RescueIslandCustody;

// Native one-shot host bootstrap. The ONLY admitted operation observes its
// own process token. No caller task, path, command, token, clock, evidence or
// environment flag can open the production execution admission boundary.
if (args.Length != 1 || args[0] != "--inspect-principal")
{
    Console.WriteLine("{\"verdict\":\"HELD\",\"blocker\":\"ISLAND_HOST_OPERATION_NOT_ADMITTED\",\"executionAllowed\":false}");
    return 64;
}
if (!OperatingSystem.IsWindows())
{
    Console.WriteLine("{\"verdict\":\"HELD\",\"blocker\":\"ISLAND_HOST_WINDOWS_REQUIRED\",\"executionAllowed\":false}");
    return 3;
}
try
{
    var principal = WindowsProcessPrincipalObservation.ObserveCurrentProcess();
    using var process = Process.GetCurrentProcess();
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        schemaVersion = "stephanos.rescue-island-host-observation.v1",
        workerId = "rescue-island-01", ownerIssueNumber = 3109,
        ownerIssueTitle = "Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)",
        observedAtUtc = DateTime.UtcNow, processId = Environment.ProcessId,
        processStartedAtUtc = process.StartTime.ToUniversalTime(),
        principal,
        verdict = "HELD", blocker = "RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED",
        observationOnly = true, installedIdentityAuthenticated = false,
        principalEnrollmentAuthenticated = false, independentOwnershipAuthenticated = false,
        gamingBudgetAuthenticated = false, originalWriterExclusionProven = false,
        hostCommissioned = false, physicalPickupAllowed = false, sourceMutationAllowed = false,
        executionAllowed = false, canonicalLeaseAccessAllowed = false, seedForgeQueueAccessAllowed = false,
        nextRequiredCapabilities = new[]
        {
            "protected-principal-and-complete-execution-estate",
            "authenticated-atomic-cross-system-task-and-comment-reservation",
            "fresh-task-bound-revocable-resource-budget",
            "live-original-writer-exclusion-and-recovery-probes"
        }
    }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    return 3; // A successful observation is still a held host, never BUILDING.
}
catch (CustodyException e)
{
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        verdict = "HELD", blocker = e.Blocker, nativeError = e.NativeError,
        observationOnly = true, executionAllowed = false, hostCommissioned = false
    }));
    return 3;
}
catch (Exception)
{
    // Do not leak paths, environment or credentials in a bootstrap error.
    Console.WriteLine("{\"verdict\":\"HELD\",\"blocker\":\"ISLAND_HOST_OBSERVATION_FAILED\",\"executionAllowed\":false,\"hostCommissioned\":false}");
    return 3;
}
