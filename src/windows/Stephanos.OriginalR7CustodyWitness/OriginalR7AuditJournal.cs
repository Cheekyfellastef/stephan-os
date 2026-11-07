using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stephanos.OriginalR7CustodyWitness;

internal enum OriginalR7AuditEvent { Start, Observation, Fault, Stop }

internal sealed record OriginalR7AuditBinding(
    string SourceRevision, string OriginalLeaseDigest, string RequestId,
    string CommandId, string SourceExecutionId, string HeadSha);

internal sealed record OriginalR7AuditCheckpoint(
    long Sequence, string EntryDigest, string BindingDigest,
    OriginalR7AuditEvent Event, string ObservedAtUtc)
{
    // Neither an append nor a digest authenticates OS custody or a signer.
    internal bool PhysicalContainmentProven => false;
    internal bool IndependentSignatureProven => false;
    internal bool LeaseReleaseAuthorized => false;
}

// Durable framing mechanism owned by the existing native witness, not a new
// authority. Only the fixed Windows storage adapter may open production state.
// The internal stream seam lets native tests use disposable, untrusted files.
internal sealed class OriginalR7AuditJournal : IDisposable
{
    internal const int MaxJournalBytes = 4 * 1024 * 1024;
    internal const int MaxEntryBytes = 2048;
    internal const int MaxEntries = 4096;
    private const string Schema = "stephanos.original-r7-audit-entry.v1";
    private const string Lease = "critical-2962-elastic-goal-r7-lease";
    private const string Domain = "stephanos.original-r7-audit-chain.v1\0";
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly string ZeroDigest = new('0', 64);
    private static readonly JsonSerializerOptions Json = new() { MaxDepth = 8 };
    private readonly FileStream stream;
    private readonly Func<DateTimeOffset> utcNow;
    private readonly Func<long> monotonic;
    private readonly string bindingDigest;
    private readonly object sync = new();
    private readonly bool existingSession;
    private bool poisoned, disposed;
    private long expectedLength, lastTick = -1;
    private DateTimeOffset? lastUtc;
    private OriginalR7AuditCheckpoint? checkpoint;

    private sealed record Frame(
        string SchemaVersion, string LeaseId, string BindingDigest,
        long Sequence, string PreviousDigest, string Event,
        string ObservedAtUtc, long MonotonicTick, string OsEvidenceDigest,
        string EntryDigest);

    internal OriginalR7AuditJournal(FileStream retainedStream,
        OriginalR7AuditBinding binding,
        Func<DateTimeOffset>? clock = null, Func<long>? monotonicClock = null)
    {
        stream = retainedStream;
        utcNow = clock ?? (() => DateTimeOffset.UtcNow);
        monotonic = monotonicClock ?? Stopwatch.GetTimestamp;
        if (!ValidBinding(binding) || !stream.CanRead || !stream.CanWrite || !stream.CanSeek)
            throw Held("INPUT_UNQUALIFIED");
        bindingDigest = Digest(Utf8.GetBytes(JsonSerializer.Serialize(binding, Json)));
        try { Replay(); }
        catch { throw Held("REPLAY_INVALID"); }
        existingSession = expectedLength != 0;
    }

    internal OriginalR7AuditCheckpoint? LastCheckpoint
    {
        get { lock (sync) { EnsureUsable(); return checkpoint; } }
    }

    internal OriginalR7AuditCheckpoint Append(OriginalR7AuditEvent kind, string osEvidenceDigest)
    {
        lock (sync)
        {
            EnsureUsable();
            if (existingSession) throw Held("RESTART_CONTINUITY_UNPROVEN");
            if (!Enum.IsDefined(kind) || !Hex(osEvidenceDigest, 64))
                throw Held("EVENT_OR_EVIDENCE_INVALID");
            ValidateTransition(checkpoint?.Event, kind);
            DateTimeOffset now = utcNow();
            string stamp = now.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture);
            DateTimeOffset canonicalNow = ParseUtc(stamp);
            long tick = monotonic();
            if (tick < 0 || tick < lastTick || (lastUtc.HasValue && canonicalNow < lastUtc.Value))
            {
                poisoned = true;
                throw Held("CLOCK_ORDER_UNPROVEN");
            }
            long next = (checkpoint?.Sequence ?? 0) + 1;
            if (next > MaxEntries) throw Held("ENTRY_LIMIT");
            Frame bare = new(Schema, Lease, bindingDigest, next,
                checkpoint?.EntryDigest ?? ZeroDigest, kind.ToString(), stamp,
                tick, osEvidenceDigest, "");
            Frame frame = bare with { EntryDigest = FrameDigest(bare) };
            byte[] bytes = Utf8.GetBytes(JsonSerializer.Serialize(frame, Json) + "\n");
            if (bytes.Length > MaxEntryBytes || expectedLength + bytes.Length > MaxJournalBytes)
                throw Held("BYTE_LIMIT");
            // Once I/O begins, every failure is terminal. Never return a
            // checkpoint until the exact retained bytes survive flush/readback.
            try
            {
                if (stream.Length != expectedLength) throw Held("LENGTH_CHANGED");
                stream.Position = expectedLength;
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
                if (stream.Length != expectedLength + bytes.Length) throw Held("WRITE_LENGTH_MISMATCH");
                stream.Position = expectedLength;
                byte[] readback = new byte[bytes.Length];
                stream.ReadExactly(readback);
                if (!readback.AsSpan().SequenceEqual(bytes)) throw Held("WRITE_READBACK_MISMATCH");
                expectedLength += bytes.Length;
                checkpoint = new(next, frame.EntryDigest, bindingDigest, kind, stamp);
                lastTick = tick;
                lastUtc = canonicalNow;
                return checkpoint;
            }
            catch
            {
                poisoned = true;
                throw Held("DURABLE_APPEND_FAILED");
            }
        }
    }

    private void Replay()
    {
        long length = stream.Length;
        if (length > MaxJournalBytes) throw Held("BYTE_LIMIT");
        stream.Position = 0;
        byte[] bytes = new byte[(int)length];
        stream.ReadExactly(bytes);
        if (stream.Length != length) throw Held("REPLAY_LENGTH_CHANGED");
        if (length == 0) { expectedLength = 0; return; }
        if (bytes[^1] != (byte)'\n') throw Held("TORN_TAIL");
        int start = 0;
        for (int i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] != (byte)'\n') continue;
            int count = i - start;
            if (count == 0 || count + 1 > MaxEntryBytes) throw Held("FRAME_SIZE_INVALID");
            string line = Utf8.GetString(bytes, start, count);
            Frame frame;
            try { frame = JsonSerializer.Deserialize<Frame>(line, Json) ?? throw Held("FRAME_INVALID"); }
            catch { throw Held("FRAME_INVALID"); }
            // Reject duplicate/unknown keys, whitespace alternatives, BOM,
            // noncanonical numbers and property reorderings, not just values.
            if (JsonSerializer.Serialize(frame, Json) != line) throw Held("NONCANONICAL_FRAME");
            if (frame.SchemaVersion != Schema || frame.LeaseId != Lease
                || frame.BindingDigest != bindingDigest
                || frame.Sequence != (checkpoint?.Sequence ?? 0) + 1
                || frame.Sequence > MaxEntries
                || frame.PreviousDigest != (checkpoint?.EntryDigest ?? ZeroDigest)
                || !Hex(frame.EntryDigest, 64) || !Hex(frame.OsEvidenceDigest, 64)
                || FrameDigest(frame with { EntryDigest = "" }) != frame.EntryDigest
                || !Enum.TryParse(frame.Event, out OriginalR7AuditEvent kind)
                || !Enum.IsDefined(kind) || kind.ToString() != frame.Event)
                throw Held("CHAIN_OR_BINDING_INVALID");
            ValidateTransition(checkpoint?.Event, kind);
            DateTimeOffset stamp = ParseUtc(frame.ObservedAtUtc);
            if (frame.MonotonicTick < 0 || frame.MonotonicTick < lastTick
                || (lastUtc.HasValue && stamp < lastUtc.Value)) throw Held("CLOCK_ORDER_UNPROVEN");
            checkpoint = new(frame.Sequence, frame.EntryDigest, bindingDigest, kind, frame.ObservedAtUtc);
            lastTick = frame.MonotonicTick;
            lastUtc = stamp;
            start = i + 1;
        }
        expectedLength = length;
    }

    private static void ValidateTransition(OriginalR7AuditEvent? previous, OriginalR7AuditEvent next)
    {
        if ((!previous.HasValue && next != OriginalR7AuditEvent.Start)
            || (previous.HasValue && next == OriginalR7AuditEvent.Start)
            || previous is OriginalR7AuditEvent.Fault or OriginalR7AuditEvent.Stop)
            throw Held("LIFECYCLE_INVALID");
    }

    private static DateTimeOffset ParseUtc(string value)
    {
        if (!DateTimeOffset.TryParseExact(value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out DateTimeOffset parsed)) throw Held("TIMESTAMP_INVALID");
        return parsed;
    }

    private static bool ValidBinding(OriginalR7AuditBinding b) => b is not null
        && Hex(b.SourceRevision, 40) && Hex(b.OriginalLeaseDigest, 64)
        && b.HeadSha == "4e5023eef829b285095db4eeb09d6f2b365e33e4"
        && Regex.IsMatch(b.RequestId ?? "", "\\A[a-z0-9._:-]{8,120}\\z")
        && Regex.IsMatch(b.CommandId ?? "", "\\A[a-z0-9._-]{8,127}\\z")
        && b.SourceExecutionId is { Length: <= 100 }
        && Regex.IsMatch(b.SourceExecutionId ?? "", "\\Acritical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}\\z");
    private static bool Hex(string? value, int length) => value is not null
        && value.Length == length && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static string FrameDigest(Frame frame)
        => Digest(Utf8.GetBytes(Domain + JsonSerializer.Serialize(frame, Json)));
    private static string Digest(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static InvalidOperationException Held(string code) => new("R7_AUDIT_" + code);
    private void EnsureUsable()
    {
        if (disposed) throw Held("DISPOSED");
        if (poisoned) throw Held("INSTANCE_POISONED");
    }
    public void Dispose()
    {
        lock (sync)
        {
            if (disposed) return;
            disposed = true;
            stream.Dispose();
        }
    }
}
