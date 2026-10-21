using System.Security.Cryptography;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Stephanos.SeedParallelCustody;

try
{
if (!OperatingSystem.IsWindows()) return 2;
// Test process only: failing assertions must not interrupt the desktop with
// Windows error-reporting dialogs. No registry or machine policy is changed.
TestErrorMode.Apply();
if (args.Length == 1 && args[0] == "--probe-harness-failure")
    throw new InvalidOperationException("SEED_EXPECTED_NONINTERACTIVE_HARNESS_FAILURE");
if (args.Length != 0) return 2;
int count = 0;
void Check(bool pass, string label)
{ count++; if (!pass) throw new Exception("SEED_NATIVE_TEST_FAILED_" + label); }
void Denied(Action action, string label)
{
    bool denied = false;
    try { action(); } catch (IOException) { denied = true; }
    catch (UnauthorizedAccessException) { denied = true; }
    Check(denied, label);
}
void Held(Action action, string label)
{
    bool held = false;
    try { action(); } catch (SeedWriterHeldException) { held = true; }
    Check(held, label);
}
// Avoid a redirected/8.3 TEMP alias; exercise ordinary long paths beneath the
// test working directory without asking the production API to accept aliases.
string root = Path.Combine(Environment.CurrentDirectory, "nt-" + Guid.NewGuid().ToString("N")[..12]);
Directory.CreateDirectory(root);
string parent = Path.Combine(root, "docs");
Directory.CreateDirectory(parent);
string file = Path.Combine(parent, "proposal.md");
byte[] content = Encoding.UTF8.GetBytes("# Bounded Seed proposal\n\nDisposable native fixture.\n");
string digest = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
try
{
    using (var lease = PinnedNewFile.Create(file, content, digest))
    {
        Check(!lease.SourceOwnershipAuthenticated && !lease.CompleteOperationCustodyProven
            && !lease.LeaseReleaseAuthorized, "NO_AUTHORITY");
        lease.Verify(); Check(true, "HANDLE_READBACK");
        Denied(() => File.WriteAllText(file, "forged"), "EXCLUSIVE_WRITE");
        Denied(() => File.Delete(file), "DELETE");
        Denied(() => File.Move(file, file + ".moved"), "LEAF_RENAME");
        Denied(() => Directory.Move(parent, parent + "-moved"), "PARENT_RENAME");
        Denied(() => Directory.Move(root, root + "-moved"), "ANCESTOR_RENAME");
        // Race repeated real pathname replacement attempts against retained I/O.
        await Task.Run(() => {
            for (int i = 0; i < 32; i++)
            {
                try { File.WriteAllBytes(file, Encoding.UTF8.GetBytes("substitution")); }
                catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
        });
        lease.Verify(); Check(true, "CONCURRENT_WRITER_DENIED");
        Held(() => PinnedNewFile.Create(file, content, digest).Dispose(), "NO_OVERWRITE_OPEN_FILE");
    }
    Check(File.ReadAllBytes(file).SequenceEqual(content), "EXACT_ARTIFACT_AFTER_CLOSE");
    Held(() => PinnedNewFile.Create(file, content, digest).Dispose(), "NO_OVERWRITE_CLOSED_FILE");
    Check(File.ReadAllBytes(file).SequenceEqual(content), "EXISTING_BYTES_UNCHANGED");
    Held(() => PinnedNewFile.Create(Path.Combine(parent, "bad.md"), content,
        new string('0', 64)).Dispose(), "DIGEST_DENIAL");
    Check(!File.Exists(Path.Combine(parent, "bad.md")), "NO_FILE_ON_BAD_DIGEST");
    foreach (string bad in new[] { "relative.md", file + ":alternate", parent + "\\..\\escape.md",
        parent + "\\NUL.md", parent + "\\trailing. ", parent + "\\missing\\file.md" })
        Held(() => PinnedNewFile.Create(bad, content, digest).Dispose(), "PATH_DENIAL");
    byte[] oversized = new byte[PinnedNewFile.MaximumBytes + 1];
    Held(() => PinnedNewFile.Create(Path.Combine(parent, "large.md"), oversized,
        Convert.ToHexString(SHA256.HashData(oversized)).ToLowerInvariant()).Dispose(), "SIZE_DENIAL");
    Check(!File.Exists(Path.Combine(parent, "large.md")), "NO_OVERSIZED_ARTIFACT");
    var closed = PinnedNewFile.Create(Path.Combine(parent, "closed.md"), content, digest);
    closed.Dispose(); closed.Dispose();
    Held(closed.Verify, "CLOSED_HANDLE_DENIED");
    Directory.Move(parent, parent + "-released");
    Directory.Move(parent + "-released", parent);
    Check(true, "DISPOSAL_RELEASES_ANCESTORS");
    string linked = Path.Combine(root, "junction");
    // A directory junction requires no symlink privilege. Fixed test-only
    // Windows tool/operation; paths are passed as private child environment,
    // never interpolated into PowerShell source or supplied to production.
    var setup = new ProcessStartInfo(@"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
    { UseShellExecute = false, CreateNoWindow = true };
    foreach (string arg in new[] { "-NoProfile", "-NonInteractive", "-Command",
        "New-Item -ItemType Junction -Path $env:SEED_TEST_LINK -Target $env:SEED_TEST_TARGET -ErrorAction Stop | Out-Null" })
        setup.ArgumentList.Add(arg);
    setup.Environment["SEED_TEST_LINK"] = linked;
    setup.Environment["SEED_TEST_TARGET"] = parent;
    using (var child = Process.Start(setup) ?? throw new Exception("SEED_JUNCTION_FIXTURE_NOT_STARTED"))
    {
        if (!child.WaitForExit(10000))
        { child.Kill(); child.WaitForExit(); throw new Exception("SEED_JUNCTION_FIXTURE_TIMEOUT"); }
        Check(child.ExitCode == 0 && (File.GetAttributes(linked) & FileAttributes.ReparsePoint) != 0,
            "REAL_JUNCTION_FIXTURE");
    }
    try
    {
        Held(() => PinnedNewFile.Create(Path.Combine(linked, "alias.md"), content, digest).Dispose(), "REPARSE_PARENT_DENIED");
        Check(!File.Exists(Path.Combine(parent, "alias.md")), "NO_REPARSE_WRITE");
    }
    finally { Directory.Delete(linked); }
    Console.WriteLine("SEED_NATIVE_NEW_FILE_ASSERTIONS=" + count);
    Console.WriteLine("SEED_PRODUCTION_WORKER_COMMISSIONED=false");
    return 0;
}
catch (SeedWriterHeldException error)
{
    Console.Error.WriteLine(error.Code + ":" + error.Data["NativeStatus"]);
    return 1;
}
finally
{
    // Only this freshly created, fixed-prefix fixture is recursively removed.
    string fixtureParent = Path.GetFullPath(Environment.CurrentDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    if (Path.GetFullPath(root).StartsWith(fixtureParent, StringComparison.OrdinalIgnoreCase)
        && Path.GetFileName(root).StartsWith("nt-", StringComparison.Ordinal))
        Directory.Delete(root, true);
}
}
catch (Exception error)
{
    Console.Error.WriteLine("SEED_NATIVE_FIXTURE_FAILED_" + error.GetType().Name);
    return 1;
}

internal static class TestErrorMode
{
    internal static void Apply()
    {
        const uint flags = 3; // SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX
        _ = SetErrorMode(GetErrorMode() | flags);
        if ((GetErrorMode() & flags) != flags)
            throw new InvalidOperationException("SEED_TEST_ERROR_MODE_UNPROVEN");
    }
    [DllImport("kernel32.dll")] private static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
}
