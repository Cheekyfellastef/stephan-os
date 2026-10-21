using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
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
                if (Path.GetDirectoryName(file) != directory || !new[] { "witness.seed", "operator.seed", "existing.txt", "sentinel.txt", "added-link.seed" }.Contains(Path.GetFileName(file)))
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
