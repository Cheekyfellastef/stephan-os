using System;
using System.IO;
using Stephanos.OriginalR7CustodyWitness;

// Hosted CI executes native Windows SCM readback on a machine without
// commissioning authority. All even-positive shape cases retain NO lease
// or source mutation, historical receipt, signer or containment authority.
if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("R7_SCM_TEST_REQUIRES_WINDOWS");
    return 2;
}

int total = 0;
void Check(bool condition, string name)
{
    total++;
    if (!condition) throw new InvalidOperationException("R7_SCM_TEST_FAILED_" + name);
}
string image = Environment.ProcessPath
    ?? throw new InvalidOperationException("R7_SCM_TEST_EXECUTABLE_UNAVAILABLE");
const string account = @"NT SERVICE\StephanosOriginalR7CustodyWitness";
OriginalR7ScmObservation Eval(
    string? who = account, int? type = 0x10, int? start = 2, int? sid = 3,
    string? path = null, string? actual = null) =>
        OriginalR7ScmPreflight.Evaluate(who, type, start, sid, path ?? image, actual ?? image);

void AlwaysHeld(OriginalR7ScmObservation report, string id)
{
    Check(!report.OriginalWriterExclusionProven, id + "_WRITER");
    Check(!report.ProtectedAuditProven, id + "_AUDIT");
    Check(!report.IndependentSigningProven, id + "_SIGNER");
    Check(!report.LeaseReleaseAuthorized, id + "_LEASE");
}

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
};
foreach (var (name, report) in tests)
{
    Check(!report.ScmConfigurationObserved, name);
    AlwaysHeld(report, name);
}

// The actual runner must not be able to commission this fixed service.
// An unexpectedly registered service is not success or a permission grant.
OriginalR7ScmObservation live = OriginalR7ScmPreflight.Inspect();
AlwaysHeld(live, "LIVE");
Check(!live.LeaseReleaseAuthorized, "LIVE_CANNOT_RELEASE");

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
Console.WriteLine("R7_SCM_NATIVE_READBACK_TESTS_PASSED=" + total);
Console.WriteLine("R7_SCM_REAL_BATTLE_BRIDGE_COMMISSIONED=false");
Console.WriteLine("R7_SCM_ORIGINAL_WRITER_EXCLUDED=false");
Console.WriteLine("R7_SCM_LEASE_RELEASED=false");
return 0;
