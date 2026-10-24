using System.Diagnostics;
using System.Text.Json;
using Stephanos.RescueIslandCustody;

// Strict inspection stays deny-only. The separate supervised command routes
// only bounded JSON to the source-controlled Island runner, with lower assurance.
if (args.Length != 1 || (args[0] != "--inspect-principal" && args[0] != "--supervised-once"))
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
    if (args[0] == "--supervised-once")
    {
        if (principal.Elevated || principal.ThreadImpersonating || principal.ElevationType == "Full"
            || (principal.AdministratorsGroupPresent && (principal.AdministratorsGroupAttributes is not uint attributes || (attributes & 16) == 0)))
            throw new HostHeldException("ISLAND_HOST_NON_ADMINISTRATIVE_TOKEN_REQUIRED");
        byte[] buffer = new byte[16385];
        int count = 0;
        using var inputDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var input = Console.OpenStandardInput();
        while (count < buffer.Length)
        {
            int read = await input.ReadAsync(buffer.AsMemory(count), inputDeadline.Token);
            if (read == 0) break;
            count += read;
        }
        if (count > 16384) throw new HostHeldException("ISLAND_HOST_REQUEST_OVERSIZE");
        string request = new System.Text.UTF8Encoding(false, true).GetString(buffer, 0, count);
        bool sourceProposal = false;
        using (var document = JsonDocument.Parse(request, new JsonDocumentOptions { MaxDepth = 8 }))
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.EnumerateObject().Select(p => p.Name).Order().SequenceEqual(new[] { "commentId", "task" })
                || !root.GetProperty("commentId").TryGetInt64(out long commentId) || commentId < 1
                || root.GetProperty("task").ValueKind != JsonValueKind.Object)
                throw new HostHeldException("ISLAND_HOST_REQUEST_INVALID");
            sourceProposal = root.GetProperty("task").TryGetProperty("schemaVersion", out var schema)
                && schema.ValueKind == JsonValueKind.String && schema.GetString() == "stephanos.rescue-island-source-task.v1";
        }
        // The built executable has one source layout. No cwd/env/task can
        // nominate a script, executable or repository. Copied binaries fail shut.
        string sourceRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../.."));
        string script = Path.Combine(sourceRoot, "scripts", "rescue-island-supervised-host.mjs");
        string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (!Directory.Exists(Path.Combine(sourceRoot, ".git")) || !File.Exists(script) || !File.Exists(node))
            throw new HostHeldException("ISLAND_HOST_SOURCE_LAYOUT_INVALID");
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = sourceRoot, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, StandardInputEncoding = new System.Text.UTF8Encoding(false, true)
        };
        start.ArgumentList.Add(script);
        // Inherited authority flags and Node preload settings are not inputs.
        var inherited = start.Environment.ToDictionary(p => p.Key, p => p.Value, StringComparer.OrdinalIgnoreCase);
        start.Environment.Clear();
        foreach (string name in new[] { "APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PROGRAMDATA",
            "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR",
            // Additive canonical detector inputs; JS validates these as data
            // and supplies them ONLY to the fixed governor, never GitHub.
            "STEPHANOS_GAME_PROCESS_NAMES", "STEPHANOS_GAME_LIBRARY_ROOTS" })
            if (inherited.TryGetValue(name, out string? value) && !string.IsNullOrEmpty(value)) start.Environment[name] = value;
        using var child = Process.Start(start) ?? throw new HostHeldException("ISLAND_HOST_CHILD_START_FAILED");
        try
        {
            child.PriorityClass = ProcessPriorityClass.BelowNormal;
            await child.StandardInput.WriteAsync(request);
            child.StandardInput.Close();
            using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(sourceProposal ? 5 : 3));
            await child.WaitForExitAsync(deadline.Token);
            return child.ExitCode;
        }
        finally
        {
            // Cancellation is restricted to the exact child created above.
            if (!child.HasExited) { child.Kill(entireProcessTree: true); child.WaitForExit(); }
        }
    }
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
catch (HostHeldException e)
{
    Console.WriteLine(JsonSerializer.Serialize(new { verdict = "HELD", blocker = e.Message,
        executionAllowed = false, assuranceProfile = "SUPERVISED_COOPERATIVE_V1",
        hostileWriterContainmentProven = false }));
    return 3;
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

internal sealed class HostHeldException(string blocker) : IOException(blocker);
