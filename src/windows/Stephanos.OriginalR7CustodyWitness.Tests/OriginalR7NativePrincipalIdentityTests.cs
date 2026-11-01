using Stephanos.OriginalR7DaclReadback;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Stephanos.OriginalR7CustodyWitness;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7NativePrincipalIdentityTests
{
    private static int total;
    private static void Check(bool value, string label)
    { total++; if (!value) throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_FAILED_" + label); }
    private static void NoAuthority(R7NativePrincipalStamp stamp)
        => Check(!stamp.SourcePrincipalAuthenticated && !stamp.CompleteCapabilityInventoryProven
            && !stamp.HostPolicyAdopted && !stamp.LeaseReleaseAuthorized, "METADATA_IS_NOT_AUTHORITY");

    internal static int Run()
    {
        if (!OpenProcessToken(GetCurrentProcess(), 0x000a, out var original))
            throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_PROCESS_OPEN");
        using (original)
        {
            var first = R7NativePrincipalIdentity.ObserveRetained(original); NoAuthority(first);
            Check(first.NativeIdentityObserved && first.NativeType == 1 && first.IdentityDigest.Length == 64
                && first.MutationDigest.Length == 64, "ACTUAL_PRIMARY_OBJECT_AND_MUTATION_STAMP");
            var second = R7NativePrincipalIdentity.ObserveRetained(original); NoAuthority(second);
            Check(R7NativePrincipalIdentity.SameRetainedObjectAndState(first, second), "STABLE_NATIVE_OBJECT_READBACK");
            if (!DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), out var duplicateHandle, 0, false, 2))
                throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_HANDLE_DUPLICATION");
            using (duplicateHandle)
            {
                var duplicate = R7NativePrincipalIdentity.ObserveRetained(duplicateHandle); NoAuthority(duplicate);
                Check(R7NativePrincipalIdentity.SameRetainedObjectAndState(first, duplicate),
                    "SAME_OBJECT_DIFFERENT_HANDLE_VALUES");
            }
            if (!DuplicateTokenEx(original, 0x0028, IntPtr.Zero, 2, 1, out var ownedClone))
                throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_CLONE_CREATION");
            using (ownedClone)
            {
                var clone = R7NativePrincipalIdentity.ObserveRetained(ownedClone); NoAuthority(clone);
                using var originalIdentity = new WindowsIdentity(original.DangerousGetHandle());
                using var clonedIdentity = new WindowsIdentity(ownedClone.DangerousGetHandle());
                Check(originalIdentity.User?.Value == clonedIdentity.User?.Value, "DUPLICATE_OBJECT_SAME_REAL_SID");
                Check(clone.NativeIdentityObserved && clone.NativeType == 1 && clone.IdentityDigest != first.IdentityDigest,
                    "SAME_SID_PRIMARY_OBJECT_REPLACEMENT_DETECTED");
                Check(!R7NativePrincipalIdentity.SameRetainedObjectAndState(first, clone),
                    "SAME_SID_IS_NOT_SAME_KERNEL_OBJECT");

                // Change ONLY the newly duplicated token, never the current
                // process/thread token. No SetThreadToken/impersonation occurs.
                if (!LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out var luid))
                    throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_PRIVILEGE_LOOKUP");
                var disable = new PrivilegeState { Count = 1, Id = luid, Attributes = 0 };
                if (!AdjustTokenPrivileges(ownedClone, false, ref disable,
                        checked((uint)Marshal.SizeOf<PrivilegeState>()), out var previous, out _)
                    || Marshal.GetLastWin32Error() != 0 || previous.Count != 1)
                    throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_CLONE_DISABLE");
                try
                {
                    var changed = R7NativePrincipalIdentity.ObserveRetained(ownedClone); NoAuthority(changed);
                    Check(changed.NativeIdentityObserved && changed.IdentityDigest == clone.IdentityDigest,
                        "SAME_OBJECT_ID_RETAINED_DURING_OWN_CLONE_CHANGE");
                    Check(changed.MutationDigest != clone.MutationDigest
                        && !R7NativePrincipalIdentity.SameRetainedObjectAndState(clone, changed),
                        "ACTUAL_SECURITY_CONTEXT_MUTATION_DETECTED");
                    var untouched = R7NativePrincipalIdentity.ObserveRetained(original);
                    Check(R7NativePrincipalIdentity.SameRetainedObjectAndState(first, untouched),
                        "CURRENT_PROCESS_SECURITY_CONTEXT_UNCHANGED");
                }
                finally
                {
                    if (!AdjustTokenPrivileges(ownedClone, false, ref previous,
                            checked((uint)Marshal.SizeOf<PrivilegeState>()), out _, out _)
                        || Marshal.GetLastWin32Error() != 0)
                        throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_CLONE_RESTORE");
                }
                var restored = R7NativePrincipalIdentity.ObserveRetained(ownedClone);
                Check(restored.IdentityDigest == clone.IdentityDigest && restored.MutationDigest != clone.MutationDigest,
                    "RESTORING_PRIVILEGES_CANNOT_REUSE_OLD_MUTATION_STAMP");
                // Removal is deliberately irreversible on this OWN disposable
                // clone. Some Windows versions keep ModifiedId unchanged, so
                // the canonical privilege inventory must also bind the state.
                var remove = new PrivilegeState { Count = 1, Id = luid, Attributes = 4 };
                if (!AdjustTokenPrivileges(ownedClone, false, ref remove,
                        checked((uint)Marshal.SizeOf<PrivilegeState>()), out _, out _)
                    || Marshal.GetLastWin32Error() != 0)
                    throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_CLONE_REMOVAL");
                var removed = R7NativePrincipalIdentity.ObserveRetained(ownedClone); NoAuthority(removed);
                // Windows may also leave the statistics privilege count stale.
                // The existing canonical reader deliberately rejects that
                // incoherent snapshot. Preserve UNKNOWN rather than relaxing it.
                Check(removed.NativeIdentityObserved
                    ? removed.IdentityDigest == restored.IdentityDigest && removed.MutationDigest != restored.MutationDigest
                    : removed.NativeType == 0 && removed.IdentityDigest == "" && removed.MutationDigest == "",
                    "REMOVAL_PRODUCES_CHANGED_OR_EXPLICITLY_UNKNOWN_STATE");
                Check(!R7NativePrincipalIdentity.SameRetainedObjectAndState(restored, removed),
                    "ACTUAL_REMOVAL_INVALIDATES_BOUND_PRIVILEGE_STATE");
                Check(R7NativePrincipalIdentity.SameRetainedObjectAndState(first,
                    R7NativePrincipalIdentity.ObserveRetained(original)), "REMOVAL_NEVER_TOUCHES_CURRENT_PROCESS");
            }
            if (!DuplicateTokenEx(original, 0x0008, IntPtr.Zero, 2, 2, out var impersonation))
                throw new InvalidOperationException("R7_NATIVE_PRINCIPAL_FIXTURE_OWN_IMPERSONATION_OBJECT");
            using (impersonation)
            {
                var observed = R7NativePrincipalIdentity.ObserveRetained(impersonation); NoAuthority(observed);
                Check(!observed.NativeIdentityObserved && observed.NativeType == 0 && observed.IdentityDigest == "",
                    "CANONICAL_PRIMARY_ONLY_SCOPE_NOT_BROADENED_TO_IMPERSONATION");
            }
        }
        using (var invalid = new SafeAccessTokenHandle(IntPtr.Zero))
        {
            var unknown = R7NativePrincipalIdentity.ObserveRetained(invalid); NoAuthority(unknown);
            Check(!unknown.NativeIdentityObserved && unknown.NativeType == 0 && unknown.IdentityDigest == ""
                && unknown.MutationDigest == "", "INVALID_HANDLE_IS_UNKNOWN_NOT_IDENTITY");
            Check(!R7NativePrincipalIdentity.SameRetainedObjectAndState(unknown, unknown), "TWO_UNKNOWN_STAMPS_ARE_NOT_CONTINUITY");
        }
        var owner = OriginalR7CommissioningOwnerContext.ObserveCurrent();
        Check(owner.NativePrincipalIdentityDigest.Length == 64 && owner.NativePrincipalMutationDigest.Length == 64,
            "ACTUAL_OWNER_CONTEXT_INCLUDES_KERNEL_IDENTITY");
        Check(!owner.HumanConsentProven && !owner.HostExecutionAuthorized && !owner.LeaseReleaseAuthorized,
            "OWNER_METADATA_STILL_NOT_CONSENT_OR_GRANT");
        Console.WriteLine("R7_NATIVE_PRINCIPAL_IDENTITY_ASSERTIONS_PASSED=" + total);
        Console.WriteLine("R7_CURRENT_PROCESS_PRIVILEGES_CHANGED=false");
        Console.WriteLine("R7_COMPLETE_PRINCIPAL_ESTATE_AUTHENTICATED=false");
        return total;
    }

    [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] private struct PrivilegeState { internal uint Count; internal Luid Id; internal uint Attributes; }
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DuplicateHandle(IntPtr sourceProcess,
        SafeAccessTokenHandle source, IntPtr destinationProcess, out SafeAccessTokenHandle target, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DuplicateTokenEx(SafeAccessTokenHandle token,
        uint access, IntPtr attributes, int level, int type, out SafeAccessTokenHandle duplicate);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AdjustTokenPrivileges(SafeAccessTokenHandle token,
        [MarshalAs(UnmanagedType.Bool)] bool disableAll, ref PrivilegeState changes, uint previousLength,
        out PrivilegeState previous, out uint returned);
}
