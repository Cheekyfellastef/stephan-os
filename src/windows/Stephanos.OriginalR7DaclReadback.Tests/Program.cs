using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using Stephanos.OriginalR7DaclReadback;

// Tests run on a disposable Windows GitHub Actions host and only manipulate
// one randomly named directory under the runner's own TEMP. No production
// Battle Bridge source, original lease or source permissions are changed.
internal static class Program
{
    private static void Check(bool ok, string code)
    {
        if (!ok) throw new InvalidOperationException(code);
    }

    private static void AssertNotCustody(R7DaclObservation observation)
    {
        Check(!observation.PhysicalWriterDenialProven, "PHYSICAL_PROOF_MUST_STAY_FALSE");
        Check(!observation.AuthenticatedOsWitness, "AUTHENTICATED_WITNESS_MUST_STAY_FALSE");
        Check(!observation.SourceMutationAuthorized, "SOURCE_MUTATION_MUST_STAY_FALSE");
        Check(!observation.LeaseReleaseAuthorized, "LEASE_RELEASE_MUST_STAY_FALSE");
        Check(!observation.HistoricalReceiptReconstructed, "HISTORY_CANNOT_BE_RECONSTRUCTED");
    }

    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return 2;
        if (args.Length == 1 && args[0] == "--r7-process-fixture")
        {
            Console.ReadLine();
            return 0;
        }
        if (args.Length != 0) return 2;
        var scratch = Path.Combine(Path.GetTempPath(), "stephanos-r7-acl-test-" + Guid.NewGuid().ToString("N"));
        // Synthetic identity is not the original r7 writer. A real original
        // writer must be identified independently and tested on Battle Bridge.
        const string syntheticWriterSid = "S-1-5-21-1000-2000-3000-4000";
        try
        {
            Directory.CreateDirectory(scratch);
            var initial = R7DaclReadback.ObservePolicyShape(scratch, syntheticWriterSid);
            AssertNotCustody(initial);
            Check(!initial.PolicyShapeObserved, "MISSING_EXPLICIT_DENY_MUST_FAIL");

            var wrongSid = R7DaclReadback.ObservePolicyShape(scratch, "invalid-sid");
            AssertNotCustody(wrongSid);
            Check(!wrongSid.PolicyShapeObserved, "UNKNOWN_PRINCIPAL_MUST_FAIL");

            var info = new DirectoryInfo(scratch);
            var security = info.GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);
            security.SetAccessRuleProtection(isProtected: true, preserveInheritance: true);
            security.AddAccessRule(new FileSystemAccessRule(
                new SecurityIdentifier(syntheticWriterSid), FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Deny));
            info.SetAccessControl(security);

            var structural = R7DaclReadback.ObservePolicyShape(scratch, syntheticWriterSid);
            Check(structural.PolicyShapeObserved, "EXPLICIT_DENY_POLICY_NOT_OBSERVED");
            Check(structural.Classification == "R7_DACL_STRUCTURAL_DENY_OBSERVED_NOT_OS_CUSTODY",
                "STRUCTURAL_CLASSIFICATION_INCORRECT");
            AssertNotCustody(structural);

            var another = R7DaclReadback.ObservePolicyShape(scratch, "S-1-5-21-1000-2000-3000-4001");
            Check(!another.PolicyShapeObserved, "WRONG_PRINCIPAL_MUST_NOT_INHERIT_PROOF");
            AssertNotCustody(another);

            var vanished = R7DaclReadback.ObservePolicyShape(
                Path.Combine(scratch, "does-not-exist"), syntheticWriterSid);
            Check(!vanished.PolicyShapeObserved, "MISSING_DIRECTORY_MUST_FAIL");
            AssertNotCustody(vanished);

            ProcessBoundWriteDenialTests.Run();
            EffectiveWriteDenialTests.Run();

            Console.WriteLine("R7_DACL_NATIVE_READBACK_TESTS_PASSED=true");
            Console.WriteLine("R7_DACL_ORIGINAL_WRITER_TESTED=false");
            Console.WriteLine("R7_DACL_ORIGINAL_LEASE_RELEASED=false");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("R7_DACL_NATIVE_READBACK_TESTS_FAILED");
            Console.Error.WriteLine("R7_DACL_TEST_EXCEPTION_TYPE=" + error.GetType().Name);
            if (System.Text.RegularExpressions.Regex.IsMatch(error.Message, "^[A-Z0-9_]{1,120}$"))
                Console.Error.WriteLine("R7_DACL_TEST_FAILURE_CODE=" + error.Message);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(scratch)) Directory.Delete(scratch, recursive: true); }
            catch { /* CI scratch cleanup failure never authorizes production */ }
        }
    }
}
