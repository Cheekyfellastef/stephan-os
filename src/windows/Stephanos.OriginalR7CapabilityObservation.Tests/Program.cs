using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

try
{
    if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64) return 2;
    // Prevent test exceptions/critical file errors from opening desktop dialogs.
    Native.SetErrorMode(Native.GetErrorMode() | 3);
    if (args.Length == 1 && args[0] == "--owned-capability-child") return FixtureChild.Run();
    if (OwnedObservationJobFixture.TryRunChild(args, out int jobChild)) return jobChild;
    if (args.Length == 1 && args[0] == "--snapshot-api-probes-only") return OwnedObservationJobFixture.RunSnapshotProbes();
    if (args.Length != 0) return 2;
    if (OwnedObservationJobFixture.Run() != 0) return 1;
    return FixtureTests.Run();
}
catch (Exception error)
{
    Console.Error.WriteLine("R7_CAPABILITY_FIXTURE_FAILED: " + error.GetType().Name + ": " + error.Message);
    return 1;
}

internal sealed record FixtureReady(int Pid, long Created, string Sid, string Root,
    long[] Handles, long View, long CopyView, long ReadView, long GuardView, bool SectionHandlesClosed, bool FileHandlesClosedAfterMapping);

internal static class FixtureChild
{
    internal static int Run()
    {
        string root = Path.Combine(Environment.CurrentDirectory, "r7-owned-capability-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var owned = new List<SafeFileHandle>();
        var views = new List<nint>();
        try
        {
            string file = Path.Combine(root, "owned.bin");
            File.WriteAllBytes(file, new byte[4096]);
            // Only this newly created disposable fixture: inherited Modify
            // permission need not include WRITE_OWNER. Explicitly grant the
            // current real fixture SID full control so that each positive
            // capability case has an actual kernel-granted right to inspect.
            var fixtureSid = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("OWNED_SID");
            var fixtureAcl = new FileInfo(file).GetAccessControl();
            fixtureAcl.AddAccessRule(new FileSystemAccessRule(fixtureSid, FileSystemRights.FullControl, AccessControlType.Allow));
            new FileInfo(file).SetAccessControl(fixtureAcl);
            File.WriteAllBytes(Path.Combine(root, "other.bin"), new byte[4096]);
            // Data/security-capable handles exist before the observer runs.
            foreach (uint access in new uint[] { 0x82, 0x40080, 0x80080, 0x80 })
            {
                SafeFileHandle handle = Native.CreateFileW(file, access, 3, 0, 3, 0x00200000, 0);
                if (handle.IsInvalid) throw new InvalidOperationException("OWNED_HANDLE_CREATE_" + access.ToString("x") + "_" + Marshal.GetLastWin32Error());
                owned.Add(handle);
            }
            // Mapping uses a distinct temporary file handle, which is closed.
            nint shared, copy, read, guard;
            using (SafeFileHandle fileForMap = Native.CreateFileW(file, 0xc0000080, 3, 0, 3, 0x00200000, 0))
            {
                if (fileForMap.IsInvalid) throw new InvalidOperationException("OWNED_MAPPING_FILE");
                using SafeFileHandle section = Native.CreateFileMappingW(fileForMap, 0, 4, 0, 4096, null);
                if (section.IsInvalid) throw new InvalidOperationException("OWNED_SECTION");
                shared = Native.MapViewOfFile(section, 2, 0, 0, 4096);
                copy = Native.MapViewOfFile(section, 1, 0, 0, 4096);
                read = Native.MapViewOfFile(section, 4, 0, 0, 4096);
                guard = Native.MapViewOfFile(section, 2, 0, 0, 4096);
                if (shared == 0 || copy == 0 || read == 0 || guard == 0) throw new InvalidOperationException("OWNED_VIEWS");
                views.AddRange([shared, copy, read, guard]);
                if (!Native.VirtualProtect(guard, 4096, 0x104 /* READWRITE | GUARD */, out uint prior)
                    || prior != 4) throw new InvalidOperationException("OWNED_GUARD_PROTECTION");
            }
            // The section and its creation file handle are now closed; the
            // kernel mappings remain. Never read any target process memory.
            using Process self = Process.GetCurrentProcess();
            if (!Native.GetProcessTimes(self.SafeHandle, out long created, out _, out _, out _))
                throw new InvalidOperationException("OWNED_CREATION_TIME");
            string sid = WindowsIdentity.GetCurrent().User?.Value ?? throw new InvalidOperationException("OWNED_SID");
            Console.WriteLine(JsonSerializer.Serialize(new FixtureReady(Environment.ProcessId, created, sid, root,
                owned.Select(h => (long)h.DangerousGetHandle()).ToArray(), (long)shared, (long)copy, (long)read, (long)guard, true, true)));
            Console.Out.Flush();
            // Cooperative one-use fixture protocol; hard exit even if parent
            // fails. No supplied path, PID, arbitrary command or data accepted.
            string? request = Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(25)).GetAwaiter().GetResult();
            if (request != "PROVE_OWNED_VIEW") return 2;
            // Only our own mapping: require observation to have left the
            // native guard intact, then deliberately remove it before writing.
            // Do not provoke an unhandled guard exception in managed code.
            if (!Native.VirtualProtect(guard, 4096, 4, out uint guardedPrior)
                || guardedPrior != 0x104) throw new InvalidOperationException("OWNED_GUARD_PRESERVED_BY_OBSERVER");
            Marshal.WriteByte(guard, 1, 0x6b);
            if (!Native.FlushViewOfFile(guard, 4096)) throw new InvalidOperationException("OWNED_GUARD_VIEW_FLUSH");
            Marshal.WriteByte(shared, 0, 0x5a);
            if (!Native.FlushViewOfFile(shared, 4096)) throw new InvalidOperationException("OWNED_VIEW_FLUSH");
            Console.WriteLine("OWNED_VIEW_WRITE_FLUSHED");
            Console.Out.Flush();
            request = Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(25)).GetAwaiter().GetResult();
            return request == "RELEASE_OWNED_FIXTURE" ? 0 : 2;
        }
        finally
        {
            foreach (nint view in views) Native.UnmapViewOfFile(view);
            foreach (SafeFileHandle handle in owned) handle.Dispose();
            // Cleanup exactly this freshly created, fixed-content fixture.
            File.Delete(Path.Combine(root, "owned.bin"));
            File.Delete(Path.Combine(root, "other.bin"));
            Directory.Delete(root, false);
        }
    }
}

internal static class FixtureTests
{
    internal static int Run()
    {
        int assertions = 0;
        void Check(bool value, string label)
        { assertions++; if (!value) throw new InvalidOperationException(label); }
        string exe = Environment.ProcessPath ?? throw new InvalidOperationException("APPHOST_REQUIRED");
        bool hosted = Path.GetFileNameWithoutExtension(exe).Equals("dotnet", StringComparison.OrdinalIgnoreCase);
        using var child = new Process { StartInfo = new(exe) {
            WorkingDirectory = Environment.CurrentDirectory, UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true } };
        if (hosted) child.StartInfo.ArgumentList.Add(typeof(FixtureTests).Assembly.Location);
        child.StartInfo.ArgumentList.Add("--owned-capability-child");
        child.StartInfo.Environment.Clear();
        child.StartInfo.Environment["SystemRoot"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        child.StartInfo.Environment["DOTNET_ROOT"] = Path.GetDirectoryName(exe);
        child.StartInfo.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
        child.StartInfo.Environment["DOTNET_GENERATE_ASPNET_CERTIFICATE"] = "false";
        child.StartInfo.Environment["DOTNET_ADD_GLOBAL_TOOLS_TO_PATH"] = "false";
        if (!child.Start()) throw new InvalidOperationException("OWNED_CHILD_START");
        // Retain the exact object from Process.Start; never recover by name/PID.
        SafeProcessHandle process = child.SafeHandle;
        string? readyLine = child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
        if (readyLine is null || readyLine.Length > 4096)
        {
            string diagnostic = child.StandardError.ReadToEndAsync().WaitAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
            throw new InvalidOperationException("OWNED_READY_MISSING_" + diagnostic[..Math.Min(diagnostic.Length, 400)]);
        }
        FixtureReady ready = JsonSerializer.Deserialize<FixtureReady>(readyLine) ?? throw new InvalidOperationException("OWNED_READY_INVALID");
        try
        {
            string taskRoot = Path.GetFullPath(Environment.CurrentDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            Check(ready.Pid == child.Id && Native.GetProcessTimes(process, out long created, out _, out _, out _) && created == ready.Created, "OWNED_PID_FILETIME");
            Check(ready.Root.StartsWith(taskRoot, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(ready.Root).StartsWith("r7-owned-capability-", StringComparison.Ordinal)
                && ready.Handles.Length == 4, "OWNED_FIXED_SCOPE");
            string file = Path.Combine(ready.Root, "owned.bin");
            using SafeFileHandle target = Native.CreateFileW(file, 0x80, 7, 0, 3, 0x00200000, 0);
            using SafeFileHandle other = Native.CreateFileW(Path.Combine(ready.Root, "other.bin"), 0x80, 7, 0, 3, 0x00200000, 0);
            nint[] handles = ready.Handles.Select(h => (nint)h).ToArray();
            nint[] views = [(nint)ready.View, (nint)ready.CopyView, (nint)ready.ReadView, (nint)ready.GuardView];
            var handleDiscovery = R7RetainedHandleMetadataDiscovery.Discover(process, ready.Pid, ready.Created, ready.Sid);
            Check(handleDiscovery.RetainedProcessAndPrimaryTokenStable && handleDiscovery.NativeBufferDecoded,
                "NATIVE_RETAINED_HANDLE_DISCOVERY_" + handleDiscovery.Classification);
            Check(handles.All(h => handleDiscovery.Candidates.Any(c => c.Value == h)), "NATIVE_DISCOVERY_FINDS_OWNED_EXISTING_HANDLES");
            Check((handleDiscovery.Candidates.Single(c => c.Value == handles[1]).GrantedAccess & 0x40000) != 0
                && (handleDiscovery.Candidates.Single(c => c.Value == handles[2]).GrantedAccess & 0x80000) != 0,
                "NATIVE_HANDLE_DISCOVERY_PRESERVES_SECURITY_ACCESS");
            Check(!handleDiscovery.CapturedHandleObjectsRetained && !handleDiscovery.FileIdentityAuthenticated
                && !handleDiscovery.CompleteEstateObserved && !handleDiscovery.ZeroWritersProven
                && !handleDiscovery.ContinuousCustodyProven && !handleDiscovery.LeaseReleaseAuthorized
                && !handleDiscovery.AuthenticatedOsWitness, "HANDLE_METADATA_CANDIDATES_NEVER_OBJECT_CUSTODY");
            foreach (var bad in new[] {
                R7RetainedHandleMetadataDiscovery.Discover(process, ready.Pid + 1, ready.Created, ready.Sid),
                R7RetainedHandleMetadataDiscovery.Discover(process, ready.Pid, ready.Created + 1, ready.Sid),
                R7RetainedHandleMetadataDiscovery.Discover(process, ready.Pid, ready.Created, "S-1-5-18") })
                Check(!bad.NativeBufferDecoded && !bad.RetainedProcessAndPrimaryTokenStable && bad.Candidates.Count == 0,
                    "HANDLE_DISCOVERY_WRONG_SUBJECT_NO_ROWS");
            // Real kernel data above supplies positive evidence. These explicit
            // malformed buffers additionally qualify fail-closed bounds.
            byte[] one = new byte[56];
            System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(one, 1);
            System.Buffers.Binary.BinaryPrimitives.WriteUInt64LittleEndian(one.AsSpan(16), 4);
            Check(R7RetainedHandleMetadataDiscovery.TryDecode(one, 56, out var parsed) && parsed.Count == 1,
                "HANDLE_NATIVE_X64_BUFFER_VALID_SHAPE");
            foreach (uint length in new uint[] { 0, 15, 16, 55, 57, uint.MaxValue })
                Check(!R7RetainedHandleMetadataDiscovery.TryDecode(one, length, out var rejected) && rejected.Count == 0,
                    "HANDLE_NATIVE_LENGTH_MISMATCH_NO_PARTIAL_ROWS");
            one[8] = 1;
            Check(!R7RetainedHandleMetadataDiscovery.TryDecode(one, 56, out _), "HANDLE_NATIVE_RESERVED_HEADER_REJECTED");
            one[8] = 0; one[52] = 1;
            Check(!R7RetainedHandleMetadataDiscovery.TryDecode(one, 56, out _), "HANDLE_NATIVE_RESERVED_ENTRY_REJECTED");
            one[52] = 0; one[16] = 0;
            Check(!R7RetainedHandleMetadataDiscovery.TryDecode(one, 56, out _), "HANDLE_NATIVE_ZERO_VALUE_REJECTED");
            var discovered = R7RetainedRegionSnapshotDiscovery.Discover(process, ready.Pid, ready.Created, ready.Sid);
            Check(discovered.RetainedProcessAndPrimaryTokenStable && discovered.SnapshotWalksReachedEnd
                && discovered.SnapshotResourcesReleased, "OWNED_METADATA_SNAPSHOT_" + discovered.Classification);
            Check(!discovered.HandleTableObserved, "REGION_DISCOVERY_DOES_NOT_SUBSTITUTE_HANDLE_INVENTORY");
            foreach (nint view in views)
                Check(discovered.Regions.Any(r => view >= r.BaseAddress && (ulong)(view - r.BaseAddress) < r.Bytes
                    && r.State == 0x1000 && r.Type == 0x40000), "NATIVE_DISCOVERY_FINDS_OWNED_MAPPING");
            Check(discovered.Regions.Any(r => r.BaseAddress == (nint)ready.GuardView && r.Protection == 0x104),
                "NATIVE_DISCOVERY_PRESERVES_GUARD_METADATA");
            Check(!discovered.CompleteEstateObserved && !discovered.ZeroWritersProven
                && !discovered.ContinuousCustodyProven && !discovered.LeaseReleaseAuthorized
                && !discovered.AuthenticatedOsWitness, "SNAPSHOT_NEVER_WHOLE_ESTATE_AUTHORITY");
            foreach (var bad in new[] {
                R7RetainedRegionSnapshotDiscovery.Discover(process, ready.Pid + 1, ready.Created, ready.Sid),
                R7RetainedRegionSnapshotDiscovery.Discover(process, ready.Pid, ready.Created + 1, ready.Sid),
                R7RetainedRegionSnapshotDiscovery.Discover(process, ready.Pid, ready.Created, "S-1-5-18") })
                Check(!bad.RetainedProcessAndPrimaryTokenStable && !bad.SnapshotWalksReachedEnd
                    && bad.Regions.Count == 0, "SNAPSHOT_REJECTS_WRONG_NATIVE_SUBJECT");
            R7ExistingCapabilitySample Sample(SafeFileHandle? leaf = null, IReadOnlyList<nint>? hs = null,
                IReadOnlyList<nint>? vs = null, int? pid = null, long? creation = null, string? sid = null)
                => R7ExistingCapabilityObservation.ObserveRetained(process, pid ?? ready.Pid, creation ?? ready.Created,
                    sid ?? ready.Sid, leaf ?? target, hs ?? handles, vs ?? views);
            R7ExistingCapabilitySample actual = Sample();
            // Discover candidates from the native table instead of supplying
            // the child's ready-message handle values to this observation.
            // Kernel file identity and object comparison, not numeric joins,
            // establish which discovered candidates refer to our target.
            var discoveredTargetHandles = new List<R7ExistingHandleSample>();
            foreach (var chunk in handleDiscovery.Candidates
                .Where(c => (c.GrantedAccess & 0xc0006) != 0).Select(c => c.Value).Chunk(16))
            {
                var observedChunk = Sample(hs: chunk, vs: []);
                Check(observedChunk.RetainedProcessAndPrimaryTokenStable, "DISCOVERED_HANDLE_CHUNK_NATIVE_CONTINUITY");
                discoveredTargetHandles.AddRange(observedChunk.Handles.Where(h => h.FileIdentityMatchesTarget && h.SameObjectAtBothSamples));
            }
            Check(discoveredTargetHandles.Any(h => h.DataWriteGranted)
                && discoveredTargetHandles.Any(h => h.WriteDacGranted)
                && discoveredTargetHandles.Any(h => h.WriteOwnerGranted),
                "NATIVE_DISCOVERY_TO_SAME_OBJECT_FILE_ID_FINDS_THREE_WRITER_CAPABILITIES");
            int discoveredTargetWritableViews = 0;
            foreach (var region in discovered.Regions.Where(r => r.State == 0x1000 && r.Type == 0x40000
                && ((r.Protection & 0xff) is 4 or 0x40)).Take(64))
            {
                var observedView = Sample(hs: [], vs: [region.BaseAddress]);
                discoveredTargetWritableViews += observedView.Views.Count(v => v.WritableMappedViewObserved
                    && v.TargetNativeNameCorrelated && v.SameRegionAtBothSamples && !v.BackingFileIdentityAuthenticated);
            }
            Check(discoveredTargetWritableViews >= 2,
                "NATIVE_REGION_DISCOVERY_FINDS_SHARED_AND_GUARDED_VIEWS_WITHOUT_SUPPLIED_ADDRESSES_FILE_ID_UNRESOLVED");
            Check(actual.RetainedProcessAndPrimaryTokenStable, "NATIVE_PROCESS_PRIMARY_CONTINUITY_" + actual.Classification);
            Check(actual.TargetFileIdentityDigest.Length == 64, "NATIVE_FILE_ID_DIGEST");
            Check(actual.Handles.Count == 4 && actual.Views.Count == 4, "BOUNDED_ROWS");
            foreach (var handle in actual.Handles)
            {
                Check(handle.FileIdentityMatchesTarget, "EXISTING_HANDLE_NATIVE_FILE_ID_" + handle.Index);
                Check(handle.SameObjectAtBothSamples, "EXISTING_HANDLE_OBJECT_CONTINUITY_" + handle.Index);
            }
            Check(actual.Handles[0].DataWriteGranted && !actual.Handles[0].WriteDacGranted && !actual.Handles[0].WriteOwnerGranted, "ACTUAL_DATA_GRANT");
            Check(actual.Handles[1].WriteDacGranted && !actual.Handles[1].DataWriteGranted, "ACTUAL_WRITE_DAC_GRANT");
            Check(actual.Handles[2].WriteOwnerGranted && !actual.Handles[2].DataWriteGranted, "ACTUAL_WRITE_OWNER_GRANT");
            Check(!actual.Handles[3].DataWriteGranted && !actual.Handles[3].WriteDacGranted && !actual.Handles[3].WriteOwnerGranted, "READ_ATTRIBUTES_NO_WRITER_GRANT");
            Check(ready.SectionHandlesClosed && ready.FileHandlesClosedAfterMapping, "CREATION_SECTION_AND_FILE_HANDLE_CLOSED");
            Check(actual.Views[0].WritableMappedViewObserved && actual.Views[0].SameRegionAtBothSamples, "WRITABLE_VIEW_AFTER_SECTION_CLOSE");
            Check(!actual.Views[1].WritableMappedViewObserved, "WRITECOPY_NOT_SHARED_FILE_WRITE");
            Check(!actual.Views[2].WritableMappedViewObserved, "READONLY_VIEW_NOT_SHARED_FILE_WRITE");
            Check(actual.Views[3].WritableMappedViewObserved && actual.Views[3].SameRegionAtBothSamples
                && actual.Views[3].Protection == 0x104, "GUARDED_SHARED_VIEW_RETAINS_WRITE_CAPABILITY");
            foreach (var view in actual.Views)
            {
                Check(view.TargetNativeNameCorrelated, "KERNEL_MAPPED_NATIVE_NAME_CORRELATION_" + view.Index);
                Check(!view.BackingFileIdentityAuthenticated, "MAPPED_NAME_NOT_KERNEL_FILE_ID_" + view.Index);
            }
            void NoAuthority(R7ExistingCapabilitySample result)
            {
                Check(!result.CompleteEstateObserved && !result.ZeroWritersProven && !result.ContinuousCustodyProven
                    && !result.AuthenticatedOsWitness && !result.LeaseReleaseAuthorized
                    && !result.SourceMutationAuthorized && !result.HistoricalReceiptReconstructed, "ALL_AUTHORITY_FALSE");
            }
            NoAuthority(actual);
            var repeated = Sample();
            Check(repeated.RetainedProcessAndPrimaryTokenStable && repeated.TargetFileIdentityDigest == actual.TargetFileIdentityDigest
                && repeated.Handles.All(h => h.SameObjectAtBothSamples), "REPEATED_REAL_SAMPLE_STABLE");
            NoAuthority(repeated);
            // The adapter must index a capped collection, never enumerate an
            // untrusted enumerable whose length can exceed its Count claim.
            var indexed = Sample(hs: new IndexOnlyList(handles), vs: new IndexOnlyList(views));
            Check(indexed.RetainedProcessAndPrimaryTokenStable && indexed.Handles.Count == 4,
                "BOUNDED_INDEX_COPY_NO_ENUMERATOR");
            NoAuthority(indexed);
            foreach (var invalid in new[] { Sample(pid: ready.Pid + 1), Sample(creation: ready.Created + 1), Sample(sid: "S-1-5-18"),
                Sample(hs: Enumerable.Repeat((nint)4, 17).ToArray()), Sample(vs: Enumerable.Repeat((nint)4, 17).ToArray()),
                Sample(hs: [(nint)(-1)]), Sample(hs: [handles[0], handles[0]]), Sample(vs: [views[0], views[0]]) })
            { Check(!invalid.RetainedProcessAndPrimaryTokenStable && invalid.Classification.StartsWith("INCOMPLETE_"), "INVALID_BINDING_OR_BUDGET"); NoAuthority(invalid); }
            var mismatch = Sample(leaf: other);
            Check(mismatch.RetainedProcessAndPrimaryTokenStable && mismatch.Handles.All(h => !h.FileIdentityMatchesTarget)
                && mismatch.Views.All(v => !v.TargetNativeNameCorrelated), "WRONG_TARGET_NATIVE_ID_REJECTED");
            NoAuthority(mismatch);
            var absent = Sample(hs: [(nint)0x123456], vs: []);
            Check(absent.Handles.Count == 1 && !absent.Handles[0].FileIdentityMatchesTarget
                && absent.Handles[0].Classification == "INCOMPLETE_EXISTING_HANDLE_DUPLICATION", "CLOSED_OR_ABSENT_HANDLE_INCOMPLETE");
            NoAuthority(absent);
            var missingView = Sample(hs: [], vs: [(nint)1]);
            Check(!missingView.Views.Any(v => v.WritableMappedViewObserved), "UNMAPPED_ADDRESS_NO_POSITIVE_VIEW");
            NoAuthority(missingView);
            using (SafeProcessHandle denied = Native.OpenProcess(0x00101000, false, ready.Pid))
            {
                var accessDenied = R7ExistingCapabilityObservation.ObserveRetained(denied, ready.Pid, ready.Created, ready.Sid, target, handles, views);
                Check(!accessDenied.Handles.Any(h => h.FileIdentityMatchesTarget), "NO_DUP_RIGHTS_INCOMPLETE_NOT_ZERO");
                NoAuthority(accessDenied);
            }
            var empty = Sample(hs: [], vs: []);
            Check(empty.RetainedProcessAndPrimaryTokenStable && !empty.ZeroWritersProven, "EMPTY_INPUT_NOT_ZERO_WRITERS");
            NoAuthority(empty);
            child.StandardInput.WriteLine("PROVE_OWNED_VIEW"); child.StandardInput.Flush();
            Check(child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult() == "OWNED_VIEW_WRITE_FLUSHED", "OWNED_MAPPING_ACTUAL_WRITE");
            // Only disposable fixture bytes; no process memory or private files.
            using (var fixtureBytes = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                Check(fixtureBytes.ReadByte() == 0x5a, "OWNED_MAPPING_SHARED_WRITE_REACHED_FILE");
                Check(fixtureBytes.ReadByte() == 0x6b, "OWNED_GUARDED_MAPPING_WRITE_AFTER_EXPLICIT_GUARD_REMOVAL");
            }
            child.StandardInput.WriteLine("RELEASE_OWNED_FIXTURE"); child.StandardInput.Flush();
            Check(child.WaitForExit(5000) && child.ExitCode == 0, "OWNED_CHILD_NORMAL_EXIT");
            var exited = Sample();
            Check(!exited.RetainedProcessAndPrimaryTokenStable, "RETAINED_EXITED_PROCESS_INCOMPLETE");
            NoAuthority(exited);
            Check(!Directory.Exists(ready.Root), "OWNED_FIXTURE_CLEANED");
            Console.WriteLine(JsonSerializer.Serialize(new { schemaVersion = "stephanos.r7-existing-capability-fixture.v1", assertions,
                result = "PASS", existingDataHandle = true, existingWriteDac = true, existingWriteOwner = true,
                writableViewAfterSectionHandleClose = true, actualFixtureMappedWrite = true,
                guardedWritableMappingObservedWithoutClearingGuard = true,
                nativeSnapshotFoundOwnedMappedRegions = true, nativeHandleMetadataFoundOwnedHandles = true,
                discoveredWriterHandlesAuthenticatedThroughKernelFileId = true,
                discoveredWritableViewsNameCorrelatedWithoutSuppliedAddresses = true,
                handleMetadataIsCompatibilitySensitive = true, wholeEstateHandleTableQualified = false,
                processPrimaryAndNativeFileIdentitySampled = true, mappedBackingFileIdAuthenticated = false,
                completeEstate = false, leaseReleaseAuthorized = false, sourceMutationAuthorized = false,
                targetIdentityDigest = actual.TargetFileIdentityDigest }));
            return 0;
        }
        finally
        {
            // No global/PID/tree kill. Ask only this owned child to exit; it
            // also has its own 25s protocol deadline and fixed-path cleanup.
            try { if (!child.HasExited) { child.StandardInput.WriteLine("RELEASE_OWNED_FIXTURE"); child.StandardInput.Flush(); child.StandardInput.Close(); child.WaitForExit(3000); } } catch { }
        }
    }
}

internal sealed class IndexOnlyList(nint[] values) : IReadOnlyList<nint>
{
    public int Count => values.Length;
    public nint this[int index] => values[index];
    public IEnumerator<nint> GetEnumerator() => throw new InvalidOperationException("UNBOUNDED_ENUMERATOR_MUST_NOT_RUN");
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}

internal static class Native
{
    [DllImport("kernel32.dll")] internal static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] internal static extern uint SetErrorMode(uint mode);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetProcessTimes(SafeProcessHandle process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFileW(string file, uint access, uint share, nint security, uint disposition, uint flags, nint template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern SafeFileHandle CreateFileMappingW(SafeFileHandle file, nint security, uint protection, uint high, uint low, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint MapViewOfFile(SafeFileHandle section, uint access, uint high, uint low, nuint bytes);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UnmapViewOfFile(nint address);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool FlushViewOfFile(nint address, nuint bytes);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool VirtualProtect(nint address, nuint bytes, uint protection, out uint previous);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int pid);
}
