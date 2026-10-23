using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;

// Feasibility experiment on NEW OWNED files only. No production tree, token,
// service, task, ACL, account, process, root, key or lease is changed.
if (!OperatingSystem.IsWindows()) return 2;
uint previousErrorMode = Native.SetErrorMode(3);
try { return RunOwnedProbe(); }
catch (Exception error) { Console.Error.WriteLine("R7_OWNED_LIVE_FENCE_FAILED: " + error.GetType().Name + ": " + error.Message); return 1; }
finally { Native.SetErrorMode(previousErrorMode); }

static int RunOwnedProbe()
{
string parent = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
if (!string.Equals(new DriveInfo(Path.GetPathRoot(parent)!).DriveFormat, "NTFS", StringComparison.Ordinal)) return 3;
string root = Path.Combine(parent, "owned-r7-oplock-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var results = new List<object>();
int assertions = 0;
void Check(bool condition, string code) { if (!condition) throw new InvalidOperationException(code); assertions++; }
try
{
    string plain = Path.Combine(root, "plain.txt"); File.WriteAllText(plain, "owned fixture");
    using (var guard = Native.Open(plain, 0x80000000, 1, 0x40200000))
    using (var oplock = new ReadOplock(guard))
    {
        using var writer = Native.TryOpen(plain, 2, 7, 0x00200000, out int writeError);
        using var metadata = Native.TryOpen(plain, 0x40000, 7, 0x00200000, out int metadataError);
        Check(oplock.Granted && oplock.StillPending, "ORDINARY_READ_OPLOCK_REQUIRED");
        Check(writer.IsInvalid && writeError == 32, "ORDINARY_DATA_WRITE_NOT_BLOCKED");
        Check(!metadata.IsInvalid, "METADATA_COUNTEREXAMPLE_NOT_OBSERVED");
        results.Add(new { scenario = "ordinary-file", oplock.Granted, oplock.RequestError,
            newDataWriterDenied = writer.IsInvalid, writeError,
            writeDacHandleOpened = !metadata.IsInvalid, metadataError,
            remainsPending = oplock.StillPending });
    }

    string mapped = Path.Combine(root, "mapped.txt"); File.WriteAllBytes(mapped, new byte[4096]);
    // Keep only a genuine writable mapped view. The original CreateFile and
    // CreateFileMapping handles are explicitly closed before the new guard.
    nint view;
    using (var original = Native.Open(mapped, 0xc0000000, 7, 0x00200000))
    {
        nint section = Native.CreateFileMappingW(original, 0, 4, 0, 0, null);
        if (section == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { view = Native.MapViewOfFile(section, 2, 0, 0, 4096); }
        finally { if (!Native.CloseHandle(section)) throw new InvalidOperationException("OWNED_SECTION_CLOSE_FAILED"); }
        if (view == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    try
    {
        using var guard = Native.TryOpen(mapped, 0x80000000, 1, 0x40200000, out int guardError);
        bool existingViewStillWritable;
        Marshal.WriteByte(view, 0, 0x52);
        existingViewStillWritable = Marshal.ReadByte(view) == 0x52;
        using ReadOplock? oplock = guard.IsInvalid ? null : new(guard);
        Check(existingViewStillWritable, "RETAINED_VIEW_COUNTEREXAMPLE_NOT_OBSERVED");
        Check(guard.IsInvalid ? guardError == 32 : oplock?.Granted == false,
            "WRITABLE_VIEW_WAS_NOT_DETECTED");
        results.Add(new { scenario = "retained-writable-view-after-both-handles-closed",
            guardOpened = !guard.IsInvalid, guardError, existingViewStillWritable,
            oplockGranted = oplock?.Granted, oplockRequestError = oplock?.RequestError,
            flags = oplock?.OutputFlags });
    }
    finally { if (!Native.UnmapViewOfFile(view)) throw new InvalidOperationException("OWNED_VIEW_UNMAP_FAILED"); }
    using (var guard = Native.Open(mapped, 0x80000000, 1, 0x40200000))
    using (var oplock = new ReadOplock(guard))
    {
        Check(oplock.Granted && oplock.StillPending, "UNMAPPED_CONTROL_LOCK_NOT_GRANTED");
        results.Add(new { scenario = "after-owned-writable-view-unmapped", oplock.Granted, oplock.RequestError });
    }

    string occupied = Path.Combine(root, "occupied.txt"); File.WriteAllText(occupied, "owned fixture");
    using (var existing = Native.Open(occupied, 2, 7, 0x00200000))
    using (var guard = Native.TryOpen(occupied, 0x80000000, 1, 0x40200000, out int guardError))
    {
        Check(guard.IsInvalid && guardError == 32, "EXISTING_WRITE_HANDLE_WAS_NOT_DETECTED");
        results.Add(new { scenario = "retained-write-handle", guardOpened = !guard.IsInvalid, guardError });
    }

    string streams = Path.Combine(root, "streams.txt"); File.WriteAllText(streams, "owned fixture");
    using (var guard = Native.Open(streams, 0x80000000, 1, 0x40200000))
    using (var oplock = new ReadOplock(guard))
    {
        bool alternateStreamCreated = false; int alternateError = 0;
        try { File.WriteAllText(streams + ":owned-stream", "owned alternate stream"); alternateStreamCreated = true; }
        catch (IOException ex) { alternateError = ex.HResult; }
        Check(oplock.Granted && alternateStreamCreated && oplock.StillPending,
            "ALTERNATE_STREAM_COUNTEREXAMPLE_NOT_OBSERVED");
        results.Add(new { scenario = "alternate-data-stream", oplock.Granted,
            alternateStreamCreated, alternateError, unnamedStreamOplockStillPending = oplock.StillPending });
    }

    string directory = Path.Combine(root, "directory"); Directory.CreateDirectory(directory);
    using (var guard = Native.Open(directory, 0x81, 1, 0x42200000))
    using (var oplock = new ReadOplock(guard))
    {
        bool childCreated = false;
        try { File.WriteAllText(Path.Combine(directory, "child.txt"), "owned child"); childCreated = true; }
        catch (IOException) { } catch (UnauthorizedAccessException) { }
        Check(oplock.Granted && childCreated && oplock.BreakSignaled,
            "DIRECTORY_ADVISORY_COUNTEREXAMPLE_NOT_OBSERVED");
        results.Add(new { scenario = "directory-new-child", oplock.Granted,
            oplock.RequestError, childCreated, advisoryBreakObserved = oplock.BreakSignaled });
    }
    string directoryStreams = Path.Combine(root, "directory-streams");
    Directory.CreateDirectory(directoryStreams);
    string namedDirectoryStream = directoryStreams + ":owned-data";
    File.WriteAllText(namedDirectoryStream, "owned directory data stream");
    using (var writer = Native.Open(namedDirectoryStream, 2, 7, 0x00200000))
    using (var guard = Native.Open(directoryStreams, 0x81, 1, 0x42200000))
    using (var streamGuard = Native.TryOpen(namedDirectoryStream, 0x80000000, 1, 0x40200000, out int streamError))
    {
        Check(!guard.IsInvalid, "DIRECTORY_MAIN_GUARD_DOES_NOT_EXCLUDE_ADS_WRITER");
        Native.StandardInformation standard = Native.Standard(writer);
        Check(standard.Directory == 0, "DIRECTORY_ADS_IS_NON_DIRECTORY_STREAM");
        Check(streamGuard.IsInvalid && streamError == 32, "DIRECTORY_ADS_REQUIRES_SEPARATE_STREAM_GUARD");
        results.Add(new { scenario = "directory-alternate-data-stream",
            directoryGuardOpened = !guard.IsInvalid, namedStreamDirectoryFlag = standard.Directory,
            separateStreamGuardDenied = streamGuard.IsInvalid, streamError });
    }
    Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "stephanos.r7-owned-live-fence-feasibility.v1",
        observedAtUtc = DateTimeOffset.UtcNow, assertions, results, productionSourceTouched = false,
        originalWriterAuthenticated = false, completeContainmentProven = false,
        productionKeysCreated = false, leaseReleased = false }));
    return 0;
}
finally
{
    // Cleanup has no recursive primitive and follows no links. Only the exact
    // random immediate child of this experiment's current directory is allowed.
    if (Path.GetDirectoryName(root) != parent || !Path.GetFileName(root).StartsWith("owned-r7-oplock-", StringComparison.Ordinal)
        || (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
        throw new InvalidOperationException("OWNED_CLEANUP_SCOPE_UNPROVEN");
    foreach (string dir in Directory.GetDirectories(root))
    {
        if (Path.GetDirectoryName(dir) != root || (File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("OWNED_CLEANUP_CHILD_UNPROVEN");
        foreach (string file in Directory.GetFiles(dir)) File.Delete(file);
        Directory.Delete(dir, false);
    }
    foreach (string file in Directory.GetFiles(root)) File.Delete(file);
    Directory.Delete(root, false);
}
}

internal sealed class ReadOplock : IDisposable
{
    private readonly SafeFileHandle file;
    private nint input, output, overlapped, signal;
    private bool pending, disposed;
    internal bool Granted { get; }
    internal int RequestError { get; }
    internal bool StillPending => Granted && !disposed && Native.WaitForSingleObject(signal, 0) == 258;
    internal bool BreakSignaled => Granted && !disposed && Native.WaitForSingleObject(signal, 0) == 0;
    internal uint OutputFlags => unchecked((uint)Marshal.ReadInt32(output, 12));

    internal ReadOplock(SafeFileHandle file)
    {
        this.file = file;
        input = Marshal.AllocHGlobal(12); output = Marshal.AllocHGlobal(24);
        overlapped = Marshal.AllocHGlobal(Marshal.SizeOf<Native.Overlapped>());
        Marshal.Copy(new byte[12], 0, input, 12); Marshal.Copy(new byte[24], 0, output, 24);
        signal = Native.CreateEventW(0, true, false, null);
        if (signal == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        Marshal.StructureToPtr(new Native.Overlapped { Event = signal }, overlapped, false);
        Marshal.WriteInt16(input, 0, 1); Marshal.WriteInt16(input, 2, 12);
        Marshal.WriteInt32(input, 4, 1); Marshal.WriteInt32(input, 8, 1);
        bool synchronous = Native.DeviceIoControl(file, 0x00090240, input, 12, output, 24, 0, overlapped);
        RequestError = synchronous ? 0 : Marshal.GetLastWin32Error();
        Granted = !synchronous && RequestError == 997;
        pending = Granted;
    }

    public void Dispose()
    {
        if (disposed) return; disposed = true;
        if (pending)
        {
            Native.CancelIoEx(file, overlapped);
            if (Native.WaitForSingleObject(signal, 5000) != 0)
                // Do NOT free kernel-owned pending I/O buffers. Process exit
                // reclaims this owned fixture; an ambiguous result is terminal.
                throw new InvalidOperationException("OWNED_OPLOCK_CANCELLATION_NOT_COMPLETE");
            Native.GetOverlappedResult(file, overlapped, out _, false);
            pending = false;
        }
        if (signal != 0) Native.CloseHandle(signal);
        Marshal.FreeHGlobal(overlapped); Marshal.FreeHGlobal(output); Marshal.FreeHGlobal(input);
    }
}

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct StandardInformation
    {
        internal long AllocationSize, EndOfFile;
        internal uint NumberOfLinks;
        internal byte DeletePending, Directory;
    }
    internal static StandardInformation Standard(SafeFileHandle file)
    {
        if (!GetFileInformationByHandleEx(file, 1, out StandardInformation value,
            (uint)Marshal.SizeOf<StandardInformation>())) throw new Win32Exception(Marshal.GetLastWin32Error());
        return value;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind,
        out StandardInformation information, uint length);
    [DllImport("kernel32.dll")] internal static extern uint SetErrorMode(uint mode);
    [StructLayout(LayoutKind.Sequential)]
    internal struct Overlapped { internal nint Internal, InternalHigh; internal uint Offset, OffsetHigh; internal nint Event; }
    internal static SafeFileHandle Open(string path, uint access, uint sharing, uint flags)
    {
        var handle = TryOpen(path, access, sharing, flags, out int error);
        if (!handle.IsInvalid) return handle;
        handle.Dispose(); throw new Win32Exception(error);
    }
    internal static SafeFileHandle TryOpen(string path, uint access, uint sharing, uint flags, out int error)
    {
        var handle = CreateFileW(path, access, sharing, 0, 3, flags, 0);
        error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0; return handle;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, nint security, uint disposition, uint flags, nint template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeviceIoControl(SafeFileHandle file, uint code, nint input, uint inputBytes, nint output, uint outputBytes, nint returned, nint overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateEventW(nint security, [MarshalAs(UnmanagedType.Bool)] bool manual, [MarshalAs(UnmanagedType.Bool)] bool initial, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CancelIoEx(SafeFileHandle file, nint overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetOverlappedResult(SafeFileHandle file, nint overlapped, out uint transferred, [MarshalAs(UnmanagedType.Bool)] bool wait);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(nint handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateFileMappingW(SafeFileHandle file, nint attributes, uint protection, uint highSize, uint lowSize, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint MapViewOfFile(nint mapping, uint access, uint highOffset, uint lowOffset, nuint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool UnmapViewOfFile(nint view);
}
