using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.RescueIslandCustody;

/// <summary>
/// A read-only, lifetime-bound Windows file snapshot. This is not a worker,
/// principal-isolation proof, claim reservation, executable allowlist or grant.
/// No canonical/Seed/R7 state is read or changed by this component.
/// </summary>
public sealed class PinnedFileSnapshot : IDisposable
{
    private readonly List<SafeFileHandle> handles = new();
    private SafeFileHandle? leaf;
    private readonly long length;
    private readonly string digest;
    private readonly byte[] snapshot;
    private bool disposed;
    public string Sha256 { get { ThrowIfDisposed(); return digest; } }
    public long Length { get { ThrowIfDisposed(); return length; } }

    private PinnedFileSnapshot(string path, string expectedSha256, long maxBytes)
    {
        try
        {
            string full = ValidatePath(path);
            string root = Path.GetPathRoot(full)!;
            string parent = root;
            uint? volume = null;
            var pieces = full[root.Length..].Split('\\');
            // Open every ancestor before descending. Retain each handle, deny
            // delete sharing, reject reparses and bind the final handle path.
            // Directory writes remain shared: this is NOT estate write exclusion.
            for (int i = -1; i < pieces.Length - 1; i++)
            {
                if (i >= 0) parent = Path.Combine(parent, pieces[i]);
                var handle = Open(parent, directory: true);
                handles.Add(handle);
                var info = Inspect(handle, parent, directory: true);
                volume ??= info.VolumeSerialNumber;
                if (info.VolumeSerialNumber != volume)
                    throw new CustodyException("ISLAND_CUSTODY_VOLUME_CHANGED");
            }
            leaf = Open(full, directory: false);
            handles.Add(leaf);
            var file = Inspect(leaf, full, directory: false);
            if (file.VolumeSerialNumber != volume || file.NumberOfLinks != 1)
                throw new CustodyException("ISLAND_CUSTODY_VOLUME_OR_LINK_COUNT_INVALID");
            ulong rawLength = ((ulong)file.FileSizeHigh << 32) | file.FileSizeLow;
            if (rawLength > (ulong)maxBytes)
                throw new CustodyException("ISLAND_CUSTODY_FILE_TOO_LARGE");
            length = checked((long)rawLength);
            snapshot = new byte[checked((int)length)];
            int offset = 0;
            while (offset < length)
            {
                int count = RandomAccess.Read(leaf, snapshot.AsSpan(offset), offset);
                if (count == 0) throw new CustodyException("ISLAND_CUSTODY_SHORT_READ");
                offset += count;
            }
            digest = Convert.ToHexString(SHA256.HashData(snapshot)).ToLowerInvariant();
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(digest), Convert.FromHexString(expectedSha256)))
                throw new CustodyException("ISLAND_CUSTODY_DIGEST_MISMATCH");
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public static PinnedFileSnapshot Acquire(string path, string expectedSha256, long maxBytes = 64 * 1024 * 1024)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (expectedSha256 is null || expectedSha256.Length != 64
            || expectedSha256.Any(c => !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
            || maxBytes < 0 || maxBytes > 64 * 1024 * 1024)
            throw new CustodyException("ISLAND_CUSTODY_EXPECTATION_INVALID");
        return new PinnedFileSnapshot(path, expectedSha256, maxBytes);
    }

    // A pre-existing writable memory mapping can outlive its original file
    // handle. Share denial alone is NOT proof of immutable on-disk bytes.
    // Read only the private bytes whose digest was verified; never reopen or
    // reread the path/handle after validation. No mutable buffer is exported.
    public int Read(long offset, Span<byte> destination)
    {
        ThrowIfDisposed();
        if (offset < 0 || offset > length) throw new ArgumentOutOfRangeException(nameof(offset));
        int count = (int)Math.Min(destination.Length, length - offset);
        snapshot.AsSpan((int)offset, count).CopyTo(destination);
        return count;
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose();
        handles.Clear();
        leaf = null;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(disposed, this);

    internal static string ValidatePath(string path)
    {
        // Deliberately narrow DOS paths on local drives only. No UNC/device,
        // ADS, drive-relative, normalized traversal, case alias or short name.
        if (string.IsNullOrEmpty(path) || path.Length > 240 || path.Length < 4
            || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] != '\\'
            || path[3..].Any(c => c is ':' or '/' or '\0')
            || path.Split('\\').Skip(1).Any(s => s.Length == 0 || s is "." or ".."
                || s.EndsWith(' ') || s.EndsWith('.') || s.Contains('~') || ReservedDevice(s))
            || !string.Equals(Path.GetFullPath(path), path, StringComparison.Ordinal))
            throw new CustodyException("ISLAND_CUSTODY_PATH_INVALID");
        if (GetDriveTypeW(path[..3]) != 3) throw new CustodyException("ISLAND_CUSTODY_LOCAL_FIXED_VOLUME_REQUIRED");
        return path;
    }

    private static bool ReservedDevice(string segment)
    {
        string stem = segment.Split('.')[0].ToUpperInvariant();
        return stem is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$"
            || (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal)
                || stem.StartsWith("LPT", StringComparison.Ordinal))
                && (stem[3] is >= '0' and <= '9' or '¹' or '²' or '³'));
    }

    internal static SafeFileHandle Open(string path, bool directory)
    {
        const uint readAttributes = 0x80, genericRead = 0x80000000;
        const uint shareRead = 1, shareWrite = 2, openExisting = 3;
        const uint openReparse = 0x00200000, backupSemantics = 0x02000000;
        var handle = CreateFileW(path, directory ? readAttributes : genericRead,
            directory ? shareRead | shareWrite : shareRead, IntPtr.Zero, openExisting,
            openReparse | (directory ? backupSemantics : 0), IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new CustodyException("ISLAND_CUSTODY_OPEN_DENIED", error);
        }
        return handle;
    }

    internal static FileInfoNative Inspect(SafeFileHandle handle, string expectedPath, bool directory)
    {
        if (!GetFileInformationByHandle(handle, out var info))
            throw new CustodyException("ISLAND_CUSTODY_IDENTITY_UNAVAILABLE", Marshal.GetLastWin32Error());
        const uint reparsePoint = 0x400, directoryFlag = 0x10;
        if ((info.Attributes & reparsePoint) != 0 || ((info.Attributes & directoryFlag) != 0) != directory)
            throw new CustodyException("ISLAND_CUSTODY_REPARSE_OR_TYPE_INVALID");
        var buffer = new StringBuilder(512);
        uint size = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (size == 0 || size >= buffer.Capacity
            || !string.Equals(buffer.ToString(), "\\\\?\\" + expectedPath, StringComparison.OrdinalIgnoreCase))
            throw new CustodyException("ISLAND_CUSTODY_FINAL_PATH_MISMATCH");
        return info;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct FileInfoNative
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
        public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfoNative info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveTypeW(string root);
}

public sealed class CustodyException : IOException
{
    public string Blocker { get; }
    public int NativeError { get; }
    internal CustodyException(string blocker, int nativeError = 0) : base(blocker)
        => (Blocker, NativeError) = (blocker, nativeError);
}
