using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Stephanos.OriginalR7CustodyWitness;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

// Public RFC8032 keys and disposable fixtures only. Synthetic claims below
// exercise encoding/authentication, never physical custody or production trust.
internal static class OriginalR7SigningProviderTests
{
    private static int total;
    private static readonly JsonSerializerOptions Relaxed = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static readonly byte[] WitnessSeed = Convert.FromHexString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    private static readonly byte[] OperatorSeed = Convert.FromHexString("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
    private const string WitnessSid = "S-1-5-80-1-2-3-4-5";
    private const string OperatorSid = "S-1-5-21-1-2-3-1001";
    private static void Check(bool ok, string name)
    {
        total++;
        if (!ok) throw new InvalidOperationException("R7_SIGNING_TEST_FAILED_" + name);
    }
    private static void Reject(Action action, string name)
    {
        bool held = false;
        try { action(); } catch (InvalidOperationException) { held = true; }
        Check(held, name);
    }
    private static string Sha(byte[] value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private static string H(string value) => Sha(Encoding.UTF8.GetBytes(value));
    private static byte[] Wire(object value) => JsonSerializer.SerializeToUtf8Bytes(value, Relaxed);
    private static byte[] SeedBytes(OriginalR7SoftwareSeedSession session)
        => (byte[])(typeof(OriginalR7SoftwareSeedSession).GetField("seed", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(session) ?? throw new InvalidOperationException("TEST_OWNED_BUFFER_UNOBSERVABLE"));
    private static OriginalR7SoftwareSeedSession Open(string path, OriginalR7SignaturePurpose purpose)
        => new(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), purpose);

    internal static void Run()
    {
        string root = Path.GetFullPath(Directory.GetCurrentDirectory());
        string script = Path.Combine(root, "src/windows/Stephanos.OriginalR7CustodyWitness.Tests/LegacySigningInterop.mjs");
        if (!File.Exists(script)) throw new InvalidOperationException("FIXED_INTEROP_SCRIPT_REQUIRED");
        string own = Path.Combine(Path.GetTempPath(), "r7-signing-fixture-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(own);
        try
        {
            Vectors(script);
            string witnessPath = Path.Combine(own, "public-rfc8032-seed-one.bin");
            string operatorPath = Path.Combine(own, "public-rfc8032-seed-two.bin");
            File.WriteAllBytes(witnessPath, WitnessSeed);
            File.WriteAllBytes(operatorPath, OperatorSeed);
            Sessions(own, witnessPath);
            Profiles();
            Interop(own, script, witnessPath, operatorPath);
            CheckLoadedProvider();
            Console.WriteLine("R7_SIGNING_PROVIDER_ASSERTIONS_PASSED=" + total);
            Console.WriteLine("R7_SIGNING_TEST_ONLY_ROOTS=true");
            Console.WriteLine("R7_PRODUCTION_TRUST_ENROLLED=false");
            Console.WriteLine("R7_PHYSICAL_CUSTODY_PROVEN=false");
            Console.WriteLine("R7_CANONICAL_LEASE_RELEASED=false");
        }
        finally
        {
            string actual = Path.GetFullPath(own);
            string parent = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
            if (Path.GetDirectoryName(actual) != parent || !Path.GetFileName(actual).StartsWith("r7-signing-fixture-", StringComparison.Ordinal))
                throw new InvalidOperationException("FIXTURE_CLEANUP_BOUNDARY_INVALID");
            Directory.Delete(actual, recursive: true);
        }
    }

    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("SingleFile", "IL3000",
        Justification = "Unbundled-only provenance test hashes the actually loaded provider and rejects an empty bundled location.")]
    private static void CheckLoadedProvider()
    {
        string provider = typeof(Org.BouncyCastle.Math.EC.Rfc8032.Ed25519).Assembly.Location;
        if (string.IsNullOrEmpty(provider)) throw new InvalidOperationException("R7_SIGNING_UNBUNDLED_PROVIDER_PROOF_REQUIRED");
        Check(Sha(File.ReadAllBytes(provider)) == OriginalR7SigningPrimitives.PublisherNet6Sha256,
            "ACTUALLY_LOADED_PROVIDER_MATCHES_OFFICIAL_NET6_SHA256");
    }

    private static void Vectors(string script)
    {
        foreach (var vector in new[] {
            (WitnessSeed, "", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
                "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
            (OperatorSeed, "72", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
                "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00")
        })
        {
            Check(Convert.FromHexString(vector.Item4).Length == 64, "RFC8032_FIXTURE_SIGNATURE_LENGTH");
            byte[] message = Convert.FromHexString(vector.Item2);
            byte[] pub = OriginalR7SigningPrimitives.PublicKey(vector.Item1);
            byte[] signature = OriginalR7SigningPrimitives.SignDetached(vector.Item1, message);
            Check(Convert.ToHexString(pub).ToLowerInvariant() == vector.Item3, "RFC8032_PUBLIC_KEY");
            Check(Convert.ToHexString(signature).ToLowerInvariant() == vector.Item4, "RFC8032_SIGNATURE");
            Check(OriginalR7SigningPrimitives.Verify(pub, message, signature), "RFC8032_VERIFIED");
            signature[0] ^= 1;
            Check(!OriginalR7SigningPrimitives.Verify(pub, message, signature), "RFC8032_TAMPER_REJECTED");
            Check(OriginalR7SigningPrimitives.PublicSpki(pub).Length == 44, "RFC8410_SPKI_LENGTH");
        }
        Reject(() => OriginalR7SigningPrimitives.PublicKey(new byte[31]), "SHORT_SEED_REJECTED");
        Reject(() => OriginalR7SigningPrimitives.SignDetached(new byte[33], new byte[1]), "LONG_SEED_REJECTED");
        Reject(() => OriginalR7SigningPrimitives.SignDetached(WitnessSeed, new byte[OriginalR7SigningPrimitives.MaxPayloadBytes + 129]), "MESSAGE_BOUND");
        Check(!OriginalR7SigningPrimitives.Verify(new byte[31], new byte[1], new byte[64]), "BAD_PUBLIC_KEY_LENGTH");
        Check(!OriginalR7SigningPrimitives.Verify(new byte[32], new byte[1], new byte[63]), "BAD_SIGNATURE_LENGTH");
        foreach (string bad in new[] { "[]", "{\"a\":1,\"a\":1}", "{ \"a\":1}", "{\"a\":1.0}", "{\"a\":null}",
            "{\"a\":9007199254740992}", "{\"a\":\"\\u0061\"}", "{\"a\":\"é\"}", "{\"a\":\"\\n\"}", "{\"a\":{}}" })
            Reject(() => OriginalR7SigningPrimitives.DomainMessage(OriginalR7SignaturePurpose.Witness, Encoding.UTF8.GetBytes(bad)), "NONCANONICAL_OR_UNSUPPORTED_CLAIMS");
        Reject(() => OriginalR7SigningPrimitives.DomainMessage((OriginalR7SignaturePurpose)99, Wire(new { a = 1 })), "PURPOSE_ENUM");
        foreach (string numeric in new[] { "{\"1\":1,\"0\":0}", "{\"0\":0}", "{\"4294967294\":1}" })
            Reject(() => OriginalR7SigningPrimitives.DomainMessage(OriginalR7SignaturePurpose.Witness, Encoding.UTF8.GetBytes(numeric)), "JAVASCRIPT_INDEX_PROPERTY_UNSUPPORTED");
        Check(Node(script,"canonical","{\"1\":1,\"0\":0}").GetProperty("canonical").GetString() == "{\"0\":0,\"1\":1}", "ACTUAL_NODE_INDEX_ORDER_DIFFERS");
        byte[] claims = Wire(new { path = "C:\\fixture + = apostrophe'", flag = true, number = 7 });
        byte[] w = OriginalR7SigningPrimitives.DomainMessage(OriginalR7SignaturePurpose.Witness, claims);
        byte[] o = OriginalR7SigningPrimitives.DomainMessage(OriginalR7SignaturePurpose.Operator, claims);
        Check(!w.SequenceEqual(o), "DOMAINS_DISTINCT");
    }

    private static void Sessions(string own, string witnessPath)
    {
        byte[] claims = Wire(new { fixture = "algorithm-only + / =", revision = 7 });
        var s = Open(witnessPath, OriginalR7SignaturePurpose.Witness);
        byte[] buffer = SeedBytes(s);
        var signature = s.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims);
        Check(!signature.PolicyAdopted && !signature.KeyCustodyProven && !signature.HardwareNonExportableKeyProven
            && !signature.NativeContainmentProven && !signature.LeaseReleaseAuthorized, "SIGNATURE_HAS_NO_CUSTODY_OR_AUTHORITY");
        Check(signature.PublicSpkiSha256 != signature.PublicPemSha256, "SPKI_AND_PEM_PINS_ARE_DISTINCT");
        Reject(() => s.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Operator, claims), "CROSS_ROLE_HELD");
        Check(buffer.All(b => b == 0), "CROSS_ROLE_ZEROS_OWNED_SEED");
        Reject(() => s.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims), "CROSS_ROLE_FAILURE_TERMINAL");
        s.Dispose();
        Check(buffer.All(b => b == 0), "DISPOSE_ZEROS_OWNED_SEED");
        Reject(() => s.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims), "DISPOSE_TERMINAL");
        foreach (int length in new[] { 0, 31, 33 })
        {
            string path = Path.Combine(own, "bad-" + length);
            File.WriteAllBytes(path, new byte[length]);
            Reject(() => Open(path, OriginalR7SignaturePurpose.Witness), "SEED_FILE_BOUND");
        }
        Reject(() => new OriginalR7SoftwareSeedSession(new FileStream(witnessPath, FileMode.Open, FileAccess.ReadWrite),
            OriginalR7SignaturePurpose.Witness), "WRITABLE_STREAM_REJECTED");
        var closed = new FileStream(witnessPath, FileMode.Open, FileAccess.Read); closed.Dispose();
        Reject(() => new OriginalR7SoftwareSeedSession(closed, OriginalR7SignaturePurpose.Witness), "CLOSED_IMPORT_REJECTED");
        using (var tampered = Open(witnessPath, OriginalR7SignaturePurpose.Witness))
        {
            byte[] material = SeedBytes(tampered);
            tampered.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims);
            byte[] changed = WitnessSeed.ToArray(); changed[0] ^= 1;
            File.WriteAllBytes(witnessPath, changed);
            Reject(() => tampered.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims), "FRESH_OS_READ_DETECTS_MATERIAL_CHANGE");
            Check(material.All(b => b == 0), "FAILURE_ZEROS_OWNED_SEED");
            File.WriteAllBytes(witnessPath, WitnessSeed);
            Reject(() => tampered.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, claims), "POISON_TERMINAL_AFTER_BYTES_RESTORED");
        }
        using var malformed = Open(witnessPath, OriginalR7SignaturePurpose.Witness);
        byte[] malformedBuffer = SeedBytes(malformed);
        Reject(() => malformed.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness, Encoding.UTF8.GetBytes("{\"a\":1.0}")), "MALFORMED_SIGN_HELD");
        Check(malformedBuffer.All(b => b == 0), "MALFORMED_SIGN_ZEROS_SEED");
    }

    private static void Profiles()
    {
        DateTimeOffset now = DateTimeOffset.Parse("2026-10-21T16:20:00Z");
        Dictionary<string, object> f = new() {
            ["schemaVersion"]="stephanos.r7-fixed-signing-host-profile-candidate.v1", ["state"]="UNADOPTED_PREPARATION_ONLY",
            ["repository"]="Cheekyfellastef/stephan-os", ["leaseId"]="critical-2962-elastic-goal-r7-lease", ["revision"]=7,
            ["serviceName"]="StephanosOriginalR7CustodyWitness", ["sourceHead"]=new string('b',40), ["baseSha"]=new string('a',40),
            ["treeSha"]=new string('c',40), ["imageSha256"]=H("fixture-image"), ["originalLeaseDigest"]=H("fixture-lease"),
            ["sourceExecutionId"]="critical-2962-elastic-goal-r1-0123456789ab", ["worktreePath"]="C:\\fixture-only\\source",
            ["worktreeNativeIdentityDigest"]=H("fixture-native"), ["witnessSid"]=WitnessSid, ["operatorSid"]=OperatorSid,
            ["executorSid"]=OperatorSid, ["sourcePrincipalSids"]=new[]{"S-1-5-21-1-2-3-1002"},
            ["witnessKeySpkiSha256"]=H("fixture-witness"), ["operatorKeySpkiSha256"]=H("fixture-operator"),
            ["commissioningRootSpkiSha256"]=H("fixture-operator"), ["policyProposalDigest"]=H("fixture-proposal"),
            ["providerVersion"]=OriginalR7SigningPrimitives.PackageVersion, ["providerNet6Sha256"]=OriginalR7SigningPrimitives.PublisherNet6Sha256,
            ["issuedAtUtc"]="2026-10-21T16:19:00.000Z", ["expiresAtUtc"]="2026-10-21T16:24:00.000Z"
        };
        OriginalR7FixedSigningProfileCandidate Parse(Dictionary<string, object> v)
            => OriginalR7FixedSigningHostProfile.ParseCandidate(Encoding.UTF8.GetString(Wire(v)), now);
        var candidate = Parse(f);
        Check(candidate.SourceExecutionId.Contains("-r1-") && !candidate.PolicyAdopted
            && !candidate.ActualPrincipalEnrollmentProven && !candidate.ProductionKeyAccessAllowed, "PROFILE_NEVER_ADOPTS_OR_RELABELS_EXECUTION");
        var plan = OriginalR7FixedSigningHostProfile.PlanFirstRootCeremony(candidate);
        Check(plan.RequiredIndependentKeyCount == 2 && plan.OperatorMayBeExecutor && plan.OperatorRootMayCommissionWitness
            && !plan.PreExistingThirdRootRequired, "TWO_ROOTS_NO_CIRCULAR_THIRD_ROOT");
        Check(plan.ActualProtectedOwnerOsConsentRequired && plan.ExactSourceReviewAndProtectedApprovalRequired
            && plan.ActualSourcePrincipalIsolationRequired && !plan.KeyCreationExecuted && !plan.RootTrustEnrolled
            && !plan.HostExecutionAuthorized && !plan.LeaseReleaseAuthorized, "FIRST_ROOT_PLAN_NO_SIDE_EFFECTS");
        foreach (var change in new (string,object)[] {
            ("sourceHead",new string('0',40)), ("treeSha",new string('0',40)), ("imageSha256",new string('0',64)),
            ("state","ADOPTED"), ("revision",1), ("executorSid",WitnessSid), ("operatorSid",WitnessSid),
            ("commissioningRootSpkiSha256",H("fixture-witness")), ("witnessKeySpkiSha256",H("fixture-operator")),
            ("sourcePrincipalSids",new[]{OperatorSid}), ("sourceExecutionId","invented-execution"),
            ("worktreePath","C:\\fixture-only\\..\\source"), ("expiresAtUtc","2026-10-21T16:19:30.000Z"),
            ("providerVersion","latest"), ("extraAuthority",true)
        })
        {
            var bad = new Dictionary<string, object>(f) { [change.Item1] = change.Item2 };
            Reject(() => Parse(bad), "PROFILE_FAIL_CLOSED_" + change.Item1);
        }
        string wire = Encoding.UTF8.GetString(Wire(f));
        Reject(() => OriginalR7FixedSigningHostProfile.ParseCandidate(wire[..^1]+",\"revision\":7}",now), "PROFILE_DUPLICATE_KEY");
        var observed = OriginalR7FixedSigningHostProfile.ObserveCurrentWitnessContext();
        Check(!observed.AuthenticatedRepositoryOwner && !observed.AdoptedPolicyProven
            && !observed.CompleteNativeCustodyProven && !observed.ProductionKeyAccessAllowed, "ACTUAL_CURRENT_CONTEXT_CANNOT_SELF_ENROLL");
        var held = OriginalR7FixedSigningHostProfile.PreflightProductionWitness(null, candidate);
        Check(!held.ProductionKeyAccessAllowed && !held.CompleteNativeCustodyProven, "PRODUCTION_KEYS_UNREACHABLE");
    }

    private static JsonElement Node(string script, string operation, string argument)
    {
        using Process process = new();
        process.StartInfo = new("node.exe") { UseShellExecute=false, RedirectStandardOutput=true, RedirectStandardError=true, CreateNoWindow=true };
        process.StartInfo.ArgumentList.Add(script);
        process.StartInfo.ArgumentList.Add(operation);
        process.StartInfo.ArgumentList.Add(argument);
        process.Start();
        Task<string> output=process.StandardOutput.ReadToEndAsync(), error=process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(15000)) { process.Kill(entireProcessTree:true); throw new InvalidOperationException("FIXTURE_NODE_TIMEOUT"); }
        string text=output.GetAwaiter().GetResult(), err=error.GetAwaiter().GetResult();
        if (process.ExitCode!=0 || text.Length>32768 || err.Length>4096)
            throw new InvalidOperationException("FIXTURE_NODE_FAILED_"+err);
        using JsonDocument document=JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static void Interop(string own, string script, string witnessPath, string operatorPath)
    {
        string worktree=Path.Combine(own,"source + = apostrophe'");
        Directory.CreateDirectory(worktree);
        string canonical=Node(script,"path",worktree).GetProperty("canonicalWorktree").GetString()!;
        var expected = new Dictionary<string,object> {
            ["repository"]="Cheekyfellastef/stephan-os", ["missionId"]="critical-2962-elastic-goal",
            ["leaseId"]="critical-2962-elastic-goal-r7-lease", ["revision"]=7, ["originalLeaseDigest"]=H("TEST_ONLY_LEASE"),
            ["headSha"]="4e5023eef829b285095db4eeb09d6f2b365e33e4", ["sourceRevision"]=new string('a',40),
            ["worktreePath"]=canonical, ["sourceExecutionId"]="critical-2962-elastic-goal-r1-0123456789ab",
            ["commandId"]="fixture-command-only", ["requestId"]="fixture-request-only", ["branch"]="openclaw/elastic-goal-2962"
        };
        using var witness=Open(witnessPath,OriginalR7SignaturePurpose.Witness);
        using var op=Open(operatorPath,OriginalR7SignaturePurpose.Operator);
        Dictionary<string,object> claims=new(expected) {
            ["historicalTerminalReceiptPresent"]=false, ["historicalTerminalReceiptReconstructed"]=false,
            ["historicalExecutionOutcome"]="UNKNOWN", ["activeOriginalSourceWriters"]=0,
            ["oldWriterAccessRevoked"]=true, ["outOfJobExecutionRevoked"]=true, ["wmiComRelaunchDenied"]=true,
            ["scheduledTaskRelaunchDenied"]=true, ["sourceWriteAccessDeniedToOriginalPrincipals"]=true,
            ["testedOldPrincipalWriteDenied"]=true, ["knownWorkerQueuesQuiesced"]=true, ["containmentRemainsEnforced"]=true,
            ["independentOsWitnessSid"]=WitnessSid, ["osEvidenceDigest"]=H("SYNTHETIC_TEST_NOT_PHYSICAL_EVIDENCE"),
            ["denyAclPolicyDigest"]=H("SYNTHETIC_TEST_NOT_HOST_POLICY"), ["protectedWitnessLogId"]="fixture-log-000",
            ["containmentEffectiveAtUtc"]="2026-10-21T16:16:00.000Z", ["observedAtUtc"]="2026-10-21T16:17:00.000Z",
            ["signedAtUtc"]="2026-10-21T16:18:00.000Z"
        };
        byte[] wire=Array.Empty<byte>();
        OriginalR7SoftwareSignature? signature=null;
        for(int i=0;i<128;i++) {
            claims["protectedWitnessLogId"]="fixture-log-"+i;
            wire=Wire(claims); signature=witness.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Witness,wire);
            if(new[]{'+','/','='}.All(signature.SignatureBase64.Contains))break;
        }
        Check(signature is not null && new[]{'+','/','='}.All(signature.SignatureBase64.Contains),"BASE64_PLUS_SLASH_EQUALS_EXERCISED");
        var part=Part(wire,signature!);
        byte[] canonicalPart=OriginalR7SigningPrimitives.CanonicalSignaturePart(OriginalR7SignaturePurpose.Witness,wire,signature!);
        Dictionary<string,object> approval=new() {
            ["repository"]=expected["repository"], ["missionId"]=expected["missionId"], ["leaseId"]=expected["leaseId"],
            ["revision"]=7, ["originalLeaseDigest"]=expected["originalLeaseDigest"],
            ["commandId"]=expected["commandId"], ["requestId"]=expected["requestId"], ["witnessDigest"]=Sha(canonicalPart),
            ["historicalOutcomeRemainsUnknown"]=true, ["deferGoalNotComplete"]=true,
            ["operatorApprovalKind"]="QUARANTINE_ORIGINAL_EXECUTION_ONLY", ["operatorSid"]=OperatorSid,
            ["approvedAtUtc"]="2026-10-21T16:19:00.000Z"
        };
        Dictionary<string,object> record=new() {
            ["schemaVersion"]="stephanos.legacy-original-source-orphan-quarantine.v1", ["osWitness"]=part,
            ["operatorApproval"]=Part(Wire(approval),op.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Operator,Wire(approval)))
        };
        string recordPath=Path.Combine(own,"test-only-signed-record.json");
        string publicWitness=Path.Combine(own,"test-only-witness-public.pem"), publicOperator=Path.Combine(own,"test-only-operator-public.pem");
        File.WriteAllText(publicWitness,signature!.PublicKeyPem,new UTF8Encoding(false));
        File.WriteAllText(publicOperator,OriginalR7SigningPrimitives.PublicPem(OriginalR7SigningPrimitives.PublicKey(OperatorSeed)),new UTF8Encoding(false));
        string metadata=Path.Combine(own,"test-only-metadata.json");
        File.WriteAllBytes(metadata,Wire(new { recordPath, witnessPublicPath=publicWitness,operatorPublicPath=publicOperator,
            expected,clockUtc="2026-10-21T16:20:00.000Z" }));
        void Save() => File.WriteAllBytes(recordPath,JsonSerializer.SerializeToUtf8Bytes(record));
        Save();
        Check(File.ReadAllText(recordPath).Contains("\\u002B",StringComparison.OrdinalIgnoreCase),"OUTER_DEFAULT_ENCODER_ESCAPES_PLUS");
        JsonElement valid=Node(script,"verify",metadata);
        Check(valid.GetProperty("testOnlyTrust").GetBoolean(),"INTEROP_TRUST_EXPLICITLY_TEST_ONLY");
        Check(valid.GetProperty("scoped").GetProperty("authenticated").GetBoolean(),"ACTUAL_CANONICAL_VERIFIER_ACCEPTS_CRYPTO_FIXTURE");
        Check(valid.GetProperty("scoped").GetProperty("eligibilityOnly").GetBoolean()
            && !valid.GetProperty("scoped").GetProperty("leaseReleaseAuthority").GetBoolean()
            && !valid.GetProperty("scoped").GetProperty("sourceMutationAuthority").GetBoolean(),"EVEN_VALID_FIXTURE_CANNOT_RELEASE_OR_WRITE");
        Check(!valid.GetProperty("noProductionPins").GetProperty("authenticated").GetBoolean(),"ABSENT_PRODUCTION_ROOTS_HOLD");
        Check(valid.GetProperty("interpretedWitnessDigest").GetString()==Sha(canonicalPart),"NODE_CANONICAL_PART_DIGEST_EXACT");
        Check(valid.GetProperty("base64RoundTripHasPlusSlashEquals").GetBoolean(),"NODE_BASE64_ROUNDTRIP_EXACT");
        string source=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(script)!,"../../../stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js"));
        Check(valid.GetProperty("actualVerifierSourceSha256").GetString()==Sha(File.ReadAllBytes(source)),"ACTUAL_UNCHANGED_VERIFIER_SOURCE_HASH");
        // Default .NET part escaping hashes different bytes from JSON.stringify.
        approval["witnessDigest"]=Sha(JsonSerializer.SerializeToUtf8Bytes(part));
        record["operatorApproval"]=Part(Wire(approval),op.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Operator,Wire(approval)));
        Save();
        Check(!Node(script,"verify",metadata).GetProperty("scoped").GetProperty("authenticated").GetBoolean(),"WRONG_ESCAPED_WITNESS_DIGEST_REJECTED");
        approval["witnessDigest"]=Sha(canonicalPart);
        record["operatorApproval"]=Part(Wire(approval),op.SignForAlgorithmPreparation(OriginalR7SignaturePurpose.Operator,Wire(approval)));
        var wrongDomain=signature! with { SignatureBase64=Convert.ToBase64String(OriginalR7SigningPrimitives.SignDetached(WitnessSeed,
            OriginalR7SigningPrimitives.DomainMessage(OriginalR7SignaturePurpose.Operator,wire))) };
        record["osWitness"]=Part(wire,wrongDomain);Save();
        Check(!Node(script,"verify",metadata).GetProperty("scoped").GetProperty("authenticated").GetBoolean(),"WRONG_SIGNATURE_DOMAIN_REJECTED");
    }

    private static Dictionary<string,object> Part(byte[] wire,OriginalR7SoftwareSignature signature)
    {
        using JsonDocument document=JsonDocument.Parse(wire);
        return new() { ["algorithm"]="Ed25519",["claims"]=document.RootElement.Clone(),["signatureBase64"]=signature.SignatureBase64 };
    }
}
