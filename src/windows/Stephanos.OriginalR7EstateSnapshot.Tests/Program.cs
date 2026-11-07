using Microsoft.Win32.SafeHandles;
using System.Buffers.Binary;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Stephanos.OriginalR7DaclReadback;

internal static class Program
{
    private static int assertions;
    private static void Check(bool value, string label)
    { assertions++; if (!value) throw new InvalidOperationException("R7_ESTATE_FIXTURE_" + label); }
    private static int Main(string[] args)
    {
        SetErrorMode(SetErrorMode(0) | 3);
        try
        {
            if (args.SequenceEqual(new[] { "--owned-helper" }))
            {
                // Fixed fresh OWNED helper only; no paths/commands/selectors.
                // Normal stdin close ends it; it also exits itself after20s.
                Console.WriteLine("READY"); Console.Out.Flush();
                Console.In.ReadLineAsync().Wait(TimeSpan.FromSeconds(20)); return 0;
            }
            if (args.SequenceEqual(new[] { "--probe-harness-failure" })) throw new InvalidOperationException("EXPECTED_CONTROLLED_FAILURE");
            if (args.Length != 0 || !OperatingSystem.IsWindows()) return 2;
            return Run();
        }
        catch (Exception ex) { Console.Error.WriteLine("R7_ESTATE_FIXTURE_FAILED=" + ex.GetType().Name + ":" + ex.Message); return 1; }
    }

    private static int Run()
    {
        MalformedBuffers();
        using var ready = new ManualResetEventSlim();
        using var stop = new ManualResetEventSlim();
        uint ownedTid = 0; long ownedBirth = 0;
        Exception? threadFailure = null;
        var thread = new Thread(() =>
        {
            try
            {
                ownedTid = GetCurrentThreadId();
                if (!GetThreadTimes(GetCurrentThread(), out ownedBirth, out _, out _, out _)) throw new InvalidOperationException("OWN_BIRTH_REQUIRED");
                ready.Set(); stop.Wait(TimeSpan.FromSeconds(20));
            }
            catch (Exception ex) { threadFailure = ex; ready.Set(); }
        }) { IsBackground = true };
        thread.Start();
        Process? child = null;
        SafeWaitHandle? retainedThread = null;
        try
        {
            Check(ready.Wait(TimeSpan.FromSeconds(3)) && threadFailure is null && ownedTid != 0 && ownedBirth > 0, "FRESH_OWNED_NATIVE_THREAD_READY");
            retainedThread = OpenThread(0x100800 /* SYNCHRONIZE | QUERY_LIMITED_INFORMATION */, false, ownedTid);
            Check(!retainedThread.IsInvalid && GetThreadId(retainedThread) == ownedTid
                && GetProcessIdOfThread(retainedThread) == Environment.ProcessId, "OWNED_RETAINED_THREAD_NATIVE_OWNER");
            Check(GetRetainedThreadTimes(retainedThread, out long retainedBirth, out _, out _, out _) && retainedBirth == ownedBirth,
                "OWNED_RETAINED_THREAD_NATIVE_BIRTH");

            string runtime = Environment.ProcessPath ?? throw new InvalidOperationException("OWN_RUNTIME_REQUIRED");
            string assembly = Assembly.GetExecutingAssembly().Location;
            bool ownApphost = string.Equals(Path.GetFullPath(runtime),
                Path.ChangeExtension(Path.GetFullPath(assembly), ".exe"), StringComparison.OrdinalIgnoreCase);
            bool dotnetHost = string.Equals(Path.GetFileName(runtime), "dotnet.exe", StringComparison.OrdinalIgnoreCase);
            if (!ownApphost && !dotnetHost) throw new InvalidOperationException("OWNED_HELPER_HOST_UNSUPPORTED");
            var start = new ProcessStartInfo(runtime)
            { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            // dotnet needs the DLL argument; our own apphost already embeds it.
            // Passing the DLL to an apphost creates an invalid extra argument.
            if (!ownApphost) start.ArgumentList.Add(assembly);
            start.ArgumentList.Add("--owned-helper");
            child = Process.Start(start) ?? throw new InvalidOperationException("OWNED_HELPER_REQUIRED");
            var readiness = child.StandardOutput.ReadLineAsync();
            Check(readiness.Wait(TimeSpan.FromSeconds(3)) && readiness.Result == "READY", "OWNED_HELPER_READY_DEADLINE");
            long childBirth = 0;
            Check(!child.HasExited && GetProcessTimes(child.SafeHandle, out childBirth, out _, out _, out _) && childBirth > 0,
                "FRESH_RETAINED_OWNED_PROCESS_BIRTH");
            // No caller selectors enter Capture: all rows originate in the
            // actual query. Only our OWNED fixture objects are cross-checked.
            var first = R7ProcessEstateSnapshot.Capture(); RequireNative(first);
            var ownProcess = first.Processes.Single(p => p.ProcessId == Environment.ProcessId);
            Check(ownProcess.Threads.Any(t => t.ThreadId == ownedTid && t.CreationFileTimeUtc == ownedBirth
                && t.ProcessId == ownProcess.ProcessId), "DISCOVERED_OWNED_THREAD_BIRTH_AND_RELATIONSHIP");
            var childRow = first.Processes.Single(p => p.ProcessId == child.Id);
            Check(childRow.CreationFileTimeUtc == childBirth && childRow.BirthFieldsAvailable, "DISCOVERED_FRESH_CHILD_NATIVE_BIRTH");
            bool childThreadCrossChecked = false;
            foreach (var row in childRow.Threads.Where(t => t.BirthFieldsAvailable))
            {
                using var query = OpenThread(0x100800, false, row.ThreadId);
                if (!query.IsInvalid && GetProcessIdOfThread(query) == child.Id && GetThreadId(query) == row.ThreadId
                    && GetRetainedThreadTimes(query, out long birth, out _, out _, out _) && birth == row.CreationFileTimeUtc)
                { childThreadCrossChecked = true; break; }
            }
            Check(childThreadCrossChecked, "DISCOVERED_OWNED_CHILD_THREAD_NATIVE_BIRTH_AND_OWNER");
            Check(first.Processes.Any(p => p.SessionId == 0), "OTHER_SESSION_ROWS_NOT_FILTERED");
            Check(first.Processes.Any(p => p.ProcessId == 0) && first.Processes.Any(p => p.ProcessId == 4), "IDLE_AND_SYSTEM_ROWS_NOT_FILTERED");
            Check(first.ProcessBirthUnknownCount > 0 || first.ThreadBirthUnknownCount > 0,
                "ACTUAL_UNKNOWN_BIRTH_ROWS_PRESERVED_NOT_SAFE");
            var second = R7ProcessEstateSnapshot.Capture(); RequireNative(second);
            Check(second.Processes.Single(p => p.ProcessId == child.Id).CreationFileTimeUtc == childBirth
                && second.Processes.Single(p => p.ProcessId == Environment.ProcessId).Threads
                    .Any(t => t.ThreadId == ownedTid && t.CreationFileTimeUtc == ownedBirth), "REPEATED_SNAPSHOT_PRESERVES_OWNED_BIRTH");

            stop.Set(); Check(thread.Join(TimeSpan.FromSeconds(3)), "OWNED_THREAD_NORMAL_EXIT");
            Check(WaitForSingleObject(retainedThread, 0) == 0, "OWNED_THREAD_EXIT_PROVEN_BY_RETAINED_NATIVE_OBJECT");
            child.StandardInput.Close(); Check(child.WaitForExit(3000) && child.ExitCode == 0, "OWNED_HELPER_NORMAL_EXIT_NO_TERMINATION");
            var after = R7ProcessEstateSnapshot.Capture(); RequireNative(after);
            var exitedChild = after.Processes.SingleOrDefault(p => p.ProcessId == child.Id && p.CreationFileTimeUtc == childBirth);
            var exitedThread = after.Processes.SingleOrDefault(p => p.ProcessId == Environment.ProcessId)?.Threads
                .SingleOrDefault(t => t.ThreadId == ownedTid && t.CreationFileTimeUtc == ownedBirth);
            Check(exitedChild is null, "EXITED_OWNED_PROCESS_NO_LONGER_IN_REPORTED_TABLE");
            Check(exitedThread is null || exitedThread.NativeState == 4,
                "EXITED_OWNED_THREAD_ABSENT_OR_REPORTED_TERMINATED");
            // A disappearance or metadata digest change is NOT disposal of
            // unrelated old writers, original enrollment or continuous custody.
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "stephanos.r7-process-estate-native-fixture.v1",
                result = "PASS", assertions, runtime = Environment.Version.ToString(), osVersion = Environment.OSVersion.Version.ToString(),
                helperLaunchKind = ownApphost ? "OWN_APPHOST" : "DOTNET_HOST",
                reportedProcesses = first.Processes.Count, reportedThreads = first.ThreadCount,
                processBirthUnknown = first.ProcessBirthUnknownCount, threadBirthUnknown = first.ThreadBirthUnknownCount,
                opaqueRowCount = first.OpaqueRowCount, opaqueByteCount = first.OpaqueByteCount,
                completeNativeLayoutUnderstood = first.CompleteNativeLayoutUnderstood,
                observedSessions = first.Processes.Select(p => p.SessionId).Distinct().Count(),
                metadataDigest = first.MetadataDigest, queryAttempts = first.Attempts, returnedBytes = first.ReturnedBytes,
                captureMilliseconds = first.ElapsedMilliseconds, ownNativeBirthLayoutMatched = first.OwnNativeBirthLayoutMatched,
                ownChildAndThreadDiscovered = true, ownChildThreadNativeBirthCrossChecked = childThreadCrossChecked,
                ownProcessExitDisappeared = true, ownThreadExitAbsent = exitedThread is null,
                foreignSubjectsOpened = 0, namesPathsCommandsSidsOrRawRowsOutput = false,
                wholeEstateCustodyProven = false, zeroWritersProven = false, continuousFenceProven = false,
                sourcePrincipalAuthenticated = false, leaseReleaseAuthorized = false }));
            return 0;
        }
        finally
        {
            stop.Set();
            if (thread.IsAlive && !thread.Join(TimeSpan.FromSeconds(3))) throw new InvalidOperationException("OWNED_THREAD_NORMAL_CLEANUP_UNPROVEN");
            retainedThread?.Dispose();
            if (child is not null)
            {
                try { child.StandardInput.Close(); } catch (InvalidOperationException) { }
                if (!child.WaitForExit(3000)) throw new InvalidOperationException("OWNED_HELPER_NORMAL_CLEANUP_UNPROVEN");
                child.Dispose();
            }
        }
    }

    private static void RequireNative(R7ProcessEstateObservation value)
    {
        Check(value.NativeQuerySucceeded && value.ReportedProcessThreadRowsDecoded && value.OwnNativeBirthLayoutMatched,
            "ACTUAL_NATIVE_QUERY_AND_LAYOUT_" + value.Classification);
        Check(value.Processes.Count > 0 && value.ThreadCount > 0 && value.MetadataDigest.Length == 64
            && value.Attempts is >= 1 and <= R7ProcessEstateSnapshot.MaximumAttempts
            && value.ReturnedBytes <= R7ProcessEstateSnapshot.MaximumBytes
            && value.ElapsedMilliseconds <= R7ProcessEstateSnapshot.DeadlineMilliseconds, "ACTUAL_BOUNDED_NONEMPTY_TABLE");
        Check(!value.CompleteNativeLayoutUnderstood && !value.AllSystemSubjectsIncludedProven && !value.AllSubjectsIndependentlyOpened
            && !value.OriginalSourcePrincipalAuthenticated && !value.WholeEstateCustodyProven && !value.ZeroWritersProven
            && !value.ContinuousFenceProven && !value.IndependentSignatureProven && !value.RootEnrollmentAuthorized
            && !value.LeaseReleaseAuthorized, "TABLE_NEVER_PROVIDES_AUTHORITY");
        Check(value.Processes.All(p => !p.RetainedObjectIdentityProven && !p.SubjectAccessIndependentlyChecked
            && !p.ParentRelationshipAuthenticated && !p.OriginalSourcePrincipalAuthenticated
            && p.Threads.All(t => !t.RetainedObjectIdentityProven && !t.OriginalSourcePrincipalAuthenticated)),
            "FOREIGN_ROWS_NEVER_BECOME_RETAINED_IDENTITIES_OR_SOURCE_ENROLLMENT");
    }

    private const ulong Base = 0x10000000;
    private static void U32(byte[] b, int at, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(b.AsSpan(at), value);
    private static void U64(byte[] b, int at, ulong value) => BinaryPrimitives.WriteUInt64LittleEndian(b.AsSpan(at), value);
    private static byte[] Golden()
    {
        // Two x64 records: a named process with one thread, then idle with two
        // anonymous UNKNOWN thread entries. No image-name text need be decoded.
        byte[] bytes = new byte[352 + 256 + 160];
        U32(bytes, 0, 352); U32(bytes, 4, 1); U64(bytes, 32, 12345); U64(bytes, 80, 100); U64(bytes, 88, 44); U32(bytes, 100, 2);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(56), 2); BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(58), 4);
        U64(bytes, 64, Base + 336); U64(bytes, 256 + 16, 12346); U64(bytes, 256 + 40, 100); U64(bytes, 256 + 48, 200);
        U32(bytes, 352 + 4, 2); return bytes;
    }
    private static bool Decode(byte[] bytes, uint? length = null, ulong baseAddress = Base)
        => R7ProcessEstateSnapshot.DecodeUntrustedFixture(bytes, length ?? (uint)bytes.Length, baseAddress, out _, out _);
    private static void Bad(Action<byte[]> change, string label)
    { byte[] b = Golden(); change(b); Check(!Decode(b), label); }
    private static void MalformedBuffers()
    {
        byte[] valid = Golden();
        Check(R7ProcessEstateSnapshot.DecodeUntrustedFixture(valid, (uint)valid.Length, Base, out var rows, out _)
            && rows.Count == 2 && rows.Sum(p => p.Threads.Count) == 3, "SYNTHETIC_COUNTED_TABLE_DECODED");
        Check(rows[0].BirthFieldsAvailable && !rows[1].BirthFieldsAvailable
            && rows[1].Threads.Count == 2 && rows[1].Threads.All(t => !t.BirthFieldsAvailable), "SYNTHETIC_UNKNOWN_IDLE_ROWS_RETAINED");
        Check(rows[0].Threads[0].ProcessId == rows[0].ProcessId && rows[0].Threads[0].CreationFileTimeUtc == 12346,
            "SYNTHETIC_NATIVE_OWNER_AND_BIRTH_OFFSETS");
        foreach (uint length in new uint[] { 0, 1, 255, 256, (uint)valid.Length - 1, (uint)valid.Length + 1, uint.MaxValue })
            Check(!Decode(valid, length), "RETURNED_LENGTH_BOUND");
        foreach (ulong pointer in new ulong[] { 0, Base + 1, ulong.MaxValue, 0x7ffffffffffffff8 })
            Check(!Decode(valid, baseAddress: pointer), "OWNED_BASE_POINTER_BOUND");
        foreach (uint next in new uint[] { 1, 248, 257, 351, uint.MaxValue, (uint)valid.Length, (uint)valid.Length - 128 })
            Bad(b => U32(b, 0, next), "NEXT_ENTRY_OFFSET_BOUND");
        byte[] terminal = Golden(); U32(terminal, 0, 0);
        Check(R7ProcessEstateSnapshot.DecodeUntrustedFixture(terminal, (uint)terminal.Length, Base, out var terminalRows, out _)
            && terminalRows.Count == 1 && terminalRows[0].OpaqueBytes > 15,
            "UNREPORTED_SUFFIX_STAYS_OPAQUE_UNKNOWN_NEVER_INVENTED_AS_SUBJECTS");
        Bad(b => U32(b, 4, uint.MaxValue), "COUNT_MULTIPLICATION_OVERFLOW_BOUND");
        Bad(b => U32(b, 4, R7ProcessEstateSnapshot.MaximumThreadsPerProcess + 1), "PER_PROCESS_THREAD_CAP");
        Bad(b => U32(b, 4, 2), "THREAD_ARRAY_TRUNCATION");
        Bad(b => U64(b, 80, 0x100000000), "PID_WIDTH_BOUND");
        Bad(b => U64(b, 88, ulong.MaxValue), "PARENT_PID_WIDTH_BOUND");
        Bad(b => U64(b, 32, ulong.MaxValue), "NEGATIVE_PROCESS_BIRTH");
        Bad(b => U64(b, 352 + 80, 100), "DUPLICATE_PROCESS_ID");
        Bad(b => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(56), 3), "ODD_UNICODE_LENGTH");
        Bad(b => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(58), 3), "ODD_UNICODE_MAXIMUM");
        Bad(b => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(56), 6), "NAME_LENGTH_EXCEEDS_MAXIMUM");
        foreach (ulong pointer in new[] { 0UL, Base - 2, Base + 2, Base + 337, Base + 352, ulong.MaxValue })
            Bad(b => U64(b, 64, pointer), "NAME_POINTER_NOT_OWNED_ENTRY_TAIL");
        Bad(b => BinaryPrimitives.WriteUInt16LittleEndian(b.AsSpan(58), 18), "NAME_EXTENT_CROSSES_ENTRY");
        Bad(b => U64(b, 256 + 40, 101), "THREAD_OWNER_PROCESS_MISMATCH");
        Bad(b => U64(b, 256 + 48, 0x100000000), "THREAD_ID_WIDTH_BOUND");
        Bad(b => U64(b, 256 + 16, ulong.MaxValue), "NEGATIVE_THREAD_BIRTH");
        Bad(b => U64(b, 352 + 256 + 48, 200), "DUPLICATE_NONZERO_THREAD_ID");
        Check(!R7ProcessEstateSnapshot.DecodeUntrustedFixture(valid, (uint)valid.Length, Base, out var expiredRows, out _, true)
            && expiredRows.Count == 0, "EXPIRED_DECODE_NEVER_RETURNS_PARTIAL_SUCCESS");
        byte[] padding = valid.Concat(new byte[32]).ToArray();
        Check(R7ProcessEstateSnapshot.DecodeUntrustedFixture(padding, (uint)padding.Length, Base, out var padded, out _)
            && padded.Count == 2 && padded[^1].OpaqueBytes == 32 && padded[^1].OpaqueDigest.Length == 64,
            "OPAQUE_TERMINAL_SUFFIX_EXPLICITLY_COUNTED_AND_HASHED_NOT_LAYOUT_PROOF");
        padding[^1] = 1;
        Check(R7ProcessEstateSnapshot.DecodeUntrustedFixture(padding, (uint)padding.Length, Base, out var changed, out _)
            && changed[^1].OpaqueDigest != padded[^1].OpaqueDigest && changed.Count == padded.Count,
            "OPAQUE_BYTE_MUTATION_CHANGES_DIGEST_WITHOUT_INVENTING_ROW");
        byte[] large = new byte[R7ProcessEstateSnapshot.MaximumBytes + 1]; Check(!Decode(large), "GLOBAL_ALLOCATION_CAP");
        // Full process-cap and total-thread-cap adversaries, not just malformed
        // arithmetic. Every prefix is valid; the overflowing row must HOLD.
        byte[] processCap = new byte[(R7ProcessEstateSnapshot.MaximumProcesses + 1) * 256];
        for (int i = 0; i <= R7ProcessEstateSnapshot.MaximumProcesses; i++)
        { U32(processCap, i * 256, i == R7ProcessEstateSnapshot.MaximumProcesses ? 0u : 256u); U64(processCap, i * 256 + 80, (ulong)i); }
        Check(!Decode(processCap), "FULL_PROCESS_COUNT_CAP");
        uint per = R7ProcessEstateSnapshot.MaximumThreadsPerProcess;
        int entryBytes = checked(256 + (int)per * 80); byte[] threadCap = new byte[entryBytes * 5];
        for (int i = 0; i < 5; i++)
        {
            int at = i * entryBytes; U32(threadCap, at, i == 4 ? 0u : (uint)entryBytes); U32(threadCap, at + 4, per);
            U64(threadCap, at + 80, (ulong)i);
            for (int t = 0; t < per; t++) U64(threadCap, at + 256 + t * 80 + 40, (ulong)i);
        }
        Check(!Decode(threadCap), "FULL_TOTAL_THREAD_CAP");
    }

    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [DllImport("kernel32.dll")] private static extern nint GetCurrentThread();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeWaitHandle OpenThread(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint thread);
    [DllImport("kernel32.dll")] private static extern uint GetThreadId(SafeWaitHandle thread);
    [DllImport("kernel32.dll")] private static extern uint GetProcessIdOfThread(SafeWaitHandle thread);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(SafeWaitHandle handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetThreadTimes(nint thread, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", EntryPoint = "GetThreadTimes", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetRetainedThreadTimes(SafeWaitHandle thread, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(SafeProcessHandle process, out long creation, out long exit, out long kernel, out long user);
}
