using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Stephanos.OriginalR7DaclReadback;

internal sealed record R7EstateThreadRow(uint ProcessId, uint ThreadId, long CreationFileTimeUtc,
    uint NativeState, int IndexWithinProcess)
{
    internal bool BirthFieldsAvailable => ProcessId != 0 && ThreadId != 0 && CreationFileTimeUtc > 0;
    internal bool RetainedObjectIdentityProven => false;
    internal bool OriginalSourcePrincipalAuthenticated => false;
}

internal sealed record R7EstateProcessRow(uint ProcessId, uint ParentProcessId, uint SessionId,
    long CreationFileTimeUtc, IReadOnlyList<R7EstateThreadRow> Threads,
    int OpaqueBytes, string OpaqueDigest)
{
    internal bool BirthFieldsAvailable => ProcessId != 0 && CreationFileTimeUtc > 0;
    internal bool RetainedObjectIdentityProven => false;
    internal bool SubjectAccessIndependentlyChecked => false;
    internal bool OriginalSourcePrincipalAuthenticated => false;
    // Parent PID alone is historical metadata and can refer to a recycled ID.
    internal bool ParentRelationshipAuthenticated => false;
}

internal sealed record R7ProcessEstateObservation(string Classification, bool NativeQuerySucceeded,
    bool ReportedProcessThreadRowsDecoded, bool OwnNativeBirthLayoutMatched, uint NativeStatus,
    int Attempts, int ReturnedBytes, long ElapsedMilliseconds, string MetadataDigest,
    IReadOnlyList<R7EstateProcessRow> Processes)
{
    internal int ThreadCount => Processes.Sum(p => p.Threads.Count);
    internal int ProcessBirthUnknownCount => Processes.Count(p => !p.BirthFieldsAvailable);
    internal int ThreadBirthUnknownCount => Processes.Sum(p => p.Threads.Count(t => !t.BirthFieldsAvailable));
    internal int OpaqueRowCount => Processes.Count(p => p.OpaqueBytes != 0);
    internal int OpaqueByteCount => Processes.Sum(p => p.OpaqueBytes);
    internal bool CompleteNativeLayoutUnderstood => false;
    internal bool AllSystemSubjectsIncludedProven => false;
    internal bool AllSubjectsIndependentlyOpened => false;
    internal bool OriginalSourcePrincipalAuthenticated => false;
    internal bool WholeEstateCustodyProven => false;
    internal bool ZeroWritersProven => false;
    internal bool ContinuousFenceProven => false;
    internal bool IndependentSignatureProven => false;
    internal bool RootEnrollmentAuthorized => false;
    internal bool LeaseReleaseAuthorized => false;
}

// Kernel table metadata discovery, NOT a retained-object census or custody.
// SystemProcessInformation is documented, but its full x64 process/thread
// layout is compatibility-sensitive. Primary header pinned at:
// https://github.com/winsiderss/phnt/blob/53fbbdc5b5d2b08761db1c7b26bfa8c820924356/ntexapi.h
// exact downloaded UTF8 SHA256 0510ac40fa1690cd73bed8afe3ed602aaa7bb6870ab95ea9aaba36ce1f4c3d53.
// Process fixed header256, thread stride80; CreateTime32/16, IDs80/40+48.
// Dynamic absolute system DLL/export, fixed information class5, no syscall IDs.
// No foreign OpenProcess/OpenThread, token/credential/command/name query, page
// read, privilege change, mutation, endpoint or worker. Image-name pointers are
// validated ONLY; no name/address/command string is exported or dereferenced.
internal static class R7ProcessEstateSnapshot
{
    internal const int ProcessHeaderBytes = 256, ThreadBytes = 80;
    internal const int MaximumBytes = 16 * 1024 * 1024;
    internal const int MaximumProcesses = 8192, MaximumThreads = 65536;
    internal const int MaximumThreadsPerProcess = 16384, MaximumAttempts = 5;
    internal const int DeadlineMilliseconds = 3000;
    private const uint LengthMismatch = 0xc0000004;

    internal static R7ProcessEstateObservation Capture()
    {
        long began = Stopwatch.GetTimestamp();
        try
        {
            var result = CaptureCore(began);
            long elapsed = (long)Stopwatch.GetElapsedTime(began).TotalMilliseconds;
            // Include allocation wiping, disposal and DLL cleanup in the final
            // positive budget decision. No native syscall cancellation claimed.
            return elapsed <= DeadlineMilliseconds ? result with { ElapsedMilliseconds = elapsed }
                : new("R7_PROCESS_TABLE_INCOMPLETE_DEADLINE_AFTER_CLEANUP", result.NativeQuerySucceeded,
                    false, false, result.NativeStatus, result.Attempts, result.ReturnedBytes, elapsed, "", []);
        }
        catch
        {
            return new("R7_PROCESS_TABLE_INCOMPLETE_API_OR_CLEANUP", false, false, false,
                0, 0, 0, (long)Stopwatch.GetElapsedTime(began).TotalMilliseconds, "", []);
        }
    }

    private static R7ProcessEstateObservation CaptureCore(long began)
    {
        int attempts = 0, actualBytes = 0;
        uint status = 0;
        nint library = 0;
        bool querySucceeded = false;
        R7ProcessEstateObservation Held(string code) => new("R7_PROCESS_TABLE_INCOMPLETE_" + code,
            querySucceeded, false, false, status, attempts, actualBytes,
            (long)Stopwatch.GetElapsedTime(began).TotalMilliseconds, "", []);
        bool Current() => Stopwatch.GetElapsedTime(began).TotalMilliseconds <= DeadlineMilliseconds;
        try
        {
            if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
                || IntPtr.Size != 8 || !IsWow64Process2(GetCurrentProcess(), out ushort machine, out ushort native)
                || machine != 0 || native != 0x8664) return Held("NATIVE_X64_REQUIRED");
            uint ownPid = GetCurrentProcessId(), ownTid = GetCurrentThreadId();
            if (!GetProcessTimes(GetCurrentProcess(), out long processBirth, out _, out _, out _)
                || !GetThreadTimes(GetCurrentThread(), out long threadBirth, out _, out _, out _)
                || !ProcessIdToSessionId(ownPid, out uint session) || processBirth <= 0 || threadBirth <= 0)
                return Held("OWN_BIRTH_UNOBSERVABLE");
            // Documented compatibility guidance requires runtime dynamic linkage.
            library = NativeLibrary.Load(Path.Combine(Environment.SystemDirectory, "ntdll.dll"));
            var query = Marshal.GetDelegateForFunctionPointer<QuerySystem>(NativeLibrary.GetExport(library,
                "NtQuerySystemInformation"));
            int capacity = 256 * 1024;
            for (attempts = 1; attempts <= MaximumAttempts; attempts++)
            {
                if (!Current()) return Held("DEADLINE");
                int allocatedCapacity = capacity;
                nint owned = Marshal.AllocHGlobal(allocatedCapacity);
                byte[]? copied = null;
                try
                {
                    // Unwritten/opaque padding must never contain unrelated
                    // uninitialized bytes from this observer's process heap.
                    ClearOwned(owned, allocatedCapacity);
                    status = unchecked((uint)query(5, owned, (uint)capacity, out uint actual));
                    if (!Current()) return Held("DEADLINE");
                    if (status == LengthMismatch)
                    {
                        ulong next = Math.Max((ulong)capacity * 2, actual);
                        if (next > MaximumBytes) return Held("BYTE_CAP");
                        capacity = checked((int)((next + 4095) & ~4095UL));
                        continue;
                    }
                    if (status != 0) return Held("NATIVE_QUERY_STATUS");
                    querySucceeded = true;
                    if (actual < ProcessHeaderBytes || actual > capacity || actual > MaximumBytes)
                        return Held("RETURNED_LENGTH");
                    actualBytes = (int)actual;
                    copied = new byte[actualBytes]; Marshal.Copy(owned, copied, 0, copied.Length);
                    if (!Decode(copied, actual, unchecked((ulong)owned), Current, out var rows, out string reason))
                        return Held(reason);
                    // A decoded pointer layout is still unqualified unless its
                    // own independently queried native process/thread birth and
                    // session match before/after the system query. This does not
                    // retain or authenticate any FOREIGN object in the table.
                    var self = rows.SingleOrDefault(p => p.ProcessId == ownPid);
                    var ownThread = self?.Threads.SingleOrDefault(t => t.ThreadId == ownTid);
                    if (self is null || ownThread is null || self.CreationFileTimeUtc != processBirth
                        || self.SessionId != session || ownThread.CreationFileTimeUtc != threadBirth
                        || ownThread.ProcessId != ownPid || GetCurrentThreadId() != ownTid
                        || GetCurrentProcessId() != ownPid
                        || !GetProcessTimes(GetCurrentProcess(), out long finalProcessBirth, out _, out _, out _)
                        || !GetThreadTimes(GetCurrentThread(), out long finalThreadBirth, out _, out _, out _)
                        || processBirth != finalProcessBirth || threadBirth != finalThreadBirth || !Current())
                        return Held("LAYOUT_OR_OWN_BIRTH_RACE");
                    string digest = Digest(rows);
                    if (!Current()) return Held("DEADLINE");
                    return new("R7_NATIVE_REPORTED_PROCESS_THREAD_TABLE_NOT_CUSTODY", true, true, true,
                        status, attempts, actualBytes, (long)Stopwatch.GetElapsedTime(began).TotalMilliseconds, digest, rows);
                }
                finally
                {
                    if (copied is not null) CryptographicOperations.ZeroMemory(copied);
                    // Raw native data includes private kernel addresses/names;
                    // it is never persisted or exposed. Clear our allocation.
                    try { ClearOwned(owned, allocatedCapacity); }
                    finally { Marshal.FreeHGlobal(owned); }
                }
            }
            attempts = MaximumAttempts;
            return Held("RETRY_CAP");
        }
        catch { return Held("API_OR_LAYOUT_UNSUPPORTED"); }
        finally { if (library != 0) NativeLibrary.Free(library); }
    }

    // Decoder-only fixture seam. No native query, enrollment or authority can
    // follow from caller bytes/base/deadline. It never dereferences the pointer.
    internal static bool DecodeUntrustedFixture(ReadOnlySpan<byte> bytes, uint actual, ulong fixtureBase,
        out IReadOnlyList<R7EstateProcessRow> rows, out string reason, bool expired = false)
        => Decode(bytes, actual, fixtureBase, () => !expired, out rows, out reason);

    private static bool Decode(ReadOnlySpan<byte> buffer, uint actual, ulong nativeBase, Func<bool> current,
        out IReadOnlyList<R7EstateProcessRow> rows, out string reason)
    {
        rows = []; reason = "BUFFER_LAYOUT";
        if (actual < ProcessHeaderBytes || actual > MaximumBytes || actual > buffer.Length
            || nativeBase == 0 || nativeBase > long.MaxValue || (nativeBase & 7) != 0
            || nativeBase > (ulong)long.MaxValue - actual) return false;
        buffer = buffer[..(int)actual];
        var result = new List<R7EstateProcessRow>();
        var pids = new HashSet<uint>(); var tids = new HashSet<uint>();
        int at = 0, totalThreads = 0;
        while (true)
        {
            if (!current()) { reason = "DEADLINE"; return false; }
            if (result.Count >= MaximumProcesses) { reason = "PROCESS_CAP"; return false; }
            reason = "ENTRY_HEADER";
            if (at > buffer.Length - ProcessHeaderBytes) return false;
            var entry = buffer[at..];
            uint next = U32(entry, 0), count = U32(entry, 4);
            if (count > MaximumThreadsPerProcess || count > MaximumThreads - totalThreads)
            { reason = "THREAD_CAP"; return false; }
            int end;
            if (next == 0) end = buffer.Length;
            else
            {
                reason = "NEXT_ENTRY_OFFSET";
                if ((next & 7) != 0 || next < ProcessHeaderBytes || next > buffer.Length - at
                    || buffer.Length - at - next < ProcessHeaderBytes) return false;
                end = checked(at + (int)next);
            }
            int required = checked(ProcessHeaderBytes + (int)count * ThreadBytes);
            reason = "THREAD_EXTENT";
            if (required > end - at) return false;
            ulong pid64 = U64(entry, 80), parent64 = U64(entry, 88);
            long birth = I64(entry, 32);
            reason = "PROCESS_IDENTITY_FIELD";
            if (pid64 > uint.MaxValue || parent64 > uint.MaxValue || birth < 0 || !pids.Add((uint)pid64)) return false;
            ushort nameLength = BinaryPrimitives.ReadUInt16LittleEndian(entry[56..]);
            ushort nameMaximum = BinaryPrimitives.ReadUInt16LittleEndian(entry[58..]);
            ulong namePointer = U64(entry, 64);
            reason = "UNICODE_LENGTH";
            if ((nameLength & 1) != 0 || (nameMaximum & 1) != 0 || nameLength > nameMaximum) return false;
            int knownEnd = at + required, usedEnd = knownEnd, nameStart = knownEnd;
            if (namePointer == 0)
            { if (nameLength != 0 || nameMaximum != 0) return false; }
            else
            {
                reason = "IMAGE_POINTER_EXTENT";
                if ((namePointer & 1) != 0 || namePointer < nativeBase + (ulong)usedEnd
                    || namePointer > nativeBase + (ulong)end
                    || nameMaximum > nativeBase + (ulong)end - namePointer) return false;
                nameStart = checked((int)(namePointer - nativeBase));
                usedEnd = checked(nameStart + nameMaximum);
            }
            // Neither Microsoft nor the pinned full-field header promises that
            // every remaining byte is zero/alignment padding. Preserve opaque
            // gaps/tails explicitly; never decode them as hidden processes or
            // claim complete layout/subject coverage. NextEntryOffset defines
            // ONLY the reported linked rows. A terminal suffix remains UNKNOWN.
            int opaqueBytes = checked(nameStart - knownEnd + end - usedEnd);
            string opaqueDigest = "";
            if (opaqueBytes != 0)
            {
                using var opaque = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                opaque.AppendData(Encoding.ASCII.GetBytes("stephanos.r7.opaque-process-row-bytes.v1\0"));
                opaque.AppendData(buffer.Slice(knownEnd, nameStart - knownEnd));
                opaque.AppendData(buffer.Slice(usedEnd, end - usedEnd));
                opaqueDigest = Convert.ToHexString(opaque.GetHashAndReset()).ToLowerInvariant();
            }
            var threads = new List<R7EstateThreadRow>((int)count);
            for (int index = 0; index < (int)count; index++)
            {
                if ((index & 63) == 0 && !current()) { reason = "DEADLINE"; return false; }
                var thread = entry.Slice(ProcessHeaderBytes + index * ThreadBytes, ThreadBytes);
                ulong owner = U64(thread, 40), tid = U64(thread, 48); long created = I64(thread, 16);
                reason = "THREAD_IDENTITY_FIELD";
                if (owner != pid64 || tid > uint.MaxValue || created < 0
                    || (tid != 0 && !tids.Add((uint)tid))) return false;
                // Zero IDs/births, including anonymous idle/kernel entries, are
                // explicitly retained as UNKNOWN, never silently filtered.
                threads.Add(new((uint)owner, (uint)tid, created, U32(thread, 68), index));
            }
            totalThreads += (int)count;
            result.Add(new((uint)pid64, (uint)parent64, U32(entry, 100), birth, threads.AsReadOnly(), opaqueBytes, opaqueDigest));
            if (next == 0) break;
            at = end;
        }
        if (result.Count == 0 || !current()) { reason = "DEADLINE_OR_EMPTY"; return false; }
        rows = result.AsReadOnly(); reason = "REPORTED_TABLE_DECODED_NOT_CUSTODY"; return true;
    }

    private static uint U32(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt32LittleEndian(bytes[offset..]);
    private static ulong U64(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadUInt64LittleEndian(bytes[offset..]);
    private static long I64(ReadOnlySpan<byte> bytes, int offset) => BinaryPrimitives.ReadInt64LittleEndian(bytes[offset..]);
    private static string Digest(IReadOnlyList<R7EstateProcessRow> rows)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.ASCII.GetBytes("stephanos.r7.reported-process-thread-table.v1\0"));
        Span<byte> record = stackalloc byte[32];
        foreach (var p in rows.OrderBy(p => p.ProcessId))
        {
            record.Clear(); BinaryPrimitives.WriteUInt32LittleEndian(record, p.ProcessId);
            BinaryPrimitives.WriteUInt32LittleEndian(record[4..], p.ParentProcessId);
            BinaryPrimitives.WriteUInt32LittleEndian(record[8..], p.SessionId);
            BinaryPrimitives.WriteInt64LittleEndian(record[12..], p.CreationFileTimeUtc);
            BinaryPrimitives.WriteInt32LittleEndian(record[20..], p.Threads.Count); hash.AppendData(record);
            BinaryPrimitives.WriteInt32LittleEndian(record, p.OpaqueBytes); hash.AppendData(record[..4]);
            if (p.OpaqueDigest.Length != 0) hash.AppendData(Convert.FromHexString(p.OpaqueDigest));
            foreach (var t in p.Threads.OrderBy(t => t.ThreadId).ThenBy(t => t.IndexWithinProcess))
            {
                record.Clear(); BinaryPrimitives.WriteUInt32LittleEndian(record, t.ProcessId);
                BinaryPrimitives.WriteUInt32LittleEndian(record[4..], t.ThreadId);
                BinaryPrimitives.WriteInt64LittleEndian(record[8..], t.CreationFileTimeUtc);
                BinaryPrimitives.WriteUInt32LittleEndian(record[16..], t.NativeState); hash.AppendData(record);
            }
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    private static void ClearOwned(nint memory, int count)
    {
        byte[] zeros = new byte[4096];
        for (int at = 0; at < count; at += zeros.Length) Marshal.Copy(zeros, 0, memory + at, Math.Min(zeros.Length, count - at));
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate int QuerySystem(int kind, nint buffer, uint bytes, out uint actual);
    [DllImport("kernel32.dll")] private static extern nint GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern nint GetCurrentThread();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(nint process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetThreadTimes(nint thread, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWow64Process2(nint process, out ushort processMachine, out ushort nativeMachine);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ProcessIdToSessionId(uint process, out uint session);
}
