using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

internal sealed record R7HandleMetadataCandidate(nint Value, uint GrantedAccess, uint ObjectTypeIndex, uint Attributes);
internal sealed record R7RetainedHandleDiscovery(string Classification,
    bool RetainedProcessAndPrimaryTokenStable, bool NativeBufferDecoded,
    IReadOnlyList<R7HandleMetadataCandidate> Candidates)
{
    internal bool CapturedHandleObjectsRetained => false;
    internal bool FileIdentityAuthenticated => false;
    internal bool CompleteEstateObserved => false;
    internal bool ZeroWritersProven => false;
    internal bool ContinuousCustodyProven => false;
    internal bool LeaseReleaseAuthorized => false;
    internal bool AuthenticatedOsWitness => false;
}

// PRIVATE compatibility-sensitive diagnostic prerequisite, NOT a complete
// producer. No PSS handle capture, global query, object-name query, page read,
// duplication, source handle close, guessed SID or PID-based reopening.
internal static class R7RetainedHandleMetadataDiscovery
{
    internal const int MaximumHandles = 4096;
    internal const int HeaderBytes = 16, EntryBytes = 40;
    private const int BufferBytes = HeaderBytes + MaximumHandles * EntryBytes;
    private static readonly Lazy<QueryProcessDelegate> Query = new(LoadQuery);

    internal static R7RetainedHandleDiscovery Discover(SafeProcessHandle process,
        int expectedPid, long expectedCreation, string expectedPrimarySid)
    {
        static R7RetainedHandleDiscovery Unknown(string stage) => new("INCOMPLETE_" + stage, false, false, []);
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || process is null || process.IsInvalid || process.IsClosed || expectedPid <= 0 || expectedCreation <= 0)
            return Unknown("HANDLE_METADATA_SUBJECT");
        bool retained = false;
        long began = Stopwatch.GetTimestamp();
        string stage = "HANDLE_METADATA_BINDING";
        try
        {
            process.DangerousAddRef(ref retained);
            if (GetProcessId(process) != expectedPid
                || !R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreation)
                || !IsWow64Process2(process, out ushort machine, out ushort nativeMachine)
                || machine != 0 || nativeMachine != 0x8664)
                return Unknown(stage);
            if (!OpenProcessToken(process, 8, out SafeAccessTokenHandle token))
            { token?.Dispose(); return Unknown(stage); }
            using (token)
            {
                var first = R7NativePrincipalIdentity.ObserveRetained(token);
                using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
                    if (!first.NativeIdentityObserved || identity.User is null
                        || !identity.User.Equals(new SecurityIdentifier(expectedPrimarySid)))
                        return Unknown(stage);
                stage = "HANDLE_METADATA_NATIVE_QUERY";
                // Internal information class51 is not a public Windows
                // compatibility contract. Its exact x64 layout is referenced
                // by pinned primary phnt source, not guessed from PSS output:
                // https://github.com/winsiderss/phnt/blob/53fbbdc5b5d2b08761db1c7b26bfa8c820924356/ntpsapi.h
                // Any status/length/count/layout mismatch is UNKNOWN, without
                // retrying an unbounded allocation or the faulting PSS route.
                byte[] buffer = new byte[BufferBytes];
                if (Query.Value(process, 51, buffer, (uint)buffer.Length, out uint actual) != 0
                    || !TryDecode(buffer, actual, out var candidates)) return Unknown(stage);
                stage = "HANDLE_METADATA_NATIVE_RECHECK";
                if (!OpenProcessToken(process, 8, out SafeAccessTokenHandle current))
                { current?.Dispose(); return Unknown(stage); }
                using (current)
                    if (!CompareObjectHandles(token, current)
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(first, R7NativePrincipalIdentity.ObserveRetained(token))
                        || !R7NativePrincipalIdentity.SameRetainedObjectAndState(first, R7NativePrincipalIdentity.ObserveRetained(current)))
                        return Unknown(stage);
                if (GetProcessId(process) != expectedPid
                    || !R7ProcessBoundWriteDenial.MatchesLiveProcess(process, expectedCreation)
                    || Stopwatch.GetElapsedTime(began) > TimeSpan.FromSeconds(2)) return Unknown(stage);
                return new("RETAINED_HANDLE_METADATA_CANDIDATES_NOT_CUSTODY", true, true, candidates);
            }
        }
        catch { return Unknown(stage); }
        finally { if (retained) process.DangerousRelease(); }
    }

    internal static bool TryDecode(ReadOnlySpan<byte> buffer, uint actual,
        out IReadOnlyList<R7HandleMetadataCandidate> candidates)
    {
        candidates = [];
        if (actual < HeaderBytes || actual > BufferBytes || actual > buffer.Length) return false;
        buffer = buffer[..(int)actual];
        ulong count = BinaryPrimitives.ReadUInt64LittleEndian(buffer);
        if (count > MaximumHandles || BinaryPrimitives.ReadUInt64LittleEndian(buffer[8..]) != 0
            || actual != HeaderBytes + count * EntryBytes) return false;
        var rows = new List<R7HandleMetadataCandidate>((int)count);
        var unique = new HashSet<ulong>();
        for (int i = 0; i < (int)count; i++)
        {
            var row = buffer.Slice(HeaderBytes + i * EntryBytes, EntryBytes);
            ulong value = BinaryPrimitives.ReadUInt64LittleEndian(row);
            if (value == 0 || value > long.MaxValue || !unique.Add(value)
                || BinaryPrimitives.ReadUInt32LittleEndian(row[36..]) != 0) return false;
            rows.Add(new((nint)value, BinaryPrimitives.ReadUInt32LittleEndian(row[24..]),
                BinaryPrimitives.ReadUInt32LittleEndian(row[28..]), BinaryPrimitives.ReadUInt32LittleEndian(row[32..])));
        }
        candidates = rows.AsReadOnly();
        return true;
    }

    private static QueryProcessDelegate LoadQuery()
    {
        // Per Microsoft's compatibility guidance: dynamic link, absolute
        // system DLL, no fixed syscall number or arbitrary export selection.
        nint module = NativeLibrary.Load(Path.Combine(Environment.SystemDirectory, "ntdll.dll"));
        return Marshal.GetDelegateForFunctionPointer<QueryProcessDelegate>(NativeLibrary.GetExport(module, "NtQueryInformationProcess"));
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int QueryProcessDelegate(SafeProcessHandle process, int kind, [Out] byte[] buffer, uint bytes, out uint actual);
    [DllImport("kernel32.dll")] private static extern uint GetProcessId(SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process2(SafeProcessHandle process, out ushort processMachine, out ushort nativeMachine);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeProcessHandle process, uint access, out SafeAccessTokenHandle token);
    [DllImport("kernelbase.dll", SetLastError = true)] private static extern bool CompareObjectHandles(SafeHandle first, SafeHandle second);
}
