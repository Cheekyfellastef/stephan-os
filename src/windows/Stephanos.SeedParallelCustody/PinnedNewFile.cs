using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.SeedParallelCustody;

public sealed class SeedWriterHeldException : Exception
{
    public string Code { get; }
    internal SeedWriterHeldException(string code) : base(code) { Code = code; }
}

// An unadopted primitive, not an executor, source owner or authority receipt.
// The production Seed worker remains held before claims/worktrees/writes.
public sealed class PinnedNewFile : IDisposable
{
    public const int MaximumBytes = 128 * 1024;
    private readonly List<SafeFileHandle> ancestors = new();
    private FileStream? stream;
    private readonly byte[] expected;
    private readonly object gate = new();
    private bool disposed;
    public bool SourceOwnershipAuthenticated => false;
    public bool CompleteOperationCustodyProven => false;
    public bool LeaseReleaseAuthorized => false;

    private PinnedNewFile(byte[] digest) { expected = digest; }

    // All parent directories must already exist. No overwrite, mkdir, delete,
    // path reopen for I/O, executable launch, ACL, claim or signer operation.
    public static PinnedNewFile Create(string path, byte[] content, string digestHex)
    {
        if (!OperatingSystem.IsWindows()) throw Held("SEED_NATIVE_WINDOWS_REQUIRED");
        if (content is null || content.Length == 0 || content.Length > MaximumBytes
            || digestHex is null || digestHex.Length != 64
            || digestHex.Any(c => !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))))
            throw Held("SEED_NATIVE_INPUT_INVALID");
        byte[] privateBytes = (byte[])content.Clone();
        byte[] digest = SHA256.HashData(privateBytes);
        if (!CryptographicOperations.FixedTimeEquals(digest, Convert.FromHexString(digestHex)))
            throw Held("SEED_NATIVE_CONTENT_DIGEST_MISMATCH");
        string[] parts;
        try { parts = ValidatePath(path); }
        catch (SeedWriterHeldException) { throw; }
        catch { throw Held("SEED_NATIVE_PATH_INVALID"); }
        var lease = new PinnedNewFile(digest);
        try
        {
            string cursor = path[..3];
            var root = CreateFileW(@"\\?\" + cursor, 0x001000A1, 3, IntPtr.Zero, 3,
                0x02200000, IntPtr.Zero);
            if (root.IsInvalid) { root.Dispose(); throw Held("SEED_NATIVE_ROOT_OPEN_DENIED"); }
            lease.ancestors.Add(root);
            uint volume = Check(root, cursor, true);
            for (int i = 0; i < parts.Length - 1; i++)
            {
                var directory = OpenRelative(lease.ancestors[^1], parts[i], true);
                lease.ancestors.Add(directory);
                cursor += parts[i] + "\\";
                if (Check(directory, cursor.TrimEnd('\\'), true) != volume)
                    throw Held("SEED_NATIVE_VOLUME_CHANGED");
            }
            SafeFileHandle file = OpenRelative(lease.ancestors[^1], parts[^1], false);
            try
            {
                if (Check(file, path, false) != volume) throw Held("SEED_NATIVE_VOLUME_CHANGED");
                lease.stream = new FileStream(file, FileAccess.ReadWrite, 4096, false);
            }
            catch { file.Dispose(); throw; }
            lease.stream.Write(privateBytes);
            lease.stream.Flush(true);
            lease.Verify();
            return lease;
        }
        catch (SeedWriterHeldException) { lease.Dispose(); throw; }
        catch { lease.Dispose(); throw Held("SEED_NATIVE_CREATE_OR_IO_DENIED"); }
        // Failed writes may leave a partial new artifact. Preserve it for owner
        // reconciliation; never delete a path by lookup or claim successful rollback.
    }

    public void Verify()
    {
        lock (gate)
        {
            if (disposed || stream is null) throw Held("SEED_NATIVE_LEASE_CLOSED");
            if (stream.Length <= 0 || stream.Length > MaximumBytes)
                throw Held("SEED_NATIVE_READBACK_LENGTH_INVALID");
            stream.Position = 0;
            if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(stream), expected))
                throw Held("SEED_NATIVE_READBACK_DIGEST_MISMATCH");
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            try { stream?.Dispose(); }
            finally
            {
                for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
                ancestors.Clear();
            }
        }
    }

    private static SeedWriterHeldException Held(string code) => new(code);
    private static string[] ValidatePath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > 240 || path.Length < 4
            || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] != '\\'
            || path.AsSpan(2).Contains(':') || path.Contains('/')
            || !string.Equals(Path.GetFullPath(path), path, StringComparison.OrdinalIgnoreCase))
            throw Held("SEED_NATIVE_PATH_INVALID");
        var parts = path[3..].Split('\\');
        foreach (string part in parts)
        {
            string stem = part.Split('.')[0].ToUpperInvariant();
            if (part.Length == 0 || part.Length > 100 || part is "." or ".."
                || part.EndsWith('.') || part.EndsWith(' ')
                || part.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-' or ' '))
                || stem is "CON" or "PRN" or "AUX" or "NUL" or "CONIN$" or "CONOUT$"
                || (stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT"))
                    && stem[3] >= '1' && stem[3] <= '9'))
                throw Held("SEED_NATIVE_PATH_INVALID");
        }
        return parts;
    }

    private static uint Check(SafeFileHandle handle, string expectedPath, bool directory)
    {
        if (!GetFileInformationByHandle(handle, out var info)
            || (info.Attributes & 0x400) != 0
            || ((info.Attributes & 0x10) != 0) != directory
            || (!directory && info.Links != 1))
            throw Held("SEED_NATIVE_HANDLE_KIND_UNQUALIFIED");
        var name = new StringBuilder(512);
        uint length = GetFinalPathNameByHandleW(handle, name, (uint)name.Capacity, 0);
        if (length == 0 || length >= name.Capacity
            || !string.Equals(name.ToString().TrimEnd('\\'),
                (@"\\?\" + expectedPath).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw Held("SEED_NATIVE_HANDLE_PATH_MISMATCH");
        return info.Volume;
    }

    private static SafeFileHandle OpenRelative(SafeFileHandle parent, string name, bool directory)
    {
        IntPtr chars = Marshal.StringToHGlobalUni(name);
        IntPtr unicode = IntPtr.Zero;
        try
        {
            var value = new UnicodeString { Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = chars };
            unicode = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>());
            Marshal.StructureToPtr(value, unicode, false);
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf<ObjectAttributes>(),
                RootDirectory = parent.DangerousGetHandle(), ObjectName = unicode,
                Attributes = 0x1040 }; // OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE
            int status = NtCreateFile(out var handle, directory ? 0x001000A1u : 0x00100083u,
                ref attributes, out _, IntPtr.Zero, directory ? 0u : 0x80u,
                directory ? 3u : 0u, directory ? 1u : 2u,
                0x00200020u | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
            if (status < 0 || handle.IsInvalid)
            {
                handle.Dispose();
                var failure = Held(directory ? "SEED_NATIVE_PARENT_OPEN_DENIED" : "SEED_NATIVE_NEW_FILE_OPEN_DENIED");
                failure.Data["NativeStatus"] = status.ToString("X8");
                throw failure;
            }
            return handle;
        }
        finally
        {
            if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
            GC.KeepAlive(parent);
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct UnicodeString
    { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes
    { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes;
      public IntPtr SecurityDescriptor, SecurityQualityOfService; }
    [StructLayout(LayoutKind.Sequential)] private struct IoStatusBlock
    { public IntPtr Status; public UIntPtr Information; }
    [StructLayout(LayoutKind.Sequential)] private struct FileInfo
    { public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh,
          Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("ntdll.dll")] private static extern int NtCreateFile(out SafeFileHandle handle,
        uint access, ref ObjectAttributes attributes, out IoStatusBlock io, IntPtr allocation,
        uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint length, uint flags);
}
