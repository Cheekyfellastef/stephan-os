using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

internal static class EffectiveWriteDenialTests
{
    private static void RestoreAcl(string file, FileSecurity original)
    {
        // SetAccessControl persists only modified sections. A previously
        // persisted descriptor cannot be reused as a rollback operation.
        FileSecurity reset = new();
        reset.SetSecurityDescriptorBinaryForm(original.GetSecurityDescriptorBinaryForm(),
            AccessControlSections.Access);
        new FileInfo(file).SetAccessControl(reset);
    }
    private static int checks;
    private static void Check(bool pass, string code)
    {
        checks++;
        if (!pass) throw new InvalidOperationException(code);
    }
    private static void NoAuthority(R7EffectiveWriteObservation observation)
    {
        Check(!observation.AuthenticatedOsWitness && !observation.LeaseReleaseAuthorized
            && !observation.SourceMutationAuthorized && !observation.HistoricalReceiptReconstructed,
            "NATIVE_PROBE_MUST_NOT_GRANT_AUTHORITY");
    }

    internal static void Run()
    {
        string temp = Path.GetFullPath(Path.GetTempPath());
        string scratch = Path.GetFullPath(Path.Combine(temp, "stephanos-r7-native-probe-" + Guid.NewGuid().ToString("N")));
        if (!scratch.StartsWith(temp.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("UNSAFE_TEST_ROOT");
        Directory.CreateDirectory(scratch);
        string file = Path.Combine(scratch, "probe.txt");
        File.WriteAllText(file, "unchanged sentinel");
        FileSecurity original = new FileInfo(file).GetAccessControl();
        using WindowsIdentity identity = WindowsIdentity.GetCurrent();
        string sid = identity.User!.Value;
        try
        {
            var writable = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
            NoAuthority(writable);
            Check(writable.OriginalTokenMatched && writable.TargetIdentityStable,
                "REAL_TOKEN_" + writable.Classification);
            Check(!writable.DataWriteOpenDenied && writable.Classification == "R7_NATIVE_ORIGINAL_TOKEN_CAN_WRITE",
                "WRITABLE_FILE_MUST_NOT_BE_REPORTED_DENIED");

            var wrong = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, "S-1-5-21-1000-2000-3000-4000");
            NoAuthority(wrong);
            Check(!wrong.OriginalTokenMatched && !wrong.DataWriteOpenDenied,
                "WRONG_PRINCIPAL_MUST_NOT_BE_PROBED");

            using SafeAccessTokenHandle invalid = new(IntPtr.Zero);
            var missingToken = R7EffectiveWriteDenial.Observe(file, invalid, sid);
            NoAuthority(missingToken);
            Check(missingToken.Classification == "R7_NATIVE_ORIGINAL_TOKEN_UNAVAILABLE",
                "MISSING_REAL_TOKEN_MUST_FAIL_CLOSED");

            foreach (string bad in new[] { "relative.txt", @"\\server\share\probe.txt",
                file + ":stream", Path.Combine(scratch, "..", "probe.txt"), file + ".",
                // Before normalization hardening this resolves to the real
                // existing writable sentinel and produced a stable observation.
                scratch + "/../" + Path.GetFileName(scratch) + "\\probe.txt",
                scratch + "\\NUL.txt", scratch + "\\COM1.txt", scratch + "\\LPT\u00b9.txt",
                scratch + "\\NUL .txt", scratch + "\\*.txt" })
            {
                var malformed = R7EffectiveWriteDenial.Observe(bad, identity.AccessToken, sid);
                NoAuthority(malformed);
                Check(!malformed.DataWriteOpenDenied && !malformed.TargetIdentityStable,
                    "NON_CANONICAL_PATH_MUST_NOT_CREATE_PROOF");
                Check(malformed.Classification == "R7_NATIVE_WRITE_PROBE_FAILED_CLOSED",
                    "NON_CANONICAL_PATH_MUST_BE_REJECTED_BEFORE_NATIVE_OPEN");
            }

            // The ACL changes only this disposable test file. The native
            // observer itself performs no write, ACL change or token reduction.
            FileSecurity denied = new FileInfo(file).GetAccessControl();
            denied.AddAccessRule(new FileSystemAccessRule(identity.User,
                FileSystemRights.WriteData | FileSystemRights.AppendData,
                AccessControlType.Deny));
            new FileInfo(file).SetAccessControl(denied);
            var observed = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
            NoAuthority(observed);
            Check(observed.DataWriteOpenDenied && observed.TargetIdentityStable,
                "KERNEL_MUST_DENY_BOTH_WRITE_AND_APPEND_OPENS");
            Check(observed.OriginalPrincipalOwnsTarget && !observed.DaclWriteOpenDenied,
                "OWNER_CAN_STILL_REWRITE_DACL_AND_MUST_NOT_BE_TREATED_AS_CONTAINED");
            Check(observed.Classification == "R7_NATIVE_DATA_DENIED_BUT_ORIGINAL_WRITER_OWNS_TARGET",
                "DATA_DENIAL_MUST_NOT_HIDE_OWNER_BYPASS");
            Check(File.ReadAllText(file) == "unchanged sentinel", "PROBE_MUST_NOT_CHANGE_FILE_CONTENTS");
            RestoreAcl(file, original);

            // Denying one operation cannot attest denial of another. In
            // particular a combined write+append access request is inadequate.
            FileSecurity appendAllowed = new FileInfo(file).GetAccessControl();
            appendAllowed.AddAccessRule(new FileSystemAccessRule(identity.User,
                FileSystemRights.WriteData, AccessControlType.Deny));
            new FileInfo(file).SetAccessControl(appendAllowed);
            var partial = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
            NoAuthority(partial);
            Check(!partial.DataWriteOpenDenied, "WRITE_ONLY_DENY_CANNOT_PROVE_APPEND_DENIAL");
            RestoreAcl(file, original);

            using (var locked = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                var sharing = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
                NoAuthority(sharing);
                Check(!sharing.DataWriteOpenDenied, "SHARING_VIOLATION_MUST_NOT_COUNT_AS_ACCESS_DENIAL");
            }

            string alias = Path.Combine(scratch, "alias.txt");
            Check(CreateHardLinkW(alias, file, IntPtr.Zero), "SCRATCH_HARD_LINK_SETUP_FAILED");
            var hardlink = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
            NoAuthority(hardlink);
            Check(!hardlink.DataWriteOpenDenied && !hardlink.TargetIdentityStable,
                "HARD_LINK_ALIAS_MUST_NOT_BE_ATTESTED_AS_AN_ISOLATED_TARGET");
            File.Delete(alias);

            var directory = R7EffectiveWriteDenial.Observe(scratch, identity.AccessToken, sid);
            NoAuthority(directory);
            Check(!directory.DataWriteOpenDenied, "WRITABLE_DIRECTORY_MUST_FAIL_DENIAL");
            Console.WriteLine($"R7_EFFECTIVE_WRITE_PROBE_CHECKS_PASSED={checks}");
        }
        finally
        {
            if (File.Exists(file)) RestoreAcl(file, original);
            // The absolute target was checked inside this test's TEMP root
            // before creation. No production source or custody path is used.
            Directory.Delete(scratch, recursive: true);
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string alias, string existing, IntPtr security);
}
