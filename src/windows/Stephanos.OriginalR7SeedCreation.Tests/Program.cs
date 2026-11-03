using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using System.Diagnostics;
using Stephanos.OriginalR7CustodyWitness;

internal static class Program
{
    private static int assertions;
    private static string root = "", actorSid = "";
    private static readonly List<string> owned = new();
    private static void Check(bool value, string name)
    { assertions++; if (!value) throw new InvalidOperationException("SEED_FIXTURE_" + name); }

    private static int Main(string[] args)
    {
        SetErrorMode(SetErrorMode(0) | 3);
        if (args.SequenceEqual(new[] { "--owned-seed-pair-crash" })) return PairCrashChild();
        try { return Run(args); }
        catch (Exception ex)
        { Console.Error.WriteLine("R7_SEED_FIXTURE_CLEANUP_OR_HARNESS_FAILED=" + ex.GetType().Name); return 1; }
    }
    private static int Run(string[] args)
    {
        try
        {
            if (args.SequenceEqual(new[] { "--probe-harness-failure" })) throw new InvalidOperationException("EXPECTED_CONTROLLED_FAILURE");
            if (args.Length != 0 || !OperatingSystem.IsWindows()) return 2;
            using WindowsIdentity identity = WindowsIdentity.GetCurrent();
            actorSid = identity.User?.Value ?? throw new InvalidOperationException("ACTOR_REQUIRED");
            // A bounded explicit disposable root under THIS fixture's current
            // workspace. No production roots, account changes or UAC requests.
            root = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "owned-seed-fixtures-" + Guid.NewGuid().ToString("N")[..8]));
            if (!CreateDirectoryW(root, IntPtr.Zero)) throw new InvalidOperationException("FRESH_OWNED_ROOT_REQUIRED");
            string witness = NewDirectory(), op = NewDirectory();
            var checkpoints = new List<OriginalR7SeedCreationCheckpoint>();
            var first = OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(witness,
                OriginalR7SignaturePurpose.Witness, checkpoint =>
                {
                    checkpoints.Add(checkpoint);
                    string file = Path.Combine(witness, "witness.seed");
                    using var metadata = OpenMetadata(file);
                    Check(!metadata.IsInvalid, "METADATA_ONLY_ACCESS_AT_EVERY_STAGE");
                    byte[] sd = OriginalR7AuditStorage.ReadDescriptor(metadata);
                    Check(OriginalR7ProtectedKeyMetadata.FileIdentity(metadata) == checkpoint.NativeFileIdentityDigest,
                        "SAME_NATIVE_OBJECT_AT_EVERY_STAGE");
                    Check(RandomAccess.GetLength(metadata) == checkpoint.Length, "ACTUAL_NATIVE_STAGE_LENGTH");
                    Check(ExactFixtureFileAcl(sd), "EXACT_PROTECTED_THREE_ACE_ACL_BEFORE_AND_AFTER_SECRET");
                    Check(!checkpoint.CanonicalPolicyMatches, "FIXTURE_OWNER_NEVER_QUALIFIES_PRODUCTION");
                    bool writerBlocked = false, renameBlocked = false, parentBlocked = false;
                    try { using var stream = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete); }
                    catch (IOException) { writerBlocked = true; } catch (UnauthorizedAccessException) { writerBlocked = true; }
                    try { File.Move(file, file + ".replaced"); } catch (IOException) { renameBlocked = true; }
                    try { Directory.Move(witness, witness + ".replaced"); } catch (IOException) { parentBlocked = true; }
                    Check(writerBlocked && renameBlocked && parentBlocked, "RETAINED_FILE_AND_ANCESTRY_REJECT_NEW_WRITER_AND_REPLACEMENT");
                });
            Check(checkpoints.Count == 4 && checkpoints[0].Stage == OriginalR7SeedCreationStage.EmptyProtectedFile
                && checkpoints[0].Length == 0 && checkpoints.Skip(1).All(c => c.Length == 32), "PERMISSIONS_PRECEDE_FIRST_MATERIAL_BYTE");
            Check(checkpoints.All(c => c.NativeFileIdentityDigest == first.NativeFileIdentityDigest
                && c.DescriptorDigest == first.DescriptorDigest), "SINGLE_RETAINED_OBJECT_AND_ACL_TRANSACTION");
            VerifyPublic(witness, first);
            NoAuthority(first);

            var second = OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(op, OriginalR7SignaturePurpose.Operator);
            VerifyPublic(op, second); NoAuthority(second);
            Check(first.PublicSpkiSha256 != second.PublicSpkiSha256, "TWO_FRESH_CSPRNG_KEYS_DIFFER");
            Check(first.Purpose != second.Purpose, "SEPARATE_FIXED_PURPOSE_LEAVES");
            Check(!File.Exists(Path.Combine(witness, "operator.seed")) && !File.Exists(Path.Combine(op, "witness.seed")),
                "NO_CROSS_ROLE_MATERIAL_WRITTEN");

            byte[] existingPublic = Convert.FromBase64String(first.PublicSpkiBase64);
            RejectPreserving(() => OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(witness,
                OriginalR7SignaturePurpose.Witness), witness, first, "CREATE_NEW_EXISTING_KEY_REFUSED");
            Check(Convert.FromBase64String(first.PublicSpkiBase64).AsSpan().SequenceEqual(existingPublic), "PUBLIC_RECORD_IMMUTABLE");

            foreach (int size in new[] { 0, 13, 31, 33, 4096 })
            {
                string directory = NewDirectory(), path = Path.Combine(directory, "witness.seed");
                byte[] preexisting = Enumerable.Repeat((byte)0xa5, size).ToArray();
                File.WriteAllBytes(path, preexisting);
                bool rejected = false;
                try { OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(directory, OriginalR7SignaturePurpose.Witness); }
                catch (OriginalR7SeedCreationException ex) { rejected = !ex.CreatedObjectObserved; }
                Check(rejected && File.ReadAllBytes(path).AsSpan().SequenceEqual(preexisting), "ANY_PREEXISTING_LEAF_PRESERVED_" + size);
            }
            string multi = NewDirectory(), source = Path.Combine(multi, "existing.txt"), linked = Path.Combine(multi, "witness.seed");
            File.WriteAllText(source, "owned public sentinel");
            Check(CreateHardLinkW(linked, source, IntPtr.Zero), "OWNED_PREEXISTING_MULTILINK_CREATED");
            bool multiRejected = false;
            try { OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(multi, OriginalR7SignaturePurpose.Witness); }
            catch (OriginalR7SeedCreationException ex) { multiRejected = !ex.CreatedObjectObserved; }
            Check(multiRejected && File.ReadAllText(source) == "owned public sentinel" && File.Exists(linked), "MULTILINK_NOT_ADOPTED_OR_DELETED");

            foreach (var fault in Enum.GetValues<OriginalR7SeedFixtureFault>().Where(f => f != OriginalR7SeedFixtureFault.None))
            {
                string directory = NewDirectory();
                bool cleaned = false;
                try { OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(directory,
                    OriginalR7SignaturePurpose.Witness, fault: fault); }
                catch (OriginalR7SeedCreationException ex) { cleaned = ex.CreatedObjectObserved && ex.CreatedObjectCleanupConfirmed; }
                Check(cleaned && !File.Exists(Path.Combine(directory, "witness.seed")), "RETAINED_OBJECT_CLEANUP_" + fault);
                var retry = OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(directory, OriginalR7SignaturePurpose.Witness);
                VerifyPublic(directory, retry); NoAuthority(retry);
            }
            // Actual metadata mutation is possible through this UNTRUSTED
            // fixture owner's implicit WRITE_DAC. It must be detected before
            // material generation; retained DELETE authority cleans only its
            // newly-created original object, without a path deletion operation.
            string badAcl = NewDirectory(); int badAclCheckpoints = 0; bool badAclCleaned = false;
            try
            {
                OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(badAcl, OriginalR7SignaturePurpose.Witness, c =>
                {
                    badAclCheckpoints++;
                    Check(c.Stage == OriginalR7SeedCreationStage.EmptyProtectedFile && c.Length == 0, "ACL_MUTATION_ONLY_ON_EMPTY_OWNED_FILE");
                    var altered = new FileSecurity();
                    altered.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;" + actorSid + ")", AccessControlSections.Access);
                    new FileInfo(Path.Combine(badAcl, "witness.seed")).SetAccessControl(altered);
                });
            }
            catch (OriginalR7SeedCreationException ex) { badAclCleaned = ex.CreatedObjectObserved && ex.CreatedObjectCleanupConfirmed; }
            Check(badAclCheckpoints == 1 && badAclCleaned && !File.Exists(Path.Combine(badAcl, "witness.seed")),
                "RACED_WRONG_ACL_DETECTED_AND_ORIGINAL_OBJECT_CLEANED_BEFORE_SECRET");

            // Exercise cleanup refusal when a newly-created object's exclusive
            // single-name identity can no longer be proven. Only the owned
            // fixture owner mutates its own DACL; no unknown path is deleted.
            string racedLink = NewDirectory(); bool linkedDuringCreation = false, unknownCleanupHeld = false;
            try
            {
                OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(racedLink, OriginalR7SignaturePurpose.Witness, c =>
                {
                    if (c.Stage != OriginalR7SeedCreationStage.EmptyProtectedFile) return;
                    string original = Path.Combine(racedLink, "witness.seed");
                    var altered = new FileSecurity();
                    altered.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;" + actorSid + ")", AccessControlSections.Access);
                    new FileInfo(original).SetAccessControl(altered);
                    linkedDuringCreation = CreateHardLinkW(Path.Combine(racedLink, "added-link.seed"), original, IntPtr.Zero);
                });
            }
            catch (OriginalR7SeedCreationException ex)
            { unknownCleanupHeld = ex.CreatedObjectObserved && !ex.CreatedObjectCleanupConfirmed
                && ex.Message == "R7_SEED_CREATION_FAILED_CLEANUP_UNPROVEN"; }
            if (linkedDuringCreation)
            {
                Check(unknownCleanupHeld, "MULTILINK_IDENTITY_LOSS_MAKES_CLEANUP_EXPLICITLY_UNPROVEN");
                Check(new FileInfo(Path.Combine(racedLink, "witness.seed")).Length == 0
                    && new FileInfo(Path.Combine(racedLink, "added-link.seed")).Length == 0,
                    "UNKNOWN_CLEANUP_NEVER_DELETES_NAMES_OR_WRITES_SECRET");
            }
            else Check(!File.Exists(Path.Combine(racedLink, "witness.seed")), "UNSUPPORTED_LINK_RACE_STILL_CLEANS_OWNED_WRONG_ACL_FILE");

            // Real filesystem symbolic-link creation can require a host policy
            // this runner lacks. Record that capability honestly, never elevate.
            string symlink = NewDirectory(), destination = Path.Combine(symlink, "sentinel.txt"), link = Path.Combine(symlink, "witness.seed");
            File.WriteAllText(destination, "owned link destination");
            bool symbolicSupported = CreateSymbolicLinkW(link, destination, 2);
            if (symbolicSupported)
            {
                bool held = false;
                try { OriginalR7ProtectedSeedCreation.CreateNewUntrustedOwnedFixture(symlink, OriginalR7SignaturePurpose.Witness); }
                catch (OriginalR7SeedCreationException ex) { held = !ex.CreatedObjectObserved; }
                Check(held && File.ReadAllText(destination) == "owned link destination"
                    && (File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0, "REPARSE_LEAF_NEVER_FOLLOWED_ADOPTED_OR_REMOVED");
            }
            Check(File.ReadAllText(destination) == "owned link destination", "SYMLINK_DESTINATION_PRESERVED");

            string canonical = NewDirectory();
            // The actor is not a commissioned owner. Try the real canonical
            // directory owner policy; lack of that OS right is a reported limit.
            bool canonicalOwnerPolicySupported = false, canonicalCreationSucceeded = false;
            try
            {
                var acl = new DirectorySecurity();
                acl.SetSecurityDescriptorBinaryForm(OriginalR7ProtectedSeedCreation.UntrustedFixtureDescriptor(
                    "S-1-5-32-544", actorSid, true), AccessControlSections.Owner | AccessControlSections.Access);
                new DirectoryInfo(canonical).SetAccessControl(acl);
                canonicalOwnerPolicySupported = true;
            }
            catch (Exception ex) when (ex is UnauthorizedAccessException or PrivilegeNotHeldException or InvalidOperationException)
            { Check(!File.Exists(Path.Combine(canonical, "witness.seed")), "UNSUPPORTED_CANONICAL_OWNER_POLICY_HAS_NO_SECRET_LEAF"); }
            if (canonicalOwnerPolicySupported)
            {
                var real = OriginalR7ProtectedSeedCreation.CreateNewCanonicalPolicyUntrustedFixture(canonical,
                    actorSid, OriginalR7SignaturePurpose.Witness);
                canonicalCreationSucceeded = real.CanonicalPolicyMatches && real.CanonicalDirectoryPolicyMatches;
                Check(canonicalCreationSucceeded, "ACTUAL_CANONICAL_POLICY_CREATION_IF_NATIVE_CONTEXT_SUPPORTS_IT");
                NoAuthority(real);
            }

            var witnessLocation = OriginalR7ProtectedSeedCreation.ProposedFixedLocation(OriginalR7SignaturePurpose.Witness);
            var operatorLocation = OriginalR7ProtectedSeedCreation.ProposedFixedLocation(OriginalR7SignaturePurpose.Operator);
            Check(witnessLocation.Path.EndsWith(@"\Stephanos\StephanosOriginalR7CustodyWitness\keys\witness.seed", StringComparison.Ordinal)
                && operatorLocation.Path.EndsWith(@"\Stephanos\StephanosOriginalR7CustodyOperator\keys\operator.seed", StringComparison.Ordinal),
                "SOURCE_PROPOSAL_FIXED_SEPARATE_ROLE_MAPPING");
            Check(!witnessLocation.PolicyAdopted && !witnessLocation.HostExecutionAuthorized && !witnessLocation.RootEnrollmentAuthorized
                && !operatorLocation.PolicyAdopted && !operatorLocation.RootEnrollmentAuthorized, "MAPPING_NEVER_INSTALLS_OR_ADOPTS_ROOTS");
            PairTransactions();
            bool invalidRoleHeld = false;
            try { OriginalR7ProtectedSeedCreation.ProposedFixedLocation((OriginalR7SignaturePurpose)99); }
            catch (InvalidOperationException) { invalidRoleHeld = true; }
            Check(invalidRoleHeld, "CLOSED_WORLD_ROLE_MAPPING");
            const string untrustedWitnessSid = "S-1-5-80-11-22-33-44-55", untrustedOperatorSid = "S-1-5-21-101-202-303-1101";
            foreach (bool isDirectory in new[] { false, true })
            {
                byte[] proposedAcl = OriginalR7ProtectedSeedCreation.UntrustedFixtureDescriptor("S-1-5-32-544", untrustedOperatorSid, isDirectory);
                Check(OriginalR7ProtectedKeyMetadata.PolicyMatches(proposedAcl, untrustedOperatorSid, isDirectory), "UNCHANGED_CANONICAL_OPERATOR_THREE_ACE_MASK_SHAPE");
                Check(!OriginalR7ProtectedKeyMetadata.PolicyMatches(proposedAcl, untrustedWitnessSid, isDirectory)
                    && new RawSecurityDescriptor(proposedAcl, 0).DiscretionaryAcl!.Cast<CommonAce>()
                        .All(ace => ace.SecurityIdentifier.Value != untrustedWitnessSid), "PROPOSED_OPERATOR_ACL_HAS_NO_WITNESS_ACE");
            }
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "stephanos.r7-seed-creation-native-fixture.v1",
                result = "PASS", assertions, runtime = Environment.Version.ToString(), canonicalOwnerPolicySupported,
                canonicalCreationSucceeded, symbolicLinkSupported = symbolicSupported,
                multilinkDuringCreationSupported = linkedDuringCreation, unknownCleanupFailureProven = unknownCleanupHeld,
                actualRandomSeedCreation = true, actualFlushAndRetainedReadback = true,
                actualPartialNativeWriteFailureCleaned = true, fixtureOwnerAndDirectoryUntrusted = true,
                productionKeyCreated = false, productionRootEnrolled = false, signingAuthorized = false,
                physicalCustodyProven = false, leaseReleaseAuthorized = false }));
            return 0;
        }
        catch (Exception ex)
        { Console.Error.WriteLine("R7_SEED_FIXTURE_FAILED=" + ex.GetType().Name + ":" + ex.Message);
          if (ex is OriginalR7SeedCreationException seedFailure) Console.Error.WriteLine("R7_SEED_FAILURE_PHASE=" + seedFailure.FailedPhase + ";created=" + seedFailure.CreatedObjectObserved + ";cleanup=" + seedFailure.CreatedObjectCleanupConfirmed);
          Console.Error.WriteLine(ex.StackTrace); return 1; }
        finally { CleanupOwnedFixtures(); }
    }

    private static string NewDirectory()
    {
        string directory = Path.Combine(root, "r7-seed-create-fixture-" + Guid.NewGuid().ToString("N")[..8]);
        byte[] sd = OriginalR7ProtectedSeedCreation.UntrustedFixtureDescriptor(actorSid, actorSid, true);
        GCHandle pinned = GCHandle.Alloc(sd, GCHandleType.Pinned);
        try
        {
            SecurityAttributes attributes = new() { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = pinned.AddrOfPinnedObject() };
            if (!CreateDirectoryWithSecurity(directory, ref attributes)) throw new InvalidOperationException("FRESH_PROTECTED_OWNED_CHILD_REQUIRED_" + Marshal.GetLastWin32Error());
            owned.Add(directory);
        }
        finally { pinned.Free(); }
        return directory;
    }

    private sealed record PairFixture(string Witness, string Operator, string Audit);
    private sealed record PairCrashRequest(string Root, PairFixture Pair, OriginalR7SeedPairStage? Stage,
        OriginalR7SignaturePurpose? MaterialPurpose = null, OriginalR7SeedCreationStage? MaterialStage = null);
    private static readonly OriginalR7AuditBinding PairBinding = new(new string('a', 40), new string('b', 64),
        "r7-seed-pair-fixture-request", "r7-seed-pair-fixture-command",
        "critical-2962-elastic-goal-r1-27828c3fdb2c", "4e5023eef829b285095db4eeb09d6f2b365e33e4");
    private static PairFixture NewPair() => new(NewDirectory(), NewDirectory(), NewDirectory());
    private static OriginalR7CreatedSeedPairObservation Pair(PairFixture f,
        Action<OriginalR7SeedPairStage>? at = null,
        OriginalR7SeedFixtureFault fault = OriginalR7SeedFixtureFault.None)
        => OriginalR7SeedPairTransaction.CreateNewUntrustedOwnedFixture(f.Witness, f.Operator, f.Audit,
            PairBinding, new string('c', 40), new string('d', 40), at, fault);
    private static string Ledger(PairFixture f) => Path.Combine(f.Audit, "seed-pair.ndjson");
    private static string[] Events(PairFixture f)
    {
        // A reader must share the already-retained writer's access. The
        // writer itself still denies every additional data-write open.
        using var stream = new FileStream(Ledger(f), FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => {
            using var doc = JsonDocument.Parse(line); return doc.RootElement.GetProperty("Event").GetString()!;
        }).ToArray();
    }

    private static void CrashOwnedPair(PairCrashRequest request)
    {
        string exe = Environment.ProcessPath ?? throw new InvalidOperationException("PAIR_OWN_IMAGE_REQUIRED");
        var start = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Environment.CurrentDirectory };
        if (Path.GetFileName(exe).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.ArgumentList.Add("--owned-seed-pair-crash");
        start.Environment["R7_OWNED_PAIR_CRASH"] = JsonSerializer.Serialize(request);
        using var child = Process.Start(start) ?? throw new InvalidOperationException("PAIR_OWN_CHILD_START");
        bool exited = child.WaitForExit(15000);
        if (!exited)
        {
            child.Kill(); // Only the exact child object this fixture just created.
            if (!child.WaitForExit(10000)) throw new InvalidOperationException("PAIR_OWN_CHILD_CLEANUP_UNPROVEN");
        }
        Check(exited && child.ExitCode == 87, "PAIR_ACTUAL_PROCESS_EXIT_AT_FIXED_CHECKPOINT");
    }

    private static void PairTransactions()
    {
        int begin = assertions;
        var f = NewPair();
        var stages = new List<OriginalR7SeedPairStage>();
        var pair = Pair(f, stage => {
            stages.Add(stage);
            string[] events = Events(f);
            Check(events.Length == (int)stage + 1, "PAIR_STAGE_FOLLOWS_DURABLE_JOURNAL_READBACK");
            if (stage == OriginalR7SeedPairStage.Reserved)
                Check(!File.Exists(Path.Combine(f.Witness, "witness.seed"))
                    && !File.Exists(Path.Combine(f.Operator, "operator.seed")), "PAIR_RESERVATION_PRECEDES_BOTH_SEEDS");
            if (stage == OriginalR7SeedPairStage.WitnessStored)
            {
                Check(!File.Exists(Path.Combine(f.Operator, "operator.seed")), "PAIR_WITNESS_CHECKPOINT_PRECEDES_OPERATOR");
                bool blocked = false;
                try { using var overwrite = new FileStream(Path.Combine(f.Witness, "witness.seed"), FileMode.Open,
                    FileAccess.Write, FileShare.ReadWrite | FileShare.Delete); }
                catch (IOException) { blocked = true; } catch (UnauthorizedAccessException) { blocked = true; }
                Check(blocked, "PAIR_RETAINS_FIRST_SEED_AGAINST_NEW_WRITERS_UNTIL_COMMIT");
            }
        });
        Check(stages.SequenceEqual(Enum.GetValues<OriginalR7SeedPairStage>()), "PAIR_ALL_DURABLE_PHASES_EXECUTE");
        Check(Events(f).SequenceEqual(new[] { "Start", "Observation", "Observation", "Stop" }), "PAIR_EXACT_JOURNAL_LIFECYCLE");
        VerifyPublic(f.Witness, pair.Witness); VerifyPublic(f.Operator, pair.Operator);
        Check(pair.DurableCommit.Sequence == 4 && pair.DurableCommit.Event == OriginalR7AuditEvent.Stop,
            "PAIR_TERMINAL_COMMIT_RETURNED_AFTER_FLUSH");
        Check(!pair.RootEnrolled && !pair.CreationCustodyProven && !pair.SigningAuthorized && !pair.LeaseReleaseAuthorized,
            "PAIR_STORAGE_CANNOT_ADMIT_ROOTS_OR_CUSTODY");
        byte[] original = File.ReadAllBytes(Ledger(f));
        bool replay = false;
        try { Pair(f); } catch (OriginalR7SeedPairException ex)
        { replay = !ex.ReservationCreated && !ex.AutonomousRetryAllowed; }
        Check(replay && File.ReadAllBytes(Ledger(f)).AsSpan().SequenceEqual(original), "PAIR_REPLAY_NEVER_REWRITES_COMPLETED_ATTEMPT");
        VerifyPublic(f.Witness, pair.Witness); VerifyPublic(f.Operator, pair.Operator);
        using (var recovered = new OriginalR7AuditJournal(new FileStream(Ledger(f), FileMode.Open,
            FileAccess.ReadWrite, FileShare.Read, 1, FileOptions.WriteThrough), PairBinding))
        {
            Check(recovered.LastCheckpoint == pair.DurableCommit, "PAIR_COMMIT_REPLAYS_THROUGH_EXISTING_AUDIT_CHAIN_VALIDATOR");
            bool cannotResume = false;
            try { recovered.Append(OriginalR7AuditEvent.Start, new string('f', 64)); }
            catch (InvalidOperationException) { cannotResume = true; }
            Check(cannotResume, "PAIR_RECOVERY_CANNOT_RESUME_A_PREVIOUS_JOURNAL_SESSION");
        }
        var alias = NewPair(); bool aliasHeld = false;
        try { Pair(alias with { Operator = alias.Witness }); }
        catch (OriginalR7SeedPairException ex) { aliasHeld = !ex.ReservationCreated; }
        Check(aliasHeld && !File.Exists(Ledger(alias)), "PAIR_DISTINCT_PATHS_REQUIRE_DISTINCT_NATIVE_DIRECTORY_OBJECTS");
        var invalid = NewPair(); bool candidateHeld = false;
        try { OriginalR7SeedPairTransaction.CreateNewUntrustedOwnedFixture(invalid.Witness, invalid.Operator,
            invalid.Audit, PairBinding, new string('0', 40), new string('d', 40)); }
        catch (OriginalR7SeedPairException ex) { candidateHeld = !ex.ReservationCreated; }
        Check(candidateHeld && !File.Exists(Ledger(invalid)), "PAIR_PLACEHOLDER_CANDIDATE_CANNOT_RESERVE_OR_GENERATE");
        var occupied = NewPair();
        string occupiedPath = Path.Combine(occupied.Operator, "operator.seed");
        File.WriteAllText(occupiedPath, "owned preexisting sentinel");
        bool occupiedHeld = false;
        try { Pair(occupied); } catch (OriginalR7SeedPairException ex)
        { occupiedHeld = ex.ReservationCreated && ex.VerifiedSeedCount == 0 && ex.DurableFaultRecorded; }
        Check(occupiedHeld && !File.Exists(Path.Combine(occupied.Witness, "witness.seed"))
            && File.ReadAllText(occupiedPath) == "owned preexisting sentinel", "PAIR_PREEXISTING_SECOND_ROOT_REFUSED_BEFORE_FIRST_ENTROPY");

        foreach (string wire in new[] { "", "{\"torn\":" })
        {
            var torn = NewPair(); File.WriteAllText(Ledger(torn), wire);
            bool held = false;
            try { Pair(torn); } catch (OriginalR7SeedPairException ex) { held = !ex.ReservationCreated; }
            Check(held && File.ReadAllText(Ledger(torn)) == wire
                && !File.Exists(Path.Combine(torn.Witness, "witness.seed"))
                && !File.Exists(Path.Combine(torn.Operator, "operator.seed")), "PAIR_EMPTY_OR_TORN_PREEXISTING_RESERVATION_IS_NOT_REUSED");
        }
        var failed = NewPair(); bool partial = false;
        try { Pair(failed, fault: OriginalR7SeedFixtureFault.BeforeFlush); }
        catch (OriginalR7SeedPairException ex)
        { partial = ex.ReservationCreated && ex.VerifiedSeedCount == 1 && ex.DurableFaultRecorded && !ex.AutonomousRetryAllowed; }
        Check(partial && File.ReadAllBytes(Path.Combine(failed.Witness, "witness.seed")).Length == 32
            && !File.Exists(Path.Combine(failed.Operator, "operator.seed")), "PAIR_SECOND_ROOT_FAILURE_PRESERVES_FIRST_AND_REQUIRES_RECOVERY");
        Check(Events(failed).SequenceEqual(new[] { "Start", "Observation", "Fault" }), "PAIR_PARTIAL_FAILURE_DURABLY_RECORDED");

        var bad = NewPair(); bool badHeld = false;
        try { Pair(bad, stage => {
            if (stage != OriginalR7SeedPairStage.WitnessStored) return;
            var altered = new FileSecurity();
            altered.SetSecurityDescriptorSddlForm("D:P(A;;FA;;;" + actorSid + ")", AccessControlSections.Access);
            new FileInfo(Path.Combine(bad.Witness, "witness.seed")).SetAccessControl(altered);
        }); }
        catch (OriginalR7SeedPairException ex) { badHeld = ex.ReservationCreated && ex.VerifiedSeedCount == 1 && ex.DurableFaultRecorded; }
        Check(badHeld && !File.Exists(Path.Combine(bad.Operator, "operator.seed")), "PAIR_FIRST_ROOT_DESCRIPTOR_CHANGE_PREVENTS_SECOND_ROOT");
        var badJournal = NewPair(); bool journalHeld = false;
        try { Pair(badJournal, stage => {
            if (stage != OriginalR7SeedPairStage.Reserved) return;
            Check(CreateHardLinkW(Path.Combine(badJournal.Audit, "added-link.seed"), Ledger(badJournal), IntPtr.Zero),
                "PAIR_OWNED_JOURNAL_LINK_TAMPER_CREATED");
        }); }
        catch (OriginalR7SeedPairException ex) { journalHeld = ex.ReservationCreated && ex.VerifiedSeedCount == 0; }
        Check(journalHeld && !File.Exists(Path.Combine(badJournal.Witness, "witness.seed"))
            && !File.Exists(Path.Combine(badJournal.Operator, "operator.seed")), "PAIR_JOURNAL_IDENTITY_LOSS_PREVENTS_BOTH_SEEDS");

        var race = NewPair();
        using var reserved = new ManualResetEventSlim(); using var release = new ManualResetEventSlim();
        var winner = Task.Run(() => Pair(race, stage => {
            if (stage != OriginalR7SeedPairStage.Reserved) return;
            reserved.Set(); if (!release.Wait(TimeSpan.FromSeconds(10))) throw new InvalidOperationException("PAIR_TEST_BARRIER_TIMEOUT");
        }));
        try
        {
            Check(reserved.Wait(TimeSpan.FromSeconds(10)), "PAIR_CONCURRENT_WINNER_RESERVED");
            bool refused = false;
            try { Pair(race); } catch (OriginalR7SeedPairException ex) { refused = !ex.ReservationCreated; }
            Check(refused, "PAIR_CREATE_NEW_SERIALIZES_CONCURRENT_ATTEMPTS");
        }
        finally { release.Set(); }
        var winning = winner.WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
        VerifyPublic(race.Witness, winning.Witness); VerifyPublic(race.Operator, winning.Operator);
        Check(Events(race).Length == 4, "PAIR_ONLY_ONE_CONCURRENT_TRANSACTION_WROTE_AUDIT");

        foreach (OriginalR7SeedPairStage crashAt in Enum.GetValues<OriginalR7SeedPairStage>())
        {
            var crash = NewPair();
            CrashOwnedPair(new(root, crash, crashAt));
            byte[] before = File.ReadAllBytes(Ledger(crash));
            Check(Events(crash).Length == (int)crashAt + 1, "PAIR_CRASH_RETAINS_EXACT_FLUSHED_PREFIX_" + crashAt);
            Check(File.Exists(Path.Combine(crash.Witness, "witness.seed")) == (crashAt >= OriginalR7SeedPairStage.WitnessStored)
                && File.Exists(Path.Combine(crash.Operator, "operator.seed")) == (crashAt >= OriginalR7SeedPairStage.OperatorStored),
                "PAIR_CRASH_MATERIAL_MATCHES_REACHED_STAGE_" + crashAt);
            bool denied = false;
            try { Pair(crash); } catch (OriginalR7SeedPairException ex) { denied = !ex.ReservationCreated && !ex.AutonomousRetryAllowed; }
            Check(denied && File.ReadAllBytes(Ledger(crash)).AsSpan().SequenceEqual(before), "PAIR_CRASH_RESTART_NEVER_RECREATES_OR_ADOPTS_KEYS_" + crashAt);
        }
        // Crash INSIDE each native file transaction as well. In particular a
        // zero/32-byte orphan may exist without a corresponding key receipt.
        // This is process-exit recovery, not a power-loss durability claim.
        foreach (OriginalR7SignaturePurpose purpose in Enum.GetValues<OriginalR7SignaturePurpose>())
        foreach (OriginalR7SeedCreationStage phase in Enum.GetValues<OriginalR7SeedCreationStage>())
        {
            var crash = NewPair();
            CrashOwnedPair(new(root, crash, null, purpose, phase));
            string orphan = Path.Combine(purpose == OriginalR7SignaturePurpose.Witness ? crash.Witness : crash.Operator,
                purpose == OriginalR7SignaturePurpose.Witness ? "witness.seed" : "operator.seed");
            Check(new FileInfo(orphan).Length == (phase == OriginalR7SeedCreationStage.EmptyProtectedFile ? 0 : 32),
                "PAIR_ACTUAL_ORPHAN_LENGTH_AT_NATIVE_MATERIAL_CHECKPOINT");
            Check(Events(crash).Length == (purpose == OriginalR7SignaturePurpose.Witness ? 1 : 2),
                "PAIR_UNRECEIPTED_MATERIAL_IS_NOT_A_VERIFIED_KEY");
            byte[] audit = File.ReadAllBytes(Ledger(crash)), orphanBytes = File.ReadAllBytes(orphan);
            try
            {
                bool refused = false;
                try { Pair(crash); } catch (OriginalR7SeedPairException ex) { refused = !ex.ReservationCreated && !ex.AutonomousRetryAllowed; }
                Check(refused && File.ReadAllBytes(Ledger(crash)).AsSpan().SequenceEqual(audit)
                    && File.ReadAllBytes(orphan).AsSpan().SequenceEqual(orphanBytes), "PAIR_UNRECEIPTED_ORPHAN_PRESERVED_ON_RESTART");
            }
            finally { CryptographicOperations.ZeroMemory(orphanBytes); }
        }
        Console.WriteLine("R7_NATIVE_SEED_PAIR_TRANSACTION_ASSERTIONS_PASSED=" + (assertions - begin));
        Console.WriteLine("R7_SEED_PAIR_ACTUAL_PROCESS_CRASH_BOUNDARIES_TESTED=12");
    }

    private static int PairCrashChild()
    {
        try
        {
            string wire = Environment.GetEnvironmentVariable("R7_OWNED_PAIR_CRASH") ?? "";
            if (wire.Length > 2048) return 2;
            var request = JsonSerializer.Deserialize<PairCrashRequest>(wire);
            if (request is null
                || !(request.Stage.HasValue && Enum.IsDefined(request.Stage.Value)
                        && request.MaterialPurpose is null && request.MaterialStage is null
                    || request.Stage is null && request.MaterialPurpose.HasValue && Enum.IsDefined(request.MaterialPurpose.Value)
                        && request.MaterialStage.HasValue && Enum.IsDefined(request.MaterialStage.Value))
                || Path.GetDirectoryName(request.Root) != Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('\\')
                || !Path.GetFileName(request.Root).StartsWith("owned-seed-fixtures-", StringComparison.Ordinal)
                || (File.GetAttributes(request.Root) & FileAttributes.ReparsePoint) != 0
                || new[] { request.Pair.Witness, request.Pair.Operator, request.Pair.Audit }
                    .Any(d => Path.GetDirectoryName(d) != request.Root)) return 2;
            OriginalR7SeedPairTransaction.CreateNewUntrustedOwnedFixture(
                request.Pair.Witness, request.Pair.Operator, request.Pair.Audit, PairBinding,
                new string('c', 40), new string('d', 40),
                stage => { if (stage == request.Stage) Environment.Exit(87); },
                materialCheckpoint: (purpose, checkpoint) => {
                    if (purpose == request.MaterialPurpose && checkpoint.Stage == request.MaterialStage) Environment.Exit(87);
                });
            return 3;
        }
        catch { return 4; }
    }
    private static bool ExactFixtureFileAcl(byte[] bytes)
    {
        var sd = new RawSecurityDescriptor(bytes, 0);
        if (sd.Owner?.Value != actorSid) return false;
        sd.Owner = new SecurityIdentifier("S-1-5-32-544");
        byte[] canonicalCopy = new byte[sd.BinaryLength]; sd.GetBinaryForm(canonicalCopy, 0);
        return OriginalR7ProtectedKeyMetadata.PolicyMatches(canonicalCopy, actorSid, false);
    }
    private static void VerifyPublic(string directory, OriginalR7CreatedSeedObservation observation)
    {
        string file = Path.Combine(directory, observation.Purpose == OriginalR7SignaturePurpose.Witness ? "witness.seed" : "operator.seed");
        byte[] material = File.ReadAllBytes(file);
        try
        {
            Check(material.Length == 32, "FULL_NATIVE_32_BYTE_MATERIAL");
            byte[] pub = OriginalR7SigningPrimitives.PublicKey(material), spki = OriginalR7SigningPrimitives.PublicSpki(pub);
            Check(Convert.ToBase64String(spki) == observation.PublicSpkiBase64
                && Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant() == observation.PublicSpkiSha256,
                "INDEPENDENT_REOPEN_PUBLIC_SPki_CONSISTENCY_WITHOUT_SECRET_EXPORT");
            using var metadata = OpenMetadata(file);
            Check(OriginalR7ProtectedKeyMetadata.FileIdentity(metadata) == observation.NativeFileIdentityDigest
                && ExactFixtureFileAcl(OriginalR7AuditStorage.ReadDescriptor(metadata)), "SAME_SINGLE_LINK_FILE_AND_PROTECTED_ACL_AFTER_COMMIT");
        }
        finally { CryptographicOperations.ZeroMemory(material); }
    }
    private static void RejectPreserving(Action action, string directory, OriginalR7CreatedSeedObservation observation, string name)
    {
        bool held = false;
        try { action(); } catch (OriginalR7SeedCreationException ex) { held = !ex.CreatedObjectObserved; }
        Check(held, name); VerifyPublic(directory, observation);
    }
    private static void NoAuthority(OriginalR7CreatedSeedObservation observation)
    {
        Check(!observation.HumanConsentProven && !observation.PolicyAdopted && !observation.SourcePrincipalIsolationProven
            && !observation.RootEnrolled && !observation.SigningAuthorized && !observation.LeaseReleaseAuthorized, "STORAGE_HAS_NO_AUTHORITY");
        if (observation.UntrustedFixtureOwnerUsed)
            Check(!observation.CanonicalPolicyMatches && !observation.CanonicalDirectoryPolicyMatches, "FIXTURE_CONTEXT_NEVER_PRODUCTION_QUALIFICATION");
    }
    private static SafeFileHandle OpenMetadata(string path)
        => CreateFileW(path, 0x20080, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);

    private static void CleanupOwnedFixtures()
    {
        if (root.Length == 0) return;
        // Only explicit direct children created by this fixture; no recursive
        // delete, path discovery or unknown-subtree cleanup. A file symlink is
        // deleted as the exact owned entry, never traversed to its target.
        string cwd = Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('\\');
        if (Path.GetDirectoryName(root) != cwd || !Path.GetFileName(root).StartsWith("owned-seed-fixtures-", StringComparison.Ordinal))
            throw new InvalidOperationException("FIXTURE_CLEANUP_ROOT_UNPROVEN");
        foreach (string directory in owned)
        {
            if (Path.GetDirectoryName(directory) != root || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("FIXTURE_CLEANUP_CHILD_UNPROVEN");
            foreach (string file in Directory.GetFiles(directory))
            {
                if (Path.GetDirectoryName(file) != directory || !new[] { "witness.seed", "operator.seed", "existing.txt", "sentinel.txt", "added-link.seed", "seed-pair.ndjson" }.Contains(Path.GetFileName(file)))
                    throw new InvalidOperationException("FIXTURE_CLEANUP_FILE_UNPROVEN");
                File.Delete(file);
            }
            Directory.Delete(directory, false);
        }
        Directory.Delete(root, false);
    }
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateDirectoryW(string path, IntPtr attributes);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateDirectoryWithSecurity(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateHardLinkW(string name, string existing, IntPtr attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] private static extern bool CreateSymbolicLinkW(string name, string target, uint flags);
}
