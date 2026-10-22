using Stephanos.RescueIslandCustody;

namespace Stephanos.SeedParallelCustody;

public enum SeedInventoryInputKind { Manifest, CanonicalSeedContract }

public sealed record SeedInventoryInput(string Path, string Sha256, long MaximumBytes = 1024 * 1024);

// A component for the two declared deterministic inventory inputs and one new
// output. It is not the complete Git/test/claim/receipt/executable dependency
// estate, a host, an authenticated grant, or permission to invoke the worker.
public sealed class SeedInventoryCustodySession : IDisposable
{
    public const long MaximumInputBytes = 1024 * 1024;
    private readonly object gate = new();
    private PinnedNewFile? output;
    private PinnedFileSnapshot? manifest;
    private PinnedFileSnapshot? canonicalSeedContract;
    private bool disposed;
    private bool createAttempted;
    public bool SourceOwnershipAuthenticated => false;
    public bool CompleteOperationCustodyProven => false;
    public bool LeaseReleaseAuthorized => false;
    public bool ProductionWorkerCommissioned => false;
    public bool OutputDerivedFromPinnedInputs { get; private set; }

    private SeedInventoryCustodySession() { }

    // Fixed CANONICAL_INVENTORY_V1 transformation. The existing authenticated
    // owner/base boundary must supply these expectations from one approved
    // manifest and protected base. This library does not authenticate a caller,
    // grant, Git estate or projection provenance from its hashes alone.
    // No caller payload, digest, render callback or executable is accepted.
    public static SeedInventoryCustodySession AcquireCanonicalInventory(
        SeedInventoryInput manifestInput,
        SeedInventoryInput canonicalProjectionInput,
        string workspaceRoot,
        string expectedRelativeTarget,
        string expectedBaseSha,
        string expectedProjectionGitBlobSha)
    {
        if (!OperatingSystem.IsWindows()) throw Held("SEED_NATIVE_WINDOWS_REQUIRED");
        var manifest = Freeze(manifestInput);
        manifest = manifest with { MaximumBytes = Math.Min(manifest.MaximumBytes,
            CanonicalInventoryDerivation.MaximumManifestBytes) };
        var projection = Freeze(canonicalProjectionInput);
        string outputPath = CanonicalInventoryDerivation.TargetPath(workspaceRoot, expectedRelativeTarget);
        string targetIdentity = Identity(outputPath);
        if (string.Equals(Identity(manifest.Path), Identity(projection.Path), StringComparison.OrdinalIgnoreCase)
            || string.Equals(Identity(manifest.Path), targetIdentity, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Identity(projection.Path), targetIdentity, StringComparison.OrdinalIgnoreCase))
            throw Held("SEED_INVENTORY_INPUT_OUTPUT_COLLISION");
        var session = new SeedInventoryCustodySession();
        try
        {
            // The target expectation is available before reading either input.
            // Parse the pinned manifest later and require that exact same target.
            session.output = PinnedNewFile.PrepareParents(outputPath);
            session.manifest = PinnedFileSnapshot.Acquire(manifest.Path, manifest.Sha256, manifest.MaximumBytes);
            session.canonicalSeedContract = PinnedFileSnapshot.Acquire(projection.Path,
                projection.Sha256, projection.MaximumBytes);
            byte[] bytes = CanonicalInventoryDerivation.Render(SnapshotBytes(session.manifest),
                SnapshotBytes(session.canonicalSeedContract), expectedBaseSha, expectedRelativeTarget,
                expectedProjectionGitBlobSha);
            session.output.BindDerivedContent(bytes);
            session.OutputDerivedFromPinnedInputs = true;
            return session;
        }
        catch (CustodyException error)
        {
            session.Dispose();
            var held = Held("SEED_INVENTORY_INPUT_CUSTODY_DENIED");
            held.Data["InputBlocker"] = error.Blocker;
            throw held;
        }
        catch
        {
            session.Dispose();
            throw;
        }
    }

    public static SeedInventoryCustodySession Acquire(
        SeedInventoryInput manifestInput,
        SeedInventoryInput canonicalSeedInput,
        string outputPath,
        byte[] outputBytes,
        string outputSha256)
    {
        if (!OperatingSystem.IsWindows()) throw Held("SEED_NATIVE_WINDOWS_REQUIRED");
        // Freeze caller-controlled descriptors before opening any handle. Paths
        // and digests are expectations only; none supplies source provenance.
        var manifest = Freeze(manifestInput);
        var seeds = Freeze(canonicalSeedInput);
        string targetIdentity = Identity(outputPath);
        if (string.Equals(Identity(manifest.Path), Identity(seeds.Path), StringComparison.OrdinalIgnoreCase)
            || string.Equals(Identity(manifest.Path), targetIdentity, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Identity(seeds.Path), targetIdentity, StringComparison.OrdinalIgnoreCase))
            throw Held("SEED_INVENTORY_INPUT_OUTPUT_COLLISION");

        var session = new SeedInventoryCustodySession();
        try
        {
            // Prepare validates and privately copies the complete output bytes
            // and digest, pins output ancestors, and creates no file. These
            // handles stay retained while both input snapshots are acquired.
            session.output = PinnedNewFile.Prepare(outputPath, outputBytes, outputSha256);
            session.manifest = PinnedFileSnapshot.Acquire(manifest.Path, manifest.Sha256, manifest.MaximumBytes);
            session.canonicalSeedContract = PinnedFileSnapshot.Acquire(seeds.Path, seeds.Sha256, seeds.MaximumBytes);
            return session;
        }
        catch (CustodyException error)
        {
            session.Dispose();
            var held = Held("SEED_INVENTORY_INPUT_CUSTODY_DENIED");
            held.Data["InputBlocker"] = error.Blocker;
            throw held;
        }
        catch
        {
            session.Dispose();
            throw;
        }
    }

    // Consume verified private snapshot bytes only. A pre-existing writable
    // mapping is not disproven by share denial; never reread an input path or
    // return its native handle, FileStream, mutable buffer or IDisposable owner.
    public int ReadInput(SeedInventoryInputKind kind, long offset, Span<byte> destination)
    {
        lock (gate)
        {
            EnsureOpen();
            return Select(kind).Read(offset, destination);
        }
    }

    public long InputLength(SeedInventoryInputKind kind)
    {
        lock (gate) { EnsureOpen(); return Select(kind).Length; }
    }

    public void CreateOutput()
    {
        lock (gate)
        {
            EnsureOpen();
            if (createAttempted) throw Held("SEED_INVENTORY_CREATE_ALREADY_ATTEMPTED");
            createAttempted = true;
            try { output!.Create(); }
            catch { Dispose(); throw; }
        }
    }

    public void VerifyOutput()
    {
        lock (gate)
        {
            EnsureOpen();
            if (!createAttempted) throw Held("SEED_INVENTORY_OUTPUT_NOT_CREATED");
            output!.Verify();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            try { output?.Dispose(); }
            finally
            {
                try { canonicalSeedContract?.Dispose(); }
                finally { manifest?.Dispose(); }
                output = null;
                canonicalSeedContract = null;
                manifest = null;
            }
        }
    }

    private PinnedFileSnapshot Select(SeedInventoryInputKind kind) => kind switch
    {
        SeedInventoryInputKind.Manifest => manifest!,
        SeedInventoryInputKind.CanonicalSeedContract => canonicalSeedContract!,
        _ => throw Held("SEED_INVENTORY_INPUT_KIND_INVALID"),
    };

    private static byte[] SnapshotBytes(PinnedFileSnapshot snapshot)
    {
        byte[] bytes = new byte[checked((int)snapshot.Length)];
        int offset = 0;
        while (offset < bytes.Length)
        {
            int count = snapshot.Read(offset, bytes.AsSpan(offset));
            if (count <= 0) throw Held("SEED_INVENTORY_SNAPSHOT_INCOMPLETE");
            offset += count;
        }
        return bytes;
    }

    private void EnsureOpen()
    {
        if (disposed || output is null || manifest is null || canonicalSeedContract is null)
            throw Held("SEED_INVENTORY_SESSION_CLOSED");
    }

    private static SeedInventoryInput Freeze(SeedInventoryInput input)
    {
        if (input is null || input.MaximumBytes < 0 || input.MaximumBytes > MaximumInputBytes
            || input.Sha256 is null || input.Sha256.Length != 64
            || input.Sha256.Any(c => !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))))
            throw Held("SEED_INVENTORY_INPUT_EXPECTATION_INVALID");
        _ = Identity(input.Path);
        return new SeedInventoryInput(input.Path, input.Sha256, input.MaximumBytes);
    }

    private static string Identity(string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path))
                throw Held("SEED_INVENTORY_PATH_INVALID");
            return Path.GetFullPath(path);
        }
        catch (SeedWriterHeldException) { throw; }
        catch { throw Held("SEED_INVENTORY_PATH_INVALID"); }
    }

    private static SeedWriterHeldException Held(string code) => new(code);
}
