using Microsoft.Win32.SafeHandles;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Stephanos.OriginalR7CustodyWitness;

internal sealed record OriginalR7KeyMetadataObservation(
    string Classification, bool NativeIdentityObserved, bool ProtectedAclShapeMatches,
    bool MetadataOnlyAccess, bool DataWriterAndReplacementSharingExcluded, string FileIdentityDigest, string DescriptorDigest)
{
    internal bool PrivateKeyBytesRead => false;
    internal bool RootEnrolled => false;
    internal bool PolicyAdopted => false;
    internal bool OriginalWriterExcluded => false;
    internal bool SigningAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

// A retained metadata observation, not a material reader or enrollment grant.
// READ_CONTROL | FILE_READ_ATTRIBUTES deliberately excludes FILE_READ_DATA.
// A future operational signer needs separately authenticated adoption and
// complete native custody before opening a distinct data handle.
internal sealed class OriginalR7ProtectedKeyMetadata : IDisposable
{
    internal const int RoleFileReadMask = 0x120089;
    internal const int RoleDirectoryReadMask = 0x1200a9;
    private const int FullControl = 0x1f01ff;
    private readonly List<SafeFileHandle> ancestors = new();
    private readonly List<string> ancestorPaths = new();
    private readonly string path, roleSid;
    private readonly bool fixtureMaterialAccess;
    private readonly long opened = Stopwatch.GetTimestamp();
    private SafeFileHandle? leaf;
    private string fileIdentity = "", descriptorIdentity = "";
    private bool disposed;

    private OriginalR7ProtectedKeyMetadata(string canonicalPath, string expectedRoleSid, bool untrustedFixtureMaterial)
    { path = canonicalPath; roleSid = new SecurityIdentifier(expectedRoleSid).Value; fixtureMaterialAccess = untrustedFixtureMaterial; }

    internal static OriginalR7KeyMetadataObservation ObserveFixedWitness()
    {
        // This diagnostic may read metadata only in the real fixed service
        // context. It never imports a candidate, caller path or key bytes.
        var context = OriginalR7FixedSigningHostProfile.ObserveCurrentWitnessContext();
        if (!context.NativeContextObserved) return Held("FIXED_SERVICE_CONTEXT_UNPROVEN");
        try
        {
            string fixedPath = Path.Combine(OriginalR7AuditStorage.KnownProgramData(),
                "Stephanos", "StephanosOriginalR7CustodyWitness", "keys", "witness.seed");
            using WindowsIdentity who = WindowsIdentity.GetCurrent();
            using var observed = OpenMetadata(fixedPath, who.User?.Value
                ?? throw Failure("CURRENT_SID_UNAVAILABLE"));
            return observed.Refresh();
        }
        catch { return Held("FIXED_KEY_METADATA_UNPROVEN"); }
    }

    // INTERNAL metadata fixture seam. It cannot open data or produce authority, and
    // is not called by a production CLI, request handler or signing endpoint.
    internal static OriginalR7ProtectedKeyMetadata OpenUntrustedFixture(
        string fixturePath, string untrustedRoleSid) => OpenMetadata(fixturePath, untrustedRoleSid);

    // Material-access mechanics can only be exercised by the internal disposable
    // fixture seam until a separate genuine adoption/custody permit exists.
    internal static OriginalR7ProtectedKeyMetadata OpenUntrustedMaterialFixture(
        string fixturePath, string untrustedRoleSid) => OpenMetadata(fixturePath, untrustedRoleSid, true);

    private static OriginalR7ProtectedKeyMetadata OpenMetadata(string input, string sid, bool fixtureMaterial = false)
    {
        if (!OperatingSystem.IsWindows() || input.Length is < 4 or > 240
            || !char.IsAsciiLetter(input[0]) || input[1] != ':' || input[2] != '\\'
            || input.Contains('/') || input.AsSpan(2).Contains(':')
            || input.Any(c => c < 0x20) || !Path.IsPathFullyQualified(input)
            || !string.Equals(input, Path.GetFullPath(input), StringComparison.OrdinalIgnoreCase))
            throw Failure("CANONICAL_LOCAL_PATH_REQUIRED");
        OriginalR7ProtectedKeyMetadata result = new(input, sid, fixtureMaterial);
        try
        {
            Stack<string> chain = new();
            for (DirectoryInfo? parent = new(Path.GetDirectoryName(input)!); parent is not null; parent = parent.Parent)
            {
                if (chain.Count >= 32) throw Failure("ANCESTOR_BOUND");
                chain.Push(parent.FullName);
            }
            while (chain.TryPop(out string? directory))
            {
                // Retain every ancestor with list-directory read access and
                // without delete sharing. No descriptor
                // read permission is required on unrelated system ancestors.
                var handle = OriginalR7AuditStorage.OpenPinnedDirectory(directory, false);
                result.ancestors.Add(handle);
                result.ancestorPaths.Add(directory);
            }
            result.leaf = CreateFileW(input, fixtureMaterial ? 0x20081 : 0x20080, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
            if (!OriginalR7AuditStorage.NativeIdentityMatches(result.leaf, input, directory: false)
                || RandomAccess.GetLength(result.leaf) != 32)
                throw Failure("REGULAR_SINGLE_LINK_32_BYTE_FILE_REQUIRED");
            result.fileIdentity = FileIdentity(result.leaf);
            result.descriptorIdentity = Hash(OriginalR7AuditStorage.ReadDescriptor(result.leaf));
            result.Refresh();
            return result;
        }
        catch { result.Dispose(); throw Failure("METADATA_OPEN_FAILED_CLOSED"); }
    }

    internal OriginalR7KeyMetadataObservation Refresh()
    {
        try
        {
            if (disposed || leaf is null || Stopwatch.GetElapsedTime(opened) > TimeSpan.FromSeconds(30))
                throw Failure("OBSERVATION_TERMINAL_OR_EXPIRED");
            for (int i = 0; i < ancestors.Count; i++)
                if (!OriginalR7AuditStorage.NativeIdentityMatches(ancestors[i], ancestorPaths[i], directory: true))
                    throw Failure("ANCESTOR_CONTINUITY_CHANGED");
            if (!OriginalR7AuditStorage.NativeIdentityMatches(leaf, path, directory: false)
                || RandomAccess.GetLength(leaf) != 32 || FileIdentity(leaf) != fileIdentity)
                throw Failure("RETAINED_IDENTITY_CHANGED");
            byte[] descriptor = OriginalR7AuditStorage.ReadDescriptor(leaf);
            if (Hash(descriptor) != descriptorIdentity) throw Failure("RETAINED_DESCRIPTOR_CHANGED");
            return new("R7_KEY_METADATA_OBSERVED_NOT_CUSTODY", true,
                PolicyMatches(descriptor, roleSid, directory: false), !fixtureMaterialAccess, fixtureMaterialAccess,
                fileIdentity, descriptorIdentity);
        }
        catch { Dispose(); throw Failure("METADATA_REFRESH_FAILED_CLOSED"); }
    }

    // Shape validation is shared with future fixed-store provisioning/readback.
    // It is not producer/root enrollment or effective source-worker exclusion.
    internal static bool PolicyMatches(byte[] descriptor, string expectedRoleSid, bool directory)
    {
        try
        {
            var role = new SecurityIdentifier(expectedRoleSid);
            if (role.Value is "S-1-5-18" or "S-1-5-32-544") return false;
            var sd = new RawSecurityDescriptor(descriptor, 0);
            const ControlFlags required = ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected;
            if ((sd.ControlFlags & required) != required || sd.DiscretionaryAcl?.Count != 3
                || sd.Owner?.Value is not ("S-1-5-18" or "S-1-5-32-544")) return false;
            var expected = new Dictionary<string, int>(StringComparer.Ordinal) {
                ["S-1-5-18"] = FullControl, ["S-1-5-32-544"] = FullControl,
                [role.Value] = directory ? RoleDirectoryReadMask : RoleFileReadMask
            };
            foreach (GenericAce raw in sd.DiscretionaryAcl)
            {
                if (raw is not CommonAce ace || ace.IsCallback || ace.AceFlags != AceFlags.None
                    || ace.AceQualifier != AceQualifier.AccessAllowed
                    || !expected.Remove(ace.SecurityIdentifier.Value, out int rights)
                    || rights != ace.AccessMask) return false;
            }
            return expected.Count == 0;
        }
        catch { return false; }
    }

    internal static string FileIdentity(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandleEx(handle, 18, out NativeFileId id, (uint)Marshal.SizeOf<NativeFileId>()))
            throw Failure("NATIVE_FILE_ID_UNAVAILABLE");
        Span<byte> raw = stackalloc byte[24];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(raw, id.Volume);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(raw[8..], id.Low);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(raw[16..], id.High);
        return Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant();
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static OriginalR7KeyMetadataObservation Held(string code) => new("R7_KEY_METADATA_" + code, false, false, true, false, "", "");
    private static InvalidOperationException Failure(string code) => new("R7_KEY_METADATA_" + code);
    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        leaf?.Dispose(); leaf = null;
        for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
        ancestors.Clear();
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativeFileId { internal ulong Volume, Low, High; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, int access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int type,
        out NativeFileId information, uint size);
}
