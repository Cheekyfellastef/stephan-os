using System;
using System.IO;
using System.Security.Cryptography;
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
// Test an actual binary digest while never commissioning this runner.
string observed = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(image))).ToLowerInvariant();
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
Console.WriteLine("R7_SCM_NATIVE_READBACK_TESTS_PASSED=" + total);
Console.WriteLine("R7_SCM_REAL_BATTLE_BRIDGE_COMMISSIONED=false");
Console.WriteLine("R7_SCM_ORIGINAL_WRITER_EXCLUDED=false");
Console.WriteLine("R7_SCM_LEASE_RELEASED=false");
return 0;
