using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Stephanos.OriginalR7CustodyWitness;

internal enum OriginalR7SeedCreationStage { EmptyProtectedFile, MaterialWritten, MaterialFlushed, MaterialVerified }
internal enum OriginalR7SeedFixtureFault { None, PartialWrite, BeforeFlush, AfterFlush, ReadbackMismatch, AfterReadback }

internal sealed record OriginalR7SeedCreationCheckpoint(
    OriginalR7SeedCreationStage Stage, string NativeFileIdentityDigest, string DescriptorDigest,
    long Length, bool CanonicalPolicyMatches);

internal sealed record OriginalR7CreatedSeedObservation(
    string Classification, OriginalR7SignaturePurpose Purpose, string NativeFileIdentityDigest,
    string DescriptorDigest, string PublicSpkiBase64, string PublicSpkiSha256, string PublicPemSha256,
    bool CanonicalPolicyMatches, bool CanonicalDirectoryPolicyMatches,
    bool UntrustedFixtureOwnerUsed, bool FlushAndReadbackCompleted)
{
    internal bool HumanConsentProven => false;
    internal bool PolicyAdopted => false;
    internal bool SourcePrincipalIsolationProven => false;
    internal bool RootEnrolled => false;
    internal bool SigningAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

internal sealed record OriginalR7FixedSeedLocationProposal(OriginalR7SignaturePurpose Purpose, string Path)
{
    internal bool PolicyAdopted => false;
    internal bool HostExecutionAuthorized => false;
    internal bool RootEnrollmentAuthorized => false;
}

internal sealed class OriginalR7SeedCreationException : InvalidOperationException
{
    internal bool CreatedObjectObserved { get; }
    internal bool CreatedObjectCleanupConfirmed { get; }
    internal string FailedPhase { get; }
    internal OriginalR7SeedCreationException(bool created, bool cleaned, string phase)
        : base(cleaned || !created ? "R7_SEED_CREATION_FAILED_CLOSED" : "R7_SEED_CREATION_FAILED_CLEANUP_UNPROVEN")
    { CreatedObjectObserved = created; CreatedObjectCleanupConfirmed = cleaned; FailedPhase = phase; }
}

// Native storage transaction for the missing first-root creation step. Nothing
// invokes it from a production host/CLI. Its current callable seams are INTERNAL
// OWNED FIXTURES ONLY, never admission capabilities. An eventual admitted native
// ceremony must bind its exact fixed role/location before entering CreateNewCore;
// it must NOT accept a path, descriptor, ownership switch or hook from a request.
// The witness's existing fixed leaf is ProgramData/Stephanos/
// StephanosOriginalR7CustodyWitness/keys/witness.seed.
// The source owner proposed a SEPARATE operator directory, not an installed
// account/root. This component supplies no host-policy decision.
internal static class OriginalR7ProtectedSeedCreation
{
    private const uint CreateAccess = 0xc0030000; // GENERIC_READ/WRITE, DELETE, READ_CONTROL
    private const uint CreateNew = 1;

    // Compiled source proposal for the existing two location IDs. No caller
    // path, environment variable, new account or third root is selected. The
    // operator private location is never a witness service input. An eventual
    // production call MUST be added inside the actually admitted ceremony;
    // this mapping alone cannot create material or supply an admission permit.
    internal static OriginalR7FixedSeedLocationProposal ProposedFixedLocation(OriginalR7SignaturePurpose purpose)
    {
        string component = purpose switch {
            OriginalR7SignaturePurpose.Witness => "StephanosOriginalR7CustodyWitness",
            OriginalR7SignaturePurpose.Operator => "StephanosOriginalR7CustodyOperator",
            _ => throw Held()
        };
        return new(purpose, Path.Combine(OriginalR7AuditStorage.KnownProgramData(), "Stephanos", component,
            "keys", purpose == OriginalR7SignaturePurpose.Witness ? "witness.seed" : "operator.seed"));
    }

    // Positive mechanics seam for a fresh directory already owned by this test
    // actor. The FILE uses the exact protected 3-ACE masks, with the untrusted
    // fixture actor as owner. Its fixture DIRECTORY also grants that actor child
    // creation, since this actor is not an administrator. Neither exception can
    // qualify canonical policy; the strict canonical branch is unchanged. No production path is
    // accepted by this seam, and no Boolean can claim adoption/provisioning.
    internal static OriginalR7CreatedSeedObservation CreateNewUntrustedOwnedFixture(
        string ownedDirectory, OriginalR7SignaturePurpose purpose,
        Action<OriginalR7SeedCreationCheckpoint>? checkpoint = null,
        OriginalR7SeedFixtureFault fault = OriginalR7SeedFixtureFault.None)
    {
        using WindowsIdentity actor = WindowsIdentity.GetCurrent();
        string role = actor.User?.Value ?? throw Held();
        RequireFixtureDirectory(ownedDirectory, role);
        return CreateNewCore(ownedDirectory, role, role, purpose, checkpoint, fault);
    }

    // Exercises the UNCHANGED canonical SYSTEM/Admin-owner policy in an owned
    // directory. Unsupported owner assignment/ACL cases fail before secret I/O;
    // an ordinary runner must never be elevated or its policy relaxed to pass.
    internal static OriginalR7CreatedSeedObservation CreateNewCanonicalPolicyUntrustedFixture(
        string ownedDirectory, string fixtureRoleSid, OriginalR7SignaturePurpose purpose)
    {
        RequireFixtureDirectory(ownedDirectory, "S-1-5-32-544");
        return CreateNewCore(ownedDirectory, fixtureRoleSid, "S-1-5-32-544", purpose, null,
            OriginalR7SeedFixtureFault.None);
    }

    private static OriginalR7CreatedSeedObservation CreateNewCore(string directory, string roleSid,
        string descriptorOwner, OriginalR7SignaturePurpose purpose,
        Action<OriginalR7SeedCreationCheckpoint>? fixtureCheckpoint, OriginalR7SeedFixtureFault fixtureFault)
    {
        List<(SafeFileHandle Handle, string Path)> ancestors = new();
        SafeFileHandle? leaf = null;
        byte[] seed = new byte[32], readback = new byte[32];
        string file = "", fileId = "", directoryDescriptor = "", leafDescriptor = "", phase = "INPUT";
        bool created = false;
        try
        {
            if (!OperatingSystem.IsWindows() || !Enum.IsDefined(purpose) || !Enum.IsDefined(fixtureFault)) throw Held();
            RequireCanonicalPath(directory);
            string role = new SecurityIdentifier(roleSid).Value;
            if (role != roleSid || role is "S-1-5-18" or "S-1-5-32-544"
                || new SecurityIdentifier(descriptorOwner).Value != descriptorOwner) throw Held();
            bool fixtureOwner = descriptorOwner is not ("S-1-5-18" or "S-1-5-32-544");
            // Core has no general-purpose leaf name or imported material.
            file = Path.Combine(directory, purpose == OriginalR7SignaturePurpose.Witness ? "witness.seed" : "operator.seed");
            Stack<string> chain = new();
            phase = "PIN_ANCESTRY";
            for (DirectoryInfo? parent = new(directory); parent is not null; parent = parent.Parent)
            { if (chain.Count >= 32) throw Held(); chain.Push(parent.FullName); }
            while (chain.TryPop(out string? part))
                ancestors.Add((OriginalR7AuditStorage.OpenPinnedDirectory(part,
                    string.Equals(part, directory, StringComparison.OrdinalIgnoreCase)), part));
            var parentHandle = ancestors[^1].Handle;
            phase = "PARENT_POLICY";
            byte[] parentBytes = OriginalR7AuditStorage.ReadDescriptor(parentHandle);
            if (!Matches(parentBytes, role, descriptorOwner, directory: true)) throw Held();
            directoryDescriptor = Hash(parentBytes);
            byte[] descriptor = Descriptor(descriptorOwner, role, directory: false);
            phase = "CREATE_NEW_PROTECTED";
            GCHandle pin = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
            try
            {
                SecurityAttributes attributes = new() { Length = Marshal.SizeOf<SecurityAttributes>(),
                    Descriptor = pin.AddrOfPinnedObject(), Inherit = 0 };
                // The protected, noninheriting DACL is present at CREATE_NEW,
                // not applied by a later chmod/ACL operation. No overwrite,
                // truncation, delete sharing, inherited handle or default ACL.
                leaf = CreateFileW(file, CreateAccess, 0, ref attributes, CreateNew,
                    0x80200080 /* WRITE_THROUGH | OPEN_REPARSE_POINT | NORMAL */, IntPtr.Zero);
            }
            finally { pin.Free(); }
            if (leaf.IsInvalid) throw Held();
            created = true;
            phase = "EMPTY_FILE_IDENTITY_AND_POLICY";
            fileId = OriginalR7ProtectedKeyMetadata.FileIdentity(leaf);
            if (!OriginalR7AuditStorage.NativeIdentityMatches(leaf, file, false)
                || RandomAccess.GetLength(leaf) != 0) throw Held();
            byte[] initialDescriptor = OriginalR7AuditStorage.ReadDescriptor(leaf);
            if (!Matches(initialDescriptor, role, descriptorOwner, false)) throw Held();
            leafDescriptor = Hash(initialDescriptor);

            void Validate(long size)
            {
                foreach (var ancestor in ancestors)
                    if (!OriginalR7AuditStorage.NativeIdentityMatches(ancestor.Handle, ancestor.Path, true)) throw Held();
                byte[] currentParent = OriginalR7AuditStorage.ReadDescriptor(parentHandle);
                byte[] currentLeaf = OriginalR7AuditStorage.ReadDescriptor(leaf);
                if (Hash(currentParent) != directoryDescriptor || !Matches(currentParent, role, descriptorOwner, true)
                    || !OriginalR7AuditStorage.NativeIdentityMatches(leaf, file, false)
                    || OriginalR7ProtectedKeyMetadata.FileIdentity(leaf) != fileId || RandomAccess.GetLength(leaf) != size
                    || Hash(currentLeaf) != leafDescriptor || !Matches(currentLeaf, role, descriptorOwner, false)) throw Held();
            }
            void Checkpoint(OriginalR7SeedCreationStage stage, long size)
            {
                Validate(size);
                fixtureCheckpoint?.Invoke(new(stage, fileId, leafDescriptor, size,
                    OriginalR7ProtectedKeyMetadata.PolicyMatches(OriginalR7AuditStorage.ReadDescriptor(leaf), role, false)));
                Validate(size);
            }
            // Empty file, canonical identity, current parent and exact ACL are
            // checked before CSPRNG material exists and again after test hooks.
            phase = "EMPTY_CHECKPOINT";
            Checkpoint(OriginalR7SeedCreationStage.EmptyProtectedFile, 0);
            phase = "GENERATE_AND_WRITE";
            RandomNumberGenerator.Fill(seed);
            int requested = fixtureFault == OriginalR7SeedFixtureFault.PartialWrite ? 13 : 32;
            if (!WriteFile(leaf, seed, (uint)requested, out uint written, IntPtr.Zero) || written != 32) throw Held();
            phase = "WRITTEN_CHECKPOINT";
            Checkpoint(OriginalR7SeedCreationStage.MaterialWritten, 32);
            if (fixtureFault == OriginalR7SeedFixtureFault.BeforeFlush) throw Held();
            if (fixtureFault == OriginalR7SeedFixtureFault.ReadbackMismatch)
            {
                Span<byte> corrupt = stackalloc byte[1];
                try { corrupt[0] = (byte)(seed[0] ^ 0xff); RandomAccess.Write(leaf, corrupt, 0); }
                finally { CryptographicOperations.ZeroMemory(corrupt); }
            }
            phase = "FLUSH";
            if (!FlushFileBuffers(leaf)) throw Held();
            Checkpoint(OriginalR7SeedCreationStage.MaterialFlushed, 32);
            if (fixtureFault == OriginalR7SeedFixtureFault.AfterFlush) throw Held();
            phase = "READBACK";
            int read = 0;
            while (read < 32)
            { int n = RandomAccess.Read(leaf, readback.AsSpan(read), read); if (n <= 0) throw Held(); read += n; }
            Span<byte> extra = stackalloc byte[1];
            try { if (RandomAccess.Read(leaf, extra, 32) != 0) throw Held(); }
            finally { CryptographicOperations.ZeroMemory(extra); }
            if (!CryptographicOperations.FixedTimeEquals(seed, readback)) throw Held();
            byte[] publicKey = OriginalR7SigningPrimitives.PublicKey(seed);
            byte[] secondPublic = OriginalR7SigningPrimitives.PublicKey(readback);
            if (!CryptographicOperations.FixedTimeEquals(publicKey, secondPublic)) throw Held();
            byte[] spki = OriginalR7SigningPrimitives.PublicSpki(publicKey);
            string pem = OriginalR7SigningPrimitives.PublicPem(publicKey);
            phase = "VERIFIED_CHECKPOINT";
            Checkpoint(OriginalR7SeedCreationStage.MaterialVerified, 32);
            if (fixtureFault == OriginalR7SeedFixtureFault.AfterReadback) throw Held();
            Validate(32);
            var result = new OriginalR7CreatedSeedObservation("R7_NATIVE_CREATED_SEED_STORAGE_ONLY_NOT_ENROLLMENT",
                purpose, fileId, leafDescriptor, Convert.ToBase64String(spki), Hash(spki),
                Hash(Encoding.ASCII.GetBytes(pem)),
                OriginalR7ProtectedKeyMetadata.PolicyMatches(OriginalR7AuditStorage.ReadDescriptor(leaf), role, false),
                OriginalR7ProtectedKeyMetadata.PolicyMatches(OriginalR7AuditStorage.ReadDescriptor(parentHandle), role, true),
                fixtureOwner, true);
            return result;
        }
        catch
        {
            bool cleaned = !created;
            if (created && leaf is not null && !leaf.IsClosed)
            {
                try
                {
                    // Delete by the original retained object ONLY, after native
                    // identity and single-link/path proof. Never DeleteFile(path),
                    // recursively delete, reopen by name, follow a link or remove
                    // a replacement. Unknown identity leaves an explicit failure.
                    foreach (var ancestor in ancestors)
                        if (!OriginalR7AuditStorage.NativeIdentityMatches(ancestor.Handle, ancestor.Path, true)) throw Held();
                    if (fileId.Length != 64 || OriginalR7ProtectedKeyMetadata.FileIdentity(leaf) != fileId
                        || !OriginalR7AuditStorage.NativeIdentityMatches(leaf, file, false)) throw Held();
                    FileDisposition disposition = new() { Delete = 1 };
                    if (!SetFileInformationByHandle(leaf, 4, ref disposition, 1)
                        || !GetFileInformationByHandleEx(leaf, 1, out FileStandard standard,
                            (uint)Marshal.SizeOf<FileStandard>()) || standard.DeletePending != 1) throw Held();
                    leaf.Dispose();
                    uint attributes = GetFileAttributesW(file); int error = Marshal.GetLastWin32Error();
                    cleaned = attributes == uint.MaxValue && error is 2 or 3;
                }
                catch { cleaned = false; }
            }
            throw new OriginalR7SeedCreationException(created, cleaned, phase);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(seed); CryptographicOperations.ZeroMemory(readback);
            leaf?.Dispose();
            for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Handle.Dispose();
            // A successful storage transaction leaves exactly its newly-created
            // file. Returning public metadata never enrolls or adopts that file.
        }
    }

    private static bool Matches(byte[] descriptor, string role, string owner, bool directory)
    {
        if (owner is "S-1-5-18" or "S-1-5-32-544")
            return OriginalR7ProtectedKeyMetadata.PolicyMatches(descriptor, role, directory);
        // Fixture-only owner substitution: the evaluator itself is UNCHANGED.
        // Require the real fixture actor owner and the same exact protected
        // 3-ACE DACL by evaluating a temporary descriptor copy with canonical
        // owner. This copy is never applied to Windows or used as authority.
        try
        {
            var sd = new RawSecurityDescriptor(descriptor, 0);
            if (sd.Owner?.Value != owner) return false;
            if (directory)
            {
                // An owned non-admin fixture needs FILE_ADD_FILE on its own
                // disposable directory. Require exactly the fixture descriptor,
                // never promote it to canonical parent policy or production.
                if (sd.DiscretionaryAcl is null) return false;
                foreach (GenericAce raw in sd.DiscretionaryAcl)
                    if (raw is CommonAce ace && ace.SecurityIdentifier.Value == role)
                    {
                        if (ace.AccessMask != 0x1f01ff) return false;
                        ace.AccessMask = OriginalR7ProtectedKeyMetadata.RoleDirectoryReadMask;
                    }
            }
            sd.Owner = new SecurityIdentifier("S-1-5-32-544");
            byte[] copy = new byte[sd.BinaryLength]; sd.GetBinaryForm(copy, 0);
            return OriginalR7ProtectedKeyMetadata.PolicyMatches(copy, role, directory);
        }
        catch { return false; }
    }

    internal static byte[] UntrustedFixtureDescriptor(string actualFixtureOwner, string role, bool directory)
        => Descriptor(actualFixtureOwner, role, directory);
    private static byte[] Descriptor(string owner, string role, bool directory)
    {
        var sd = new RawSecurityDescriptor("O:" + new SecurityIdentifier(owner).Value
            + "D:P(A;;0x1f01ff;;;SY)(A;;0x1f01ff;;;BA)(A;;0x"
            + (directory && owner is not ("S-1-5-18" or "S-1-5-32-544") ? 0x1f01ff
                : directory ? OriginalR7ProtectedKeyMetadata.RoleDirectoryReadMask : OriginalR7ProtectedKeyMetadata.RoleFileReadMask)
                .ToString("x", System.Globalization.CultureInfo.InvariantCulture)
            + ";;;" + new SecurityIdentifier(role).Value + ")");
        byte[] bytes = new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes, 0); return bytes;
    }

    private static void RequireFixtureDirectory(string directory, string actualOwner)
    {
        if (!OperatingSystem.IsWindows()) throw Held();
        RequireCanonicalPath(directory);
        if (!Path.GetFileName(directory).StartsWith("r7-seed-create-fixture-", StringComparison.Ordinal)) throw Held();
        using var h = OriginalR7AuditStorage.OpenPinnedDirectory(directory, true);
        if (new RawSecurityDescriptor(OriginalR7AuditStorage.ReadDescriptor(h), 0).Owner?.Value != actualOwner) throw Held();
    }
    private static void RequireCanonicalPath(string p)
    {
        if (p.Length is < 4 or > 210 || !char.IsAsciiLetter(p[0]) || p[1] != ':' || p[2] != '\\'
            || p.Contains('/') || p.AsSpan(2).Contains(':') || p.Any(c => c < 0x20)
            || !string.Equals(Path.GetFullPath(p), p, StringComparison.OrdinalIgnoreCase)
            || p.Split('\\').Skip(1).Any(s => s.Length == 0 || s is "." or ".."
                || s.EndsWith('.') || s.EndsWith(' ') || s.Any(c => "<>\"|?*".Contains(c)))) throw Held();
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static InvalidOperationException Held() => new("R7_SEED_CREATION_NATIVE_STORAGE_UNPROVEN");

    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [StructLayout(LayoutKind.Sequential)] private struct FileDisposition { internal byte Delete; }
    [StructLayout(LayoutKind.Sequential)] private struct FileStandard { internal long Allocation, EndOfFile; internal uint Links; internal byte DeletePending, Directory; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, ref SecurityAttributes attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteFile(SafeFileHandle handle, byte[] bytes, uint count, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int informationClass, out FileStandard information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int informationClass, ref FileDisposition information, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFileAttributesW(string path);
}
