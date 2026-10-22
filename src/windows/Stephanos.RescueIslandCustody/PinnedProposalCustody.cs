using System.Security.Cryptography;

namespace Stephanos.RescueIslandCustody;

/// <summary>
/// An expected input for a bounded source proposal. These caller-supplied
/// values are not authenticated authority or proof of a complete dependency set.
/// </summary>
public sealed record ProposalDependency(string Path, string ExpectedSha256, long MaxBytes);

/// <summary>
/// Owns the native snapshots of every declared input and one create-only
/// proposal output for a single lifetime. The target parent chain is retained
/// during acquisition, before inputs are read; all inputs must be acquired before
/// output creation is possible. Consumers read verified private snapshot bytes;
/// no input/output handle or mutable internal buffer escapes this scope.
///
/// This composes the existing native primitives; it does not authenticate a
/// manifest, protect executable loading/Git/claims, exclude an original writer
/// principal, grant resources or commission the Island. No production host or
/// source engine invokes it while execution custody remains unimplemented.
/// </summary>
public sealed class PinnedProposalCustody : IDisposable
{
    private const int MaximumDependencies = 32;
    private const long MaximumInputBytes = 64 * 1024 * 1024;
    private readonly object gate = new();
    private readonly List<PinnedFileSnapshot> inputs = new(MaximumDependencies);
    private PinnedFileCreation? output;
    private bool outputAttempted;
    private bool disposed;

    private PinnedProposalCustody(ProposalDependency[] dependencies,
        string targetPath, byte[] approvedBytes, string expectedSha256)
    {
        try
        {
            output = PinnedFileCreation.PrepareApproved(targetPath, approvedBytes, expectedSha256);
            foreach (var dependency in dependencies)
                inputs.Add(PinnedFileSnapshot.Acquire(dependency.Path,
                    dependency.ExpectedSha256, dependency.MaxBytes));
        }
        catch
        {
            // A bad later input must release every already-acquired native
            // input and output-parent handle. No leaf is created here or on cleanup.
            Dispose();
            throw;
        }
    }

    public static PinnedProposalCustody Acquire(ProposalDependency[] dependencies,
        string targetPath, byte[] approvedBytes, string expectedSha256)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        if (dependencies is null || dependencies.Length is < 1 or > MaximumDependencies
            || approvedBytes is null || approvedBytes.Length > 8192 || !ValidDigest(expectedSha256))
            throw new CustodyException("ISLAND_PROPOSAL_EXPECTATION_INVALID");

        // Only arrays are accepted: an arbitrary enumerable cannot manufacture
        // an unbounded manifest or change the next input while native opens run.
        var declared = (ProposalDependency[])dependencies.Clone();
        byte[] bytes = approvedBytes.ToArray();
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes), Convert.FromHexString(expectedSha256)))
            throw new CustodyException("ISLAND_CUSTODY_DIGEST_MISMATCH");
        string target = PinnedFileSnapshot.ValidatePath(targetPath);
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { target };
        long reservedBytes = 0;
        foreach (var dependency in declared)
        {
            if (dependency is null || !ValidDigest(dependency.ExpectedSha256)
                || dependency.MaxBytes < 0 || dependency.MaxBytes > MaximumInputBytes)
                throw new CustodyException("ISLAND_PROPOSAL_EXPECTATION_INVALID");
            reservedBytes += dependency.MaxBytes;
            if (reservedBytes > MaximumInputBytes)
                throw new CustodyException("ISLAND_PROPOSAL_INPUT_BUDGET_EXCEEDED");
            string path = PinnedFileSnapshot.ValidatePath(dependency.Path);
            if (!paths.Add(path))
                throw new CustodyException("ISLAND_PROPOSAL_PATH_COLLISION");
        }
        return new PinnedProposalCustody(declared, target, bytes, expectedSha256);
    }

    public int DependencyCount { get { lock (gate) { ThrowIfDisposed(); return inputs.Count; } } }
    public bool OutputCreated { get { lock (gate) { ThrowIfDisposed(); return output?.Created == true; } } }

    public long GetDependencyLength(int index)
    {
        lock (gate) { ThrowIfDisposed(); return Input(index).Length; }
    }

    public int ReadDependency(int index, long offset, Span<byte> destination)
    {
        lock (gate) { ThrowIfDisposed(); return Input(index).Read(offset, destination); }
    }

    /// <summary>
    /// Exactly one attempt against the target/bytes bound at Acquire. A failed
    /// native creation may leave an artifact for authenticated reconciliation;
    /// it is never retried, deleted or overwritten by this scope.
    /// </summary>
    public void CreateOutput()
    {
        lock (gate)
        {
            ThrowIfDisposed();
            if (outputAttempted) throw new CustodyException("ISLAND_PROPOSAL_OUTPUT_ALREADY_ATTEMPTED");
            outputAttempted = true;
            output!.CreatePrepared();
        }
    }

    public int ReadOutput(long offset, Span<byte> destination)
    {
        lock (gate)
        {
            ThrowIfDisposed();
            if (output is null || !output.Created) throw new CustodyException("ISLAND_PROPOSAL_OUTPUT_NOT_CREATED");
            return output.Read(offset, destination);
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            output?.Dispose();
            output = null;
            for (int i = inputs.Count - 1; i >= 0; i--) inputs[i].Dispose();
            inputs.Clear();
        }
    }

    private PinnedFileSnapshot Input(int index)
    {
        if ((uint)index >= (uint)inputs.Count) throw new ArgumentOutOfRangeException(nameof(index));
        return inputs[index];
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(disposed, this);
    private static bool ValidDigest(string value) => value is not null && value.Length == 64
        && value.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));
}
