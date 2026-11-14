using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// Observes a bounded content hash or copies only a regular file's unnamed data
// stream into one new file. Both
// parent chains remain retained, and the destination basename is opened relative
// to its retained parent. No source write/delete access, path cleanup, rename,
// overwrite, metadata preservation or cross-volume fallback is present.
public sealed class SovereignFileCopyV1 : IDisposable {
    public const int MaxFileBytes = 8388608, MaxTotalReadBytes = 33554432, MaxHashReadBytes = 16777216, MaxRunMs = 5000;
    public const string HashSemantics = "BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS";
    const uint Read = 0x00120089, ShareRead = 1;
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
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool WriteFile(SafeFileHandle handle, byte[] buffer, uint count, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FlushFileBuffers(SafeFileHandle handle);
    [DllImport("ntdll.dll")]
    static extern int NtCreateFile(out IntPtr handle, uint access, ref ObjectAttributes attributes,
        out IoStatusBlock status, IntPtr size, uint fileAttributes, uint sharing,
        uint disposition, uint options, IntPtr ea, uint eaLength);
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
        public SafeFileHandle Handle; public string Identity, Path, VolumeRoot; public uint Volume;
    }
    public sealed class Receipt {
        public string schemaVersion = "stephanos.sovereign-file-copy.v1";
        public bool ok = true, copied = true, overwritten = false, wholeFileAtomicityProven = false;
        public bool mutationAttempted = true, mappedWriterExclusionProven = false, retryAllowed = false;
        public bool sourceMutationAttempted = false, sourceContentObservedUnchanged = true, metadataPreserved = false;
        public string mutationState = "COPIED", stage = "POSTCONDITION", filesystem = "NTFS";
        public string hashSemantics = HashSemantics, copyScope = "UNNAMED_DATA_STREAM_ONLY";
        public string source, destination, sha256, sourceIdentity, destinationIdentity;
        public string sourceParentIdentity, destinationParentIdentity;
        public int bytes, bytesRead, durationMs;
    }
    public sealed class HashReceipt {
        public string schemaVersion = "stephanos.sovereign-file-hash.v1";
        public bool ok = true, mutationAttempted = false, sourceMutationAttempted = false;
        public bool mappedWriterExclusionProven = false, retryAllowed = false, sourceContentObservedUnchanged = true;
        public string observationState = "HASHED", stage = "POSTCONDITION", filesystem = "NTFS";
        public string hashSemantics = HashSemantics, hashScope = "UNNAMED_DATA_STREAM_ONLY";
        public string path, sha256, identity, parentIdentity;
        public int bytes, bytesRead, durationMs;
    }

    readonly List<DirectoryPin> pins = new List<DirectoryPin>();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly string sourcePath, destinationPath, expectedHash, destinationName;
    readonly bool hashOnly;
    SafeFileHandle source, destination;
    DirectoryPin sourceParent, destinationParent;
    string sourceCanonical, destinationCanonical;
    bool disposed, used;
    int bytesRead;
    public bool MutationAttempted { get; private set; }
    public string Stage { get; private set; }
    public string SourceIdentity { get; private set; }
    public string DestinationIdentity { get; private set; }
    public string SourceParentIdentity { get { return sourceParent == null ? null : sourceParent.Identity; } }

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
            && ValidUtf16(part) && part.TrimEnd(' ', '.') == part
            && !Regex.IsMatch(part, "[\x00-\x1f<>:\"/\\\\|?*~]")
            && !Regex.IsMatch(part, @"^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }
    static void ValidatePath(string path) {
        if (path == null || path.Length > 1024 || path.Trim() != path
            || path.StartsWith("\ufeff", StringComparison.Ordinal) || path.EndsWith("\ufeff", StringComparison.Ordinal)
            || !Regex.IsMatch(path, @"^[A-Za-z]:\\[^\\]"))
            throw new InvalidOperationException("SOVEREIGN_COPY_PATH_INVALID");
        string[] parts = path.Substring(3).Split('\\');
        if (parts.Length > 64) throw new InvalidOperationException("SOVEREIGN_COPY_PATH_INVALID");
        foreach (string part in parts) {
            if (!ValidPart(part)) throw new InvalidOperationException("SOVEREIGN_COPY_PATH_INVALID");
            if (ExcludedDirectories.Contains(part) || SensitiveFiles.IsMatch(part))
                throw new InvalidOperationException("SOVEREIGN_COPY_PATH_EXCLUDED");
        }
    }
    public static void ValidateRequest(string from, string to, string sha256) {
        ValidatePath(from); ValidatePath(to);
        if (sha256 == null || !Regex.IsMatch(sha256, @"\A[a-f0-9]{64}\z"))
            throw new InvalidOperationException("SOVEREIGN_COPY_HASH_REQUIRED");
        if (String.Equals(from, to, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS");
        if (!String.Equals(from.Substring(0, 3), to.Substring(0, 3), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_COPY_SAME_VOLUME_REQUIRED");
    }
    void Budget() {
        if (clock.ElapsedMilliseconds >= MaxRunMs) throw new InvalidOperationException("SOVEREIGN_COPY_TIME_LIMIT");
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
            throw new InvalidOperationException("SOVEREIGN_COPY_REPARSE_OR_NONREGULAR");
        if (!directory && info.Links != 1) throw new InvalidOperationException("SOVEREIGN_COPY_HARD_LINK_REJECTED");
        // A content-only copy must not silently turn EFS data into plaintext.
        // Encrypted parent policy and encrypted streams require a separate scope.
        if ((info.Attributes & 0x4000u) != 0) throw new InvalidOperationException("SOVEREIGN_COPY_ENCRYPTED_FILE_UNQUALIFIED");
        return info;
    }
    static string FinalPath(SafeFileHandle handle) {
        var buffer = new StringBuilder(2048);
        uint count = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 1);
        if (count == 0 || count >= buffer.Capacity) throw new InvalidOperationException("SOVEREIGN_COPY_PATH_IDENTITY_UNPROVEN");
        return buffer.ToString();
    }
    static SafeFileHandle RelativeOpen(SafeFileHandle parent, string name, bool create, bool directory, bool allowMissing) {
        if (!ValidPart(name)) throw new InvalidOperationException("SOVEREIGN_COPY_PATH_INVALID");
        IntPtr chars = Marshal.StringToHGlobalUni(name), unicode = IntPtr.Zero;
        bool retained = false;
        try {
            var value = new UnicodeString { Length = checked((ushort)(name.Length * 2)),
                MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = chars };
            unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));
            Marshal.StructureToPtr(value, unicode, false);
            parent.DangerousAddRef(ref retained);
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf(typeof(ObjectAttributes)),
                RootDirectory = parent.DangerousGetHandle(), ObjectName = unicode,
                Attributes = 0x1040 }; // OBJ_DONT_REPARSE | OBJ_CASE_INSENSITIVE.
            IntPtr raw; IoStatusBlock ios;
            uint access = create ? 0xC0100000u : Read;
            uint sharing = create ? 0u : ShareRead;
            // A missing-target observation accepts either object kind so that
            // an existing directory is refused as an existing destination too.
            uint kind = create ? 0x40u : directory ? 1u : allowMissing ? 0u : 0x40u;
            int status = NtCreateFile(out raw, access, ref attributes, out ios, IntPtr.Zero, create ? 0x80u : 0u,
                sharing, create ? 2u : 1u, kind | 0x20u | 0x00200000u, IntPtr.Zero, 0);
            if (allowMissing && status == NameMissing) return null;
            if (status != 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
            var result = new SafeFileHandle(raw, true);
            if (result.IsInvalid || (create && ios.Information.ToUInt64() != 2)) {
                result.Dispose(); throw new InvalidOperationException(create ? "SOVEREIGN_COPY_CREATE_UNPROVEN" : "SOVEREIGN_COPY_OPEN_UNPROVEN");
            }
            return result;
        } finally {
            if (retained) parent.DangerousRelease();
            if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
        }
    }
    DirectoryPin RecordDirectory(SafeFileHandle handle, string expected, uint volume, string volumeRoot) {
        try {
            FileInformation info = Information(handle, true); string canonical = FinalPath(handle);
            if (info.Volume != volume || !String.Equals(canonical, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_COPY_PATH_IDENTITY_UNPROVEN");
            var pin = new DirectoryPin { Handle = handle, Identity = FileIdentity(info), Path = canonical,
                Volume = volume, VolumeRoot = volumeRoot };
            pins.Add(pin); return pin;
        } catch { handle.Dispose(); throw; }
    }
    DirectoryPin PinParent(string path) {
        Budget();
        if (GetDriveTypeW(path.Substring(0, 3)) != 3) throw new InvalidOperationException("SOVEREIGN_COPY_LOCAL_FIXED_VOLUME_REQUIRED");
        var root = CreateFileW(@"\\?\" + path.Substring(0, 3), 0x80000000, ShareRead,
            IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
        DirectoryPin current;
        try {
            FileInformation info = Information(root, true); string volumeRoot = FinalPath(root);
            if (!Regex.IsMatch(volumeRoot, @"^\\\\\?\\Volume\{[a-fA-F0-9-]+\}\\$") || GetDriveTypeW(volumeRoot) != 3)
                throw new InvalidOperationException("SOVEREIGN_COPY_LOCAL_FIXED_VOLUME_REQUIRED");
            uint serial, maximumName, flags; var filesystem = new StringBuilder(64);
            if (!GetVolumeInformationByHandleW(root, null, 0, out serial, out maximumName, out flags, filesystem, 64)
                || serial != info.Volume || filesystem.ToString() != "NTFS")
                throw new InvalidOperationException("SOVEREIGN_COPY_NTFS_REQUIRED");
            current = RecordDirectory(root, volumeRoot, info.Volume, volumeRoot);
        } catch { root.Dispose(); throw; }
        string[] parts = path.Substring(3).Split('\\');
        for (int i = 0; i < parts.Length - 1; i++) {
            Budget();
            var next = RelativeOpen(current.Handle, parts[i], false, true, false);
            current = RecordDirectory(next, current.Path.TrimEnd('\\') + "\\" + parts[i], current.Volume, current.VolumeRoot);
        }
        return current;
    }
    void VerifyParents() {
        foreach (DirectoryPin pin in pins) {
            Budget(); FileInformation info = Information(pin.Handle, true);
            if (info.Volume != pin.Volume || FileIdentity(info) != pin.Identity
                || !String.Equals(FinalPath(pin.Handle), pin.Path, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_COPY_PARENT_CHANGED");
        }
    }
    FileInformation VerifySource() {
        Budget(); FileInformation info = Information(source, false);
        if (FileIdentity(info) != SourceIdentity || info.Volume != sourceParent.Volume
            || !String.Equals(FinalPath(source), sourceCanonical, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_IDENTITY_UNPROVEN");
        return info;
    }
    FileInformation VerifyDestination() {
        Budget(); FileInformation info = Information(destination, false);
        if (FileIdentity(info) != DestinationIdentity || info.Volume != destinationParent.Volume
            || DestinationIdentity == SourceIdentity
            || !String.Equals(FinalPath(destination), destinationCanonical, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_COPY_DESTINATION_IDENTITY_UNPROVEN");
        return info;
    }
    static bool SameObservation(FileInformation a, FileInformation b) {
        // Access time may change because the source is read. Never claim full
        // metadata invariance or a fence against pre-existing mapped writers.
        return FileIdentity(a) == FileIdentity(b) && Length(a) == Length(b) && a.Links == b.Links
            && a.Attributes == b.Attributes
            && a.Creation.dwHighDateTime == b.Creation.dwHighDateTime && a.Creation.dwLowDateTime == b.Creation.dwLowDateTime
            && a.Write.dwHighDateTime == b.Write.dwHighDateTime && a.Write.dwLowDateTime == b.Write.dwLowDateTime;
    }
    void BeginRead(SafeFileHandle handle, ulong length) {
        Budget();
        if (length > MaxFileBytes) throw new InvalidOperationException("SOVEREIGN_COPY_FILE_SIZE_LIMIT");
        if (length > (ulong)(MaxTotalReadBytes - bytesRead)) throw new InvalidOperationException("SOVEREIGN_COPY_READ_LIMIT");
        long position;
        if (!SetFilePointerEx(handle, 0, out position, 0) || position != 0)
            throw new InvalidOperationException("SOVEREIGN_COPY_READ_UNPROVEN");
    }
    int ReadChunk(SafeFileHandle handle, byte[] buffer, int remaining) {
        Budget(); uint count;
        if (!ReadFile(handle, buffer, (uint)Math.Min(buffer.Length, remaining), out count, IntPtr.Zero)
            || count == 0 || count > (uint)Math.Min(buffer.Length, remaining))
            throw new InvalidOperationException("SOVEREIGN_COPY_READ_UNPROVEN");
        bytesRead += (int)count;
        if (bytesRead > MaxTotalReadBytes) throw new InvalidOperationException("SOVEREIGN_COPY_READ_LIMIT");
        return (int)count;
    }
    static string HashValue(HashAlgorithm sha) {
        return BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
    }
    string HashStream(SafeFileHandle handle, ulong length) {
        BeginRead(handle, length);
        byte[] buffer = new byte[65536]; int remaining = (int)length;
        using (var sha = SHA256.Create()) {
            while (remaining > 0) {
                int count = ReadChunk(handle, buffer, remaining); remaining -= count;
                sha.TransformBlock(buffer, 0, count, buffer, 0);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            return HashValue(sha);
        }
    }
    string ObserveSourceHash(FileInformation before) {
        string value = HashStream(source, Length(before));
        if (!SameObservation(before, VerifySource())) throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
        return value;
    }
    void WriteChunk(byte[] buffer, int length) {
        int offset = 0;
        while (offset < length) {
            Budget(); uint count;
            byte[] part = buffer;
            if (offset != 0) { part = new byte[length - offset]; Buffer.BlockCopy(buffer, offset, part, 0, part.Length); }
            if (!WriteFile(destination, part, (uint)(length - offset), out count, IntPtr.Zero)
                || count == 0 || count > (uint)(length - offset))
                throw new InvalidOperationException("SOVEREIGN_COPY_WRITE_UNPROVEN");
            offset += (int)count;
        }
    }
    string CopyStream(FileInformation original) {
        BeginRead(source, Length(original));
        byte[] buffer = new byte[65536]; int remaining = (int)Length(original);
        using (var sha = SHA256.Create()) {
            while (remaining > 0) {
                int count = ReadChunk(source, buffer, remaining); remaining -= count;
                sha.TransformBlock(buffer, 0, count, buffer, 0); WriteChunk(buffer, count);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            if (!SameObservation(original, VerifySource())) throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
            return HashValue(sha);
        }
    }

    public SovereignFileCopyV1(string from, string to, string expectedSha256) {
        Stage = "PRECONDITION";
        ValidateRequest(from, to, expectedSha256);
        sourcePath = from; destinationPath = to; expectedHash = expectedSha256;
        destinationName = to.Substring(to.LastIndexOf('\\') + 1);
        try {
            sourceParent = PinParent(from); destinationParent = PinParent(to);
            if (sourceParent.Volume != destinationParent.Volume
                || !String.Equals(sourceParent.VolumeRoot, destinationParent.VolumeRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_COPY_SAME_VOLUME_REQUIRED");
            string sourceName = from.Substring(from.LastIndexOf('\\') + 1);
            sourceCanonical = sourceParent.Path.TrimEnd('\\') + "\\" + sourceName;
            destinationCanonical = destinationParent.Path.TrimEnd('\\') + "\\" + destinationName;
            if (String.Equals(sourceCanonical, destinationCanonical, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS");
            // Read has no DELETE, FILE_WRITE_DATA, FILE_APPEND_DATA, WRITE_EA or
            // WRITE_ATTRIBUTES rights. The original file is never mutated.
            source = RelativeOpen(sourceParent.Handle, sourceName, false, false, false);
            FileInformation info = Information(source, false); SourceIdentity = FileIdentity(info);
            if (Length(VerifySource()) > MaxFileBytes) throw new InvalidOperationException("SOVEREIGN_COPY_FILE_SIZE_LIMIT");
            using (var existing = RelativeOpen(destinationParent.Handle, destinationName, false, false, true)) {
                if (existing != null) throw new InvalidOperationException("SOVEREIGN_COPY_TARGET_EXISTS");
            }
            VerifyParents();
            // No destination exists because of construction. The owning caller
            // must explicitly call Copy() before any create attempt can occur.
        } catch { Dispose(); throw; }
    }
    // A distinct read-only construction path never opens a destination or asks
    // the OS for a source mutation right. It cannot call the copying method.
    public SovereignFileCopyV1(string path) {
        Stage = "PRECONDITION"; hashOnly = true; ValidatePath(path); sourcePath = path;
        try {
            sourceParent = PinParent(path);
            string name = path.Substring(path.LastIndexOf('\\') + 1);
            sourceCanonical = sourceParent.Path.TrimEnd('\\') + "\\" + name;
            source = RelativeOpen(sourceParent.Handle, name, false, false, false);
            FileInformation info = Information(source, false); SourceIdentity = FileIdentity(info);
            if (Length(VerifySource()) > MaxFileBytes) throw new InvalidOperationException("SOVEREIGN_COPY_FILE_SIZE_LIMIT");
            VerifyParents();
        } catch { Dispose(); throw; }
    }
    public HashReceipt Hash() {
        if (!hashOnly) throw new InvalidOperationException("SOVEREIGN_COPY_OPERATION_INVALID");
        if (disposed || used) throw new InvalidOperationException("SOVEREIGN_COPY_REQUEST_ALREADY_USED");
        used = true; VerifyParents(); FileInformation original = VerifySource();
        Stage = "HASH";
        string first = ObserveSourceHash(original);
        VerifyParents();
        if (!SameObservation(original, VerifySource())) throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
        string second = ObserveSourceHash(original);
        Stage = "POSTCONDITION"; VerifyParents();
        if (first != second || !SameObservation(original, VerifySource())
            || bytesRead > MaxHashReadBytes || bytesRead != (int)Length(original) * 2)
            throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
        Budget();
        return new HashReceipt { path = sourcePath, sha256 = second, identity = SourceIdentity,
            parentIdentity = sourceParent.Identity, bytes = (int)Length(original), bytesRead = bytesRead,
            durationMs = (int)clock.ElapsedMilliseconds };
    }
    public Receipt Copy() {
        if (hashOnly) throw new InvalidOperationException("SOVEREIGN_COPY_OPERATION_INVALID");
        if (disposed || used) throw new InvalidOperationException("SOVEREIGN_COPY_REQUEST_ALREADY_USED");
        used = true; VerifyParents();
        FileInformation original = VerifySource();
        if (ObserveSourceHash(original) != expectedHash) throw new InvalidOperationException("SOVEREIGN_COPY_HASH_MISMATCH");
        VerifyParents();
        if (!SameObservation(original, VerifySource())) throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
        Budget(); Stage = "NATIVE_CREATE"; MutationAttempted = true;
        // Native FILE_CREATE, never OPEN_IF, supplies no-overwrite even when a
        // different actor creates the destination after the constructor check.
        destination = RelativeOpen(destinationParent.Handle, destinationName, true, false, false);
        FileInformation created = Information(destination, false); DestinationIdentity = FileIdentity(created);
        if (Length(VerifyDestination()) != 0) throw new InvalidOperationException("SOVEREIGN_COPY_CREATE_UNPROVEN");
        Stage = "COPY";
        if (CopyStream(original) != expectedHash) throw new InvalidOperationException("SOVEREIGN_COPY_COPY_HASH_MISMATCH");
        if (!FlushFileBuffers(destination)) throw new InvalidOperationException("SOVEREIGN_COPY_FLUSH_UNPROVEN");
        Stage = "POSTCONDITION"; VerifyParents();
        FileInformation written = VerifyDestination();
        if (Length(written) != Length(original)) throw new InvalidOperationException("SOVEREIGN_COPY_READBACK_UNPROVEN");
        string destinationHash = HashStream(destination, Length(written));
        if (destinationHash != expectedHash || !SameObservation(written, VerifyDestination()))
            throw new InvalidOperationException("SOVEREIGN_COPY_READBACK_UNPROVEN");
        if (!SameObservation(original, VerifySource()) || ObserveSourceHash(original) != expectedHash)
            throw new InvalidOperationException("SOVEREIGN_COPY_SOURCE_CHANGED");
        VerifyParents();
        if (!SameObservation(original, VerifySource()) || !SameObservation(written, VerifyDestination())
            || bytesRead != (int)Length(original) * 4)
            throw new InvalidOperationException("SOVEREIGN_COPY_POSTCONDITION_UNPROVEN");
        Budget();
        // All four reads matched the requested hash. This is not an atomic
        // snapshot, a mapped-writer fence, a move or whole-file publication.
        // A crash or late refusal can leave a new partial file; never clean it
        // up by pathname and never authorize an automatic retry.
        return new Receipt { source = sourcePath, destination = destinationPath, sha256 = destinationHash,
            sourceIdentity = SourceIdentity, destinationIdentity = DestinationIdentity,
            sourceParentIdentity = sourceParent.Identity, destinationParentIdentity = destinationParent.Identity,
            bytes = (int)Length(original), bytesRead = bytesRead, durationMs = (int)clock.ElapsedMilliseconds };
    }
    public void Dispose() {
        if (disposed) return;
        disposed = true;
        if (destination != null) { destination.Dispose(); destination = null; }
        if (source != null) { source.Dispose(); source = null; }
        for (int i = pins.Count - 1; i >= 0; i--) pins[i].Handle.Dispose();
        pins.Clear();
    }
}
