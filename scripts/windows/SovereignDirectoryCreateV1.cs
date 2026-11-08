using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// A create-only operation for one explicit private-MCP target. This is not a
// shell, recursive mkdir, lease recovery mechanism or privileged writer fence.
public sealed class SovereignDirectoryCreateV1 : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString {
        public ushort Length, MaximumLength; public IntPtr Buffer;
    }
    [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes {
        public int Length; public IntPtr RootDirectory, ObjectName;
        public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoStatusBlock {
        public IntPtr Status; public UIntPtr Information;
    }
    [StructLayout(LayoutKind.Sequential)] struct FileInformation {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("ntdll.dll")]
    static extern int NtCreateFile(out IntPtr handle, uint access, ref ObjectAttributes attributes,
        out IoStatusBlock status, IntPtr size, uint fileAttributes, uint sharing,
        uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);

    readonly List<SafeFileHandle> pins = new List<SafeFileHandle>();
    readonly string leaf;
    bool attempted, disposed;
    public string Target { get; private set; }
    public string ParentIdentity { get; private set; }

    public static string ValidateTarget(string path) {
        if (path == null || path.Length > 1024 || !Regex.IsMatch(path, @"^[A-Za-z]:\\[^\\]"))
            throw new InvalidOperationException("SOVEREIGN_DIRECTORY_TARGET_INVALID");
        string[] parts = path.Substring(3).Split('\\');
        foreach (string part in parts) {
            if (part.Length == 0 || part.Length > 255 || part == "." || part == ".."
                || part.TrimEnd(' ', '.') != part || Regex.IsMatch(part, "[\x00-\x1f<>:\"/|?*]")
                || Regex.IsMatch(part, @"^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", RegexOptions.IgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_DIRECTORY_TARGET_INVALID");
        }
        return path;
    }

    static string Identity(SafeFileHandle handle) {
        FileInformation info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.Attributes & 0x400) != 0 || (info.Attributes & 0x10) == 0)
            throw new InvalidOperationException("SOVEREIGN_DIRECTORY_PARENT_REDIRECTED");
        return info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
    }

    static SafeFileHandle RelativeDirectory(SafeFileHandle parent, string name, bool create) {
        IntPtr chars = Marshal.StringToHGlobalUni(name), unicode = IntPtr.Zero;
        bool retained = false;
        try {
            var value = new UnicodeString { Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = chars };
            unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));
            Marshal.StructureToPtr(value, unicode, false);
            parent.DangerousAddRef(ref retained);
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf(typeof(ObjectAttributes)),
                RootDirectory = parent.DangerousGetHandle(), ObjectName = unicode, Attributes = 0x40 };
            IntPtr raw; IoStatusBlock ios;
            // FILE_GENERIC_READ includes data/list access: metadata-only access
            // does not establish the sharing exclusion needed for these pins.
            // Share read only denies both rename/delete and reparse write handles.
            int status = NtCreateFile(out raw, 0x00120089, ref attributes, out ios,
                IntPtr.Zero, 0x10, 1, create ? 2u : 1u,
                0x00000001 | 0x00000020 | 0x00200000, IntPtr.Zero, 0);
            if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
            var result = new SafeFileHandle(raw, true);
            try {
                if (result.IsInvalid || (create && ios.Information.ToUInt64() != 2))
                    throw new InvalidOperationException("SOVEREIGN_DIRECTORY_CREATE_NOT_PROVEN");
                Identity(result);
                return result;
            } catch { result.Dispose(); throw; }
        } finally {
            if (retained) parent.DangerousRelease();
            if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
        }
    }

    public SovereignDirectoryCreateV1(string target) {
        Target = ValidateTarget(target);
        string[] parts = target.Substring(3).Split('\\');
        leaf = parts[parts.Length - 1];
        try {
            if (GetDriveTypeW(target.Substring(0, 3)) != 3)
                throw new InvalidOperationException("SOVEREIGN_DIRECTORY_LOCAL_FIXED_VOLUME_REQUIRED");
            var root = CreateFileW(@"\\?\" + target.Substring(0, 3), 0x80000000, 1,
                IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            pins.Add(root);
            if (root.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            Identity(root);
            // Check the opened object too: a drive-letter syntax/type check alone
            // cannot exclude a mapped network root or a changed DOS drive alias.
            var volumePath = new StringBuilder(2048);
            uint size = GetFinalPathNameByHandleW(root, volumePath, (uint)volumePath.Capacity, 1);
            var volumeRoot = Regex.Match(volumePath.ToString(), @"^\\\\\?\\Volume\{[a-fA-F0-9-]+\}\\");
            if (size == 0 || size >= volumePath.Capacity
                || !volumeRoot.Success || GetDriveTypeW(volumeRoot.Value) != 3)
                throw new InvalidOperationException("SOVEREIGN_DIRECTORY_LOCAL_FIXED_VOLUME_REQUIRED");
            for (int i = 0; i < parts.Length - 1; i++)
                pins.Add(RelativeDirectory(pins[pins.Count - 1], parts[i], false));
            ParentIdentity = Identity(pins[pins.Count - 1]);
        } catch { Dispose(); throw; }
    }

    public string Create() {
        if (disposed || attempted) throw new InvalidOperationException("SOVEREIGN_DIRECTORY_REQUEST_ALREADY_USED");
        attempted = true;
        // FILE_CREATE refuses existing files, folders and links atomically.
        // The leaf is relative to the pinned parent, never re-resolved by path.
        var created = RelativeDirectory(pins[pins.Count - 1], leaf, true);
        pins.Add(created);
        return Identity(created);
    }

    public void Dispose() {
        if (disposed) return;
        disposed = true;
        for (int i = pins.Count - 1; i >= 0; i--) pins[i].Dispose();
        pins.Clear();
    }
}
