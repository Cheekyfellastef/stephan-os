using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Stephanos.OriginalR7DaclReadback;

namespace Stephanos.OriginalR7CustodyWitness;

// Inputs are a diagnostic challenge, NOT authenticated historical enrollment.
// No CLI/IPC endpoint accepts this plan. Production startup remains disabled.
internal sealed record OriginalR7ProcessChallenge(
    int ProcessId, long CreationFileTimeUtc, string PrincipalSid, string TargetPath);

internal sealed record OriginalR7ObservationReceipt(
    string Classification, int SamplesCompleted, int PlannedSamples,
    string PlanDigest, OriginalR7AuditCheckpoint Checkpoint)
{
    internal bool OriginalPrincipalProvenanceAuthenticated => false;
    internal bool PhysicalContainmentProven => false;
    internal bool ContinuousExclusionProven => false;
    internal bool IndependentSignatureProven => false;
    internal bool LeaseReleaseAuthorized => false;
}

// One finite audit-backed read-only observation session. No key generation,
// signing, source ACL changes, process termination, or release operation.
// Even a complete negative survey remains a snapshot, never custody proof.
internal sealed class OriginalR7ObservationSession : IDisposable
{
    internal const int MaxSamples = 8;
    internal const long MaxDurationMs = 30_000;
    private readonly object sync = new();
    private readonly OriginalR7AuditJournal journal;
    private readonly OriginalR7ProcessChallenge[] plan;
    private readonly string planDigest;
    private readonly Func<OriginalR7ProcessChallenge, R7ProcessBoundWriteObservation> probe;
    private readonly Func<long> elapsedMs;
    private int completed;
    private long lastElapsed;
    private bool terminal, disposed, sampling;

    internal OriginalR7ObservationSession(OriginalR7AuditJournal retainedJournal,
        IReadOnlyList<OriginalR7ProcessChallenge> challenges,
        Func<OriginalR7ProcessChallenge, R7ProcessBoundWriteObservation>? testProbe = null,
        Func<long>? testElapsedMs = null)
    {
        // The injected seams are internal test mechanisms, not admission or
        // signer interfaces. They cannot produce an authority-bearing receipt.
        journal = retainedJournal ?? throw Held("JOURNAL_REQUIRED");
        if (challenges is null || challenges.Count is < 1 or > MaxSamples)
            throw Held("PLAN_BUDGET_INVALID");
        plan = challenges.ToArray();
        if (plan.Any(c => !Valid(c))
            || plan.Select(c => c.TargetPath).Distinct(StringComparer.OrdinalIgnoreCase).Count() != plan.Length
            || plan.Any(c => c.ProcessId != plan[0].ProcessId
                || c.CreationFileTimeUtc != plan[0].CreationFileTimeUtc
                || c.PrincipalSid != plan[0].PrincipalSid))
            throw Held("PLAN_IDENTITY_OR_PATH_INVALID");
        if (journal.LastCheckpoint is not null) throw Held("FRESH_JOURNAL_REQUIRED");
        probe = testProbe ?? (c => R7ProcessBoundWriteDenial.ObserveWriteAccess(
            c.ProcessId, c.CreationFileTimeUtc, c.PrincipalSid, c.TargetPath));
        long started = Stopwatch.GetTimestamp();
        elapsedMs = testElapsedMs ?? (() => (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        planDigest = Digest("stephanos.r7-observation-plan.v1\0" + JsonSerializer.Serialize(plan));
        long first = elapsedMs();
        if (first < 0 || first > MaxDurationMs) throw Held("CLOCK_UNQUALIFIED");
        lastElapsed = first;
        journal.Append(OriginalR7AuditEvent.Start, planDigest);
    }

    internal OriginalR7ObservationReceipt ObserveNext()
    {
        lock (sync)
        {
            if (disposed || terminal || sampling) throw Held("SESSION_CLOSED_OR_REENTRANT");
            sampling = true;
            try
            {
                if (!ClockCurrent()) return Fault("R7_OBSERVATION_DEADLINE_OR_CLOCK_UNPROVEN");
                R7ProcessBoundWriteObservation result;
                try { result = probe(plan[completed]); }
                catch { return Fault("R7_OBSERVATION_NATIVE_PROBE_FAILED"); }
                if (!ClockCurrent()) return Fault("R7_OBSERVATION_DEADLINE_OR_CLOCK_UNPROVEN");

                var access = result?.WriteAccess;
                // Positive binding alone, a denied data open, or an unknown
                // native classification must not be promoted to a negative sample.
                bool denied = result is not null
                    && result.Classification == "R7_PROCESS_TOKEN_SAMPLE_OBSERVED_NOT_CUSTODY"
                    && result.ProcessBindingObserved && access is not null
                    && access.Classification == "R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY"
                    && access.SuppliedTokenSidMatched && access.TargetIdentityStable
                    && access.DataWriteOpenDenied && access.DaclWriteOpenDenied
                    && access.OwnerWriteOpenDenied && !access.SuppliedPrincipalOwnsTarget
                    && !access.TokenHasBypassAuthority;
                if (!denied) return Fault("R7_OBSERVATION_NEGATIVE_SAMPLE_UNPROVEN");
                // Bind the exact index, challenge digest and all returned native
                // facts. A receipt escapes only after durable append/readback.
                string digest = Digest("stephanos.r7-observation-sample.v1\0"
                    + JsonSerializer.Serialize(new { planDigest, index = completed, result }));
                journal.Append(OriginalR7AuditEvent.Observation, digest);
                completed++;
                if (completed == plan.Length)
                {
                    var end = journal.Append(OriginalR7AuditEvent.Stop, digest);
                    terminal = true;
                    return new("R7_BOUNDED_SAMPLE_COMPLETE_NOT_CUSTODY", completed, plan.Length, planDigest, end);
                }
                return new("R7_BOUNDED_SAMPLE_RECORDED_NOT_CUSTODY", completed, plan.Length,
                    planDigest, journal.LastCheckpoint!);
            }
            catch
            {
                // Audit/clock/native failures cannot leave an issuable session.
                terminal = true;
                throw Held("AUDIT_OR_SESSION_FAILED_CLOSED");
            }
            finally { sampling = false; }
        }
    }

    private OriginalR7ObservationReceipt Fault(string code)
    {
        terminal = true;
        var checkpoint = journal.Append(OriginalR7AuditEvent.Fault,
            Digest("stephanos.r7-observation-fault.v1\0"
                + JsonSerializer.Serialize(new { planDigest, index = completed, code })));
        return new(code, completed, plan.Length, planDigest, checkpoint);
    }

    private bool ClockCurrent()
    {
        long current = elapsedMs();
        if (current < lastElapsed || current < 0 || current > MaxDurationMs) return false;
        lastElapsed = current;
        return true;
    }

    private static bool Valid(OriginalR7ProcessChallenge? c)
    {
        if (c is null || c.ProcessId <= 0 || c.CreationFileTimeUtc <= 0
            || c.PrincipalSid is null || c.PrincipalSid.Length > 184
            || c.TargetPath is not { Length: >= 4 and <= 240 } p
            || !char.IsAsciiLetter(p[0]) || p[1] != ':' || p[2] != '\\'
            || p.Contains('/') || p.Contains('\0') || p.AsSpan(2).Contains(':'))
            return false;
        try
        {
            if (new SecurityIdentifier(c.PrincipalSid).Value != c.PrincipalSid
                || !String.Equals(Path.GetFullPath(p), p, StringComparison.OrdinalIgnoreCase))
                return false;
            return p.Split('\\').Skip(1).All(s => s.Length > 0 && s is not "." and not ".."
                && !s.EndsWith('.') && !s.EndsWith(' '));
        }
        catch { return false; }
    }

    private static string Digest(string value) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static InvalidOperationException Held(string code) => new("R7_OBSERVATION_" + code);

    public void Dispose()
    {
        lock (sync)
        {
            if (disposed) return;
            disposed = true;
            try
            {
                if (!terminal)
                {
                    terminal = true;
                    journal.Append(OriginalR7AuditEvent.Stop,
                        Digest("stephanos.r7-observation-cancel.v1\0" + planDigest));
                }
            }
            finally { journal.Dispose(); }
        }
    }
}
