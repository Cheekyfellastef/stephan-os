using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Stephanos.RescueIslandCustody;

if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("REAL_WINDOWS_TESTS_REQUIRED");
string root = Path.Combine(Path.GetTempPath(), "island-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
int passed = 0;
try
{
    Run("held snapshot denies ordinary mutation, deletion and parent rename", () =>
    {
        string parent = Path.Combine(root, "pinned"); Directory.CreateDirectory(parent);
        string file = Path.Combine(parent, "test.txt"); File.WriteAllText(file, "approved");
        using (var lease = PinnedFileSnapshot.Acquire(file, Hash("approved")))
        {
            Denied(() => File.WriteAllText(file, "replaced"));
            Denied(() => File.Delete(file));
            Denied(() => Directory.Move(parent, parent + "-moved"));
            Equal("approved", Read(lease));
        }
        File.WriteAllText(file, "released"); // All handles actually released.
        Directory.Move(parent, parent + "-moved");
    });
    Run("pre-existing writable handle prevents admission", () =>
    {
        string file = NewFile("writer.txt", "approved");
        using var writer = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete);
        Blocked(() => PinnedFileSnapshot.Acquire(file, Hash("approved")), "ISLAND_CUSTODY_OPEN_DENIED");
    });
    Run("pre-existing mapped writer cannot change the approved snapshot", () =>
    {
        string file = NewFile("mapped.txt", "approved");
        using var mapping = MemoryMappedFile.CreateFromFile(file, FileMode.Open, null, 0, MemoryMappedFileAccess.ReadWrite);
        using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Write);
        // Some Windows filesystem implementations keep the mapping's write
        // access counted for sharing; both safe outcomes are acceptable.
        PinnedFileSnapshot? lease;
        try { lease = PinnedFileSnapshot.Acquire(file, Hash("approved")); }
        catch (CustodyException e) when (e.Blocker == "ISLAND_CUSTODY_OPEN_DENIED") { return; }
        using (lease)
        {
            view.WriteArray(0, Encoding.UTF8.GetBytes("attacker"), 0, 8); view.Flush();
            Equal("approved", Read(lease));
        }
    });
    Run("hash mismatch and size failure release every ancestor handle", () =>
    {
        string parent = Path.Combine(root, "cleanup"); Directory.CreateDirectory(parent);
        string file = Path.Combine(parent, "bad.txt"); File.WriteAllText(file, "wrong");
        Blocked(() => PinnedFileSnapshot.Acquire(file, Hash("approved")), "ISLAND_CUSTODY_DIGEST_MISMATCH");
        Blocked(() => PinnedFileSnapshot.Acquire(file, Hash("wrong"), 1), "ISLAND_CUSTODY_FILE_TOO_LARGE");
        File.Delete(file); Directory.Delete(parent);
    });
    Run("hardlink identity is rejected", () =>
    {
        string file = NewFile("linked.txt", "approved"), alias = Path.Combine(root, "alias.txt");
        if (!Native.CreateHardLinkW(alias, file, IntPtr.Zero)) throw new Exception("HARDLINK_TEST_SETUP_FAILED:" + Marshal.GetLastWin32Error());
        Blocked(() => PinnedFileSnapshot.Acquire(file, Hash("approved")), "ISLAND_CUSTODY_VOLUME_OR_LINK_COUNT_INVALID");
    });
    Run("directory junction is rejected before following its child", () =>
    {
        string target = Path.Combine(root, "junction-target"), link = Path.Combine(root, "junction-link");
        Directory.CreateDirectory(target); File.WriteAllText(Path.Combine(target, "source.txt"), "approved");
        var start = new System.Diagnostics.ProcessStartInfo(Environment.GetEnvironmentVariable("SystemRoot") + "\\System32\\cmd.exe")
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string arg in new[] { "/d", "/c", "mklink", "/J", link, target }) start.ArgumentList.Add(arg);
        using var child = System.Diagnostics.Process.Start(start)!;
        if (!child.WaitForExit(10_000) || child.ExitCode != 0) throw new Exception("JUNCTION_TEST_SETUP_FAILED");
        Blocked(() => PinnedFileSnapshot.Acquire(Path.Combine(link, "source.txt"), Hash("approved")), "ISLAND_CUSTODY_REPARSE_OR_TYPE_INVALID");
        Directory.Delete(link);
    });
    Run("device, ADS, relative, traversal and malformed expectations denied", () =>
    {
        foreach (string path in new[] { "relative.txt", "C:relative.txt", "\\\\server\\share\\f", "\\\\?\\C:\\f", "C:\\f:stream", "C:\\a\\..\\f", "C:\\a.\\f", "C:\\NUL", "C:\\COM1.txt", "C:\\LPT¹", "C:\\CONIN$" })
            Blocked(() => PinnedFileSnapshot.Acquire(path, Hash("approved")), "ISLAND_CUSTODY_PATH_INVALID");
        Blocked(() => PinnedFileSnapshot.Acquire(Path.Combine(root, "none"), new string('g', 64)), "ISLAND_CUSTODY_EXPECTATION_INVALID");
    });
    Run("partial reads, empty files and use-after-dispose are bounded", () =>
    {
        string file = NewFile("partial.txt", "approved");
        var lease = PinnedFileSnapshot.Acquire(file, Hash("approved"));
        byte[] bytes = new byte[20];
        if (lease.Read(6, bytes) != 2 || Encoding.UTF8.GetString(bytes, 0, 2) != "ed" || lease.Read(8, bytes) != 0)
            throw new Exception("READ_BOUNDS_INVALID");
        lease.Dispose(); lease.Dispose();
        try { lease.Read(0, bytes); throw new Exception("DISPOSED_READ_ADMITTED"); } catch (ObjectDisposedException) { }
        string empty = NewFile("empty.txt", ""); using var zero = PinnedFileSnapshot.Acquire(empty, Hash(""), 0);
        if (zero.Length != 0 || zero.Read(0, bytes) != 0) throw new Exception("EMPTY_READ_INVALID");
    });
    Run("create-only output holds leaf and parent and writes the copied approved bytes", () =>
    {
        string parent = Path.Combine(root, "created"); Directory.CreateDirectory(parent);
        string file = Path.Combine(parent, "proposal.md");
        byte[] bytes = Encoding.UTF8.GetBytes("approved");
        using (var baseline = Native.OpenWritableDirectory(parent))
            if (baseline.IsInvalid) throw new Exception("WRITABLE_DIRECTORY_TEST_SETUP_FAILED");
        using (var output = PinnedFileCreation.CreateApproved(file, bytes, Hash("approved")))
        {
            bytes[0] = (byte)'X';
            Denied(() => File.WriteAllText(file, "replaced"));
            Denied(() => File.Delete(file));
            Denied(() => Directory.Move(parent, parent + "-moved"));
            byte[] readback = new byte[20];
            if (output.Read(0, readback) != 8 || Encoding.UTF8.GetString(readback, 0, 8) != "approved"
                || output.Sha256 != Hash("approved") || output.Length != 8)
                throw new Exception("OUTPUT_SNAPSHOT_CHANGED");
        }
        Equal("approved", File.ReadAllText(file));
        Directory.Move(parent, parent + "-moved");
    });
    Run("existing target, hardlink and competing create are never overwritten", () =>
    {
        string file = NewFile("existing-output.md", "incumbent");
        CreationBlocked(file, "approved", "ISLAND_CUSTODY_CREATE_DENIED");
        Equal("incumbent", File.ReadAllText(file));
        string alias = Path.Combine(root, "existing-output-alias.md");
        if (!Native.CreateHardLinkW(alias, file, IntPtr.Zero)) throw new Exception("HARDLINK_TEST_SETUP_FAILED");
        CreationBlocked(alias, "approved", "ISLAND_CUSTODY_CREATE_DENIED");
        Equal("incumbent", File.ReadAllText(file));
        string fresh = Path.Combine(root, "one-output.md");
        using (var first = PinnedFileCreation.CreateApproved(fresh, Encoding.UTF8.GetBytes("first"), Hash("first")))
            CreationBlocked(fresh, "second", "ISLAND_CUSTODY_CREATE_DENIED");
        Equal("first", File.ReadAllText(fresh));
    });
    Run("invalid digest, size and path fail before any output is created", () =>
    {
        string file = Path.Combine(root, "invalid-output.md");
        try { using var output = PinnedFileCreation.CreateApproved(file, Encoding.UTF8.GetBytes("wrong"), Hash("approved")); throw new Exception("BAD_DIGEST_ADMITTED"); }
        catch (CustodyException e) when (e.Blocker == "ISLAND_CUSTODY_DIGEST_MISMATCH") { }
        try { using var output = PinnedFileCreation.CreateApproved(file, new byte[8193], Hash("")); throw new Exception("OVERSIZE_ADMITTED"); }
        catch (CustodyException e) when (e.Blocker == "ISLAND_CUSTODY_EXPECTATION_INVALID") { }
        CreationBlocked(Path.Combine(root, "..", "escape.md"), "approved", "ISLAND_CUSTODY_PATH_INVALID");
        if (File.Exists(file)) throw new Exception("INVALID_OUTPUT_CREATED");
    });
    Run("directory sharing is not treated as writer exclusion and handles release", () =>
    {
        string parent = Path.Combine(root, "directory-writer"); Directory.CreateDirectory(parent);
        string file = Path.Combine(parent, "not-created.md");
        using (var writer = Native.OpenWritableDirectory(parent))
        {
            if (writer.IsInvalid) throw new Exception("WRITABLE_DIRECTORY_TEST_SETUP_FAILED");
            using var output = PinnedFileCreation.CreateApproved(file, Encoding.UTF8.GetBytes("approved"), Hash("approved"));
        }
        Equal("approved", File.ReadAllText(file)); File.Delete(file);
        using (var output = PinnedFileCreation.CreateApproved(file, Array.Empty<byte>(), Hash("")))
            if (output.Length != 0) throw new Exception("EMPTY_OUTPUT_INVALID");
        File.Delete(file); Directory.Delete(parent);
    });
    Run("in-place parent junction redirects pathname IO but cannot redirect relative create", () =>
    {
        string parent = Path.Combine(root, "reparse-race"), outside = Path.Combine(root, "outside-parent");
        Directory.CreateDirectory(parent); Directory.CreateDirectory(outside);
        using var retained = Native.OpenDirectory(parent);
        using var setter = Native.OpenWritableDirectory(parent);
        if (retained.IsInvalid || setter.IsInvalid) throw new Exception("REPARSE_RACE_TEST_SETUP_FAILED");
        Native.SetJunction(setter, outside);
        try
        {
            // Establish a real redirect while the checked parent is retained.
            File.WriteAllText(Path.Combine(parent, "pathname-probe.md"), "outside");
            Equal("outside", File.ReadAllText(Path.Combine(outside, "pathname-probe.md")));
            File.Delete(Path.Combine(outside, "pathname-probe.md"));
            CreationBlocked(Path.Combine(parent, "public-blocked.md"), "approved", "ISLAND_CUSTODY_REPARSE_OR_TYPE_INVALID");
            // Test the exact production native primitive at the vulnerable
            // instant, without adding a production callback or bypass option.
            var create = typeof(PinnedFileCreation).GetMethod("OpenRelative",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
            try
            {
                using var output = (Microsoft.Win32.SafeHandles.SafeFileHandle)create.Invoke(null,
                    [retained, "handle-relative.md", false])!;
            }
            catch (System.Reflection.TargetInvocationException e)
                when (e.InnerException is CustodyException c && c.Blocker == "ISLAND_CUSTODY_CREATE_DENIED") { }
            if (File.Exists(Path.Combine(outside, "handle-relative.md")) || File.Exists(Path.Combine(outside, "public-blocked.md")))
                throw new Exception("RELATIVE_CREATE_ESCAPED_RETAINED_PARENT");
        }
        finally { Native.RemoveJunction(setter); }
    });
    Run("simultaneous create attempts admit exactly one writer", () =>
    {
        string path = Path.Combine(root, "concurrent.md");
        using var start = new Barrier(2);
        Task<int> Attempt(string content) => Task.Run(() =>
        {
            if (!start.SignalAndWait(TimeSpan.FromSeconds(10))) throw new Exception("CONCURRENT_TEST_SETUP_TIMEOUT");
            try
            {
                using var output = PinnedFileCreation.CreateApproved(path, Encoding.UTF8.GetBytes(content), Hash(content));
                return 1;
            }
            catch (CustodyException e) when (e.Blocker == "ISLAND_CUSTODY_CREATE_DENIED") { return 0; }
        });
        var first = Attempt("first");
        var second = Attempt("second");
        Task.WaitAll(first, second);
        if (first.Result + second.Result != 1 || File.ReadAllText(path) != (first.Result == 1 ? "first" : "second"))
            throw new Exception("CONCURRENT_CREATE_WRITER_EXCLUSION_FAILED");
    });
    Console.WriteLine($"ISLAND_NATIVE_CUSTODY_TESTS_PASSED={passed}");
    Console.WriteLine("ISLAND_HOST_COMMISSIONED=false;ISLAND_EXECUTION_ALLOWED=false;R7_LEASE_ACCESSED=false");
}
finally
{
    string resolved = Path.GetFullPath(root);
    string temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())) + Path.DirectorySeparatorChar;
    if (!resolved.StartsWith(temp, StringComparison.OrdinalIgnoreCase)
        || !System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(resolved), "^island-[a-f0-9]{32}$"))
        throw new Exception("FIXTURE_CLEANUP_SCOPE_INVALID");
    Directory.Delete(resolved, true);
}

void Run(string name, Action action)
{
    try { action(); }
    catch (CustodyException e) { Console.WriteLine($"FAIL {name}: {e.Blocker}; native={e.NativeError}"); throw; }
    passed++; Console.WriteLine("PASS " + name);
}
string NewFile(string name, string content) { string file = Path.Combine(root, name); File.WriteAllText(file, content); return file; }
static string Hash(string bytes) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(bytes))).ToLowerInvariant();
static string Read(PinnedFileSnapshot lease) { byte[] b = new byte[(int)lease.Length]; int n = lease.Read(0, b); if (n != b.Length) throw new Exception("SHORT_READ"); return Encoding.UTF8.GetString(b); }
static void Equal(string expected, string actual) { if (expected != actual) throw new Exception("SNAPSHOT_BYTES_CHANGED"); }
static void Denied(Action action) { try { action(); } catch (IOException) { return; } catch (UnauthorizedAccessException) { return; } throw new Exception("MUTATION_WAS_NOT_DENIED"); }
static void Blocked(Func<PinnedFileSnapshot> action, string blocker) { try { using var lease = action(); } catch (CustodyException e) when (e.Blocker == blocker) { return; } throw new Exception("EXPECTED_BLOCKER_MISSING:" + blocker); }
static void CreationBlocked(string path, string content, string blocker) { try { using var output = PinnedFileCreation.CreateApproved(path, Encoding.UTF8.GetBytes(content), Hash(content)); } catch (CustodyException e) when (e.Blocker == blocker) { return; } throw new Exception("EXPECTED_CREATION_BLOCKER_MISSING:" + blocker); }
static class Native
{
    internal static Microsoft.Win32.SafeHandles.SafeFileHandle OpenDirectory(string path)
        => CreateFileW(path, 0x001000A0, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    internal static Microsoft.Win32.SafeHandles.SafeFileHandle OpenWritableDirectory(string path)
        => CreateFileW(path, 0x40000000, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    internal static void SetJunction(Microsoft.Win32.SafeHandles.SafeFileHandle directory, string target)
    {
        byte[] substitute = Encoding.Unicode.GetBytes("\\??\\" + target);
        byte[] print = Encoding.Unicode.GetBytes(target);
        byte[] buffer = new byte[16 + substitute.Length + 2 + print.Length + 2];
        BitConverter.GetBytes(0xA0000003u).CopyTo(buffer, 0);
        BitConverter.GetBytes(checked((ushort)(buffer.Length - 8))).CopyTo(buffer, 4);
        BitConverter.GetBytes(checked((ushort)substitute.Length)).CopyTo(buffer, 10);
        BitConverter.GetBytes(checked((ushort)(substitute.Length + 2))).CopyTo(buffer, 12);
        BitConverter.GetBytes(checked((ushort)print.Length)).CopyTo(buffer, 14);
        substitute.CopyTo(buffer, 16); print.CopyTo(buffer, 18 + substitute.Length);
        if (!DeviceIoControl(directory, 0x900A4, buffer, buffer.Length, IntPtr.Zero, 0, out _, IntPtr.Zero))
            throw new Exception("SET_JUNCTION_TEST_SETUP_FAILED:" + Marshal.GetLastWin32Error());
    }
    internal static void RemoveJunction(Microsoft.Win32.SafeHandles.SafeFileHandle directory)
    {
        byte[] buffer = new byte[8]; BitConverter.GetBytes(0xA0000003u).CopyTo(buffer, 0);
        if (!DeviceIoControl(directory, 0x900AC, buffer, buffer.Length, IntPtr.Zero, 0, out _, IntPtr.Zero))
            throw new Exception("REMOVE_JUNCTION_TEST_CLEANUP_FAILED:" + Marshal.GetLastWin32Error());
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(Microsoft.Win32.SafeHandles.SafeFileHandle handle, uint code,
        byte[] input, int inputLength, IntPtr output, int outputLength, out int returned, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateHardLinkW(string alias, string target, IntPtr security);
}
