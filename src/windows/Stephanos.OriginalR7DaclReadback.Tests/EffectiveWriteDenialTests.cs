using System.Runtime.InteropServices;
using System.Reflection;
using System.Text;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

internal static class EffectiveWriteDenialTests
{
    // These lower-level kernel tests never qualify the supplied token as the
    // original writer. Public admission is tested separately and must reject
    // a filtered test identity rather than silently testing a stripped token.
    private static R7EffectiveWriteObservation SampleKernel(string path, SafeAccessTokenHandle token, string sid)
        => (R7EffectiveWriteObservation)typeof(R7EffectiveWriteDenial)
            .GetMethod("SampleSuppliedTokenAccess", BindingFlags.NonPublic | BindingFlags.Static)!
            .Invoke(null, new object[] { path, token, sid })!;
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
            && !observation.OriginalPrincipalProvenanceAuthenticated
            && !observation.SourceMutationAuthorized && !observation.HistoricalReceiptReconstructed,
            "NATIVE_PROBE_MUST_NOT_GRANT_AUTHORITY");
    }

    internal static void Run()
    {
        PrivilegePolicyChecks();
        NativeNamePolicyChecks();
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
            var publicEntry = R7EffectiveWriteDenial.Observe(file, identity.AccessToken, sid);
            NoAuthority(publicEntry);
            bool qualifiedFormAvailable = publicEntry.Classification != "R7_NATIVE_FILTERED_OR_SPECIAL_TOKEN_UNQUALIFIED";
            if (!qualifiedFormAvailable)
                Check(!publicEntry.SuppliedTokenSidMatched && !publicEntry.DataWriteOpenDenied,
                    "FILTERED_HOST_TOKEN_MUST_BE_REJECTED_AT_PUBLIC_BOUNDARY");
            else
                Check(publicEntry.SuppliedTokenSidMatched && publicEntry.TargetIdentityStable,
                    "UNFILTERED_HOST_TOKEN_ENTRYPOINT_MUST_RUN_NATIVE_PROBE");
            Console.WriteLine("R7_NATIVE_UNFILTERED_ENTRYPOINT_CASE_AVAILABLE=" + qualifiedFormAvailable.ToString().ToLowerInvariant());
            var writable = SampleKernel(file, identity.AccessToken, sid);
            NoAuthority(writable);
            Check(writable.SuppliedTokenSidMatched && writable.TargetIdentityStable,
                "REAL_TOKEN_" + writable.Classification);
            Check(!writable.DataWriteOpenDenied && writable.Classification == "R7_NATIVE_SUPPLIED_TOKEN_CAN_WRITE",
                "WRITABLE_FILE_MUST_NOT_BE_REPORTED_DENIED");

            StringBuilder shortPath = new(512);
            uint shortLength = GetShortPathNameW(file, shortPath, (uint)shortPath.Capacity);
            bool nativeAliasAvailable = shortLength > 0 && shortLength < shortPath.Capacity
                && !string.Equals(shortPath.ToString(), file, StringComparison.OrdinalIgnoreCase);
            if (nativeAliasAvailable)
            {
                var aliasObservation = SampleKernel(shortPath.ToString(), identity.AccessToken, sid);
                NoAuthority(aliasObservation);
                Check(!aliasObservation.TargetIdentityStable && !aliasObservation.DataWriteOpenDenied,
                    "NATIVE_SHORT_NAME_ALIAS_MUST_FAIL_CLOSED");
            }
            Console.WriteLine("R7_NATIVE_SHORT_NAME_ALIAS_TEST_AVAILABLE=" + nativeAliasAvailable.ToString().ToLowerInvariant());

            var wrong = SampleKernel(file, identity.AccessToken, "S-1-5-21-1000-2000-3000-4000");
            NoAuthority(wrong);
            Check(!wrong.SuppliedTokenSidMatched && !wrong.DataWriteOpenDenied,
                "WRONG_PRINCIPAL_MUST_NOT_BE_PROBED");

            using SafeAccessTokenHandle invalid = new(IntPtr.Zero);
            var missingToken = R7EffectiveWriteDenial.Observe(file, invalid, sid);
            NoAuthority(missingToken);
            Check(missingToken.Classification == "R7_NATIVE_SUPPLIED_TOKEN_UNAVAILABLE",
                "MISSING_REAL_TOKEN_MUST_FAIL_CLOSED");

            // Self-restriction is test setup only. No production token is
            // filtered, impersonated to pass a denial, or claimed historical.
            Check(CreateRestrictedToken(identity.AccessToken, 1 /* DISABLE_MAX_PRIVILEGE */,
                0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out SafeAccessTokenHandle filtered),
                "RESTRICTED_TEST_TOKEN_SETUP_FAILED");
            using (filtered)
            {
                using WindowsIdentity restrictedIdentity = new(filtered.DangerousGetHandle());
                Check(restrictedIdentity.User?.Value == sid, "RESTRICTED_TOKEN_RETAINS_SAME_SID");
                var rejected = R7EffectiveWriteDenial.Observe(file, filtered, sid);
                NoAuthority(rejected);
                Check(rejected.Classification == "R7_NATIVE_FILTERED_OR_SPECIAL_TOKEN_UNQUALIFIED"
                    && !rejected.SuppliedTokenSidMatched && !rejected.DataWriteOpenDenied,
                    "FILTERED_SAME_SID_TOKEN_MUST_BE_REJECTED_BEFORE_TARGET_PROBE");
            }

            foreach (string bad in new[] { "relative.txt", @"\\server\share\probe.txt",
                file + ":stream", Path.Combine(scratch, "..", "probe.txt"), file + ".",
                // Before normalization hardening this resolves to the real
                // existing writable sentinel and produced a stable observation.
                scratch + "/../" + Path.GetFileName(scratch) + "\\probe.txt",
                scratch + "\\NUL.txt", scratch + "\\COM1.txt", scratch + "\\LPT\u00b9.txt",
                scratch + "\\NUL .txt", scratch + "\\*.txt" })
            {
                var malformed = SampleKernel(bad, identity.AccessToken, sid);
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
            var observed = SampleKernel(file, identity.AccessToken, sid);
            NoAuthority(observed);
            Check(observed.DataWriteOpenDenied && observed.TargetIdentityStable,
                "KERNEL_MUST_DENY_BOTH_WRITE_AND_APPEND_OPENS");
            // Runner-created files may be owned by the user SID or by an
            // enabled Administrators SID. Never manufacture owner evidence
            // from identity.User: classify the actual native owner/readback.
            Console.WriteLine("R7_NATIVE_SCRATCH_OWNER_SID_MATCHED="
                + observed.SuppliedPrincipalOwnsTarget.ToString().ToLowerInvariant());
            string expectedPolicyClassification = observed.SuppliedPrincipalOwnsTarget
                ? "R7_NATIVE_DATA_DENIED_BUT_SUPPLIED_PRINCIPAL_OWNS_TARGET"
                : observed.TokenHasBypassAuthority
                    ? "R7_NATIVE_DATA_DENIED_BUT_TOKEN_CAN_BYPASS_POLICY"
                    : !observed.DaclWriteOpenDenied || !observed.OwnerWriteOpenDenied
                        ? "R7_NATIVE_POLICY_REWRITE_NOT_DENIED"
                        : "R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY";
            Check(observed.Classification == expectedPolicyClassification,
                "NATIVE_OWNER_AND_TOKEN_POLICY_MUST_MATCH_ACTUAL_ACCESS_FACTS");
            Check(observed.Classification != "R7_NATIVE_OPEN_DENIAL_OBSERVED_NOT_CUSTODY"
                || (!observed.SuppliedPrincipalOwnsTarget && !observed.TokenHasBypassAuthority
                    && observed.DaclWriteOpenDenied && observed.OwnerWriteOpenDenied),
                "NATIVE_PROBE_MUST_NOT_REPORT_DENIAL_WITH_A_KNOWN_REWRITE_PATH");
            Check(File.ReadAllText(file) == "unchanged sentinel", "PROBE_MUST_NOT_CHANGE_FILE_CONTENTS");
            RestoreAcl(file, original);

            // Denying one operation cannot attest denial of another. In
            // particular a combined write+append access request is inadequate.
            FileSecurity appendAllowed = new FileInfo(file).GetAccessControl();
            appendAllowed.AddAccessRule(new FileSystemAccessRule(identity.User,
                FileSystemRights.WriteData, AccessControlType.Deny));
            new FileInfo(file).SetAccessControl(appendAllowed);
            var partial = SampleKernel(file, identity.AccessToken, sid);
            NoAuthority(partial);
            Check(!partial.DataWriteOpenDenied, "WRITE_ONLY_DENY_CANNOT_PROVE_APPEND_DENIAL");
            RestoreAcl(file, original);

            using (var locked = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                var sharing = SampleKernel(file, identity.AccessToken, sid);
                NoAuthority(sharing);
                Check(!sharing.DataWriteOpenDenied, "SHARING_VIOLATION_MUST_NOT_COUNT_AS_ACCESS_DENIAL");
            }

            string alias = Path.Combine(scratch, "alias.txt");
            Check(CreateHardLinkW(alias, file, IntPtr.Zero), "SCRATCH_HARD_LINK_SETUP_FAILED");
            var hardlink = SampleKernel(file, identity.AccessToken, sid);
            NoAuthority(hardlink);
            Check(!hardlink.DataWriteOpenDenied && !hardlink.TargetIdentityStable,
                "HARD_LINK_ALIAS_MUST_NOT_BE_ATTESTED_AS_AN_ISOLATED_TARGET");
            File.Delete(alias);

            var directory = SampleKernel(scratch, identity.AccessToken, sid);
            NoAuthority(directory);
            Check(!directory.DataWriteOpenDenied && !directory.TargetIdentityStable
                && directory.Classification == "R7_NATIVE_TARGET_NONCANONICAL_OR_UNAVAILABLE",
                "DIRECTORY_MUST_BE_REJECTED_AS_NON_FILE_BEFORE_WRITE_PROBES");
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

    private static void NativeNamePolicyChecks()
    {
        MethodInfo policy = typeof(R7EffectiveWriteDenial).GetMethod("NativeNameMatches",
            BindingFlags.NonPublic | BindingFlags.Static)!;
        bool Match(string supplied, string native)
            => (bool)policy.Invoke(null, new object[] { supplied, native })!;
        Check(Match(@"C:\source\LongFilename.txt", @"\\?\C:\source\LongFilename.txt"),
            "EXACT_NATIVE_NORMALIZED_NAME_MUST_MATCH");
        Check(!Match(@"C:\source\LONGFI~1.TXT", @"\\?\C:\source\LongFilename.txt"),
            "SHORT_FILE_ALIAS_CANNOT_BIND_LONG_NATIVE_NAME");
        Check(!Match(@"C:\LONGDI~1\probe.txt", @"\\?\C:\LongDirectory\probe.txt"),
            "SHORT_ANCESTOR_ALIAS_CANNOT_BIND_LONG_NATIVE_NAME");
        Check(!Match(@"C:\source\probe.txt", @"\\?\D:\source\probe.txt"),
            "VOLUME_NAMESPACE_ALIAS_MUST_NOT_BIND");
        Check(!Match(@"C:\source\probe.txt", @"C:\source\probe.txt"),
            "MISSING_NATIVE_NAMESPACE_PREFIX_MUST_NOT_BIND");
    }

    private static void PrivilegePolicyChecks()
    {
        MethodInfo policy = typeof(R7EffectiveWriteDenial).GetMethod("HasUnqualifiedPrivileges",
            BindingFlags.NonPublic | BindingFlags.Static)!;
        bool Denied(byte[] bytes) => (bool)policy.Invoke(null, new object[] { bytes })!;
        byte[] Inventory(uint attributes, params Luid[] ids)
        {
            byte[] bytes = new byte[4 + ids.Length * 12];
            BitConverter.GetBytes((uint)ids.Length).CopyTo(bytes, 0);
            for (int i = 0; i < ids.Length; i++)
            {
                BitConverter.GetBytes(ids[i].Low).CopyTo(bytes, 4 + i * 12);
                BitConverter.GetBytes(ids[i].High).CopyTo(bytes, 8 + i * 12);
                BitConverter.GetBytes(attributes).CopyTo(bytes, 12 + i * 12);
            }
            return bytes;
        }
        // These are policy fixtures, never an OS token or production proof.
        // No privilege is granted, enabled or removed from the test process.
        Check(LookupPrivilegeValueW(null, "SeChangeNotifyPrivilege", out Luid safe), "SAFE_LUID_LOOKUP_FAILED");
        Check(LookupPrivilegeValueW(null, "SeRelabelPrivilege", out Luid relabel), "RELABEL_LUID_LOOKUP_FAILED");
        Check(!Denied(Inventory(0)), "EMPTY_PRIVILEGE_INVENTORY_IS_QUALIFIED");
        Check(!Denied(Inventory(2, safe)), "ONLY_TRAVERSAL_PRIVILEGE_IS_QUALIFIED");
        Check(Denied(Inventory(0, relabel)), "DISABLED_RELABEL_PRIVILEGE_MUST_HOLD");
        Check(Denied(Inventory(2, relabel)), "ENABLED_RELABEL_PRIVILEGE_MUST_HOLD");
        Check(Denied(Inventory(0, new Luid { Low = uint.MaxValue, High = int.MaxValue })),
            "UNKNOWN_FUTURE_PRIVILEGE_MUST_HOLD");
        Check(Denied(Inventory(0, safe, relabel)), "SAFE_PRIVILEGE_CANNOT_HIDE_UNQUALIFIED_ONE");
        try { Denied(new byte[3]); throw new InvalidOperationException("TRUNCATED_NATIVE_BUFFER_MUST_THROW"); }
        catch (TargetInvocationException error) when (error.InnerException is InvalidDataException) { checks++; }
        try { Denied(new byte[] { 1, 0, 0, 0 }); throw new InvalidOperationException("INCOMPLETE_NATIVE_PRIVILEGES_MUST_THROW"); }
        catch (TargetInvocationException error) when (error.InnerException is InvalidDataException) { checks++; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Luid { internal uint Low; internal int High; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValueW(string? system, string name, out Luid luid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string alias, string existing, IntPtr security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathNameW(string path, StringBuilder shortPath, uint length);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags,
        uint disableCount, IntPtr disableSids, uint privilegeCount, IntPtr deletePrivileges,
        uint restrictCount, IntPtr restrictSids, out SafeAccessTokenHandle restricted);
}
