using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.RescueIslandCustody;

/// <summary>
/// Bounded create-only output through one retained native handle. A caller's
/// bytes/digest/path are expectations, not authenticated source-write authority.
/// No production engine, service, account, claim or R7 lease uses this component.
/// </summary>
public sealed class PinnedFileCreation : IDisposable
{
    private readonly List<SafeFileHandle> handles = new();
    private SafeFileHandle? leaf;
    private bool disposed;
    private readonly byte[] approvedBytes;
    private readonly string digest;
    public string Sha256 { get { ThrowIfDisposed(); return digest; } }
    public int Length { get { ThrowIfDisposed(); return approvedBytes.Length; } }

    private PinnedFileCreation(string path, byte[] bytes, string sha256)
    {
        approvedBytes = bytes;
        digest = sha256;
        try
        {
            string full = PinnedFileSnapshot.ValidatePath(path);
            string root = Path.GetPathRoot(full)!;
            string parent = root;
            uint? volume = null;
            SafeFileHandle? parentHandle = null;
            var pieces = full[root.Length..].Split('\\');
            for (int i = -1; i < pieces.Length - 1; i++)
            {
                if (i >= 0) parent = Path.Combine(parent, pieces[i]);
                // Directory sharing does NOT prove directory-write exclusion.
                // Descend relative to the retained object, with no reparsing.
                var handle = parentHandle is null
                    ? PinnedFileSnapshot.Open(parent, directory: true)
                    : OpenRelative(parentHandle, pieces[i], directory: true);
                handles.Add(handle);
                var info = PinnedFileSnapshot.Inspect(handle, parent, directory: true);
                volume ??= info.VolumeSerialNumber;
                if (info.VolumeSerialNumber != volume)
                    throw new CustodyException("ISLAND_CUSTODY_VOLUME_CHANGED");
                parentHandle = handle;
            }
            // FILE_CREATE cannot truncate a raced-in leaf. The name is one
            // component relative to the held parent, never the full pathname.
            leaf = OpenRelative(parentHandle!, pieces[^1], directory: false);
            handles.Add(leaf);
            var before = PinnedFileSnapshot.Inspect(leaf, full, directory: false);
            if (before.VolumeSerialNumber != volume || before.NumberOfLinks != 1)
                throw new CustodyException("ISLAND_CUSTODY_VOLUME_OR_LINK_COUNT_INVALID");
            RandomAccess.Write(leaf, approvedBytes, 0);
            if (!FlushFileBuffers(leaf))
                throw new CustodyException("ISLAND_CUSTODY_FLUSH_FAILED", Marshal.GetLastWin32Error());
            var after = PinnedFileSnapshot.Inspect(leaf, full, directory: false);
            if (after.VolumeSerialNumber != before.VolumeSerialNumber
                || after.FileIndexHigh != before.FileIndexHigh || after.FileIndexLow != before.FileIndexLow
                || after.NumberOfLinks != 1 || after.FileSizeHigh != 0 || after.FileSizeLow != bytes.Length)
                throw new CustodyException("ISLAND_CUSTODY_OUTPUT_IDENTITY_CHANGED");
            byte[] readback = new byte[bytes.Length];
            int offset = 0;
            while (offset < readback.Length)
            {
                int count = RandomAccess.Read(leaf, readback.AsSpan(offset), offset);
                if (count == 0) throw new CustodyException("ISLAND_CUSTODY_SHORT_READ");
                offset += count;
            }
            if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(readback), Convert.FromHexString(digest)))
                throw new CustodyException("ISLAND_CUSTODY_OUTPUT_DIGEST_CHANGED");
        }
        catch
        {
            // Never delete by pathname on failure: leave any created partial
            // file for authenticated recovery of the isolated estate to inspect.
            Dispose();
            throw;
        }
    }

    public static PinnedFileCreation CreateApproved(string path, byte[] bytes, string expectedSha256)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (bytes is null || bytes.Length > 8192 || expectedSha256 is null || expectedSha256.Length != 64
            || expectedSha256.Any(c => !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))))
            throw new CustodyException("ISLAND_CUSTODY_EXPECTATION_INVALID");
        byte[] copy = bytes.ToArray();
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(copy), Convert.FromHexString(expectedSha256)))
            throw new CustodyException("ISLAND_CUSTODY_DIGEST_MISMATCH");
        return new PinnedFileCreation(path, copy, expectedSha256);
    }

    public int Read(long offset, Span<byte> destination)
    {
        ThrowIfDisposed();
        if (offset < 0 || offset > approvedBytes.Length) throw new ArgumentOutOfRangeException(nameof(offset));
        int count = (int)Math.Min(destination.Length, approvedBytes.Length - offset);
        approvedBytes.AsSpan((int)offset, count).CopyTo(destination);
        return count;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose();
        handles.Clear();
        leaf?.Dispose(); // Also covers an invalid CreateFile result.
        leaf = null;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(disposed, this);
    private static SafeFileHandle OpenRelative(SafeFileHandle parent, string name, bool directory)
    {
        if (string.IsNullOrEmpty(name) || name is "." or ".." || name.IndexOfAny(['\\', '/', ':', '\0']) >= 0)
            throw new CustodyException("ISLAND_CUSTODY_PATH_INVALID");
        IntPtr nameBytes = Marshal.StringToHGlobalUni(name);
        IntPtr unicodePointer = IntPtr.Zero;
        bool parentRetained = false;
        try
        {
            var unicode = new UnicodeString { Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)(name.Length * 2)), Buffer = nameBytes };
            unicodePointer = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>());
            Marshal.StructureToPtr(unicode, unicodePointer, false);
            parent.DangerousAddRef(ref parentRetained);
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf<ObjectAttributes>(),
                RootDirectory = parent.DangerousGetHandle(), ObjectName = unicodePointer,
                Attributes = 0x1040 }; // OBJ_DONT_REPARSE | OBJ_CASE_INSENSITIVE; no inheritance.
            int status = NtCreateFile(out var handle, directory ? 0x001000A0u : 0xC0100000u,
                ref attributes, out var io, IntPtr.Zero, 0x80, directory ? 3u : 0u,
                directory ? 1u : 2u, // FILE_OPEN / FILE_CREATE (not Win32 constants).
                0x00200020u | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
            if (status != 0 || handle.IsInvalid || (!directory && io.Information.ToUInt64() != 2))
            {
                handle.Dispose();
                throw new CustodyException(directory ? "ISLAND_CUSTODY_OPEN_DENIED" : "ISLAND_CUSTODY_CREATE_DENIED",
                    checked((int)RtlNtStatusToDosError(status)));
            }
            return handle;
        }
        finally
        {
            if (parentRetained) parent.DangerousRelease();
            if (unicodePointer != IntPtr.Zero) Marshal.FreeHGlobal(unicodePointer);
            Marshal.FreeHGlobal(nameBytes);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ObjectAttributes
    {
        public int Length;
        public IntPtr RootDirectory, ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoStatus { public IntPtr Status; public UIntPtr Information; }
    [DllImport("ntdll.dll")]
    private static extern int NtCreateFile(out SafeFileHandle handle, uint access, ref ObjectAttributes attributes,
        out IoStatus io, IntPtr allocationSize, uint fileAttributes, uint share, uint disposition,
        uint options, IntPtr eaBuffer, uint eaLength);
    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);
}
