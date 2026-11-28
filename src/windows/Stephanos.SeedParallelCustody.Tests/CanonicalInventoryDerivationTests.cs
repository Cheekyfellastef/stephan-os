using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Stephanos.SeedParallelCustody;

internal static class CanonicalInventoryDerivationTests
{
    private const string BaseSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static readonly UTF8Encoding Utf8 = new(false, true);

    internal static (int Scenarios, int GoldenCases) Run(string root)
    {
        byte[] projection = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,
            "fixtures", "seedCanopyCanonicalInventoryV1.json"));
        using var vectors = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,
            "fixtures", "seedCanopyCanonicalInventoryV1.vectors.json")));
        Assert(vectors.RootElement.GetProperty("schemaVersion").GetString()
            == "stephanos.seed-canopy-canonical-inventory-vectors.v1", "FIXTURE_SCHEMA");
        JsonElement cases = vectors.RootElement.GetProperty("cases");
        using var inventory = JsonDocument.Parse(projection);
        JsonElement seeds = inventory.RootElement.GetProperty("seeds");
        VerifyVectorCoverage(cases, seeds);
        byte[] manifest = Utf8.GetBytes(cases[0].GetProperty("manifest").GetRawText());
        string target = cases[0].GetProperty("manifest").GetProperty("targetPath").GetString()!;
        byte[] expected = Utf8.GetBytes(cases[0].GetProperty("expectedContent").GetString()!);
        string fixtures = Path.Combine(root, "derivation");
        Directory.CreateDirectory(fixtures);
        int number = 0, passed = 0, golden = 0;
        Fixture Make(byte[]? request = null, byte[]? canonical = null) => new(
            Path.Combine(fixtures, "c" + (++number).ToString(CultureInfo.InvariantCulture)),
            request ?? manifest, canonical ?? projection, target);
        void Test(string name, Action body)
        {
            body();
            passed++;
            Console.WriteLine("SEED_NATIVE_DERIVATION_TEST_PASS=" + name);
        }
        void Reject(byte[]? request = null, byte[]? canonical = null,
            string? expectedBase = null, string? expectedTarget = null, string? expectedBlob = null,
            string? expectedCode = null)
        {
            var fixture = Make(request, canonical);
            Held(() => fixture.Acquire(expectedBase, expectedTarget, expectedBlob).Dispose(), expectedCode);
            Assert(!Directory.EnumerateFiles(fixture.Workspace, "*", SearchOption.AllDirectories).Any(),
                "REJECTION_CREATED_OUTPUT");
            fixture.AssertReleased();
        }

        Test("vector-coverage-rejects-forged-cardinality-order-and-identities", () =>
        {
            void RejectCoverage(Action<JsonArray> mutate)
            {
                JsonArray altered = JsonNode.Parse(cases.GetRawText())!.AsArray();
                mutate(altered);
                using var changed = JsonDocument.Parse(altered.ToJsonString());
                bool rejected = false;
                try { VerifyVectorCoverage(changed.RootElement, seeds); }
                catch (Exception error) when (error.Message.StartsWith(
                    "SEED_DERIVATION_TEST_FAILED_", StringComparison.Ordinal))
                { rejected = true; }
                Assert(rejected, "MUTATED_VECTOR_COVERAGE_ACCEPTED");
            }
            RejectCoverage(items => items.RemoveAt(0));
            RejectCoverage(items => items.RemoveAt(items.Count - 1));
            RejectCoverage(items => items.Add(items[0]!.DeepClone()));
            RejectCoverage(items =>
            {
                JsonNode first = items[0]!.DeepClone();
                items[0] = items[1]!.DeepClone();
                items[1] = first;
            });
            RejectCoverage(items => items[0]!["name"] = "canonical:forged-seed");
            RejectCoverage(items => items[0]!["manifest"]!["seedId"] = "forged-seed");
            RejectCoverage(items => items[seeds.GetArrayLength()]!["name"] = "unreviewed-vector");
        });

        Test("every-canonical-seed-and-seven-hostile-renderer-vectors-have-identical-output-bytes", () =>
        {
            foreach (var item in cases.EnumerateArray())
            {
                byte[] request = Utf8.GetBytes(item.GetProperty("manifest").GetRawText());
                string expectedTarget = item.GetProperty("manifest").GetProperty("targetPath").GetString()!;
                byte[] content = Utf8.GetBytes(item.GetProperty("expectedContent").GetString()!);
                var fixture = Make(request);
                string output = Path.Combine(fixture.Workspace, expectedTarget.Replace('/', Path.DirectorySeparatorChar));
                using (var session = fixture.Acquire(expectedTarget: expectedTarget))
                {
                    Assert(!File.Exists(output) && session.OutputDerivedFromPinnedInputs, "DERIVATION_PHASE");
                    AssertHeldAuthority(session);
                    session.CreateOutput();
                    session.VerifyOutput();
                }
                Assert(File.ReadAllBytes(output).SequenceEqual(content), "GOLDEN_BYTES_" + item.GetProperty("name").GetString());
                golden++;
            }
        });

        Test("fixed-derived-operation-retains-inputs-and-output-parents-through-create", () =>
        {
            var fixture = Make();
            using (var session = fixture.Acquire())
            {
                AssertHeldAuthority(session);
                Denied(() => File.WriteAllText(fixture.ManifestPath, "replacement"));
                Denied(() => File.Delete(fixture.ProjectionPath));
                Denied(() => Directory.Move(fixture.OutputParent, fixture.OutputParent + "-moved"));
                byte[] copy = new byte[(int)session.InputLength(SeedInventoryInputKind.Manifest)];
                Assert(session.ReadInput(SeedInventoryInputKind.Manifest, 0, copy) == copy.Length, "SNAPSHOT_READ");
                Array.Fill(copy, (byte)'x');
                Held(session.VerifyOutput);
                session.CreateOutput();
                session.VerifyOutput();
                Denied(() => File.WriteAllText(fixture.OutputPath, "replacement"));
                Denied(() => File.Delete(fixture.OutputPath));
                Denied(() => File.Move(fixture.OutputPath, fixture.OutputPath + ".moved"));
                Held(session.CreateOutput);
                session.VerifyOutput();
            }
            Assert(File.ReadAllBytes(fixture.OutputPath).SequenceEqual(expected), "DERIVED_BYTES_CHANGED");
            fixture.AssertReleased();
        });

        Test("exact-base-target-and-git-blob-expectations-are-required", () =>
        {
            Reject(expectedBase: new string('b', 40));
            Reject(expectedBase: BaseSha + "\n");
            Reject(expectedBlob: new string('0', 40));
            Reject(expectedBlob: GitBlob(projection).ToUpperInvariant());
            Reject(expectedTarget: "docs/architecture/different-approved-target.md");
            Reject(canonical: Change(projection, value => value["seeds"]![0]!["title"] = "Changed canonical title"),
                expectedBlob: GitBlob(projection));
        });

        Test("manifest-schema-types-duplicates-and-hidden-overrides-fail-without-a-leaf", () =>
        {
            Reject(Utf8.GetBytes("[1,2,3]"));
            Reject(Utf8.GetBytes("{\"baseSha\":\"" + BaseSha + "\"," + Utf8.GetString(manifest)[1..]));
            Reject(Change(manifest, value => value.Remove("ownerIssue")));
            Reject(Change(manifest, value => value["schemaVersion"] = "future.schema"));
            Reject(Change(manifest, value => value["ownerIssue"] = 3096));
            Reject(Change(manifest, value => value["intent"] = true));
            Reject(Change(manifest, value => value["command"] = "hidden-execution-override"));
            Reject(Change(manifest, value => value["model"] = "hidden-model-override"));
        });

        Test("manifest-ownership-authority-generation-and-new-document-profile-fail-closed", () =>
        {
            foreach (var field in new[] { "mergeAllowed", "deployAllowed", "runtimeMutationAllowed" })
            {
                Reject(Change(manifest, value => value[field] = true));
                Reject(Change(manifest, value => value[field] = null));
            }
            foreach (var pair in new[] { ("seedId", "unknown-seed"), ("ownerIssue", "#999999"),
                ("contractSource", "shared/runtime/other.mjs"), ("generationMode", "MODEL_AUTHORING_V1"),
                ("reviewAuthority", "SELF_APPROVED"), ("sourceScopeApproval", "ANY_TARGET"),
                ("expectedTargetSha256", new string('0', 64)), ("taskId", "padded-task "),
                ("taskId", "valid-task\n"), ("intent", "\uFEFF \t\n"),
                ("intent", new string('a', 2401)), ("intent", "embedded\0text") })
                Reject(Change(manifest, value => value[pair.Item1] = pair.Item2));
        });

        Test("target-and-test-paths-cannot-escape-or-widen-scope", () =>
        {
            foreach (string path in new[] { "../escape.md", "docs/architecture/../escape.md",
                "docs/architecture/security-bypass.md", "docs/architecture/file.md:alternate",
                "docs/architecture/file.md\n", "docs\\architecture\\file.md" })
                Reject(Change(manifest, value => value["targetPath"] = path), expectedTarget: path);
            foreach (var paths in new[] { Array.Empty<string>(), new[] { "../test.mjs" },
                new[] { "scripts/arbitrary.test.mjs" }, new[] { "tests/x.test.mjs", "tests/x.test.mjs" },
                Enumerable.Range(0, 6).Select(i => "tests/x" + i + ".test.mjs").ToArray() })
                Reject(Change(manifest, value => value["testPaths"] = new JsonArray(
                    paths.Select(path => (JsonNode?)JsonValue.Create(path)).ToArray())));
            Reject(Change(manifest, value => value["testPaths"] = "tests/x.test.mjs"));
        });

        Test("all-canonical-records-are-validated-with-unambiguous-identities", () =>
        {
            Reject(canonical: Change(projection, value => value["schemaVersion"] = "future.schema"));
            Reject(canonical: Change(projection, value => value["seeds"] = new JsonArray()));
            Reject(canonical: Change(projection, value => ((JsonArray)value["seeds"]!).Add(value["seeds"]![0]!.DeepClone())));
            Reject(canonical: Change(projection, value => value["seeds"]![1]!["extra"] = false));
            foreach (var pair in new[] { ("seedId", "valid-seed\n"), ("seedId", "valid-seed\u2028"),
                ("issue", "#123\n"), ("issue", "#123\u2029"), ("firstRung", "VALID_RUNG\n"),
                ("firstRung", "VALID_RUNG\r"), ("firstRung", "VALID_RUNG\u2028"),
                ("firstRung", "VALID_RUNG\u2029"), ("title", "\uFEFF \t"), ("title", "embedded\0title"),
                ("title", new string('x', 2401)), ("source", " shared/runtime/source.mjs"),
                ("source", "shared/runtime/source.mjs\uFEFF"), ("source", "../source.mjs") })
                Reject(canonical: Change(projection, value => value["seeds"]![1]![pair.Item1] = pair.Item2));
            Reject(canonical: Change(projection, value => value["seeds"]![1]!["issue"] = 123));
            Reject(canonical: Utf8.GetBytes("{\"schemaVersion\":\"duplicate\"," + Utf8.GetString(projection)[1..]));
            Reject(canonical: Change(projection, value =>
            {
                var seeds = (JsonArray)value["seeds"]!;
                while (seeds.Count < 65)
                {
                    var extra = seeds[0]!.DeepClone();
                    extra["seedId"] = "native-extra-seed-" + seeds.Count.ToString(CultureInfo.InvariantCulture);
                    seeds.Add(extra);
                }
            }));
        });

        Test("strict-utf8-json-surrogates-and-depth-are-required", () =>
        {
            const string invalidJson = "SEED_INVENTORY_JSON_INVALID";
            // Each malformed token replaces one otherwise valid unique-key
            // string. A lossy decoder or removed surrogate check would admit
            // the request, rather than merely reaching another schema error.
            Reject(request: MalformedString(manifest, new byte[] { 34, 0xC3, 0x28, 34 }),
                expectedCode: invalidJson);
            Reject(canonical: MalformedString(projection, new byte[] { 34, 0xED, 0xA0, 0x80, 34 }, canonical: true),
                expectedCode: invalidJson);
            Reject(request: new byte[] { 0xEF, 0xBB, 0xBF }.Concat(manifest).ToArray());
            Reject(request: Utf8.GetBytes(Utf8.GetString(manifest) + "/* comment */"));
            foreach (string token in new[] { "\"\\uD800\"", "\"\\uDC00\"", "\"\\uD800\\u0041\"", "\"\\uZZZZ\"" })
                Reject(request: MalformedString(manifest, Utf8.GetBytes(token)), expectedCode: invalidJson);
            Reject(request: Utf8.GetBytes("{\"extra\":[[[[[[[[[0]]]]]]]]]," + Utf8.GetString(manifest)[1..]),
                expectedCode: invalidJson);
            Reject(canonical: Utf8.GetBytes(Utf8.GetString(projection).TrimEnd()[..^1] + ",}"));
        });

        Test("raw-byte-input-limits-and-later-input-failures-release-all-handles", () =>
        {
            Reject(request: Utf8.GetBytes(Utf8.GetString(manifest) + new string(' ', 16 * 1024)));
            Reject(canonical: new byte[1024 * 1024 + 1]);
            var fixture = Make();
            File.WriteAllText(fixture.ProjectionPath, "replacement", Utf8);
            Held(() => fixture.Acquire().Dispose());
            Assert(!File.Exists(fixture.OutputPath), "INPUT_REPLACEMENT_CREATED_OUTPUT");
            fixture.AssertReleased();
            var writerFixture = Make();
            using (var writer = new FileStream(writerFixture.ProjectionPath, FileMode.Open,
                FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete))
                Held(() => writerFixture.Acquire().Dispose());
            Assert(!File.Exists(writerFixture.OutputPath), "EXISTING_WRITER_CREATED_OUTPUT");
            writerFixture.AssertReleased();
        });

        Test("raced-leaf-is-preserved-and-failure-cannot-be-retried", () =>
        {
            var fixture = Make();
            using var session = fixture.Acquire();
            File.WriteAllText(fixture.OutputPath, "incumbent", Utf8);
            Held(session.CreateOutput);
            Assert(File.ReadAllText(fixture.OutputPath) == "incumbent", "RACED_LEAF_REPLACED");
            File.Delete(fixture.OutputPath); // only the fresh competing fixture artifact
            Held(session.CreateOutput);
            Held(session.VerifyOutput);
            Assert(!File.Exists(fixture.OutputPath), "FAILED_CREATE_RETRIED");
            fixture.AssertReleased();
        });

        Test("disposed-derived-session-does-not-create-and-collisions-remain-denied", () =>
        {
            var fixture = Make();
            var session = fixture.Acquire();
            session.Dispose();
            session.Dispose();
            Held(session.CreateOutput);
            Held(session.VerifyOutput);
            Assert(!File.Exists(fixture.OutputPath), "DISPOSE_CREATED_OUTPUT");
            fixture.AssertReleased();
            var manifestInput = new SeedInventoryInput(fixture.ManifestPath, Hash(manifest));
            Held(() => SeedInventoryCustodySession.AcquireCanonicalInventory(manifestInput,
                manifestInput with { Path = fixture.ManifestPath.ToUpperInvariant() }, fixture.Workspace,
                target, BaseSha, GitBlob(projection)).Dispose());
            Held(() => SeedInventoryCustodySession.AcquireCanonicalInventory(manifestInput,
                new SeedInventoryInput(fixture.ProjectionPath, Hash(projection)), "relative-root",
                target, BaseSha, GitBlob(projection)).Dispose());
        });

        Test("private-parent-preparation-binds-once-and-unbound-create-is-terminal", () =>
        {
            MethodInfo prepare = typeof(PinnedNewFile).GetMethod("PrepareParents", BindingFlags.NonPublic | BindingFlags.Static)
                ?? throw new Exception("SEED_DERIVATION_PREPARE_MISSING");
            MethodInfo bind = typeof(PinnedNewFile).GetMethod("BindDerivedContent", BindingFlags.NonPublic | BindingFlags.Instance)
                ?? throw new Exception("SEED_DERIVATION_BIND_MISSING");
            var fixture = Make();
            using (var output = (PinnedNewFile)prepare.Invoke(null, new object[] { fixture.OutputPath })!)
            {
                Assert(!File.Exists(fixture.OutputPath), "PARENT_PREPARE_CREATED_OUTPUT");
                Denied(() => Directory.Move(fixture.OutputParent, fixture.OutputParent + "-moved"));
                byte[] payload = (byte[])expected.Clone();
                bind.Invoke(output, new object[] { payload });
                Array.Fill(payload, (byte)'x');
                Held(() => bind.Invoke(output, new object[] { Utf8.GetBytes("replacement") }));
                output.Create();
                output.Verify();
            }
            Assert(File.ReadAllBytes(fixture.OutputPath).SequenceEqual(expected), "PAYLOAD_REBOUND_OR_EXPOSED");
            var unbound = Make();
            using (var output = (PinnedNewFile)prepare.Invoke(null, new object[] { unbound.OutputPath })!)
            {
                Held(output.Create);
                Held(() => bind.Invoke(output, new object[] { expected }));
                Held(output.Create);
            }
            Assert(!File.Exists(unbound.OutputPath), "UNBOUND_CREATE_WROTE_OUTPUT");
            unbound.AssertReleased();
        });
        return (passed, golden);
    }

    // Each new canonical Seed Canopy record requires exactly one byte-exact
    // renderer vector. The seven distinct hostile cases remain mandatory.
    // A stale fixed count (formerly 16) would fail whenever a legitimate seed
    // is added, even if JS and native bytes agree. Never loosen case coverage.
    private static readonly string[] FixedHostileVectors = [
        "unicode-and-markdown-literals",
        "replace-cr-lf-tab-and-angle-brackets",
        "ecmascript-trim-includes-bom",
        "ecmascript-trim-preserves-nel",
        "maximum-intent-ascii",
        "maximum-intent-astral-pair-at-boundary",
        "maximum-intent-astral-pairs",
    ];

    private static void VerifyVectorCoverage(JsonElement cases, JsonElement seeds)
    {
        Assert(seeds.ValueKind == JsonValueKind.Array &&
            seeds.GetArrayLength() is >= 1 and <= 64, "FIXTURE_SEED_COUNT");
        Assert(cases.ValueKind == JsonValueKind.Array &&
            cases.GetArrayLength() == seeds.GetArrayLength() + FixedHostileVectors.Length,
            "FIXTURE_CASE_COUNT");
        for (int i = 0; i < seeds.GetArrayLength(); i++)
        {
            string seedId = seeds[i].GetProperty("seedId").GetString()!;
            Assert(cases[i].GetProperty("name").GetString() == "canonical:" + seedId,
                "CANONICAL_VECTOR_IDENTITY");
            Assert(cases[i].GetProperty("manifest").GetProperty("seedId").GetString() == seedId,
                "CANONICAL_VECTOR_MANIFEST_BINDING");
            Assert(cases[i].GetProperty("manifest").GetProperty("targetPath").GetString() ==
                "docs/architecture/native-seed-inventory-" +
                (i + 1).ToString("D2", CultureInfo.InvariantCulture) + ".md",
                "CANONICAL_VECTOR_TARGET_BINDING");
        }
        string firstSeedId = seeds[0].GetProperty("seedId").GetString()!;
        for (int i = 0; i < FixedHostileVectors.Length; i++)
        {
            JsonElement fixture = cases[seeds.GetArrayLength() + i];
            Assert(fixture.GetProperty("name").GetString() == FixedHostileVectors[i],
                "HOSTILE_VECTOR_NAME_OR_ORDER");
            Assert(fixture.GetProperty("manifest").GetProperty("seedId").GetString() == firstSeedId,
                "HOSTILE_VECTOR_CANONICAL_SEED");
        }
    }

    private sealed class Fixture
    {
        internal string Workspace { get; }
        internal string ManifestPath { get; }
        internal string ProjectionPath { get; }
        internal string OutputParent { get; }
        internal string OutputPath { get; }
        private readonly byte[] manifest, projection;
        private readonly string relativeTarget;
        internal Fixture(string root, byte[] manifest, byte[] projection, string relativeTarget)
        {
            this.manifest = manifest; this.projection = projection; this.relativeTarget = relativeTarget;
            Workspace = Path.Combine(root, "work");
            OutputParent = Path.Combine(Workspace, "docs", "architecture");
            Directory.CreateDirectory(OutputParent);
            ManifestPath = Path.Combine(root, "manifest.json");
            ProjectionPath = Path.Combine(root, "projection.json");
            OutputPath = Path.Combine(Workspace, relativeTarget.Replace('/', Path.DirectorySeparatorChar));
            File.WriteAllBytes(ManifestPath, manifest);
            File.WriteAllBytes(ProjectionPath, projection);
        }
        internal SeedInventoryCustodySession Acquire(string? expectedBase = null,
            string? expectedTarget = null, string? expectedBlob = null) =>
            SeedInventoryCustodySession.AcquireCanonicalInventory(
                new SeedInventoryInput(ManifestPath, Hash(manifest)),
                new SeedInventoryInput(ProjectionPath, Hash(projection)), Workspace,
                expectedTarget ?? relativeTarget, expectedBase ?? BaseSha, expectedBlob ?? GitBlob(projection));
        internal void AssertReleased()
        {
            using (var first = new FileStream(ManifestPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            using (var second = new FileStream(ProjectionPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                Assert(first.CanWrite && second.CanWrite, "INPUT_HANDLES_NOT_RELEASED");
            Directory.Move(OutputParent, OutputParent + "-released");
            Directory.Move(OutputParent + "-released", OutputParent);
        }
    }

    private static byte[] Change(byte[] original, Action<JsonObject> change)
    {
        var value = JsonNode.Parse(original)!.AsObject();
        change(value);
        return Utf8.GetBytes(value.ToJsonString());
    }
    private static byte[] MalformedString(byte[] original, byte[] token, bool canonical = false)
    {
        const string sentinel = "SEED_MALFORMED_STRING_SENTINEL";
        byte[] valid = Change(original, value =>
        {
            if (canonical) value["seeds"]![1]!["title"] = sentinel;
            else value["intent"] = sentinel;
        });
        byte[] marker = Utf8.GetBytes("\"" + sentinel + "\"");
        int start = valid.AsSpan().IndexOf(marker);
        Assert(start >= 0 && valid.AsSpan(start + marker.Length).IndexOf(marker) < 0, "MALFORMED_TOKEN_FIXTURE");
        return valid[..start].Concat(token).Concat(valid[(start + marker.Length)..]).ToArray();
    }
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string GitBlob(byte[] bytes)
    {
        byte[] header = Encoding.ASCII.GetBytes("blob " + bytes.Length.ToString(CultureInfo.InvariantCulture) + "\0");
        return Convert.ToHexString(SHA1.HashData(header.Concat(bytes).ToArray())).ToLowerInvariant();
    }
    private static void AssertHeldAuthority(SeedInventoryCustodySession session) =>
        Assert(!session.SourceOwnershipAuthenticated && !session.CompleteOperationCustodyProven
            && !session.LeaseReleaseAuthorized && !session.ProductionWorkerCommissioned, "AUTHORITY_EXPANDED");
    private static void Assert(bool pass, string label)
    { if (!pass) throw new Exception("SEED_DERIVATION_TEST_FAILED_" + label); }
    private static void Held(Action action, string? expectedCode = null)
    {
        try { action(); }
        catch (SeedWriterHeldException error)
        { Assert(expectedCode is null || error.Code == expectedCode, "WRONG_HOLD_" + error.Code); return; }
        catch (TargetInvocationException error) when (error.InnerException is SeedWriterHeldException held)
        { Assert(expectedCode is null || held.Code == expectedCode, "WRONG_HOLD_" + held.Code); return; }
        throw new Exception("SEED_DERIVATION_EXPECTED_HOLD");
    }
    private static void Denied(Action action)
    {
        try { action(); }
        catch (IOException) { return; }
        catch (UnauthorizedAccessException) { return; }
        throw new Exception("SEED_DERIVATION_EXPECTED_OS_DENIAL");
    }
}
