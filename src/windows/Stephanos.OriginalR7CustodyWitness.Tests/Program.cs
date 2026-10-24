using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Stephanos.OriginalR7CustodyWitness;

try
{
Stephanos.OriginalR7CustodyWitness.Tests.NativeTestProcessErrorMode.Apply();
if (args.Length == 1 && args[0] == "--probe-harness-failure")
    throw new InvalidOperationException("R7_EXPECTED_NONINTERACTIVE_HARNESS_PROBE");

int sourceSchemaAssertions = ProvisioningSourceSchemaTests.Run();
if (args.Length == 1 && args[0] == "--provisioning-source-schema-only")
{
    Console.WriteLine("R7_PROVISIONING_SOURCE_SCHEMA_ASSERTIONS_PASSED=" + sourceSchemaAssertions);
    Console.WriteLine("R7_NATIVE_CUSTODY_PROVEN=false");
    return 0;
}

// Hosted CI executes native Windows SCM readback on a machine without
// commissioning authority. All even-positive shape cases retain NO lease
// or source mutation, historical receipt, signer or containment authority.
if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("R7_SCM_TEST_REQUIRES_WINDOWS");
    return 2;
}

if (args.Length == 1 && args[0] == "--observation-session-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7ObservationSessionTests.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--registry-and-observation-only")
{
    int focused = 0;
    RegistryProtectionTests.Run((ok, label) =>
    {
        focused++;
        if (!ok) throw new InvalidOperationException("R7_REGISTRY_INTEGRATION_FAILED_" + label);
    });
    focused += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7ObservationSessionTests.Run();
    Console.WriteLine("R7_REGISTRY_AND_OBSERVATION_ASSERTIONS_PASSED=" + focused);
    return 0;
}

if (args.Length == 1 && args[0] == "--signing-provider-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7SigningProviderTests.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--owner-token-transport-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7OwnerEnvelopeTransportTests.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--native-principal-identity-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7NativePrincipalIdentityTests.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--owner-workflow-auth-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7OwnerWorkflowAuthenticationTests.Run();
    return 0;
}

if (args.Length == 1 && args[0] == "--key-metadata-only")
{
    Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7ProtectedKeyMetadataTests.Run();
    return 0;
}

int total = sourceSchemaAssertions;
void Check(bool condition, string name)
{
    total++;
    if (!condition) throw new InvalidOperationException("R7_SCM_TEST_FAILED_" + name);
}
string image = Environment.ProcessPath
    ?? throw new InvalidOperationException("R7_SCM_TEST_EXECUTABLE_UNAVAILABLE");
RegistryProtectionTests.Run(Check);
const string account = @"NT SERVICE\StephanosOriginalR7CustodyWitness";
// Test an actual binary digest while never commissioning this runner.
string observed = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(image))).ToLowerInvariant();
var actualImage = OriginalR7ImagePinPreflight.Evaluate(image, observed);
Check(actualImage.ImageDigestMatchesConfiguredPin, "ACTUAL_EXECUTABLE_IMAGE_GATE");
Check(!actualImage.IndependentlyProtectedPinProven && !actualImage.OriginalWriterExclusionProven
    && !actualImage.SignedWitnessIssued && !actualImage.LeaseReleaseAuthorized,
    "ACTUAL_EXECUTABLE_GATE_IS_NOT_AUTHORITY");
OriginalR7ScmObservation Eval(
    string? who = account, int? type = 0x10, int? start = 2, int? sid = 3,
    string? path = null, string? actual = null,
    string? pin = null, string? actualDigest = null) =>
        OriginalR7ScmPreflight.Evaluate(who, type, start, sid,
            path ?? image, actual ?? image, pin ?? observed, actualDigest ?? observed);

void AlwaysHeld(OriginalR7ScmObservation report, string id)
{
    Check(!report.OriginalWriterExclusionProven, id + "_WRITER");
    Check(!report.ProtectedAuditProven, id + "_AUDIT");
    Check(!report.IndependentSigningProven, id + "_SIGNER");
    Check(!report.LeaseReleaseAuthorized, id + "_LEASE");
}

// Run this same linked production adapter as an ordinary apphost AND as a
// self-contained single-file process. This exercises real assembly loading,
// rather than supplying a caller assertion about bundle identity.
bool expectBundled = args.Length == 1 && args[0] == "--expect-bundled-payload";
Check(args.Length == 0 || expectBundled, "TEST_INVOCATION");
Check(OriginalR7ScmPreflight.BundledPayloadObserved() == expectBundled,
    "REAL_PAYLOAD_BUNDLE_IDENTITY");

// A synthetic *registration shape*, not proof of Windows custody.
OriginalR7ScmObservation shape = Eval();
Check(shape.ScmConfigurationObserved, "MATCHING_SCM_SHAPE");
Check(shape.Classification == "R7_SCM_SHAPE_OBSERVED_NOT_PHYSICAL_CUSTODY", "HELD_VERDICT");
AlwaysHeld(shape, "SHAPE");
var tests = new (string Name, OriginalR7ScmObservation Result)[]
{
    ("WRONG_ACCOUNT", Eval(who: @"NT AUTHORITY\SYSTEM")),
    ("ARBITRARY_VIRTUAL_ACCOUNT", Eval(who: @"NT SERVICE\AnotherService")),
    ("LOCAL_SYSTEM_TYPE", Eval(type: 0x20)),
    ("MANUAL_START", Eval(start: 3)),
    ("NO_SERVICE_SID", Eval(sid: 0)),
    ("UNRESTRICTED_SERVICE_SID", Eval(sid: 1)),
    ("MISSING_IMAGE", Eval(path: "")),
    ("APPENDED_ARGS", Eval(path: image + " --untrusted")),
    ("OTHER_IMAGE", Eval(path: image + ".replacement.exe")),
    ("ENV_ALIAS", Eval(path: "%SystemRoot%\\System32\\cmd.exe")),
    ("RELATIVE_IMAGE", Eval(path: @"witness.exe")),
    ("UNBALANCED_QUOTE", Eval(path: "\"" + image)),
    ("MISMATCHED_PIN", Eval(pin: new string('0', 64))),
    ("MISMATCHED_IMAGE_DIGEST", Eval(actualDigest: new string('f', 64))),
    ("SHORT_IMAGE_DIGEST", Eval(pin: "012345")),
    ("UPPERCASE_IMAGE_DIGEST", Eval(pin: observed.ToUpperInvariant())),
    ("NONHEX_IMAGE_DIGEST", Eval(pin: new string('g', 64))),
};
foreach (var (name, report) in tests)
{
    Check(!report.ScmConfigurationObserved, name);
    AlwaysHeld(report, name);
}

// A valid synthetic pin still has zero containment, signing, lease or
// protected audit authority. No root hash is provisioned by this test.
Check(shape.Classification == "R7_SCM_SHAPE_OBSERVED_NOT_PHYSICAL_CUSTODY", "PIN_MATCH_NON_AUTHORITY");
Check(!Eval(pin: new string('0', 64)).ScmConfigurationObserved, "MISMATCHED_PIN_SHAPE_DENIED");

// The actual runner must not be able to commission this fixed service.
// An unexpectedly registered service is not success or a permission grant.
OriginalR7ScmObservation live = OriginalR7ScmPreflight.Inspect();
AlwaysHeld(live, "LIVE");
Check(!live.LeaseReleaseAuthorized, "LIVE_CANNOT_RELEASE");
if (!expectBundled)
{
    Check(!live.ScmConfigurationObserved, "UNBUNDLED_CANNOT_REPORT_SHAPE");
    Check(live.Classification == "R7_SCM_BUNDLED_PAYLOAD_UNPROVEN",
        "UNBUNDLED_REFUSED_BEFORE_REGISTRY");
}

void ImageAlwaysHeld(OriginalR7ImagePinObservation r, string label)
{
    Check(!r.IndependentlyProtectedPinProven, label + "_PIN_NOT_TRUSTED");
    Check(!r.OriginalWriterExclusionProven, label + "_WRITER_NOT_EXCLUDED");
    Check(!r.SignedWitnessIssued, label + "_NOT_SIGNED");
    Check(!r.LeaseReleaseAuthorized, label + "_LEASE_HELD");
}
var scratchRoot = Path.Combine(Path.GetTempPath(), "r7-pin-probe-" + Guid.NewGuid().ToString("N"));
try
{
    Directory.CreateDirectory(scratchRoot);
    string fixture = Path.Combine(scratchRoot, "witness-fixture.exe");
    string oversized = Path.Combine(scratchRoot, "oversized.exe");
    using (FileStream tooLarge = new(oversized, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        tooLarge.SetLength(OriginalR7ImagePinPreflight.MaxImageBytes + 1);
    var bounded = OriginalR7ImagePinPreflight.Evaluate(oversized, new string('0', 64));
    Check(bounded.Classification == "R7_IMAGE_LENGTH_OUT_OF_BOUNDS", "IMAGE_OVER_LIMIT_DENIED");
    ImageAlwaysHeld(bounded, "IMAGE_OVER_LIMIT");
    byte[] first = System.Security.Cryptography.RandomNumberGenerator.GetBytes(512);
    File.WriteAllBytes(fixture, first);
    string digest = Convert.ToHexString(
        System.Security.Cryptography.SHA256.HashData(first)).ToLowerInvariant();
    var valid = OriginalR7ImagePinPreflight.Evaluate(fixture, digest);
    Check(valid.ImageDigestMatchesConfiguredPin, "IMAGE_VALID_PIN_MATCHES_BYTES");
    Check(valid.Classification == "R7_IMAGE_DIGEST_MATCHED_PIN_UNATTESTED",
        "IMAGE_MATCH_IS_NOT_PRODUCTION_TRUST");
    ImageAlwaysHeld(valid, "IMAGE_VALID");
    var missing = OriginalR7ImagePinPreflight.Evaluate(fixture, null);
    Check(!missing.ImageDigestMatchesConfiguredPin, "IMAGE_MISSING_PIN_DENIED");
    ImageAlwaysHeld(missing, "IMAGE_MISSING");
    var wrong = OriginalR7ImagePinPreflight.Evaluate(fixture, new string('0', 64));
    Check(!wrong.ImageDigestMatchesConfiguredPin, "IMAGE_WRONG_PIN_DENIED");
    ImageAlwaysHeld(wrong, "IMAGE_WRONG");
    var uppercase = OriginalR7ImagePinPreflight.Evaluate(fixture, digest.ToUpperInvariant());
    Check(!uppercase.ImageDigestMatchesConfiguredPin, "IMAGE_NONCANONICAL_DIGEST_DENIED");
    ImageAlwaysHeld(uppercase, "IMAGE_NONCANONICAL");
    File.WriteAllBytes(fixture, System.Security.Cryptography.RandomNumberGenerator.GetBytes(512));
    var changed = OriginalR7ImagePinPreflight.Evaluate(fixture, digest);
    Check(!changed.ImageDigestMatchesConfiguredPin, "IMAGE_CHANGED_BYTES_DENIED");
    ImageAlwaysHeld(changed, "IMAGE_CHANGED");
    var absent = OriginalR7ImagePinPreflight.Evaluate(Path.Combine(scratchRoot,"missing.exe"), digest);
    Check(!absent.ImageDigestMatchesConfiguredPin, "IMAGE_ABSENT_DENIED");
    ImageAlwaysHeld(absent, "IMAGE_ABSENT");
    var traversal = OriginalR7ImagePinPreflight.Evaluate(
        Path.Combine(scratchRoot,"..",Path.GetFileName(scratchRoot),"witness-fixture.exe"), digest);
    Check(!traversal.ImageDigestMatchesConfiguredPin, "IMAGE_PATH_TRAVERSAL_DENIED");
    ImageAlwaysHeld(traversal, "IMAGE_TRAVERSAL");
}
finally
{
    try { Directory.Delete(scratchRoot, recursive: true); } catch {}
}

OriginalR7ImagePinObservation liveImage = OriginalR7ImagePinPreflight.Inspect();
ImageAlwaysHeld(liveImage, "IMAGE_LIVE");
if (!expectBundled)
{
    Check(liveImage.Classification == "R7_IMAGE_MANAGED_PAYLOAD_NOT_BUNDLED",
        "UNBUNDLED_LIBRARY_CANNOT_VALIDATE_APPHOST_ONLY");
    Check(!liveImage.ImageDigestMatchesConfiguredPin, "UNBUNDLED_LIBRARY_PIN_NOT_EVALUATED");
}
else
{
    Check(liveImage.Classification != "R7_IMAGE_MANAGED_PAYLOAD_NOT_BUNDLED",
        "BUNDLED_EXECUTABLE_NOT_MISCLASSIFIED_AS_APPHOST_ONLY");
    // Even the real bundled image cannot authenticate the Windows original
    // writer, issue a protected signer receipt, or release the historical lease.
    ImageAlwaysHeld(liveImage, "BUNDLED_IMAGE_NON_AUTHORITY");
}

void WriterAlwaysHeld(OriginalR7WriterAccessObservation result, string id)
{
    Check(!result.OriginalPrincipalProvenanceAuthenticated, id + "_NO_ORIGINAL_IDENTITY");
    Check(!result.WholeSourceAndRelaunchExcluded, id + "_NO_SOURCE_EXCLUSION");
    Check(!result.ProtectedAuditVerified, id + "_NO_PROTECTED_AUDIT");
    Check(!result.SigningAuthorityGranted, id + "_NO_SIGNER");
    Check(!result.LeaseReleaseAuthorized, id + "_NO_LEASE");
}
using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
{
    string originalSid = identity.User?.Value
        ?? throw new InvalidOperationException("R7_TEST_WINDOWS_IDENTITY_UNKNOWN");
    var noToken = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
        image, new Microsoft.Win32.SafeHandles.SafeAccessTokenHandle(IntPtr.Zero),
        originalSid);
    Check(!noToken.OneTargetNegativeWriteProbeObserved, "WRITER_MISSING_TOKEN_NO_DENIAL");
    WriterAlwaysHeld(noToken, "WRITER_MISSING_TOKEN");

    // The local CI runner's token is NOT the historical #2962 writer token.
    // Observations may be held as filtered on hosted runners. Never force
    // another token or manufacture a clean old-writer identity for the test.
    var actual = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
        image, identity.AccessToken, originalSid);
    Check(!actual.OneTargetNegativeWriteProbeObserved,
        "WRITER_RUNNER_BINARY_NOT_QUALIFIED_ORIGINAL_TARGET");
    WriterAlwaysHeld(actual, "WRITER_RUNNING_TOKEN");
    var spoofedSid = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
        image, identity.AccessToken, "S-1-5-21-1000-2000-3000-4000");
    Check(!spoofedSid.OneTargetNegativeWriteProbeObserved,
        "WRITER_FORGED_SID_NO_DENIAL");
    WriterAlwaysHeld(spoofedSid, "WRITER_FORGED_SID");
    var invalidPath = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
        @"\\untrusted\share\file", identity.AccessToken, originalSid);
    Check(!invalidPath.OneTargetNegativeWriteProbeObserved,
        "WRITER_UNTRUSTED_TARGET_NO_DENIAL");
    WriterAlwaysHeld(invalidPath, "WRITER_UNTRUSTED_TARGET");

    // Deliberately malformed input cannot become a privileged service
    // invocation even with a syntactically valid SID.
    var unknown = OriginalR7WriterAccessPreflight.ObserveSingleTarget(
        "", identity.AccessToken, originalSid);
    Check(!unknown.OneTargetNegativeWriteProbeObserved,
        "WRITER_NO_TARGET_NO_DENIAL");
    WriterAlwaysHeld(unknown, "WRITER_NO_TARGET");
}

void ScopeAlwaysHeld(OriginalR7WriterScopeObservation r, string id)
{
    Check(!r.OriginalPrincipalProvenanceAuthenticated, id + "_ORIGINAL_ID_UNKNOWN");
    Check(!r.AllOriginalSourceWritersExcluded, id + "_WHOLE_SOURCE_UNPROVEN");
    Check(!r.ExistingWriterHandlesExcluded, id + "_OLD_HANDLES_UNPROVEN");
    Check(!r.DirectAndTaskRelaunchExcluded, id + "_RELAUNCH_UNPROVEN");
    Check(!r.ProtectedAuditVerified, id + "_AUDIT_UNPROVEN");
    Check(!r.SigningAuthorityGranted, id + "_NO_SIGNER");
    Check(!r.LeaseReleaseAuthorized, id + "_NO_RELEASE");
}
OriginalR7WriterScopeObservation sample =
    OriginalR7WriterScopePreflight.EvaluateCounts(3, 3, true, false);
Check(sample.BoundedSampleAllDenied, "SCOPE_FINITE_SAMPLE_MATCHED");
Check(sample.Classification == "R7_BOUNDED_FILE_OPENS_DENIED_NOT_CUSTODY",
    "SCOPE_SAMPLE_NOT_WHOLE_SOURCE");
ScopeAlwaysHeld(sample, "SCOPE_SAMPLE");
var scopeInputs = new (string Name, OriginalR7WriterScopeObservation Report)[]
{
    ("EMPTY", OriginalR7WriterScopePreflight.EvaluateCounts(0, 0, true, false)),
    ("PARTIAL", OriginalR7WriterScopePreflight.EvaluateCounts(3, 2, true, false)),
    ("OVERFULL", OriginalR7WriterScopePreflight.EvaluateCounts(129, 129, true, false)),
    ("TRUNCATED", OriginalR7WriterScopePreflight.EvaluateCounts(2, 2, false, false)),
    ("REPARSE", OriginalR7WriterScopePreflight.EvaluateCounts(2, 2, true, true)),
    ("OVERCOUNT", OriginalR7WriterScopePreflight.EvaluateCounts(2, 3, true, false)),
    ("NEGATIVE", OriginalR7WriterScopePreflight.EvaluateCounts(-1, 0, true, false))
};
foreach (var (name, report) in scopeInputs)
{
    Check(!report.BoundedSampleAllDenied, "SCOPE_" + name + "_NO_SUCCESS");
    ScopeAlwaysHeld(report, "SCOPE_" + name);
}
using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
{
    var token = identity.AccessToken;
    string sid = identity.User?.Value ?? "";
    // An ordinary runner SID can never certify the old r7 writer identity.
    var invalid = OriginalR7WriterScopePreflight.ObserveBoundedFiles(
        @"\\untrusted\share", token, sid);
    Check(!invalid.BoundedSampleAllDenied, "SCOPE_UNTRUSTED_NETWORK_ROOT_DENIED");
    ScopeAlwaysHeld(invalid, "SCOPE_UNTRUSTED_ROOT");
    var noToken = OriginalR7WriterScopePreflight.ObserveBoundedFiles(
        Path.GetTempPath(), new Microsoft.Win32.SafeHandles.SafeAccessTokenHandle(IntPtr.Zero), sid);
    Check(!noToken.BoundedSampleAllDenied, "SCOPE_MISSING_TOKEN_DENIED");
    ScopeAlwaysHeld(noToken, "SCOPE_MISSING_TOKEN");
}
// Native directory access checks use ONLY a disposable hosted-runner directory.
// Neither this runner's SID nor a denied open is a historical #2962 writer.
void DirectoryAlwaysHeld(OriginalR7DirectoryRightsObservation r, string name)
{
    Check(!r.OriginalPrincipalProvenanceAuthenticated, name + "_NO_PROVENANCE");
    Check(!r.OriginalExistingHandlesExcluded, name + "_NO_OLD_HANDLES");
    Check(!r.OtherWriterTokensExcluded, name + "_NO_OTHER_TOKENS");
    Check(!r.RelaunchRoutesExcluded, name + "_NO_RELAUNCH_PROOF");
    Check(!r.WholeSourceWriterExclusionProven, name + "_NO_FULL_SOURCE_PROOF");
    Check(!r.ProtectedAuditVerified, name + "_NO_AUDIT");
    Check(!r.SigningAuthorityGranted, name + "_NO_SIGNER");
    Check(!r.LeaseReleaseAuthorized, name + "_NO_RELEASE");
}
using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent())
{
    string sid = identity.User?.Value
        ?? throw new InvalidOperationException("R7_DIRECTORY_TEST_SID_MISSING");
    string tempDirectory = Path.Combine(Path.GetTempPath(), "r7-native-dir-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(tempDirectory);
    try
    {
        var current = OriginalR7DirectoryRightsPreflight.Observe(tempDirectory, identity.AccessToken, sid);
        DirectoryAlwaysHeld(current, "DIRECTORY_RUNNER_CURRENT");
        // A hosted runner token may be privileged/restricted. Do not
        // interpret either native result as historic original writer proof.
        var wrongSid = OriginalR7DirectoryRightsPreflight.Observe(
            tempDirectory, identity.AccessToken, "S-1-5-21-1000-2000-3000-4000");
        Check(!wrongSid.BoundedDirectoryMutationDenied, "DIRECTORY_SPOOFED_SID_DENIED");
        DirectoryAlwaysHeld(wrongSid, "DIRECTORY_SPOOFED");
        var missingToken = OriginalR7DirectoryRightsPreflight.Observe(
            tempDirectory, new Microsoft.Win32.SafeHandles.SafeAccessTokenHandle(IntPtr.Zero), sid);
        Check(!missingToken.BoundedDirectoryMutationDenied, "DIRECTORY_MISSING_TOKEN");
        DirectoryAlwaysHeld(missingToken, "DIRECTORY_MISSING_TOKEN");
        var network = OriginalR7DirectoryRightsPreflight.Observe(
            @"\\untrusted\share", identity.AccessToken, sid);
        Check(!network.BoundedDirectoryMutationDenied, "DIRECTORY_NETWORK_REFUSED");
        DirectoryAlwaysHeld(network, "DIRECTORY_NETWORK");
        var alias = OriginalR7DirectoryRightsPreflight.Observe(
            tempDirectory + "\\.", identity.AccessToken, sid);
        Check(!alias.BoundedDirectoryMutationDenied, "DIRECTORY_NONCANONICAL_ALIAS_REFUSED");
        DirectoryAlwaysHeld(alias, "DIRECTORY_ALIAS");
        var missing = OriginalR7DirectoryRightsPreflight.Observe(
            Path.Combine(tempDirectory, "missing"), identity.AccessToken, sid);
        Check(!missing.BoundedDirectoryMutationDenied, "DIRECTORY_MISSING_REFUSED");
        DirectoryAlwaysHeld(missing, "DIRECTORY_NOT_FOUND");
    }
    finally { try { Directory.Delete(tempDirectory, recursive: true); } catch { } }
}

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7AuditJournalTests.Run();

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7ObservationSessionTests.Run();

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7ProtectedKeyMetadataTests.Run();

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7NativePrincipalIdentityTests.Run();

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7OwnerWorkflowAuthenticationTests.Run();

total += Stephanos.OriginalR7CustodyWitness.Tests.OriginalR7OwnerEnvelopeTransportTests.Run();

Console.WriteLine("R7_SCM_NATIVE_READBACK_TESTS_PASSED=" + total);
Console.WriteLine("R7_SCM_REAL_BATTLE_BRIDGE_COMMISSIONED=false");
Console.WriteLine("R7_SCM_ORIGINAL_WRITER_EXCLUDED=false");
Console.WriteLine("R7_SCM_LEASE_RELEASED=false");
return 0;
}
catch (Exception error)
{
    // Deliberate and unexpected fixture failures remain failures. Catch at the
    // process boundary so they cannot escape into an interactive WER dialog.
    string detail = error.Message.StartsWith("R7_", StringComparison.Ordinal)
        || error.Message.StartsWith("FIXTURE_", StringComparison.Ordinal)
        ? error.Message[..Math.Min(error.Message.Length, 240)] : "UNEXPECTED_FIXTURE_FAILURE";
    Console.Error.WriteLine("R7_SCM_NATIVE_TEST_FAILED=" + error.GetType().Name + ":" + detail);
    return 1;
}

// Schema and byte-binding checks are portable. They do not instantiate a live
// retained image, authenticate an issuer, enter native consent or create keys.
internal static class ProvisioningSourceSchemaTests
{
    internal static int Run()
    {
        int total = 0;
        DateTimeOffset now = DateTimeOffset.Parse("2026-10-21T18:40:00.000Z",
            System.Globalization.CultureInfo.InvariantCulture);
        void Check(bool condition, string label)
        {
            total++;
            if (!condition) throw new InvalidOperationException("R7_SOURCE_SCHEMA_TEST_" + label);
        }
        string H(char digit, int count = 64) => new(digit, count);
        JsonObject Fixture() => new()
        {
            ["schemaVersion"] = "stephanos.r7-first-root-owner-intake-proposal.v1",
            ["purpose"] = "R7_FIRST_ROOT_OWNER_POLICY_INTAKE",
            ["repository"] = "Cheekyfellastef/stephan-os", ["capabilityIssue"] = 3123, ["prNumber"] = 3178,
            ["requestId"] = "existing-r7-request-fixture",
            ["original"] = new JsonObject
            {
                ["missionId"] = "critical-2962-elastic-goal", ["leaseId"] = "critical-2962-elastic-goal-r7-lease",
                ["leaseRevision"] = 7, ["leaseDigest"] = H('a'),
                ["sourceExecutionId"] = "critical-2962-elastic-goal-r1-0123456789ab",
                ["branch"] = "openclaw/elastic-goal-2962",
                ["sourceHead"] = "4e5023eef829b285095db4eeb09d6f2b365e33e4", ["historicalOutcome"] = "UNKNOWN"
            },
            ["candidate"] = new JsonObject
            {
                ["branch"] = "feature/3123-r7-registry-protection-readback-20261020",
                ["sourceHead"] = H('a', 40), ["sourceTree"] = H('b', 40), ["reviewedBase"] = H('c', 40),
                ["sourceMergeCommit"] = H('d', 40), ["expectedMain"] = H('e', 40),
                ["imageSha256"] = H('a'), ["bundleSha256"] = H('b'), ["manifestSha256"] = H('c')
            },
            ["review"] = new JsonObject
            {
                ["runId"] = "123", ["runAttempt"] = "2", ["artifactId"] = "456", ["archiveSha256"] = H('a'),
                ["payloadSha256"] = H('b'), ["reviewedSourceHead"] = H('a', 40),
                ["reviewedSourceTree"] = H('b', 40), ["reviewedBase"] = H('c', 40)
            },
            ["hostPolicyProposalDigest"] = H('d'), ["fixedRecipeDigest"] = H('e'),
            ["issuedAtUtc"] = "2026-10-21T18:39:00.000Z", ["expiresAtUtc"] = "2026-10-21T18:44:00.000Z"
        };
        void Reject(string wire, string label)
        {
            try { OriginalR7NativeProvisioningSource.ParsePermit(wire, now); }
            catch (InvalidOperationException error) when (error.Message.StartsWith("R7_PROVISION_SOURCE_", StringComparison.Ordinal))
            { Check(true, label); return; }
            Check(false, label);
        }
        void Change(string group, string key, JsonNode? value, string label)
        {
            JsonObject fixture = Fixture();
            JsonObject target = group.Length == 0 ? fixture : fixture[group]!.AsObject();
            target[key] = value;
            Reject(fixture.ToJsonString(), label);
        }
        string originalWire = Fixture().ToJsonString();
        var parsed = OriginalR7NativeProvisioningSource.ParsePermit(originalWire, now);
        Check(parsed.PermitSha256 == Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(originalWire))).ToLowerInvariant(),
            "EXACT_WIRE_HASH");
        Check(parsed.SourceExecutionId == "critical-2962-elastic-goal-r1-0123456789ab", "CONSUMED_R1_PRESERVED");
        Check(parsed.ExpectedMain == H('e', 40) && parsed.OriginalLeaseDigest == H('a') && parsed.ImageSha256 == H('a'),
            "EXACT_CONTEXT_PRESERVED");
        foreach (string group in new[] { "", "original", "candidate", "review" })
        {
            foreach (string key in new[] { "operatorApproved", "rootEnrollmentAuthorized", "path", "nativeCustody", "__proto__" })
                Change(group, key, JsonValue.Create(true), "UNKNOWN_OR_AUTHORITY_FIELD");
            JsonObject missing = Fixture(), target = group.Length == 0 ? missing : missing[group]!.AsObject();
            target.Remove(target.First().Key); Reject(missing.ToJsonString(), "REQUIRED_FIELD");
        }
        Change("", "schemaVersion", JsonValue.Create("other"), "SCHEMA");
        Change("", "purpose", JsonValue.Create("PROVISION_INACTIVE_R7_SIGNING_ROOTS_ONLY"), "PURPOSE_IS_NOT_CALLER_GRANT");
        Change("", "repository", JsonValue.Create("other/stephan-os"), "REPOSITORY");
        Change("", "capabilityIssue", JsonValue.Create("3123"), "CAPABILITY_NUMERIC");
        Change("", "prNumber", JsonValue.Create(3179), "FIXED_PR");
        Change("", "requestId", JsonValue.Create("bad\nrequest"), "REQUEST_ID");
        Change("original", "missionId", JsonValue.Create("other"), "MISSION");
        Change("original", "leaseId", JsonValue.Create("other"), "LEASE");
        Change("original", "leaseRevision", JsonValue.Create(8), "REVISION");
        Change("original", "sourceExecutionId", JsonValue.Create("critical-2962-elastic-goal-r01-0123456789ab"), "EXECUTION_FORMAT");
        Change("original", "branch", JsonValue.Create("main"), "ORIGINAL_BRANCH");
        Change("original", "sourceHead", JsonValue.Create(H('b', 40)), "ORIGINAL_HEAD");
        Change("original", "historicalOutcome", JsonValue.Create("COMPLETE"), "HISTORY_CANNOT_BE_INVENTED");
        Change("candidate", "branch", JsonValue.Create("main"), "CANDIDATE_BRANCH");
        foreach (string key in new[] { "reviewedSourceHead", "reviewedSourceTree", "reviewedBase" })
            Change("review", key, JsonValue.Create(H('f', 40)), "REVIEW_MISMATCH");
        Change("candidate", "sourceHead", JsonValue.Create(H('c', 40)), "CANDIDATE_EQUALS_BASE");
        foreach (string key in new[] { "runId", "runAttempt", "artifactId" })
        {
            foreach (string value in new[] { "0", "-1", "01", "1e2", "18446744073709551616" })
                Change("review", key, JsonValue.Create(value), "INVALID_DECIMAL_ID");
            Change("review", key, JsonValue.Create(1), "ID_MUST_BE_STRING");
        }
        foreach ((string group, string key, int size) in new[]
        {
            ("", "hostPolicyProposalDigest", 64), ("", "fixedRecipeDigest", 64), ("original", "leaseDigest", 64),
            ("candidate", "sourceHead", 40), ("candidate", "sourceTree", 40), ("candidate", "reviewedBase", 40),
            ("candidate", "sourceMergeCommit", 40), ("candidate", "expectedMain", 40),
            ("candidate", "imageSha256", 64), ("candidate", "bundleSha256", 64), ("candidate", "manifestSha256", 64),
            ("review", "archiveSha256", 64), ("review", "payloadSha256", 64)
        })
            foreach (string bad in new[] { H('0', size), H('A', size), H('g', size), H('a', size - 1) })
                Change(group, key, JsonValue.Create(bad), "INVALID_OR_ZERO_DIGEST");
        Change("", "expiresAtUtc", JsonValue.Create("2026-10-21T18:40:00.000Z"), "EXPIRED");
        Change("", "issuedAtUtc", JsonValue.Create("2026-10-21T18:41:00.000Z"), "FUTURE");
        Change("", "expiresAtUtc", JsonValue.Create("2026-10-21T18:44:00.001Z"), "OVERLONG");
        Change("", "issuedAtUtc", JsonValue.Create("2026-02-30T18:39:00.000Z"), "IMPOSSIBLE_DATE");
        Change("", "issuedAtUtc", JsonValue.Create("2026-10-21T18:39:00Z"), "NONCANONICAL_TIME");
        Reject(originalWire + "\n", "TRAILING_WHITESPACE");
        Reject(originalWire.Replace("\"purpose\":", "\"purpose\":\"other\",\"purpose\":"), "DUPLICATE_ROOT");
        Reject(originalWire.Replace("\"leaseRevision\":7", "\"leaseRevision\":7,\"leaseRevision\":7"), "DUPLICATE_NESTED");
        Reject(originalWire.Replace("\"leaseRevision\":7", "\"leaseRevision\":7.0"), "NONCANONICAL_NUMBER");
        Reject(originalWire.Replace("existing-r7-request-fixture", "existing-r7-réquest-fixture"), "NON_ASCII");
        Reject(new string('x', 16385), "BOUNDED_INPUT");
        Reject("{", "INVALID_JSON");
        if (!OperatingSystem.IsWindows())
        {
            try { using var source = OriginalR7NativeProvisioningSource.OpenCurrent(originalWire); }
            catch (InvalidOperationException error) when (error.Message.StartsWith("R7_PROVISION_SOURCE_", StringComparison.Ordinal))
            { Check(true, "LIVE_SOURCE_REQUIRES_NATIVE_HOST"); return total; }
            Check(false, "LIVE_SOURCE_REQUIRES_NATIVE_HOST");
        }
        return total;
    }
}
