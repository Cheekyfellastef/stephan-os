using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

internal sealed record R7SnapshotRegion(nint BaseAddress, ulong Bytes, uint State, uint Protection, uint Type);

internal sealed record R7RetainedRegionDiscovery(string Classification,
    bool RetainedProcessAndPrimaryTokenStable, bool SnapshotWalksReachedEnd,
    bool SnapshotResourcesReleased, IReadOnlyList<R7SnapshotRegion> Regions)
{
    // Region metadata supplies neither backing-file IDs nor continuous proof.
    internal bool HandleTableObserved => false;
    internal bool CompleteEstateObserved => false;
    internal bool ZeroWritersProven => false;
    internal bool ContinuousCustodyProven => false;
    internal bool LeaseReleaseAuthorized => false;
    internal bool AuthenticatedOsWitness => false;
}

// Supported Windows Process Snapshotting metadata discovery on ONE already
// retained subject. No PID selector, global discovery, VA clone, page reads,
// threads/context, object names, root enrollment, signing or mutation endpoint.
// PSS native calls are not cancellable by this cooperative deadline. Run only
// in a qualified disposable collector; the owned job fixture is preparation.
internal static class R7RetainedRegionSnapshotDiscovery
{
    // HANDLES collection faulted in this host's isolated native diagnostics;
    // never silently substitute a guessed/empty handle inventory for evidence.
    internal const uint CaptureFlags = 0x800; // VA_SPACE only, no VA_CLONE.
    internal const int MaximumRegions = 16384;
    private const int BudgetMilliseconds = 2000;
    private const uint NoMoreItems = 259;

    internal static R7RetainedRegionDiscovery Discover(SafeProcessHandle process,
        int expectedPid, long expectedCreation, string expectedPrimarySid)
    {
        static R7RetainedRegionDiscovery Incomplete(string stage) =>
            new("INCOMPLETE_" + stage, false, false, false, []);
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || process is null || process.IsClosed || process.IsInvalid
            || expectedPid <= 0 || expectedCreation <= 0)
            return Incomplete("SNAPSHOT_SUBJECT_OR_ARCHITECTURE");
        bool retained = false;
        nint snapshot = 0, regionWalk = 0;
        bool cleanup = true;
        var result = Incomplete("SNAPSHOT_NOT_CAPTURED");
        long began = Stopwatch.GetTimestamp();
        string stage = "SNAPSHOT_INPUT";
        try
        {
            process.DangerousAddRef(ref retained);
            if (GetProcessId(process) != expectedPid
                || !R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreation)
                || !IsWow64Process2(process, out ushort machine, out ushort nativeMachine)
                || machine != 0 || nativeMachine != 0x8664)
                throw new InvalidOperationException();
            stage = "SNAPSHOT_PRIMARY";
            if (!OpenProcessToken(process, 8, out SafeAccessTokenHandle token))
            { token?.Dispose(); throw new InvalidOperationException(); }
            using (token)
            {
                var principal = R7NativePrincipalIdentity.ObserveRetained(token);
                using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
                    if (!principal.NativeIdentityObserved || identity.User is null
                        || !identity.User.Equals(new SecurityIdentifier(expectedPrimarySid)))
                        throw new InvalidOperationException();
                // PSS_CAPTURE_VA_SPACE captures metadata, never page contents.
                // https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ne-processsnapshot-pss_capture_flags
                stage = "SNAPSHOT_CAPTURE";
                CheckBudget(began);
                if (PssCaptureSnapshot(process, CaptureFlags, 0, out snapshot) != 0 || snapshot == 0)
                    throw new InvalidOperationException();
                if (PssWalkMarkerCreate(0, out regionWalk) != 0 || regionWalk == 0)
                    throw new InvalidOperationException();
                var regions = new List<R7SnapshotRegion>();
                ulong previousEnd = 0;
                stage = "SNAPSHOT_REGION_WALK";
                for (;;)
                {
                    CheckBudget(began);
                    uint status = WalkRegion(snapshot, 1, regionWalk, out RegionEntry entry, (uint)Marshal.SizeOf<RegionEntry>());
                    if (status == NoMoreItems) break;
                    ulong address = (ulong)(nuint)entry.BaseAddress, bytes = (ulong)entry.RegionSize;
                    if (status != 0 || regions.Count >= MaximumRegions || entry.BaseAddress < 0
                        || bytes == 0 || address < previousEnd || bytes > long.MaxValue - address)
                        throw new InvalidOperationException();
                    previousEnd = address + bytes;
                    regions.Add(new(entry.BaseAddress, bytes, entry.State, entry.Protect, entry.Type));
                }
                stage = "SNAPSHOT_PRIMARY_RECHECK";
                if (!OpenProcessToken(process, 8, out SafeAccessTokenHandle current))
                { current?.Dispose(); throw new InvalidOperationException(); }
                using (current)
                    if (!CompareObjectHandles(token, current)
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(principal, R7NativePrincipalIdentity.ObserveRetained(token))
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(principal, R7NativePrincipalIdentity.ObserveRetained(current)))
                        throw new InvalidOperationException();
                if (GetProcessId(process) != expectedPid
                    || !R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreation))
                    throw new InvalidOperationException();
                CheckBudget(began);
                result = new("RETAINED_PROCESS_SNAPSHOT_METADATA_NOT_CUSTODY", true, true, false,
                    regions.AsReadOnly());
            }
        }
        catch { result = Incomplete(stage); }
        finally
        {
            // PssCaptureSnapshot creates the snapshot in THIS process. Never
            // pass the remote subject to PssFreeSnapshot or CloseHandle HPSS.
            if (regionWalk != 0 && PssWalkMarkerFree(regionWalk) != 0) cleanup = false;
            if (snapshot != 0 && PssFreeSnapshot(GetCurrentProcess(), snapshot) != 0) cleanup = false;
            if (retained) process.DangerousRelease();
        }
        return cleanup ? result with { SnapshotResourcesReleased = true }
            : Incomplete("SNAPSHOT_RESOURCE_CLEANUP_UNPROVEN");
    }

    private static void CheckBudget(long began)
    { if (Stopwatch.GetElapsedTime(began).TotalMilliseconds > BudgetMilliseconds) throw new TimeoutException(); }

    // Exact Windows x64 processsnapshot.h layouts; no dereference of snapshot
    // string pointers, section data, thread contexts or arbitrary buffers.
    [StructLayout(LayoutKind.Sequential)]
    private struct RegionEntry
    {
        internal nint BaseAddress, AllocationBase;
        internal uint AllocationProtect;
        internal nuint RegionSize;
        internal uint State, Protect, Type, TimeDateStamp, SizeOfImage;
        internal nint ImageBase;
        internal uint CheckSum;
        internal ushort MappedFileNameLength;
        internal nint MappedFileName;
    }
    [DllImport("kernel32.dll")] private static extern uint PssCaptureSnapshot(SafeProcessHandle process, uint flags, uint context, out nint snapshot);
    [DllImport("kernel32.dll")] private static extern uint PssWalkMarkerCreate(nint allocator, out nint marker);
    [DllImport("kernel32.dll")] private static extern uint PssWalkMarkerFree(nint marker);
    [DllImport("kernel32.dll")] private static extern uint PssFreeSnapshot(nint process, nint snapshot);
    [DllImport("kernel32.dll", EntryPoint = "PssWalkSnapshot")] private static extern uint WalkRegion(nint snapshot, uint kind, nint marker, out RegionEntry entry, uint size);
    [DllImport("kernel32.dll")] private static extern nint GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process2(SafeProcessHandle process, out ushort processMachine, out ushort nativeMachine);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
    [DllImport("kernelbase.dll", SetLastError = true)] private static extern bool CompareObjectHandles(SafeHandle first, SafeHandle second);
}
