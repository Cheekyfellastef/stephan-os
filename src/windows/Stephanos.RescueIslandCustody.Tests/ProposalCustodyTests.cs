using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text;
using Stephanos.RescueIslandCustody;

internal static class ProposalCustodyTests
{
    internal static void Run(string fixtureRoot, Action<string, Action> run)
    {
        string root = Path.Combine(fixtureRoot, "proposal-scope");
        Directory.CreateDirectory(root);

        run("proposal scope retains all native inputs and its one approved output until disposal", () =>
        {
            string first = NewFile("held-a.txt", "first"), second = NewFile("held-b.txt", "second");
            string target = Path.Combine(root, "held-proposal.md");
            using (var scope = Acquire(target, Input(first, "first"), Input(second, "second")))
            {
                if (scope.DependencyCount != 2 || scope.OutputCreated) Fail("INITIAL_SCOPE_INVALID");
                Equal("first", ReadInput(scope, 0)); Equal("second", ReadInput(scope, 1));
                Blocked(() => scope.ReadOutput(0, new byte[8]), "ISLAND_PROPOSAL_OUTPUT_NOT_CREATED");
                Denied(() => File.WriteAllText(first, "mutated"));
                Denied(() => File.Delete(second));
                scope.CreateOutput();
                if (!scope.OutputCreated) Fail("OUTPUT_NOT_RETAINED");
                Denied(() => File.WriteAllText(target, "mutated"));
                Denied(() => File.Delete(target));
                Denied(() => Directory.Move(root, root + "-moved"));
                Equal("approved", ReadOutput(scope));
                Blocked(scope.CreateOutput, "ISLAND_PROPOSAL_OUTPUT_ALREADY_ATTEMPTED");
            }
            File.WriteAllText(first, "released"); File.Delete(second);
            Equal("approved", File.ReadAllText(target)); File.Delete(target);
        });

        run("later bad dependency releases earlier native custody without creating any output", () =>
        {
            string first = NewFile("rollback-a.txt", "first"), second = NewFile("rollback-b.txt", "wrong");
            string target = Path.Combine(root, "rollback-proposal.md");
            Blocked(() => { using var scope = Acquire(target, Input(first, "first"), Input(second, "expected")); },
                "ISLAND_CUSTODY_DIGEST_MISMATCH");
            if (File.Exists(target)) Fail("PARTIAL_ACQUISITION_CREATED_OUTPUT");
            File.WriteAllText(first, "released"); File.Delete(first); File.Delete(second);
        });

        run("a separate output parent and ancestor are retained before any proposal leaf exists", () =>
        {
            string source = NewFile("prepared-parent-source.txt", "source");
            string estate = Path.Combine(root, "prepared-output-estate");
            string parent = Path.Combine(estate, "parent");
            Directory.CreateDirectory(parent);
            string target = Path.Combine(parent, "proposal.md");
            using (var scope = Acquire(target, Input(source, "source")))
            {
                if (scope.OutputCreated || File.Exists(target)) Fail("PREPARATION_CREATED_OUTPUT");
                // The source is outside both output directories: its snapshot
                // cannot accidentally supply the parent custody under test.
                Denied(() => Directory.Move(parent, parent + "-replaced"));
                Denied(() => Directory.Delete(parent));
                Denied(() => Directory.Move(estate, estate + "-replaced"));
                scope.CreateOutput();
                Equal("approved", ReadOutput(scope));
            }
            Equal("approved", File.ReadAllText(target));
            Directory.Move(parent, parent + "-released");
            Directory.Move(estate, estate + "-released");
        });

        run("failed input acquisition releases the independently prepared output parent estate", () =>
        {
            string first = NewFile("prepared-rollback-a.txt", "first");
            string second = NewFile("prepared-rollback-b.txt", "wrong");
            string estate = Path.Combine(root, "prepared-rollback-estate");
            string parent = Path.Combine(estate, "parent");
            Directory.CreateDirectory(parent);
            string target = Path.Combine(parent, "proposal.md");
            Blocked(() => { using var scope = Acquire(target, Input(first, "first"), Input(second, "expected")); },
                "ISLAND_CUSTODY_DIGEST_MISMATCH");
            if (File.Exists(target)) Fail("FAILED_PREPARATION_CREATED_OUTPUT");
            File.WriteAllText(first, "released"); File.Delete(first); File.Delete(second);
            Directory.Delete(parent);
            Directory.Move(estate, estate + "-released");
        });

        run("disposal before output creation releases parent custody without creating a leaf", () =>
        {
            string source = NewFile("prepared-dispose-source.txt", "source");
            string parent = Path.Combine(root, "prepared-dispose-parent");
            Directory.CreateDirectory(parent);
            string target = Path.Combine(parent, "proposal.md");
            var scope = Acquire(target, Input(source, "source"));
            scope.Dispose(); scope.Dispose();
            Disposed(scope.CreateOutput);
            if (File.Exists(target)) Fail("DISPOSED_PREPARATION_CREATED_OUTPUT");
            File.WriteAllText(source, "released");
            Directory.Delete(parent);
        });

        run("duplicate inputs, input-output aliases and over-budget manifests fail before acquisition", () =>
        {
            string source = NewFile("collision.txt", "source");
            string target = Path.Combine(root, "collision-proposal.md");
            var input = Input(source, "source");
            Blocked(() => { using var scope = Acquire(target, input, input); }, "ISLAND_PROPOSAL_PATH_COLLISION");
            Blocked(() => { using var scope = Acquire(source.ToUpperInvariant(), input); }, "ISLAND_PROPOSAL_PATH_COLLISION");
            Blocked(() => { using var scope = Acquire(target, input, input with { Path = source.ToUpperInvariant() }); },
                "ISLAND_PROPOSAL_PATH_COLLISION");
            Blocked(() => { using var scope = Acquire(target, Array.Empty<ProposalDependency>()); }, "ISLAND_PROPOSAL_EXPECTATION_INVALID");
            Blocked(() => { using var scope = Acquire(target, Enumerable.Repeat(input, 33).ToArray()); }, "ISLAND_PROPOSAL_EXPECTATION_INVALID");
            Blocked(() => { using var scope = Acquire(target,
                input with { MaxBytes = 64 * 1024 * 1024 },
                new ProposalDependency(Path.Combine(root, "never-opened.txt"), Hash(""), 1)); },
                "ISLAND_PROPOSAL_INPUT_BUDGET_EXCEEDED");
            if (File.Exists(target)) Fail("INVALID_MANIFEST_CREATED_OUTPUT");
            File.Delete(source);
        });

        run("caller mutation cannot retarget acquired dependencies or alter approved output bytes", () =>
        {
            string source = NewFile("copied.txt", "source");
            string target = Path.Combine(root, "copied-proposal.md");
            var dependencies = new[] { Input(source, "source") };
            byte[] bytes = Encoding.UTF8.GetBytes("approved");
            using (var scope = PinnedProposalCustody.Acquire(dependencies, target, bytes, Hash("approved")))
            {
                dependencies[0] = new ProposalDependency(Path.Combine(root, "forged.txt"), Hash("forged"), 8);
                bytes[0] = (byte)'X';
                byte[] copied = new byte[6]; scope.ReadDependency(0, 0, copied); copied[0] = (byte)'X';
                Equal("source", ReadInput(scope, 0));
                scope.CreateOutput(); Equal("approved", ReadOutput(scope));
            }
            Equal("approved", File.ReadAllText(target));
            if (File.Exists(dependencies[0].Path)) Fail("CALLER_RETARGET_ADMITTED");
        });

        run("a failed output attempt preserves an incumbent and cannot be replayed after its removal", () =>
        {
            string source = NewFile("incumbent-source.txt", "source");
            string target = NewFile("incumbent-proposal.md", "incumbent");
            using var scope = Acquire(target, Input(source, "source"));
            Blocked(scope.CreateOutput, "ISLAND_CUSTODY_CREATE_DENIED");
            Equal("incumbent", File.ReadAllText(target));
            File.Delete(target);
            Blocked(scope.CreateOutput, "ISLAND_PROPOSAL_OUTPUT_ALREADY_ATTEMPTED");
            if (scope.OutputCreated || File.Exists(target)) Fail("FAILED_OUTPUT_REPLAYED");
            Denied(() => File.WriteAllText(source, "mutated"));
        });

        run("pre-existing mapped mutation never changes a proposal dependency snapshot", () =>
        {
            string source = NewFile("mapped-proposal-source.txt", "original");
            string target = Path.Combine(root, "mapped-proposal.md");
            using var mapping = MemoryMappedFile.CreateFromFile(source, FileMode.Open, null, 0, MemoryMappedFileAccess.ReadWrite);
            using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Write);
            PinnedProposalCustody scope;
            try { scope = Acquire(target, Input(source, "original")); }
            catch (CustodyException e) when (e.Blocker == "ISLAND_CUSTODY_OPEN_DENIED")
            {
                if (File.Exists(target)) Fail("DENIED_MAPPING_CREATED_OUTPUT");
                return;
            }
            using (scope)
            {
                view.WriteArray(0, Encoding.UTF8.GetBytes("attacker"), 0, 8); view.Flush();
                Equal("original", ReadInput(scope, 0));
                scope.CreateOutput(); Equal("approved", ReadOutput(scope));
            }
        });

        run("concurrent proposal output calls admit exactly one attempt and disposal releases every handle", () =>
        {
            string source = NewFile("concurrent-source.txt", "source");
            string target = Path.Combine(root, "concurrent-proposal.md");
            var scope = Acquire(target, Input(source, "source"));
            try
            {
                using var start = new Barrier(2);
                Task<int> Attempt() => Task.Run(() =>
                {
                    if (!start.SignalAndWait(TimeSpan.FromSeconds(10))) Fail("CONCURRENT_PROPOSAL_SETUP_TIMEOUT");
                    try { scope.CreateOutput(); return 1; }
                    catch (CustodyException e) when (e.Blocker == "ISLAND_PROPOSAL_OUTPUT_ALREADY_ATTEMPTED") { return 0; }
                });
                var first = Attempt(); var second = Attempt(); Task.WaitAll(first, second);
                if (first.Result + second.Result != 1) Fail("MULTIPLE_OUTPUT_ATTEMPTS_ADMITTED");
                Equal("approved", ReadOutput(scope));
            }
            finally { scope.Dispose(); scope.Dispose(); }
            Disposed(scope.CreateOutput);
            Disposed(() => scope.ReadDependency(0, 0, new byte[8]));
            Disposed(() => scope.ReadOutput(0, new byte[8]));
            File.WriteAllText(source, "released"); File.WriteAllText(target, "released");
        });

        run("output parent substitution after input acquisition cannot redirect a proposal write", () =>
        {
            string source = NewFile("redirect-source.txt", "source");
            string parent = Path.Combine(root, "redirect-parent"), outside = Path.Combine(root, "redirect-outside");
            Directory.CreateDirectory(parent); Directory.CreateDirectory(outside);
            string target = Path.Combine(parent, "proposal.md");
            using var scope = Acquire(target, Input(source, "source"));
            using var setter = Native.OpenWritableDirectory(parent);
            if (setter.IsInvalid) Fail("PROPOSAL_JUNCTION_SETUP_FAILED");
            Native.SetJunction(setter, outside);
            try
            {
                Blocked(scope.CreateOutput, "ISLAND_CUSTODY_REPARSE_OR_TYPE_INVALID");
                if (File.Exists(Path.Combine(outside, "proposal.md"))) Fail("PROPOSAL_WRITE_REDIRECTED");
                Blocked(scope.CreateOutput, "ISLAND_PROPOSAL_OUTPUT_ALREADY_ATTEMPTED");
            }
            finally { Native.RemoveJunction(setter); }
        });

        run("racing output creation and disposal cannot release parents during a native write", () =>
        {
            for (int attempt = 0; attempt < 12; attempt++)
            {
                string source = NewFile($"prepared-race-source-{attempt}.txt", "source");
                string parent = Path.Combine(root, $"prepared-race-parent-{attempt}");
                Directory.CreateDirectory(parent);
                string target = Path.Combine(parent, "proposal.md");
                var scope = Acquire(target, Input(source, "source"));
                using var start = new Barrier(2);
                var creator = Task.Run(() =>
                {
                    if (!start.SignalAndWait(TimeSpan.FromSeconds(10))) Fail("CREATE_DISPOSE_SETUP_TIMEOUT");
                    try { scope.CreateOutput(); return true; }
                    catch (ObjectDisposedException) { return false; }
                });
                var disposer = Task.Run(() =>
                {
                    if (!start.SignalAndWait(TimeSpan.FromSeconds(10))) Fail("CREATE_DISPOSE_SETUP_TIMEOUT");
                    scope.Dispose();
                });
                try { Task.WaitAll(creator, disposer); }
                finally { scope.Dispose(); }
                if (creator.Result) Equal("approved", File.ReadAllText(target));
                else if (File.Exists(target)) Fail("DISPOSAL_LOST_CREATE_RACE");
                File.WriteAllText(source, "released");
                Directory.Move(parent, parent + "-released");
            }
        });

        string NewFile(string name, string content)
        {
            string path = Path.Combine(root, name); File.WriteAllText(path, content); return path;
        }
    }

    private static ProposalDependency Input(string path, string text)
        => new(path, Hash(text), Encoding.UTF8.GetByteCount(text));
    private static PinnedProposalCustody Acquire(string target, params ProposalDependency[] inputs)
        => PinnedProposalCustody.Acquire(inputs, target, Encoding.UTF8.GetBytes("approved"), Hash("approved"));
    private static string Hash(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    private static string ReadInput(PinnedProposalCustody scope, int index)
    {
        byte[] bytes = new byte[checked((int)scope.GetDependencyLength(index))];
        if (scope.ReadDependency(index, 0, bytes) != bytes.Length) Fail("SHORT_PROPOSAL_INPUT_READ");
        return Encoding.UTF8.GetString(bytes);
    }
    private static string ReadOutput(PinnedProposalCustody scope)
    {
        byte[] bytes = new byte[8];
        if (scope.ReadOutput(0, bytes) != bytes.Length) Fail("SHORT_PROPOSAL_OUTPUT_READ");
        return Encoding.UTF8.GetString(bytes);
    }
    private static void Equal(string expected, string actual) { if (actual != expected) Fail("PROPOSAL_BYTES_CHANGED"); }
    private static void Fail(string message) => throw new Exception(message);
    private static void Denied(Action action)
    {
        try { action(); } catch (IOException) { return; } catch (UnauthorizedAccessException) { return; }
        Fail("PROPOSAL_MUTATION_WAS_NOT_DENIED");
    }
    private static void Blocked(Action action, string blocker)
    {
        try { action(); } catch (CustodyException e) when (e.Blocker == blocker) { return; }
        Fail("EXPECTED_PROPOSAL_BLOCKER_MISSING:" + blocker);
    }
    private static void Disposed(Action action)
    {
        try { action(); } catch (ObjectDisposedException) { return; }
        Fail("DISPOSED_PROPOSAL_SCOPE_ADMITTED");
    }
}
