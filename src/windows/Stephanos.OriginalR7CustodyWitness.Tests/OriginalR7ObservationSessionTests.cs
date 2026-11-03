using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using Stephanos.OriginalR7CustodyWitness;
using Stephanos.OriginalR7DaclReadback;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7ObservationSessionTests
{
    internal static int Run()
    {
        int count = 0;
        void Check(bool ok, string label) { count++; if (!ok) throw new Exception("SESSION_TEST_" + label); }
        void Reject(Action action, string label)
        {
            try { action(); } catch (InvalidOperationException) { Check(true, label); return; }
            throw new Exception("SESSION_ACCEPTED_" + label);
        }
        var binding = new OriginalR7AuditBinding(new string('a', 40), new string('b', 64),
            "r7-observation-test-request", "r7-observation-test-command",
            "critical-2962-elastic-goal-r7-27828c3fdb2c", "4e5023eef829b285095db4eeb09d6f2b365e33e4");
        string scratch = Path.Combine(Path.GetTempPath(), "r7-session-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(scratch);
        int serial = 0;
        string Fresh() => Path.Combine(scratch, (++serial) + ".ndjson");
        OriginalR7AuditJournal Journal(string path) => new(
            new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read, 1, FileOptions.WriteThrough), binding);
        OriginalR7ProcessChallenge Challenge(string name = "first") => new(123, 456, "S-1-5-21-1-2-3-1001", @"C:\r7-test\" + name);
        var denied = new R7ProcessBoundWriteObservation("R7_PROCESS_TOKEN_SAMPLE_OBSERVED_NOT_CUSTODY", true,
            new("R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY", true, true, true, true, true, false, false));
        void NoAuthority(OriginalR7ObservationReceipt r)
        {
            Check(!r.OriginalPrincipalProvenanceAuthenticated && !r.PhysicalContainmentProven
                && !r.ContinuousExclusionProven && !r.IndependentSignatureProven
                && !r.LeaseReleaseAuthorized, "ALL_AUTHORITY_FALSE");
        }
        try
        {
            foreach (var invalid in new[] {
                Array.Empty<OriginalR7ProcessChallenge>(),
                Enumerable.Repeat(Challenge(), 9).ToArray(),
                new[] { Challenge(), Challenge() with { TargetPath = @"c:\R7-TEST\FIRST" } },
                new[] { Challenge(), Challenge("second") with { ProcessId = 124 } },
                new[] { Challenge(), Challenge("second") with { CreationFileTimeUtc = 457 } },
                new[] { Challenge(), Challenge("second") with { PrincipalSid = "S-1-5-18" } },
                new[] { Challenge() with { TargetPath = @"\\server\share\file" } },
                new[] { Challenge() with { TargetPath = @"C:\r7-test\..\escape" } },
                new[] { Challenge() with { TargetPath = @"C:\r7-test\first:stream" } },
                new[] { Challenge() with { TargetPath = @"C:\r7-test\first." } },
                new[] { Challenge() with { PrincipalSid = "S-1-5-00018" } },
                new[] { Challenge() with { CreationFileTimeUtc = 0 } },
            })
            {
                string path = Fresh(); using var j = Journal(path);
                Reject(() => { using var s = new OriginalR7ObservationSession(j, invalid, _ => throw new Exception("SHOULD_NOT_PROBE")); }, "INVALID_PLAN");
                Check(new FileInfo(path).Length == 0, "INVALID_PLAN_NO_AUDIT_OR_PROBE");
            }

            string completePath = Fresh();
            var mutable = new[] { Challenge(), Challenge("second") };
            using (var s = new OriginalR7ObservationSession(Journal(completePath), mutable, _ => denied, () => 0))
            {
                mutable[0] = Challenge() with { ProcessId = 999 };
                var first = s.ObserveNext(); NoAuthority(first);
                Check(first.SamplesCompleted == 1 && first.Checkpoint.Sequence == 2
                    && first.Checkpoint.Event == OriginalR7AuditEvent.Observation, "FIRST_DURABLE_SAMPLE");
                var last = s.ObserveNext(); NoAuthority(last);
                Check(last.SamplesCompleted == 2 && last.PlannedSamples == 2
                    && last.Checkpoint.Sequence == 4 && last.Checkpoint.Event == OriginalR7AuditEvent.Stop
                    && last.Classification == "R7_BOUNDED_SAMPLE_COMPLETE_NOT_CUSTODY", "COMPLETE_STOPS");
                Reject(() => s.ObserveNext(), "NO_REPLAY_AFTER_COMPLETE");
            }
            using (var replay = Journal(completePath))
            {
                Check(replay.LastCheckpoint?.Sequence == 4, "ACTUAL_DURABLE_REPLAY");
                Reject(() => { using var s = new OriginalR7ObservationSession(replay, new[] { Challenge() }, _ => denied); }, "RESTART_NOT_REOPENED");
            }

            // Every partial, writable, owner, bypass, unknown and changed native
            // result must terminate without crediting a sample.
            var access = denied.WriteAccess!;
            foreach (var bad in new[] {
                denied with { ProcessBindingObserved = false },
                denied with { Classification = "UNRECOGNIZED" },
                denied with { WriteAccess = null },
                denied with { WriteAccess = access with { Classification = "UNRECOGNIZED" } },
                denied with { WriteAccess = access with { DataWriteOpenDenied = false } },
                denied with { WriteAccess = access with { DaclWriteOpenDenied = false } },
                denied with { WriteAccess = access with { OwnerWriteOpenDenied = false } },
                denied with { WriteAccess = access with { SuppliedTokenSidMatched = false } },
                denied with { WriteAccess = access with { TargetIdentityStable = false } },
                denied with { WriteAccess = access with { SuppliedPrincipalOwnsTarget = true } },
                denied with { WriteAccess = access with { TokenHasBypassAuthority = true } },
            })
            {
                using var s = new OriginalR7ObservationSession(Journal(Fresh()), new[] { Challenge() }, _ => bad, () => 0);
                var r = s.ObserveNext(); NoAuthority(r);
                Check(r.SamplesCompleted == 0 && r.Checkpoint.Event == OriginalR7AuditEvent.Fault, "BAD_NATIVE_TERMINATES");
                Reject(() => s.ObserveNext(), "BAD_NATIVE_NO_RETRY");
            }
            using (var s = new OriginalR7ObservationSession(Journal(Fresh()), new[] { Challenge() },
                _ => throw new IOException("PRIVATE_PATH_MUST_NOT_ESCAPE"), () => 0))
            {
                var r = s.ObserveNext(); Check(!r.Classification.Contains("PRIVATE"), "SANITIZED_NATIVE_ERROR");
                Check(r.Checkpoint.Event == OriginalR7AuditEvent.Fault, "NATIVE_THROW_FAULT_DURABLE"); NoAuthority(r);
            }
            foreach (bool during in new[] { false, true })
            {
                long elapsed = 0; int probes = 0;
                using var s = new OriginalR7ObservationSession(Journal(Fresh()), new[] { Challenge() },
                    _ => { probes++; elapsed = 30_001; return denied; }, () => elapsed);
                if (!during) elapsed = 30_001;
                var r = s.ObserveNext(); NoAuthority(r);
                Check(r.SamplesCompleted == 0 && probes == (during ? 1 : 0)
                    && r.Classification == "R7_OBSERVATION_DEADLINE_OR_CLOCK_UNPROVEN", "DEADLINE_BEFORE_AND_AFTER");
            }
            {
                long elapsed = 10;
                using var s = new OriginalR7ObservationSession(Journal(Fresh()), new[] { Challenge() }, _ => denied, () => elapsed);
                elapsed = 9; Check(s.ObserveNext().Checkpoint.Event == OriginalR7AuditEvent.Fault, "MONOTONIC_ROLLBACK_FAULT");
            }
            {
                var j = Journal(Fresh());
                using var s = new OriginalR7ObservationSession(j, new[] { Challenge() }, _ => { j.Dispose(); return denied; }, () => 0);
                Reject(() => s.ObserveNext(), "AUDIT_IO_FAILURE_NO_RECEIPT");
                Reject(() => s.ObserveNext(), "AUDIT_IO_FAILURE_POISONS_SESSION");
            }
            string cancelled = Fresh();
            using (var s = new OriginalR7ObservationSession(Journal(cancelled), new[] { Challenge() }, _ => denied, () => 0)) { }
            using (var replay = Journal(cancelled))
                Check(replay.LastCheckpoint?.Event == OriginalR7AuditEvent.Stop
                    && replay.LastCheckpoint.Sequence == 2, "DISPOSE_CANCEL_AUDITED");

            // Actual Windows kernel process/token binding against our own disposable
            // file. This does not identify the historical writer. No ACL is changed.
            string nativeFile = Path.Combine(scratch, "native-target.txt");
            File.WriteAllText(nativeFile, "unchanged");
            byte[] original = File.ReadAllBytes(nativeFile);
            using var current = Process.GetCurrentProcess();
            using var identity = WindowsIdentity.GetCurrent();
            var challenge = new OriginalR7ProcessChallenge(current.Id,
                current.StartTime.ToUniversalTime().ToFileTimeUtc(), identity.User!.Value, nativeFile);
            using (var s = new OriginalR7ObservationSession(Journal(Fresh()), new[] { challenge }))
            {
                var r = s.ObserveNext(); NoAuthority(r);
                Check(r.SamplesCompleted == 0 && r.Checkpoint.Event == OriginalR7AuditEvent.Fault,
                    "ACTUAL_OWN_TOKEN_NOT_MISCLASSIFIED_DENIED");
                Check(File.ReadAllBytes(nativeFile).SequenceEqual(original), "ACTUAL_PROBE_FILE_UNCHANGED");
                string publicReceipt = System.Text.Json.JsonSerializer.Serialize(r);
                Check(!publicReceipt.Contains(nativeFile) && !publicReceipt.Contains(identity.User.Value), "NO_PRIVATE_IDENTITIES_IN_RECEIPT");
            }
            // Real OS binding mismatch must also fault without a success sample.
            using (var s = new OriginalR7ObservationSession(Journal(Fresh()),
                new[] { challenge with { CreationFileTimeUtc = challenge.CreationFileTimeUtc + 1 } }))
            {
                var r = s.ObserveNext(); Check(r.Checkpoint.Event == OriginalR7AuditEvent.Fault, "ACTUAL_PID_REUSE_GUARD");
                NoAuthority(r);
            }
        }
        finally { Directory.Delete(scratch, true); }
        Console.WriteLine("R7_NEW_OBSERVATION_SESSION_ASSERTIONS_PASSED=" + count);
        return count;
    }
}
