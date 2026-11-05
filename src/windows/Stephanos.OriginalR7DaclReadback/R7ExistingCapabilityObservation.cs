using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

// Private mechanism for a future qualified estate collector. Explicit retained
// subjects only: no PID/path selector, process discovery, arbitrary endpoint or
// complete-inventory inference. Positive capabilities are useful even though
// every result remains INCOMPLETE as whole-estate/custody evidence.
internal sealed record R7ExistingHandleSample(int Index, string Classification,
    uint GrantedAccess, bool FileIdentityMatchesTarget, bool SameObjectAtBothSamples)
{
    internal bool DataWriteGranted => FileIdentityMatchesTarget && (GrantedAccess & 6) != 0;
    internal bool WriteDacGranted => FileIdentityMatchesTarget && (GrantedAccess & 0x40000) != 0;
    internal bool WriteOwnerGranted => FileIdentityMatchesTarget && (GrantedAccess & 0x80000) != 0;
}

internal sealed record R7ExistingViewSample(int Index, string Classification,
    uint Protection, ulong RegionBytes, bool WritableMappedViewObserved,
    bool TargetNativeNameCorrelated, bool SameRegionAtBothSamples)
{
    // Windows' supported GetMappedFileName supplies a NAME, not a kernel file
    // ID. Do not upgrade name equality to authenticated backing-file identity.
    internal bool BackingFileIdentityAuthenticated => false;
}

internal sealed record R7ExistingCapabilitySample(string Classification,
    bool RetainedProcessAndPrimaryTokenStable, string TargetFileIdentityDigest,
    IReadOnlyList<R7ExistingHandleSample> Handles, IReadOnlyList<R7ExistingViewSample> Views)
{
    internal bool CompleteEstateObserved => false;
    internal bool ZeroWritersProven => false;
    internal bool ContinuousCustodyProven => false;
    internal bool AuthenticatedOsWitness => false;
    internal bool LeaseReleaseAuthorized => false;
    internal bool SourceMutationAuthorized => false;
    internal bool HistoricalReceiptReconstructed => false;
}

internal static class R7ExistingCapabilityObservation
{
    internal const int MaxHandles = 16, MaxViews = 16;
    internal const int CooperativeBudgetMilliseconds = 2000;
    private const int MaxNameCharacters = 1024;
    private static readonly Lazy<QueryObjectDelegate> QueryObject = new(LoadQueryObject);

    // The future caller must own/qualify the retained objects and isolate this
    // mechanism in a bounded owned diagnostic process. Cooperative deadline
    // checks cannot cancel a blocked kernel/filesystem/driver call. This method
    // does not start a thread, terminate a subject or falsely promise hard timeout.
    internal static R7ExistingCapabilitySample ObserveRetained(
        SafeProcessHandle process, int expectedPid, long expectedCreationFileTimeUtc,
        string expectedPrimarySid, SafeFileHandle target,
        IReadOnlyList<nint> existingHandles, IReadOnlyList<nint> existingViewAddresses)
    {
        static R7ExistingCapabilitySample Incomplete(string code)
            => new(code, false, "", Array.Empty<R7ExistingHandleSample>(), Array.Empty<R7ExistingViewSample>());
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
            return Incomplete("INCOMPLETE_WINDOWS_X64_REQUIRED");
        if (process is null || process.IsInvalid || process.IsClosed
            || target is null || target.IsInvalid || target.IsClosed
            || existingHandles is null || existingViewAddresses is null
            || existingHandles.Count > MaxHandles || existingViewAddresses.Count > MaxViews
            || expectedPid <= 0 || expectedCreationFileTimeUtc <= 0)
            return Incomplete("INCOMPLETE_SUBJECT_OR_BUDGET_INVALID");
        bool retainedProcess = false, retainedTarget = false;
        var duplicates = new List<SafeFileHandle>();
        long began = Stopwatch.GetTimestamp();
        string stage = "INPUT";
        try
        {
            // Copy bounded indices before any native query. A changing caller
            // collection never becomes evidence for a different subject.
            nint[] handles = CopyBounded(existingHandles, MaxHandles), views = CopyBounded(existingViewAddresses, MaxViews);
            if (handles.Length > MaxHandles || views.Length > MaxViews
                || handles.Any(h => h <= 0) || views.Any(v => v <= 0)
                || handles.Distinct().Count() != handles.Length || views.Distinct().Count() != views.Length)
                return Incomplete("INCOMPLETE_SUBJECT_OR_BUDGET_INVALID");
            process.DangerousAddRef(ref retainedProcess);
            target.DangerousAddRef(ref retainedTarget);
            if (GetProcessId(process) != expectedPid
                || !R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreationFileTimeUtc))
                return Incomplete("INCOMPLETE_PROCESS_IDENTITY");
            if (!OpenProcessToken(process, 8 /* TOKEN_QUERY only */, out SafeAccessTokenHandle token))
            { token?.Dispose(); return Incomplete("INCOMPLETE_PRIMARY_TOKEN_ACCESS"); }
            using (token)
            {
                stage = "PRIMARY_STAMP";
                R7NativePrincipalStamp nativePrincipal = R7NativePrincipalIdentity.ObserveRetained(token);
                if (!nativePrincipal.NativeIdentityObserved || nativePrincipal.NativeType != 1)
                    return Incomplete("INCOMPLETE_PRIMARY_NATIVE_OBJECT");
                using (WindowsIdentity identity = new(token.DangerousGetHandle()))
                    if (identity.User is null || !identity.User.Equals(new SecurityIdentifier(expectedPrimarySid)))
                        return Incomplete("INCOMPLETE_PRIMARY_SID_MISMATCH");
                if (GetFileType(target) != 1 /* FILE_TYPE_DISK */
                    || !R7EffectiveWriteDenial.TryIdentity(target, out var targetIdentity))
                    return Incomplete("INCOMPLETE_TARGET_NATIVE_IDENTITY");
                stage = "TARGET_NATIVE_NAME";
                string targetName = NativeName(target);
                var handleSamples = new List<R7ExistingHandleSample>();
                var viewSamples = new List<R7ExistingViewSample>();
                var viewFingerprints = new List<string>();
                foreach (nint handle in handles)
                {
                    stage = "HANDLE_METADATA";
                    CheckBudget(began);
                    int index = handleSamples.Count;
                    if (!DuplicateHandle(process, handle, GetCurrentProcess(), out SafeFileHandle duplicate,
                        0, false, 2 /* SAME_ACCESS; NEVER CLOSE_SOURCE */))
                    {
                        duplicate?.Dispose();
                        handleSamples.Add(new(index, "INCOMPLETE_EXISTING_HANDLE_DUPLICATION", 0, false, false));
                        continue;
                    }
                    duplicates.Add(duplicate);
                    // Query granted rights on the SAME retained duplicate used
                    // for file identity, rather than joining a stale handle table
                    // entry to a new object after source handle-number reuse.
                    uint access = GrantedAccess(duplicate);
                    bool file = GetFileType(duplicate) == 1;
                    bool matches = file && R7EffectiveWriteDenial.TryIdentity(duplicate, out var actual)
                        && actual == targetIdentity;
                    handleSamples.Add(new(index, matches
                        ? "EXISTING_TARGET_HANDLE_OBSERVED" : "INCOMPLETE_HANDLE_TARGET_IDENTITY",
                        access, matches, false));
                }
                foreach (nint address in views)
                {
                    stage = "VIEW_METADATA";
                    CheckBudget(began);
                    viewSamples.Add(View(process, address, targetName, viewSamples.Count));
                    viewFingerprints.Add(ViewFingerprint(process, address));
                }
                // Re-duplicate through the SAME process object and compare
                // underlying kernel objects, not just source handle numbers.
                // This proves two samples, never uninterrupted possession.
                for (int i = 0, retainedIndex = 0; i < handles.Length; i++)
                {
                    stage = "HANDLE_RECHECK";
                    CheckBudget(began);
                    if (handleSamples[i].Classification == "INCOMPLETE_EXISTING_HANDLE_DUPLICATION") continue;
                    SafeFileHandle first = duplicates[retainedIndex++];
                    bool same = false;
                    if (DuplicateHandle(process, handles[i], GetCurrentProcess(), out SafeFileHandle last, 0, false, 2))
                    {
                        using (last) same = CompareObjectHandles(first, last)
                            && GrantedAccess(last) == handleSamples[i].GrantedAccess
                            && GrantedAccess(first) == handleSamples[i].GrantedAccess;
                    }
                    else last?.Dispose();
                    handleSamples[i] = handleSamples[i] with { SameObjectAtBothSamples = same,
                        Classification = same ? handleSamples[i].Classification : "INCOMPLETE_HANDLE_CHANGED_OR_CLOSED" };
                }
                for (int i = 0; i < views.Length; i++)
                {
                    stage = "VIEW_RECHECK";
                    CheckBudget(began);
                    R7ExistingViewSample again = View(process, views[i], targetName, i);
                    // View fingerprint also includes exact base/allocation,
                    // state/type/name. Equality of names does not give file ID.
                    bool same = ViewFingerprint(process, views[i]) == viewFingerprints[i];
                    viewSamples[i] = viewSamples[i] with { SameRegionAtBothSamples = same && again == viewSamples[i] };
                }
                stage = "PRIMARY_RECHECK";
                if (!OpenProcessToken(process, 8, out SafeAccessTokenHandle current))
                { current?.Dispose(); return Incomplete("INCOMPLETE_PRIMARY_TOKEN_RECHECK"); }
                using (current)
                    if (!CompareObjectHandles(token, current)
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(nativePrincipal, R7NativePrincipalIdentity.ObserveRetained(token))
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(nativePrincipal, R7NativePrincipalIdentity.ObserveRetained(current))
                        )
                        return Incomplete("INCOMPLETE_PRIMARY_TOKEN_CHANGED");
                if (!R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreationFileTimeUtc)
                    || !R7EffectiveWriteDenial.TryIdentity(target, out var after) || after != targetIdentity
                    || NativeName(target) != targetName)
                    return Incomplete("INCOMPLETE_PROCESS_OR_TARGET_CHANGED");
                CheckBudget(began);
                string fileDigest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                    $"{targetIdentity.Volume:x8}:{targetIdentity.High:x8}:{targetIdentity.Low:x8}"))).ToLowerInvariant();
                return new("INCOMPLETE_ESTATE_POSITIVE_SAMPLES_ONLY", true, fileDigest,
                    handleSamples.AsReadOnly(), viewSamples.AsReadOnly());
            }
        }
        catch (BudgetExceeded) { return Incomplete("INCOMPLETE_COOPERATIVE_BUDGET_EXCEEDED"); }
        catch { return Incomplete("INCOMPLETE_NATIVE_OBSERVATION_FAILED_" + stage); }
        finally
        {
            foreach (SafeFileHandle duplicate in duplicates) duplicate.Dispose();
            if (retainedTarget) target.DangerousRelease();
            if (retainedProcess) process.DangerousRelease();
        }
    }

    private static void CheckBudget(long began)
    {
        if (Stopwatch.GetElapsedTime(began).TotalMilliseconds > CooperativeBudgetMilliseconds)
            throw new BudgetExceeded();
    }
    private sealed class BudgetExceeded : Exception { }
    private static nint[] CopyBounded(IReadOnlyList<nint> values, int maximum)
    {
        int count = values.Count;
        if (count < 0 || count > maximum) throw new InvalidOperationException();
        nint[] result = new nint[count];
        for (int i = 0; i < count; i++) result[i] = values[i];
        if (values.Count != count) throw new InvalidOperationException();
        return result;
    }
    private static uint GrantedAccess(SafeFileHandle handle)
    {
        byte[] info = new byte[56]; // PUBLIC_OBJECT_BASIC_INFORMATION
        if (QueryObject.Value(handle, 0 /* ObjectBasicInformation */, info, (uint)info.Length, out uint actual) != 0
            || actual != info.Length) throw new InvalidOperationException();
        return BitConverter.ToUInt32(info, 4);
    }
    private static QueryObjectDelegate LoadQueryObject()
    {
        // Documented compatibility-sensitive entry point. Missing/changed API
        // is INCOMPLETE; do not guess undocumented object layouts or syscalls.
        nint library = NativeLibrary.Load(Path.Combine(Environment.SystemDirectory, "ntdll.dll"));
        return Marshal.GetDelegateForFunctionPointer<QueryObjectDelegate>(NativeLibrary.GetExport(library, "NtQueryObject"));
    }
    private static string NativeName(SafeFileHandle file)
    {
        StringBuilder name = new(MaxNameCharacters);
        uint length = GetFinalPathNameByHandleW(file, name, (uint)name.Capacity, 2 /* VOLUME_NAME_NT */);
        if (length == 0 || length >= name.Capacity) throw new InvalidOperationException();
        return name.ToString();
    }
    private static R7ExistingViewSample View(SafeProcessHandle process, nint address, string targetName, int index)
    {
        MemoryBasic info = Region(process, address);
        StringBuilder name = new(MaxNameCharacters);
        uint length = K32GetMappedFileNameW(process, address, name, (uint)name.Capacity);
        if (length == 0 || length >= name.Capacity)
            return new(index, "INCOMPLETE_VIEW_BACKING_NAME", info.Protect, (ulong)info.RegionSize, false, false, false);
        bool mapped = info.State == 0x1000 /* COMMIT */ && info.Type == 0x40000 /* MEM_MAPPED */;
        uint protection = info.Protect & 0xff;
        // WRITECOPY grants private-copy changes, not shared-file writes.
        // PAGE_GUARD is a one-shot alarm, not removal of the underlying
        // writable mapping capability. Metadata observation must not touch
        // the page or clear its guard, and must still report that capability.
        bool writable = mapped && (protection is 4 or 0x40);
        return new(index, writable ? "WRITABLE_MAPPED_VIEW_OBSERVED_FILE_ID_UNRESOLVED" : "VIEW_METADATA_OBSERVED",
            info.Protect, (ulong)info.RegionSize, writable,
            string.Equals(name.ToString(), targetName, StringComparison.OrdinalIgnoreCase), false);
    }
    private static MemoryBasic Region(SafeProcessHandle process, nint address)
    {
        if (VirtualQueryEx(process, address, out MemoryBasic info, (nuint)Marshal.SizeOf<MemoryBasic>()) != (nuint)Marshal.SizeOf<MemoryBasic>()
            || info.BaseAddress > address || info.RegionSize == 0
            || (nuint)(address - info.BaseAddress) >= info.RegionSize) throw new InvalidOperationException();
        return info;
    }
    private static string ViewFingerprint(SafeProcessHandle process, nint address)
    {
        MemoryBasic info = Region(process, address);
        StringBuilder name = new(MaxNameCharacters);
        uint count = K32GetMappedFileNameW(process, address, name, (uint)name.Capacity);
        if (count == 0 || count >= name.Capacity) throw new InvalidOperationException();
        return $"{info.BaseAddress:x}:{info.AllocationBase:x}:{info.AllocationProtect:x}:{info.RegionSize:x}:{info.State:x}:{info.Protect:x}:{info.Type:x}:{name}";
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryBasic
    {
        internal nint BaseAddress, AllocationBase;
        internal uint AllocationProtect;
        internal ushort PartitionId;
        internal nuint RegionSize;
        internal uint State, Protect, Type;
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int QueryObjectDelegate(SafeFileHandle handle, int kind, [Out] byte[] info, uint size, out uint actual);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(SafeProcessHandle process, nint original, nint targetProcess,
        out SafeFileHandle duplicate, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("kernel32.dll")] private static extern nint GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetFileType(SafeFileHandle file);
    [DllImport("kernelbase.dll", SetLastError = true)] private static extern bool CompareObjectHandles(SafeHandle first, SafeHandle second);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder name, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint K32GetMappedFileNameW(SafeProcessHandle process, nint address, StringBuilder name, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nuint VirtualQueryEx(SafeProcessHandle process, nint address, out MemoryBasic info, nuint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
}
