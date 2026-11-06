using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// A no-replace rename of one regular NTFS file in its existing directory.
// Cross-directory moves are deliberately unqualified: FileRenameInformation
// reopens a non-null RootDirectory by pathname with FILE_ADD_FILE access.
// A simple basename with RootDirectory == NULL uses the source link's retained
// parent instead. Do not relax the parent pins to make a path reopen succeed.
// https://learn.microsoft.com/openspecs/windows_protocols/ms-fsa/87f86c9b-6c2a-4803-84b7-131a74a434fa
public sealed class SovereignFileMoveV1 : IDisposable {
    public const int MaxFileBytes = 8388608, MaxTotalReadBytes = 16777216, MaxRunMs = 5000;
    public const string HashSemantics = "BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS";
    const uint Read = 0x00120089, Delete = 0x00010000, ShareRead = 1;
    const int NameMissing = unchecked((int)0xc0000034);

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
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool GetVolumeInformationByHandleW(SafeFileHandle root, StringBuilder label, uint labelSize,
        out uint serial, out uint maxName, out uint flags, StringBuilder filesystem, uint filesystemSize);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetFilePointerEx(SafeFileHandle handle, long distance, out long position, uint method);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadFile(SafeFileHandle handle, byte[] buffer, uint count, out uint read, IntPtr overlapped);
    [DllImport("ntdll.dll")]
    static extern int NtCreateFile(out IntPtr handle, uint access, ref ObjectAttributes attributes,
        out IoStatusBlock status, IntPtr size, uint fileAttributes, uint sharing,
        uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")]
    static extern int NtSetInformationFile(SafeFileHandle handle, out IoStatusBlock status,
        IntPtr information, uint length, int informationClass);
    [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);

    static readonly HashSet<string> ExcludedDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        ".git", ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".config",
        ".codex", ".openclaw", ".claude", ".gemini", ".pki", ".password-store",
        "secrets", ".secrets", "credentials", ".credentials", "OpenAI-Secure-MCP-Tunnel",
        "AppData", "ProgramData", "Windows", "Program Files", "Program Files (x86)",
        "$Recycle.Bin", "System Volume Information", "Recovery",
        "node_modules", "dist", "build", "coverage", ".next", ".cache"
    };
    static readonly Regex SensitiveFiles = new Regex(
        @"^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|credentials(?:\..+)?|secrets?(?:\..+)?|auth\.json|tokens?(?:\..+)?|Cookies|Login Data|Web Data)$|\.(?:key|pem|pfx|p12|kdbx|dpapi)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    sealed class DirectoryPin {
        public SafeFileHandle Handle; public string Identity, Path; public uint Volume;
    }
    public sealed class Receipt {
        public string schemaVersion = "stephanos.sovereign-file-move.v1";
        public bool ok = true, moved = true, atomicRename = true, overwritten = false, sameParent = true;
        public bool mutationAttempted = true, mappedWriterExclusionProven = false, retryAllowed = false;
        public string mutationState = "MOVED", stage = "POSTCONDITION", filesystem = "NTFS";
        public string hashSemantics = HashSemantics;
        public string source, destination, sha256, identity, sourceParentIdentity, destinationParentIdentity;
        public int bytes, bytesRead, durationMs;
    }

    readonly List<DirectoryPin> pins = new List<DirectoryPin>();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly string sourcePath, destinationPath, expectedHash;
    SafeFileHandle source;
    DirectoryPin sourceParent, destinationParent;
    string sourceCanonical, destinationCanonical;
    FileInformation original;
    bool disposed, used;
    int bytesRead;
    public bool MutationAttempted { get; private set; }
    public string Stage { get; private set; }
    public string Identity { get; private set; }
    public string SourceParentIdentity { get { return sourceParent == null ? null : sourceParent.Identity; } }
    public string DestinationParentIdentity { get { return destinationParent == null ? null : destinationParent.Identity; } }

    static bool ValidUtf16(string value) {
        for (int i = 0; i < value.Length; i++) {
            if (Char.IsHighSurrogate(value[i])) {
                if (++i >= value.Length || !Char.IsLowSurrogate(value[i])) return false;
            } else if (Char.IsLowSurrogate(value[i])) return false;
        }
        return true;
    }
    static bool ValidPart(string part) {
        return part != null && part.Length > 0 && part.Length <= 255 && part != "." && part != ".."
            && ValidUtf16(part)
            && part.TrimEnd(' ', '.') == part && !Regex.IsMatch(part, "[\x00-\x1f<>:\"/\\\\|?*~]")
            && !Regex.IsMatch(part, @"^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", RegexOptions.IgnoreCase);
    }
    static string[] ValidatePath(string path) {
        if (path == null || path.Length > 1024 || path.Trim() != path || path.StartsWith("\ufeff") || path.EndsWith("\ufeff")
            || !Regex.IsMatch(path, @"^[A-Za-z]:\\[^\\]")) throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_INVALID");
        string[] parts = path.Substring(3).Split('\\');
        if (parts.Length > 64) throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_INVALID");
        foreach (string part in parts) {
            if (!ValidPart(part)) throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_INVALID");
            if (ExcludedDirectories.Contains(part) || SensitiveFiles.IsMatch(part))
                throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_EXCLUDED");
        }
        return parts;
    }
    public static void ValidateRequest(string from, string to, string sha256) {
        ValidatePath(from); ValidatePath(to);
        if (sha256 == null || !Regex.IsMatch(sha256, @"\A[a-f0-9]{64}\z"))
            throw new InvalidOperationException("SOVEREIGN_MOVE_HASH_REQUIRED");
        if (String.Equals(from, to, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_MOVE_SAME_PATH_OR_CASE_ALIAS");
        if (!String.Equals(from.Substring(0, from.LastIndexOf('\\')), to.Substring(0, to.LastIndexOf('\\')), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_MOVE_CROSS_DIRECTORY_UNQUALIFIED");
    }
    void Budget() {
        if (clock.ElapsedMilliseconds >= MaxRunMs) throw new InvalidOperationException("SOVEREIGN_MOVE_TIME_LIMIT");
    }
    static string FileIdentity(FileInformation info) {
        return info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
    }
    static ulong Length(FileInformation info) { return ((ulong)info.SizeHigh << 32) | info.SizeLow; }
    static FileInformation Information(SafeFileHandle handle, bool directory) {
        FileInformation info;
        if (handle == null || handle.IsInvalid || !GetFileInformationByHandle(handle, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (GetFileType(handle) != 1 || (info.Attributes & (0x400u | 0x40u)) != 0
            || (((info.Attributes & 0x10) != 0) != directory))
            throw new InvalidOperationException("SOVEREIGN_MOVE_REPARSE_OR_NONREGULAR");
        if (!directory && info.Links != 1) throw new InvalidOperationException("SOVEREIGN_MOVE_HARD_LINK_REJECTED");
        return info;
    }
    static string FinalPath(SafeFileHandle handle) {
        var buffer = new StringBuilder(2048);
        uint count = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 1);
        if (count == 0 || count >= buffer.Capacity) throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_IDENTITY_UNPROVEN");
        return buffer.ToString();
    }
    static SafeFileHandle RelativeOpen(SafeFileHandle parent, string name, uint access, uint sharing, uint type, bool allowMissing) {
        if (!ValidPart(name)) throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_INVALID");
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
            int status = NtCreateFile(out raw, access, ref attributes, out ios, IntPtr.Zero, 0,
                sharing, 1, type | 0x20u | 0x00200000u, IntPtr.Zero, 0);
            if (allowMissing && status == NameMissing) return null;
            if (status != 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
            var result = new SafeFileHandle(raw, true);
            if (result.IsInvalid) { result.Dispose(); throw new InvalidOperationException("SOVEREIGN_MOVE_OPEN_UNPROVEN"); }
            return result;
        } finally {
            if (retained) parent.DangerousRelease();
            if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
        }
    }
    DirectoryPin RecordDirectory(SafeFileHandle handle, string expected, uint volume) {
        try {
            FileInformation info = Information(handle, true);
            string canonical = FinalPath(handle);
            if (info.Volume != volume || !String.Equals(canonical, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_MOVE_PATH_IDENTITY_UNPROVEN");
            var pin = new DirectoryPin { Handle = handle, Identity = FileIdentity(info), Path = canonical, Volume = volume };
            pins.Add(pin); return pin;
        } catch { handle.Dispose(); throw; }
    }
    DirectoryPin PinParent(string path) {
        Budget();
        if (GetDriveTypeW(path.Substring(0, 3)) != 3) throw new InvalidOperationException("SOVEREIGN_MOVE_LOCAL_FIXED_VOLUME_REQUIRED");
        var root = CreateFileW(@"\\?\" + path.Substring(0, 3), 0x80000000, ShareRead,
            IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        DirectoryPin current;
        try {
            FileInformation info = Information(root, true);
            string volumeRoot = FinalPath(root);
            if (!Regex.IsMatch(volumeRoot, @"^\\\\\?\\Volume\{[a-fA-F0-9-]+\}\\$") || GetDriveTypeW(volumeRoot) != 3)
                throw new InvalidOperationException("SOVEREIGN_MOVE_LOCAL_FIXED_VOLUME_REQUIRED");
            uint serial, maximumName, flags; var filesystem = new StringBuilder(64);
            if (!GetVolumeInformationByHandleW(root, null, 0, out serial, out maximumName, out flags, filesystem, 64)
                || serial != info.Volume || filesystem.ToString() != "NTFS")
                throw new InvalidOperationException("SOVEREIGN_MOVE_NTFS_REQUIRED");
            current = RecordDirectory(root, volumeRoot, info.Volume);
        } catch { root.Dispose(); throw; }
        string[] parts = path.Substring(3).Split('\\');
        for (int i = 0; i < parts.Length - 1; i++) {
            Budget();
            var next = RelativeOpen(current.Handle, parts[i], Read, ShareRead, 1, false);
            current = RecordDirectory(next, current.Path.TrimEnd('\\') + "\\" + parts[i], current.Volume);
        }
        return current;
    }
    void VerifyParents() {
        foreach (DirectoryPin pin in pins) {
            Budget(); FileInformation info = Information(pin.Handle, true);
            if (info.Volume != pin.Volume || FileIdentity(info) != pin.Identity
                || !String.Equals(FinalPath(pin.Handle), pin.Path, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_MOVE_PARENT_CHANGED");
        }
    }
    FileInformation VerifySource(string expectedPath) {
        Budget(); FileInformation info = Information(source, false);
        if (FileIdentity(info) != Identity || info.Volume != sourceParent.Volume
            || !String.Equals(FinalPath(source), expectedPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_MOVE_SOURCE_IDENTITY_UNPROVEN");
        return info;
    }
    static bool SameObservation(FileInformation a, FileInformation b) {
        return FileIdentity(a) == FileIdentity(b) && Length(a) == Length(b) && a.Links == b.Links
            && a.Write.dwHighDateTime == b.Write.dwHighDateTime && a.Write.dwLowDateTime == b.Write.dwLowDateTime;
    }
    string ObserveHash(FileInformation before, string expectedPath) {
        ulong length = Length(before);
        if (length > MaxFileBytes) throw new InvalidOperationException("SOVEREIGN_MOVE_FILE_SIZE_LIMIT");
        if (length > (ulong)(MaxTotalReadBytes - bytesRead)) throw new InvalidOperationException("SOVEREIGN_MOVE_READ_LIMIT");
        long position;
        if (!SetFilePointerEx(source, 0, out position, 0) || position != 0)
            throw new InvalidOperationException("SOVEREIGN_MOVE_READ_UNPROVEN");
        byte[] buffer = new byte[65536]; int remaining = (int)length;
        using (var sha = SHA256.Create()) {
            while (remaining > 0) {
                Budget(); uint count;
                if (!ReadFile(source, buffer, (uint)Math.Min(buffer.Length, remaining), out count, IntPtr.Zero)
                    || count == 0 || count > (uint)remaining)
                    throw new InvalidOperationException("SOVEREIGN_MOVE_READ_UNPROVEN");
                bytesRead += (int)count; remaining -= (int)count;
                sha.TransformBlock(buffer, 0, (int)count, buffer, 0);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            if (!SameObservation(before, VerifySource(expectedPath)))
                throw new InvalidOperationException("SOVEREIGN_MOVE_SOURCE_CHANGED");
            return BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
        }
    }

    public SovereignFileMoveV1(string from, string to, string expectedSha256) {
        Stage = "PRECONDITION";
        ValidateRequest(from, to, expectedSha256);
        sourcePath = from; destinationPath = to; expectedHash = expectedSha256;
        try {
            sourceParent = PinParent(from); destinationParent = PinParent(to);
            if (sourceParent.Volume != destinationParent.Volume || sourceParent.Identity != destinationParent.Identity
                || !String.Equals(sourceParent.Path, destinationParent.Path, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_MOVE_CROSS_DIRECTORY_UNQUALIFIED");
            string fromName = from.Substring(from.LastIndexOf('\\') + 1), toName = to.Substring(to.LastIndexOf('\\') + 1);
            sourceCanonical = sourceParent.Path.TrimEnd('\\') + "\\" + fromName;
            destinationCanonical = destinationParent.Path.TrimEnd('\\') + "\\" + toName;
            source = RelativeOpen(sourceParent.Handle, fromName, Read | Delete, ShareRead, 0x40, false);
            original = Information(source, false); Identity = FileIdentity(original);
            VerifySource(sourceCanonical);
            // A pre-existing target is an ordinary precondition refusal. This
            // observation is not the no-overwrite guarantee; the kernel's
            // ReplaceIfExists=false also refuses a target created afterwards.
            using (var existing = RelativeOpen(destinationParent.Handle, toName, 0x00100080, 7, 0, true)) {
                if (existing != null) throw new InvalidOperationException("SOVEREIGN_MOVE_TARGET_EXISTS");
            }
            VerifyParents();
        } catch { Dispose(); throw; }
    }
    public Receipt Move() {
        if (disposed || used) throw new InvalidOperationException("SOVEREIGN_MOVE_REQUEST_ALREADY_USED");
        used = true;
        VerifyParents();
        original = VerifySource(sourceCanonical);
        string beforeHash = ObserveHash(original, sourceCanonical);
        if (beforeHash != expectedHash) throw new InvalidOperationException("SOVEREIGN_MOVE_HASH_MISMATCH");
        VerifyParents();
        if (!SameObservation(original, VerifySource(sourceCanonical)))
            throw new InvalidOperationException("SOVEREIGN_MOVE_SOURCE_CHANGED");
        string name = destinationPath.Substring(destinationPath.LastIndexOf('\\') + 1);
        // Never let an encoding replacement fallback choose a different name.
        byte[] nameBytes = new UnicodeEncoding(false, false, true).GetBytes(name);
        int handleOffset = IntPtr.Size == 8 ? 8 : 4;
        int lengthOffset = handleOffset + IntPtr.Size, nameOffset = lengthOffset + 4;
        // Zeroed ReplaceIfExists, zeroed padding, NULL RootDirectory. A NULL
        // root plus exactly one basename keeps the original parent object.
        byte[] rename = new byte[nameOffset + nameBytes.Length + 2];
        Buffer.BlockCopy(BitConverter.GetBytes((uint)nameBytes.Length), 0, rename, lengthOffset, 4);
        Buffer.BlockCopy(nameBytes, 0, rename, nameOffset, nameBytes.Length);
        var memory = GCHandle.Alloc(rename, GCHandleType.Pinned);
        try {
            Budget();
            Stage = "NATIVE_RENAME"; MutationAttempted = true;
            IoStatusBlock ios;
            int status = NtSetInformationFile(source, out ios, memory.AddrOfPinnedObject(), (uint)rename.Length, 10);
            if (status != 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
        } finally { memory.Free(); }
        Stage = "POSTCONDITION";
        VerifyParents();
        FileInformation after = VerifySource(destinationCanonical);
        if (!SameObservation(original, after)) throw new InvalidOperationException("SOVEREIGN_MOVE_POSTCONDITION_UNPROVEN");
        string afterHash = ObserveHash(after, destinationCanonical);
        if (afterHash != expectedHash) throw new InvalidOperationException("SOVEREIGN_MOVE_POSTCONDITION_UNPROVEN");
        Budget();
        // Share denial excludes ordinary write/delete handles. Existing mapped
        // views have different semantics: these are pre/post observations, not
        // an atomic content CAS, a mapped-writer fence or power-loss proof.
        return new Receipt { source = sourcePath, destination = destinationPath, sha256 = afterHash,
            identity = Identity, sourceParentIdentity = SourceParentIdentity, destinationParentIdentity = DestinationParentIdentity,
            bytes = (int)Length(after), bytesRead = bytesRead, durationMs = (int)clock.ElapsedMilliseconds };
    }
    public void Dispose() {
        if (disposed) return;
        disposed = true;
        if (source != null) { source.Dispose(); source = null; }
        for (int i = pins.Count - 1; i >= 0; i--) pins[i].Handle.Dispose();
        pins.Clear();
    }
}
