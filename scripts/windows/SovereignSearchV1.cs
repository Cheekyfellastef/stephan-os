using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// Read-only, fixed-budget traversal of one explicit local directory. Every
// opened component is relative to a retained parent handle. Share-read-only
// pins refuse existing writers and deny later write/delete/rename handles.
// No pathname is reopened to enumerate a directory or read a file.
public sealed class SovereignSearchV1 : IDisposable {
    public const int MaxEntries = 10000, MaxFiles = 1000, MaxResults = 1000;
    public const int MaxFileBytes = 262144, MaxTotalBytes = 16777216;
    public const int MaxResultBytes = 524288, MaxDepth = 12, MaxScanMs = 5000;
    const uint GenericRead = 0x00120089, ShareReadOnly = 1;
    const int NoMoreFiles = unchecked((int)0x80000006);
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
    [DllImport("ntdll.dll")]
    static extern int NtCreateFile(out IntPtr handle, uint access, ref ObjectAttributes attributes,
        out IoStatusBlock status, IntPtr size, uint fileAttributes, uint sharing,
        uint disposition, uint options, IntPtr ea, uint eaLength);
    [DllImport("ntdll.dll")]
    static extern int NtQueryDirectoryFile(SafeFileHandle handle, IntPtr ev, IntPtr apc, IntPtr context,
        out IoStatusBlock status, IntPtr buffer, uint length, int informationClass,
        [MarshalAs(UnmanagedType.U1)] bool single, IntPtr name, [MarshalAs(UnmanagedType.U1)] bool restart);
    [DllImport("ntdll.dll")] static extern uint RtlNtStatusToDosError(int status);

    public sealed class Match {
        public string path, relativePath, type = "file", preview;
        public int? line, column;
    }
    public sealed class Statistics {
        public int entriesVisited, filesVisited, bytesRead, resultBytes, resultsCount, durationMs;
    }
    public sealed class Snapshot {
        public string schemaVersion = "stephanos.sovereign-search-snapshot.v1";
        public bool ok = true, complete;
        public string path, query, mode, scopeIdentity;
        public bool caseSensitive;
        public string confinement = "WINDOWS_HANDLE_RELATIVE_NO_REPARSE";
        public string snapshotConsistency = "BOUNDED_OBSERVATION_NOT_ATOMIC_TREE_SNAPSHOT";
        public string[] reasons;
        public Statistics stats;
        public Match[] results;
    }
    sealed class Entry { public string Name; public bool Directory, Reparse; }

    static readonly HashSet<string> SensitiveDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        ".git", ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".config",
        ".codex", ".openclaw", ".claude", ".gemini", ".pki", ".password-store",
        "secrets", ".secrets", "credentials", ".credentials", "OpenAI-Secure-MCP-Tunnel",
        "AppData", "ProgramData", "Windows", "Program Files", "Program Files (x86)",
        "$Recycle.Bin", "System Volume Information", "Recovery"
    };
    static readonly HashSet<string> OmittedBuildDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "node_modules", "dist", "build", "coverage", ".next", ".cache"
    };
    static readonly Regex SensitiveFiles = new Regex(
        @"^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|credentials(?:\..+)?|secrets?(?:\..+)?|auth\.json|tokens?(?:\..+)?|Cookies|Login Data|Web Data)$|\.(?:key|pem|pfx|p12|kdbx|dpapi)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    readonly List<SafeFileHandle> ancestors = new List<SafeFileHandle>();
    readonly List<Match> matches = new List<Match>();
    readonly HashSet<string> reasons = new HashSet<string>(StringComparer.Ordinal);
    readonly Statistics stats = new Statistics();
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly string target, needle, mode;
    readonly bool caseSensitive;
    readonly StringComparison comparison;
    string volumeRoot, canonicalScope, scopeIdentity;
    uint volume;
    bool disposed, used, halt;

    public static bool ValidPart(string part) {
        return part != null && part.Length > 0 && part.Length <= 255 && part != "." && part != ".."
            && part.TrimEnd(' ', '.') == part && !Regex.IsMatch(part, "[\x00-\x1f<>:\"/\\\\|?*~]")
            && !Regex.IsMatch(part, @"^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", RegexOptions.IgnoreCase);
    }
    public static void ValidateRequest(string path, string query, string mode) {
        if (path == null || path.Length > 1024 || path.Trim() != path
            || !Regex.IsMatch(path, @"^[A-Za-z]:\\[^\\]"))
            throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_INVALID");
        var parts = path.Substring(3).Split('\\');
        if (parts.Length > 64) throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_INVALID");
        foreach (var part in parts) {
            if (!ValidPart(part)) throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_INVALID");
            if (SensitiveDirectories.Contains(part) || OmittedBuildDirectories.Contains(part) || SensitiveFiles.IsMatch(part))
                throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_EXCLUDED");
        }
        if (query == null || query.Length < 1 || query.Length > 200 || Regex.IsMatch(query, "[\x00-\x1f\x7f]"))
            throw new InvalidOperationException("SOVEREIGN_SEARCH_QUERY_INVALID");
        if (mode != "file" && mode != "content") throw new InvalidOperationException("SOVEREIGN_SEARCH_MODE_INVALID");
    }
    static string Identity(FileInformation info) {
        return info.Volume.ToString("x8") + ":" + info.IndexHigh.ToString("x8") + info.IndexLow.ToString("x8");
    }
    static FileInformation Information(SafeFileHandle handle, bool directory) {
        FileInformation info;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (GetFileType(handle) != 1 || (info.Attributes & 0x400) != 0
            || ((info.Attributes & 0x10) != 0) != directory)
            throw new InvalidOperationException("SOVEREIGN_SEARCH_REPARSE_OR_TYPE_REJECTED");
        if (!directory && info.Links != 1)
            throw new InvalidOperationException("SOVEREIGN_SEARCH_HARD_LINK_REJECTED");
        return info;
    }
    static string FinalPath(SafeFileHandle handle) {
        var value = new StringBuilder(2048);
        uint count = GetFinalPathNameByHandleW(handle, value, (uint)value.Capacity, 1);
        if (count == 0 || count >= value.Capacity)
            throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
        return value.ToString();
    }
    void VerifyOpenedPath(SafeFileHandle handle, bool directory, bool scopeAncestor) {
        string actual = FinalPath(handle);
        if (!actual.StartsWith(volumeRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
        string[] actualParts = actual.Substring(volumeRoot.Length).Split('\\');
        for (int i = 0; i < actualParts.Length; i++) {
            if (!ValidPart(actualParts[i])) throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
            if (i < actualParts.Length - 1 || directory) {
                if (SensitiveDirectories.Contains(actualParts[i]) || OmittedBuildDirectories.Contains(actualParts[i]) || SensitiveFiles.IsMatch(actualParts[i]))
                    throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_EXCLUDED");
            } else if (SensitiveFiles.IsMatch(actualParts[i])) {
                throw new InvalidOperationException("SOVEREIGN_SEARCH_SENSITIVE_FILE_REJECTED");
            }
        }
        if (!scopeAncestor && !actual.StartsWith(canonicalScope + "\\", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
    }
    static SafeFileHandle OpenRelative(SafeFileHandle parent, string name, bool directory) {
        if (!ValidPart(name)) throw new InvalidOperationException("SOVEREIGN_SEARCH_SCOPE_INVALID");
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
            // FILE_OPEN only. No create/write/delete access or disposition.
            int status = NtCreateFile(out raw, GenericRead, ref attributes, out ios, IntPtr.Zero, 0,
                ShareReadOnly, 1, (directory ? 1u : 0x40u) | 0x20u | 0x00200000u, IntPtr.Zero, 0);
            if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
            var result = new SafeFileHandle(raw, true);
            try { Information(result, directory); return result; }
            catch { result.Dispose(); throw; }
        } finally {
            if (retained) parent.DangerousRelease();
            if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode);
            Marshal.FreeHGlobal(chars);
        }
    }
    public SovereignSearchV1(string path, string query, string searchMode, bool matchCase) {
        ValidateRequest(path, query, searchMode);
        target = path; needle = query; mode = searchMode; caseSensitive = matchCase;
        comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        try {
            if (GetDriveTypeW(path.Substring(0, 3)) != 3)
                throw new InvalidOperationException("SOVEREIGN_SEARCH_LOCAL_FIXED_VOLUME_REQUIRED");
            var drive = CreateFileW(@"\\?\" + path.Substring(0, 3), 0x80000000, ShareReadOnly,
                IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
            ancestors.Add(drive);
            var info = Information(drive, true); volume = info.Volume;
            volumeRoot = FinalPath(drive);
            // Refuse DOS aliases/subst roots as well as remote/mounted redirects.
            if (!Regex.IsMatch(volumeRoot, @"^\\\\\?\\Volume\{[a-fA-F0-9-]+\}\\$") || GetDriveTypeW(volumeRoot) != 3)
                throw new InvalidOperationException("SOVEREIGN_SEARCH_LOCAL_FIXED_VOLUME_REQUIRED");
            foreach (var part in path.Substring(3).Split('\\')) {
                var next = OpenRelative(ancestors[ancestors.Count - 1], part, true);
                ancestors.Add(next);
                if (Information(next, true).Volume != volume)
                    throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
                VerifyOpenedPath(next, true, true);
            }
            canonicalScope = FinalPath(ancestors[ancestors.Count - 1]);
            scopeIdentity = Identity(Information(ancestors[ancestors.Count - 1], true));
        } catch { Dispose(); throw; }
    }
    bool Continue() {
        if (clock.ElapsedMilliseconds >= MaxScanMs) { reasons.Add("TIME_LIMIT"); halt = true; }
        return !halt;
    }
    void Failure(Exception error) {
        var native = error as Win32Exception;
        if (native != null) {
            reasons.Add(native.NativeErrorCode == 5 ? "ACCESS_DENIED" : "ENTRY_CHANGED_OR_BUSY"); return;
        }
        switch (error.Message) {
            case "SOVEREIGN_SEARCH_HARD_LINK_REJECTED": reasons.Add("HARD_LINK_EXCLUDED"); break;
            case "SOVEREIGN_SEARCH_REPARSE_OR_TYPE_REJECTED": reasons.Add("LINK_OR_NONREGULAR_EXCLUDED"); break;
            case "SOVEREIGN_SEARCH_SCOPE_EXCLUDED":
            case "SOVEREIGN_SEARCH_SENSITIVE_FILE_REJECTED": reasons.Add("SENSITIVE_ENTRY_EXCLUDED"); break;
            case "SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN": reasons.Add("OBJECT_PATH_UNPROVEN"); break;
            default: reasons.Add("READ_FAILED"); break;
        }
    }
    List<Entry> Enumerate(SafeFileHandle directory) {
        var entries = new List<Entry>();
        IntPtr buffer = Marshal.AllocHGlobal(16384);
        try {
            bool restart = true;
            while (Continue()) {
                IoStatusBlock ios;
                // Microsoft FILE_DIRECTORY_INFORMATION: attributes at 56,
                // name length at 60, UTF-16 name at 64; next records align to 8.
                // https://learn.microsoft.com/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_directory_information
                int status = NtQueryDirectoryFile(directory, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero,
                    out ios, buffer, 16384, 1, false, IntPtr.Zero, restart);
                restart = false;
                if (status == NoMoreFiles) break;
                if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
                ulong size = ios.Information.ToUInt64();
                if (size < 64 || size > 16384) throw new IOException("Invalid directory record");
                int offset = 0;
                while (true) {
                    if (!Continue()) return entries;
                    if (offset < 0 || (ulong)(offset + 64) > size) throw new IOException("Invalid directory record");
                    IntPtr record = IntPtr.Add(buffer, offset);
                    uint next = unchecked((uint)Marshal.ReadInt32(record, 0));
                    uint attributes = unchecked((uint)Marshal.ReadInt32(record, 56));
                    int bytes = Marshal.ReadInt32(record, 60);
                    if (bytes < 2 || bytes > 510 || (bytes & 1) != 0 || (ulong)(offset + 64 + bytes) > size)
                        throw new IOException("Invalid directory name");
                    string name = Marshal.PtrToStringUni(IntPtr.Add(record, 64), bytes / 2);
                    if (name != "." && name != "..") {
                        if (stats.entriesVisited >= MaxEntries) { reasons.Add("ENTRY_LIMIT"); return entries; }
                        stats.entriesVisited++;
                        if (!ValidPart(name)) reasons.Add("INVALID_ENTRY_NAME_EXCLUDED");
                        else entries.Add(new Entry { Name = name, Directory = (attributes & 0x10) != 0, Reparse = (attributes & 0x400) != 0 });
                    }
                    if (next == 0) break;
                    if (next < 64 + bytes || next > int.MaxValue || (next & 7) != 0 || (ulong)(offset + next) >= size)
                        throw new IOException("Invalid directory offset");
                    offset += (int)next;
                }
            }
        } finally { Marshal.FreeHGlobal(buffer); }
        entries.Sort(delegate(Entry a, Entry b) { return StringComparer.Ordinal.Compare(a.Name, b.Name); });
        return entries;
    }
    void Add(string relative, int? line, int? column, string preview) {
        if (matches.Count >= MaxResults) { reasons.Add("RESULT_LIMIT"); halt = true; return; }
        string full = target + "\\" + relative;
        if (full.Length > 1024) { reasons.Add("PATH_LENGTH_LIMIT"); return; }
        // Conservative JSON budget (all characters may require six-byte escaping).
        int cost = checked((full.Length + relative.Length + (preview == null ? 0 : preview.Length)) * 6 + 192);
        if (stats.resultBytes + cost > MaxResultBytes) { reasons.Add("RESULT_BYTE_LIMIT"); halt = true; return; }
        matches.Add(new Match { path = full, relativePath = relative, line = line, column = column, preview = preview });
        stats.resultBytes += cost;
    }
    void ReadOne(SafeFileHandle parent, string name, string relative) {
        if (stats.filesVisited >= MaxFiles) { reasons.Add("FILE_LIMIT"); halt = true; return; }
        stats.filesVisited++;
        try {
            using (var file = OpenRelative(parent, name, false)) {
                var before = Information(file, false);
                if (before.Volume != volume) throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
                VerifyOpenedPath(file, false, false);
                if (mode == "file") {
                    if (name.IndexOf(needle, comparison) >= 0) Add(relative, null, null, null);
                    return;
                }
                ulong length = ((ulong)before.SizeHigh << 32) | before.SizeLow;
                if (length > MaxFileBytes) { reasons.Add("FILE_SIZE_LIMIT"); return; }
                if (length > (ulong)(MaxTotalBytes - stats.bytesRead)) { reasons.Add("BYTE_LIMIT"); halt = true; return; }
                byte[] bytes = new byte[(int)length]; int read = 0;
                using (var stream = new FileStream(file, FileAccess.Read, 4096, false)) {
                    while (read < bytes.Length && Continue()) {
                        int count = stream.Read(bytes, read, Math.Min(16384, bytes.Length - read));
                        if (count == 0) break;
                        read += count; stats.bytesRead += count;
                    }
                    if (!Continue()) return;
                    var after = Information(file, false);
                    if (read != bytes.Length || before.SizeHigh != after.SizeHigh || before.SizeLow != after.SizeLow
                        || before.Write.dwHighDateTime != after.Write.dwHighDateTime || before.Write.dwLowDateTime != after.Write.dwLowDateTime) {
                        reasons.Add("FILE_CHANGED_DURING_READ"); return;
                    }
                }
                if (Array.IndexOf(bytes, (byte)0) >= 0) { reasons.Add("BINARY_OR_NON_UTF8_EXCLUDED"); return; }
                string content;
                try { content = new UTF8Encoding(false, true).GetString(bytes); }
                catch (DecoderFallbackException) { reasons.Add("BINARY_OR_NON_UTF8_EXCLUDED"); return; }
                if (content.Length > 0 && content[0] == '\uFEFF') content = content.Substring(1);
                int start = 0, line = 1;
                while (start <= content.Length && Continue()) {
                    int end = content.IndexOf('\n', start); if (end < 0) end = content.Length;
                    int count = end - start; if (count > 0 && content[start + count - 1] == '\r') count--;
                    string value = content.Substring(start, count);
                    int column = value.IndexOf(needle, comparison);
                    if (column >= 0) Add(relative, line, column + 1, value.Substring(0, Math.Min(value.Length, 240)));
                    if (end == content.Length) break;
                    start = end + 1; line++;
                }
            }
        } catch (Exception error) { Failure(error); }
    }
    void Walk(SafeFileHandle directory, string prefix, int depth) {
        List<Entry> entries;
        try { entries = Enumerate(directory); } catch (Exception error) { Failure(error); return; }
        foreach (var entry in entries) {
            if (!Continue()) return;
            if (entry.Reparse) { reasons.Add("LINK_OR_NONREGULAR_EXCLUDED"); continue; }
            string relative = prefix.Length == 0 ? entry.Name : prefix + "\\" + entry.Name;
            if (target.Length + 1 + relative.Length > 1024) { reasons.Add("PATH_LENGTH_LIMIT"); continue; }
            if (entry.Directory) {
                if (SensitiveDirectories.Contains(entry.Name) || SensitiveFiles.IsMatch(entry.Name)) { reasons.Add("SENSITIVE_ENTRY_EXCLUDED"); continue; }
                if (OmittedBuildDirectories.Contains(entry.Name)) { reasons.Add("BUILD_TREE_EXCLUDED"); continue; }
                if (depth >= MaxDepth) { reasons.Add("DEPTH_LIMIT"); continue; }
                try {
                    using (var child = OpenRelative(directory, entry.Name, true)) {
                        if (Information(child, true).Volume != volume) throw new InvalidOperationException("SOVEREIGN_SEARCH_OBJECT_PATH_UNPROVEN");
                        VerifyOpenedPath(child, true, false);
                        Walk(child, relative, depth + 1);
                    }
                } catch (Exception error) { Failure(error); }
            } else if (SensitiveFiles.IsMatch(entry.Name)) reasons.Add("SENSITIVE_ENTRY_EXCLUDED");
            else ReadOne(directory, entry.Name, relative);
        }
    }
    public Snapshot Run() {
        if (disposed || used) throw new InvalidOperationException("SOVEREIGN_SEARCH_REQUEST_ALREADY_USED");
        used = true;
        Walk(ancestors[ancestors.Count - 1], "", 0);
        Continue();
        stats.resultsCount = matches.Count; stats.durationMs = (int)Math.Min(int.MaxValue, clock.ElapsedMilliseconds);
        var orderedReasons = new List<string>(reasons); orderedReasons.Sort(StringComparer.Ordinal);
        return new Snapshot { path = target, query = needle, mode = mode, caseSensitive = caseSensitive,
            scopeIdentity = scopeIdentity, complete = reasons.Count == 0, reasons = orderedReasons.ToArray(),
            stats = stats, results = matches.ToArray() };
    }
    public void Dispose() {
        if (disposed) return;
        disposed = true;
        for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
        ancestors.Clear();
    }
}
