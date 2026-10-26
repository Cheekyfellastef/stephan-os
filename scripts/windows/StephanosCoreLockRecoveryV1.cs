using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

// Only the fixed, operator-admitted PowerShell entry point calls this adapter.
// The observed file stays exclusively open until deletion commits or is refused.
public sealed class StephanosCoreLockRecoveryV1 : IDisposable {
    [StructLayout(LayoutKind.Sequential)]
    private struct Info {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Disposition { [MarshalAs(UnmanagedType.Bool)] public bool Delete; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, ref Disposition value, uint size);
    private readonly List<SafeFileHandle> ancestors = new List<SafeFileHandle>();
    private SafeFileHandle handle;
    private FileStream stream;
    private readonly byte[] bytes;
    private bool committed;
    public string Digest { get; private set; }
    public string Text { get { return new System.Text.UTF8Encoding(false, true).GetString(bytes); } }
    public DateTime CreatedUtc { get; private set; }
    public DateTime WrittenUtc { get; private set; }
    public string FileIdentity { get; private set; }

    private static Info Inspect(SafeFileHandle value, bool directory) {
        Info info;
        if (value.IsInvalid || !GetFileInformationByHandle(value, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.Attributes & 0x400) != 0 || ((info.Attributes & 0x10) != 0) != directory)
            throw new IOException("CORE_RECOVERY_PATH_TYPE_UNSAFE");
        if (!directory && (info.Links != 1 || info.SizeHigh != 0 || info.SizeLow < 2 || info.SizeLow > 4096))
            throw new IOException("CORE_RECOVERY_LOCK_SHAPE_UNSAFE");
        return info;
    }
    private static DateTime FileTime(System.Runtime.InteropServices.ComTypes.FILETIME value) {
        return DateTime.FromFileTimeUtc(((long)value.dwHighDateTime << 32) | (uint)value.dwLowDateTime);
    }
    public StephanosCoreLockRecoveryV1(string path) {
        try {
            string full = Path.GetFullPath(path);
            if (full.StartsWith(@"\\", StringComparison.Ordinal) || full.IndexOf(':', 2) >= 0) throw new IOException("CORE_RECOVERY_PATH_UNSAFE");
            var directories = new Stack<string>();
            for (var current = Path.GetDirectoryName(full); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) directories.Push(current);
            while (directories.Count > 0) {
                // Deny delete/rename of each ancestor throughout the operation.
                var parent = CreateFile(directories.Pop(), 0x80, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                ancestors.Add(parent); Inspect(parent, true);
            }
            handle = CreateFile(full, 0x80000000 | 0x00010000, 0, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
            var info = Inspect(handle, false);
            CreatedUtc = FileTime(info.Created); WrittenUtc = FileTime(info.Written);
            FileIdentity = info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
            stream = new FileStream(handle, FileAccess.Read);
            bytes = new byte[info.SizeLow];
            int offset = 0;
            while (offset < bytes.Length) { int count = stream.Read(bytes, offset, bytes.Length - offset); if (count == 0) throw new EndOfStreamException(); offset += count; }
            using (var sha = SHA256.Create()) Digest = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        } catch { Dispose(); throw; }
    }
    public void Archive(string archivePath) {
        if (committed) throw new IOException("CORE_RECOVERY_ALREADY_COMMITTED");
        // Caller supplies the fixed digest-named sibling. Its parent is pinned.
        using (var output = new FileStream(archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
            output.Write(bytes, 0, bytes.Length); output.Flush(true);
        }
    }
    public void Commit(string expectedDigest) {
        if (committed || !String.Equals(Digest, expectedDigest, StringComparison.Ordinal)) throw new IOException("CORE_RECOVERY_DIGEST_CHANGED");
        var value = new Disposition { Delete = true };
        if (!SetFileInformationByHandle(handle, 4, ref value, (uint)Marshal.SizeOf(typeof(Disposition)))) throw new Win32Exception(Marshal.GetLastWin32Error());
        committed = true;
    }
    public void Dispose() {
        if (stream != null) { stream.Dispose(); stream = null; }
        if (handle != null) { handle.Dispose(); handle = null; }
        for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
        ancestors.Clear();
    }
}
