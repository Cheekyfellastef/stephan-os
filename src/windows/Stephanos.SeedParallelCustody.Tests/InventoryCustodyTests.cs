using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text;
using Stephanos.SeedParallelCustody;

internal static class InventoryCustodyTests
{
    internal static int Run(string root)
    {
        int passed = 0;
        string inputs = Path.Combine(root, "inventory-inputs");
        string outputs = Path.Combine(root, "inventory-outputs");
        Directory.CreateDirectory(inputs);
        Directory.CreateDirectory(outputs);
        string manifest = Path.Combine(inputs, "manifest.json");
        string seeds = Path.Combine(inputs, "seeds.mjs");
        const string manifestText = "{\"taskId\":\"fixture-only\"}\n";
        const string seedText = "export const seeds = ['fixture'];\n";
        byte[] expected = Encoding.UTF8.GetBytes("# Exact inventory fixture\n");
        File.WriteAllText(manifest, manifestText, new UTF8Encoding(false));
        File.WriteAllText(seeds, seedText, new UTF8Encoding(false));
        var manifestInput = new SeedInventoryInput(manifest, Hash(Encoding.UTF8.GetBytes(manifestText)));
        var seedInput = new SeedInventoryInput(seeds, Hash(Encoding.UTF8.GetBytes(seedText)));
        SeedInventoryCustodySession Acquire(string name, byte[]? bytes = null)
            => SeedInventoryCustodySession.Acquire(manifestInput, seedInput,
                Path.Combine(outputs, name), bytes ?? expected, Hash(expected));
        void Test(string name, Action body)
        {
            body();
            passed++;
            Console.WriteLine("SEED_INVENTORY_SESSION_TEST_PASS=" + name);
        }

        Test("inputs-and-separate-output-parent-retained-before-create", () =>
        {
            string path = Path.Combine(outputs, "held.md");
            using (var session = Acquire("held.md"))
            {
                Assert(!File.Exists(path), "ACQUIRE_CREATED_OUTPUT");
                Assert(!session.SourceOwnershipAuthenticated && !session.CompleteOperationCustodyProven
                    && !session.LeaseReleaseAuthorized && !session.ProductionWorkerCommissioned,
                    "AUTHORITY_EXPANDED");
                Assert(Read(session, SeedInventoryInputKind.Manifest) == manifestText, "MANIFEST_BYTES");
                Assert(Read(session, SeedInventoryInputKind.CanonicalSeedContract) == seedText, "SEED_BYTES");
                Denied(() => File.WriteAllText(manifest, "replacement"));
                Denied(() => File.Delete(seeds));
                Denied(() => Directory.Move(inputs, inputs + "-moved"));
                Denied(() => Directory.Move(outputs, outputs + "-moved"));
                Held(session.VerifyOutput);
                session.CreateOutput();
                session.VerifyOutput();
                Denied(() => File.WriteAllBytes(path, new byte[] { 1 }));
                Denied(() => File.Delete(path));
                Denied(() => File.Move(path, path + ".moved"));
                Denied(() => File.WriteAllText(manifest, "replacement"));
                Held(session.CreateOutput);
                session.VerifyOutput();
            }
            Assert(File.ReadAllBytes(path).SequenceEqual(expected), "ARTIFACT_NOT_EXACT");
            Directory.Move(outputs, outputs + "-released");
            Directory.Move(outputs + "-released", outputs);
        });

        Test("prepared-proposal-uses-private-copy", () =>
        {
            byte[] candidate = (byte[])expected.Clone();
            using (var session = Acquire("copied.md", candidate))
            {
                Array.Fill(candidate, (byte)'x');
                session.CreateOutput();
                session.VerifyOutput();
            }
            Assert(File.ReadAllBytes(Path.Combine(outputs, "copied.md")).SequenceEqual(expected), "CALLER_BUFFER_CHANGED_OUTPUT");
        });

        Test("caller-read-buffer-cannot-change-snapshot", () =>
        {
            using var session = Acquire("snapshot.md");
            byte[] bytes = new byte[(int)session.InputLength(SeedInventoryInputKind.Manifest)];
            _ = session.ReadInput(SeedInventoryInputKind.Manifest, 0, bytes);
            Array.Fill(bytes, (byte)'x');
            Assert(Read(session, SeedInventoryInputKind.Manifest) == manifestText, "SNAPSHOT_BUFFER_EXPORTED");
            Held(() => session.InputLength((SeedInventoryInputKind)42));
            session.CreateOutput();
            session.VerifyOutput();
        });

        Test("later-input-failure-releases-earlier-input-and-target-parents", () =>
        {
            string path = Path.Combine(outputs, "bad-input.md");
            Held(() => SeedInventoryCustodySession.Acquire(manifestInput,
                seedInput with { Sha256 = new string('0', 64) }, path, expected, Hash(expected)).Dispose());
            Assert(!File.Exists(path), "FAILED_INPUT_CREATED_OUTPUT");
            using (var write = new FileStream(manifest, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                Assert(write.Length > 0, "EARLIER_INPUT_NOT_RELEASED");
            Directory.Move(outputs, outputs + "-released");
            Directory.Move(outputs + "-released", outputs);
        });

        Test("raced-leaf-preserved-and-failed-session-terminal", () =>
        {
            string path = Path.Combine(outputs, "raced.md");
            using var session = Acquire("raced.md");
            File.WriteAllText(path, "incumbent", new UTF8Encoding(false));
            Held(session.CreateOutput);
            Assert(File.ReadAllText(path) == "incumbent", "INCUMBENT_OVERWRITTEN");
            File.Delete(path); // only this test's newly created competing artifact
            Held(session.CreateOutput);
            Held(() => session.InputLength(SeedInventoryInputKind.Manifest));
            Assert(!File.Exists(path), "FAILED_SESSION_RETRIED");
            Directory.Move(outputs, outputs + "-released");
            Directory.Move(outputs + "-released", outputs);
        });

        Test("case-folded-input-and-output-collisions-denied", () =>
        {
            Held(() => SeedInventoryCustodySession.Acquire(manifestInput,
                manifestInput with { Path = manifest.ToUpperInvariant() },
                Path.Combine(outputs, "duplicate.md"), expected, Hash(expected)).Dispose());
            Held(() => SeedInventoryCustodySession.Acquire(manifestInput, seedInput,
                manifest.ToUpperInvariant(), expected, Hash(expected)).Dispose());
            Assert(File.ReadAllText(manifest) == manifestText, "COLLISION_MUTATED_INPUT");
            Assert(!File.Exists(Path.Combine(outputs, "duplicate.md")), "COLLISION_CREATED_OUTPUT");
        });

        Test("bounded-input-expectations-and-size-denied", () =>
        {
            foreach (long size in new[] { -1L, SeedInventoryCustodySession.MaximumInputBytes + 1 })
                Held(() => SeedInventoryCustodySession.Acquire(manifestInput with { MaximumBytes = size },
                    seedInput, Path.Combine(outputs, "bound.md"), expected, Hash(expected)).Dispose());
            Held(() => SeedInventoryCustodySession.Acquire(manifestInput with { MaximumBytes = 1 },
                seedInput, Path.Combine(outputs, "bound.md"), expected, Hash(expected)).Dispose());
            Assert(!File.Exists(Path.Combine(outputs, "bound.md")), "BOUND_FAILURE_CREATED_OUTPUT");
        });

        Test("pre-existing-input-writer-denies-acquisition", () =>
        {
            using var writer = new FileStream(manifest, FileMode.Open, FileAccess.ReadWrite,
                FileShare.ReadWrite | FileShare.Delete);
            Held(() => Acquire("writer.md").Dispose());
            Assert(!File.Exists(Path.Combine(outputs, "writer.md")), "WRITER_CONFLICT_CREATED_OUTPUT");
        });

        Test("pre-existing-mapping-held-or-immutable-snapshot", () =>
        {
            string mapped = Path.Combine(inputs, "mapped.txt");
            File.WriteAllText(mapped, "approved", new UTF8Encoding(false));
            using var mappingSource = new FileStream(mapped, FileMode.Open, FileAccess.ReadWrite,
                FileShare.ReadWrite | FileShare.Delete);
            using var mapping = MemoryMappedFile.CreateFromFile(mappingSource, null, 0,
                MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, leaveOpen: true);
            using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Write);
            // Release the original writable file handle before acquisition so
            // this exercises the surviving mapping, not merely an open writer.
            mappingSource.Dispose();
            SeedInventoryCustodySession session;
            try
            {
                session = SeedInventoryCustodySession.Acquire(
                    new SeedInventoryInput(mapped, Hash(Encoding.UTF8.GetBytes("approved"))),
                    seedInput, Path.Combine(outputs, "mapped.md"), expected, Hash(expected));
            }
            catch (SeedWriterHeldException error) when (error.Code == "SEED_INVENTORY_INPUT_CUSTODY_DENIED"
                && error.Data["InputBlocker"] as string == "ISLAND_CUSTODY_OPEN_DENIED")
            {
                Assert(!File.Exists(Path.Combine(outputs, "mapped.md")), "MAPPED_HOLD_CREATED_OUTPUT");
                Console.WriteLine("SEED_INVENTORY_MAPPING_OUTCOME=OS_SHARE_DENIED");
                return;
            }
            using (session)
            {
                view.WriteArray(0, Encoding.UTF8.GetBytes("attacker"), 0, 8);
                view.Flush();
                Assert(Read(session, SeedInventoryInputKind.Manifest) == "approved", "MAPPING_CHANGED_PRIVATE_SNAPSHOT");
                Console.WriteLine("SEED_INVENTORY_MAPPING_OUTCOME=PRIVATE_SNAPSHOT_RETAINED");
                session.CreateOutput();
                session.VerifyOutput();
            }
        });

        Test("concurrent-create-remains-one-shot", () =>
        {
            using var session = Acquire("concurrent.md");
            int success = 0, held = 0;
            Task.WaitAll(Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
            {
                try { session.CreateOutput(); Interlocked.Increment(ref success); }
                catch (SeedWriterHeldException) { Interlocked.Increment(ref held); }
            })).ToArray());
            Assert(success == 1 && held == 1, "CONCURRENT_CREATE_NOT_SINGLE_SHOT");
            session.VerifyOutput();
        });

        Test("create-dispose-race-is-serialized", () =>
        {
            string path = Path.Combine(outputs, "dispose-race.md");
            var session = Acquire("dispose-race.md");
            int created = 0;
            Task.WaitAll(Task.Run(() =>
            {
                try { session.CreateOutput(); Interlocked.Exchange(ref created, 1); }
                catch (SeedWriterHeldException error) when (error.Code == "SEED_INVENTORY_SESSION_CLOSED") { }
            }), Task.Run(session.Dispose));
            session.Dispose();
            Assert(created == 0 ? !File.Exists(path) : File.ReadAllBytes(path).SequenceEqual(expected),
                "DISPOSE_RACE_PARTIAL_OR_UNEXPECTED_ARTIFACT");
            Held(session.CreateOutput);
            Directory.Move(outputs, outputs + "-released");
            Directory.Move(outputs + "-released", outputs);
        });

        Test("uncreated-disposal-releases-without-output", () =>
        {
            var session = Acquire("uncreated.md");
            session.Dispose();
            session.Dispose();
            Held(session.CreateOutput);
            Held(() => session.InputLength(SeedInventoryInputKind.Manifest));
            Assert(!File.Exists(Path.Combine(outputs, "uncreated.md")), "DISPOSAL_CREATED_OUTPUT");
            Directory.Move(inputs, inputs + "-released");
            Directory.Move(inputs + "-released", inputs);
        });

        return passed;
    }

    private static string Read(SeedInventoryCustodySession session, SeedInventoryInputKind kind)
    {
        byte[] bytes = new byte[(int)session.InputLength(kind)];
        Assert(session.ReadInput(kind, 0, bytes) == bytes.Length, "SHORT_SNAPSHOT_READ");
        return Encoding.UTF8.GetString(bytes);
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Assert(bool pass, string label)
    { if (!pass) throw new Exception("SEED_INVENTORY_TEST_FAILED_" + label); }
    private static void Held(Action action)
    {
        try { action(); }
        catch (SeedWriterHeldException) { return; }
        throw new Exception("SEED_INVENTORY_EXPECTED_HOLD");
    }
    private static void Denied(Action action)
    {
        try { action(); }
        catch (IOException) { return; }
        catch (UnauthorizedAccessException) { return; }
        throw new Exception("SEED_INVENTORY_EXPECTED_OS_DENIAL");
    }
}
