using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace Stephanos.OriginalR7CustodyWitness;

// Opens preprovisioned audit storage only. It does not provision a trusted
// root, create paths, set permissions, sign evidence or authorize custody.
internal sealed class OriginalR7AuditStorage : IDisposable
{
    internal const int ServiceFileMask = 0x12008d; // GENERIC_READ mapped + APPEND_DATA only
    internal const int ServiceDirectoryMask = 0x1200a9; // Read/execute; no child creation/deletion
    private const int FullControl = 0x1f01ff;
    private const string Service = "StephanosOriginalR7CustodyWitness";
    private readonly List<SafeFileHandle> ancestors = new();
    private OriginalR7AuditJournal? journal;
    private bool disposed;
    internal OriginalR7AuditJournal Journal => !disposed && journal is not null
        ? journal : throw Held("STORAGE_UNAVAILABLE");

    internal static OriginalR7AuditStorage OpenFixed(OriginalR7AuditBinding binding)
    {
        if (!OperatingSystem.IsWindows() || Environment.UserInteractive
            || System.Diagnostics.Process.GetCurrentProcess().SessionId != 0)
            throw Held("SCM_CONTEXT_REQUIRED");
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        SecurityIdentifier sid = (SecurityIdentifier)new NTAccount("NT SERVICE", Service)
            .Translate(typeof(SecurityIdentifier));
        if (identity.User?.Equals(sid) != true || identity.IsSystem
            || new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
            throw Held("DEDICATED_SERVICE_IDENTITY_REQUIRED");

        string programData = KnownProgramData();
        string directory = Path.Combine(programData, "Stephanos", Service, "audit");
        string file = Path.Combine(directory, "original-r7.ndjson");
        OriginalR7AuditStorage result = new();
        FileStream? stream = null;
        try
        {
            // Root to leaf, all retained for the entire journal lifetime.
            Stack<string> path = new();
            for (DirectoryInfo? d = new(directory); d is not null; d = d.Parent)
            {
                if (path.Count >= 32) throw Held("ANCESTOR_LIMIT");
                path.Push(d.FullName);
            }
            SafeFileHandle? leaf = null;
            while (path.TryPop(out string? part))
            {
                SafeFileHandle h = OpenPinnedDirectory(part,
                    string.Equals(part, directory, StringComparison.OrdinalIgnoreCase));
                result.ancestors.Add(h);
                leaf = h;
            }
            if (leaf is null || !PolicyMatches(ReadDescriptor(leaf), sid.Value, directory: true))
                throw Held("DIRECTORY_POLICY_UNPROVEN");
            SafeFileHandle handle = CreateFileW(file, ServiceFileMask,
                1 /* no other writer/delete sharing */, IntPtr.Zero, 3,
                0x80200000 /* WRITE_THROUGH | OPEN_REPARSE_POINT */, IntPtr.Zero);
            try
            {
                if (!NativeIdentityMatches(handle, file, directory: false)
                    || !PolicyMatches(ReadDescriptor(handle), sid.Value, directory: false))
                    throw Held("FILE_IDENTITY_OR_POLICY_UNPROVEN");
                stream = new FileStream(handle, FileAccess.ReadWrite, 1, false);
            }
            catch { handle.Dispose(); throw; }
            result.journal = new OriginalR7AuditJournal(stream, binding);
            stream = null; // owned by the journal after complete initialization
            return result;
        }
        catch
        {
            stream?.Dispose();
            result.Dispose();
            throw Held("FIXED_STORAGE_UNAVAILABLE");
        }
    }

    // Shared by audit storage and the metadata observer, so native fixture
    // tests exercise the actual audit ancestor-open operation. FILE_LIST_DIRECTORY
    // makes this a read-access open: metadata-only access does not participate
    // in Windows sharing checks and cannot pin names by refusing delete sharing.
    // This is replacement-sharing protection only, not mapped-writer exclusion.
    internal static SafeFileHandle OpenPinnedDirectory(string canonicalPath, bool descriptorRequired)
    {
        SafeFileHandle handle = CreateFileW(canonicalPath,
            descriptorRequired ? 0x20081 : 0x81, 3 /* read/write, no delete */,
            IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        try
        {
            if (!NativeIdentityMatches(handle, canonicalPath, directory: true))
                throw Held("ANCESTOR_IDENTITY_UNPROVEN");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }

    // Descriptor evaluator is also exercised with synthetic descriptors by
    // tests. A matching descriptor is policy shape, never trusted provenance.
    internal static bool PolicyMatches(byte[] descriptor, string serviceSid, bool directory)
    {
        try
        {
            SecurityIdentifier service = new(serviceSid);
            if (!service.Value.StartsWith("S-1-5-80-", StringComparison.Ordinal)) return false;
            RawSecurityDescriptor sd = new(descriptor, 0);
            const ControlFlags required = ControlFlags.DiscretionaryAclPresent
                | ControlFlags.DiscretionaryAclProtected;
            if ((sd.ControlFlags & required) != required || sd.DiscretionaryAcl?.Count != 3
                || sd.Owner is null || sd.Owner.Value is not ("S-1-5-18" or "S-1-5-32-544"))
                return false;
            var expected = new Dictionary<string, int>(StringComparer.Ordinal) {
                ["S-1-5-18"] = FullControl, ["S-1-5-32-544"] = FullControl,
                [service.Value] = directory ? ServiceDirectoryMask : ServiceFileMask
            };
            foreach (GenericAce raw in sd.DiscretionaryAcl)
            {
                if (raw is not CommonAce ace || ace.IsCallback
                    || ace.AceFlags != AceFlags.None || ace.AceQualifier != AceQualifier.AccessAllowed
                    || !expected.Remove(ace.SecurityIdentifier.Value, out int mask)
                    || ace.AccessMask != mask) return false;
            }
            return expected.Count == 0;
        }
        catch { return false; }
    }

    internal static byte[] ReadDescriptor(SafeFileHandle handle)
    {
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            uint error = GetSecurityInfo(handle, 1, 5, out _, out _, out _, out _, out descriptor);
            if (error != 0 || descriptor == IntPtr.Zero) throw Held("DESCRIPTOR_UNREADABLE");
            uint length = GetSecurityDescriptorLength(descriptor);
            if (length == 0 || length > 65536) throw Held("DESCRIPTOR_BOUND");
            byte[] bytes = new byte[(int)length];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            return bytes;
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }

    internal static bool NativeIdentityMatches(SafeFileHandle handle, string path, bool directory)
    {
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out FileInfo info)
            || (info.Attributes & 0x400) != 0
            || ((info.Attributes & 0x10) != 0) != directory
            || (!directory && info.Links != 1)) return false;
        StringBuilder name = new(512);
        uint length = GetFinalPathNameByHandleW(handle, name, (uint)name.Capacity, 0);
        string native = name.ToString();
        return length > 0 && length < name.Capacity && native.StartsWith(@"\\?\", StringComparison.Ordinal)
            && string.Equals(native[4..], path, StringComparison.OrdinalIgnoreCase);
    }

    internal static string KnownProgramData()
    {
        Guid id = new("62AB5D82-FDC1-4DC3-A9DD-070D1D495D97");
        IntPtr value = IntPtr.Zero;
        try
        {
            if (SHGetKnownFolderPath(in id, 0, IntPtr.Zero, out value) != 0 || value == IntPtr.Zero)
                throw Held("PROGRAMDATA_UNKNOWN");
            string path = Marshal.PtrToStringUni(value) ?? "";
            if (path.Length is < 3 or > 160 || !char.IsAsciiLetter(path[0])
                || path[1] != ':' || path[2] != '\\' || path.Contains('/')
                || path.AsSpan(2).Contains(':') || !Path.IsPathFullyQualified(path)
                || !string.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase))
                throw Held("PROGRAMDATA_NONCANONICAL");
            return path;
        }
        finally { if (value != IntPtr.Zero) Marshal.FreeCoTaskMem(value); }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        journal?.Dispose();
        for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
        ancestors.Clear();
    }
    private static InvalidOperationException Held(string code) => new("R7_AUDIT_" + code);
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        internal uint Attributes;
        internal System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        internal uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, int access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint security,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr value);
    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(in Guid id, uint flags, IntPtr token, out IntPtr path);
}
