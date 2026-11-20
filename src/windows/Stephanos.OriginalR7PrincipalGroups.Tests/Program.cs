using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Stephanos.OriginalR7DaclReadback;

internal static class Program
{
    private static int assertions;
    private static int optionalGroupAdjustmentCases;
    private static void Check(bool value, string code)
    {
        assertions++;
        if (!value) throw new InvalidOperationException(code);
    }
    private static void Flags(R7TokenGroupObservation value)
    {
        Check(!value.SourcePrincipalAuthenticated, "No enrollment authority");
        Check(!value.CompleteCapabilityInventoryProven, "No complete capability claim");
        Check(!value.ContinuousCustodyProven, "No continuity claim");
        Check(!value.SourceMutationAuthorized, "No source authority");
        Check(!value.LeaseReleaseAuthorized, "No lease authority");
        Check(!value.HostPolicyAdopted, "No host policy authority");
    }
    private static void Held(R7TokenGroupObservation value)
    {
        Check(!value.SampleStable && value.InventoryDigest == "", "Unknown must not carry success digest");
        Check(value.Groups.Count == 0 && value.RestrictedSids.Count == 0 && value.Capabilities.Count == 0,
            "Unknown must not carry partial inventory");
        Flags(value);
    }
    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
        { Console.WriteLine("UNSUPPORTED_WINDOWS_X64_REQUIRED"); return 2; }
        SetErrorMode(GetErrorMode() | 3);
        try
        {
            if (args.Length != 0) throw new InvalidOperationException("Expected controlled harness failure");
            ParserCases();
            NativeCases();
            Console.WriteLine(JsonSerializer.Serialize(new {
                schemaVersion = "stephanos.r7-token-group-inventory-native-fixture.v1",
                result = "PASS", assertions, optionalGroupAdjustmentCases,
                sdk = "8.0.426", runtime = Environment.Version.ToString(),
                canonicalIdentityReused = true, actualOwnedPrimaryTokens = true,
                actualOwnedRestrictedToken = true, impersonationTokenSupported = false,
                productionTokenChanged = false, productionSourceChanged = false,
                completeCapabilityInventory = false, continuousCustody = false,
                autonomousGoalConveyorPickup = false, leaseReleaseAuthorized = false,
                sourceMutationAuthorized = false
            }));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("R7_TOKEN_GROUP_FIXTURE_FAILED:" + error.GetType().Name + ":" + error.Message);
            return 1;
        }
    }
    private static void NativeCases()
    {
        Check(OpenProcessToken(GetCurrentProcess(), 0x000a, out var original), "Own process query token");
        using (original)
        {
            var first = R7TokenGroupInventory.ObserveRetained(original);
            Check(first.SampleStable, "Actual primary token observation: " + first.Classification);
            Check(first.Groups.Count > 0 && first.InventoryDigest.Length == 64, "Actual group inventory");
            Flags(first);
            var again = R7TokenGroupInventory.ObserveRetained(original);
            Check(R7TokenGroupInventory.SameRetainedObjectAndGroupState(first, again),
                "Stable same owned token");
            Check(DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(),
                out var sameObject, 0, false, 2), "Same object duplicate handle");
            using (sameObject)
            {
                var same = R7TokenGroupInventory.ObserveRetained(sameObject);
                Check(R7TokenGroupInventory.SameRetainedObjectAndGroupState(first, same),
                    "Duplicate HANDLE preserves canonical kernel token identity");
            }

            Check(DuplicateTokenEx(original, 0x004a, IntPtr.Zero, 2, 1, out var freshPrimary),
                "Fresh owned primary token");
            using (freshPrimary)
            {
                var duplicate = R7TokenGroupInventory.ObserveRetained(freshPrimary);
                Check(duplicate.SampleStable, "Fresh primary is observable");
                Check(duplicate.InventoryDigest == first.InventoryDigest, "Group metadata survives primary duplication");
                Check(!R7TokenGroupInventory.SameRetainedObjectAndGroupState(first, duplicate),
                    "Distinct duplicated token object is not the same original principal object");
                Check(duplicate.Principal.IdentityDigest != first.Principal.IdentityDigest,
                    "Canonical object stamp, not SID equality");
                Flags(duplicate);
                // This unused OWNED duplicate is never assigned to a process/thread.
                // Try disabling a nonmandatory currently enabled group where present.
                var adjustable = duplicate.Groups.FirstOrDefault(e =>
                    e.Enabled && !e.DenyOnly && (e.Attributes & 1) == 0);
                if (adjustable is not null)
                {
                    using var update = new OwnedGroups([new(adjustable.SidBytesHex, 0)]);
                    bool changed = AdjustTokenGroups(freshPrimary, false, update.Pointer, 0,
                        IntPtr.Zero, IntPtr.Zero);
                    if (changed)
                    {
                        var disabled = R7TokenGroupInventory.ObserveRetained(freshPrimary);
                        Check(disabled.SampleStable, "Changed duplicate is observable");
                        var actual = disabled.Groups.Single(e => e.SidBytesHex == adjustable.SidBytesHex);
                        Check(!actual.Enabled && !actual.DenyOnly, "Disabled is distinct from deny-only");
                        Check(disabled.Groups.Count == duplicate.Groups.Count, "Attribute mutation preserves count");
                        Check(disabled.Principal.IdentityDigest == duplicate.Principal.IdentityDigest,
                            "Adjusted token retains native object identity");
                        Check(disabled.InventoryDigest != duplicate.InventoryDigest,
                            "Same-count actual group change changes inventory digest");
                        Check(!R7TokenGroupInventory.SameRetainedObjectAndGroupState(duplicate, disabled),
                            "Before/after comparison refuses changed same object");
                        optionalGroupAdjustmentCases++;
                    }
                    else Console.WriteLine("OPTIONAL_ADJUST_GROUP_UNSUPPORTED");
                }
                else Console.WriteLine("OPTIONAL_ADJUST_GROUP_NO_NONMANDATORY_ENABLED_GROUP");
            }

            Check(DuplicateTokenEx(original, 0x000a, IntPtr.Zero, 2, 2, out var impersonation),
                "Fresh unused owned impersonation token");
            using (impersonation)
            {
                var unsupported = R7TokenGroupInventory.ObserveRetained(impersonation);
                Check(unsupported.Classification == "R7_GROUP_CANONICAL_PRIMARY_IDENTITY_UNAVAILABLE",
                    "Canonical primary-only identity limitation remains explicit");
                Held(unsupported);
            }

            var disable = first.Groups.First(e => e.Enabled && !e.DenyOnly);
            var restrict = first.RestrictedSids.FirstOrDefault() ?? disable;
            using var disabledSids = new OwnedGroups([new(disable.SidBytesHex, 0)]);
            using var restrictedSids = new OwnedGroups([new(restrict.SidBytesHex, 0)]);
            Check(CreateRestrictedToken(original, 0, 1, disabledSids.Entries, 0, IntPtr.Zero,
                1, restrictedSids.Entries, out var restricted), "Fresh unused owned restricted token");
            using (restricted)
            {
                var sampled = R7TokenGroupInventory.ObserveRetained(restricted);
                Check(sampled.SampleStable, "Actual restricted primary metadata is readable");
                Check(sampled.Groups.Any(e => e.SidBytesHex == disable.SidBytesHex && e.DenyOnly && !e.Enabled),
                    "Actual deny-only SID remains distinct from enabled");
                Check(sampled.RestrictedSids.Count > 0
                    && sampled.RestrictedSids.Any(e => e.SidBytesHex == restrict.SidBytesHex),
                    "Actual restricting SID inventory");
                Check(sampled.Groups.Count == first.Groups.Count,
                    "Actual deny-only conversion is visible despite unchanged GroupCount");
                Check(sampled.InventoryDigest != first.InventoryDigest, "Restriction changes digest");
                Check(!R7TokenGroupInventory.SameRetainedObjectAndGroupState(first, sampled),
                    "Filtered token not substituted for original");
                Flags(sampled);
            }
            // Querying an actual owned token with a valid but non-querying handle
            // must produce UNKNOWN, not an empty inventory interpreted as safe.
            Check(DuplicateTokenEx(original, 0x0002, IntPtr.Zero, 2, 1, out var noQuery), "Own no-query token");
            using (noQuery) Held(R7TokenGroupInventory.ObserveRetained(noQuery));
            Held(R7TokenGroupInventory.ObserveRetained(new SafeAccessTokenHandle(IntPtr.Zero)));
            using var closed = new SafeAccessTokenHandle(IntPtr.Zero);
            closed.Dispose();
            Held(R7TokenGroupInventory.ObserveRetained(closed));
            Check(R7TokenGroupInventory.SameRetainedObjectAndGroupState(first,
                R7TokenGroupInventory.ObserveRetained(original)), "Actual process token unchanged");
        }
    }
    private static void ParserCases()
    {
        const string world = "010100000000000100000000";
        const string administrators = "01020000000000052000000020020000";
        var enabled = new R7TokenGroupEntry(world, 4);
        var deny = new R7TokenGroupEntry(world, 0x10);
        var adminDisabled = new R7TokenGroupEntry(administrators, 0);
        using (var groups = new OwnedGroups([enabled, adminDisabled]))
        {
            var parsed = R7TokenGroupInventory.ParseOwnedBuffer(groups.Pointer, groups.Bytes);
            Check(parsed.Count == 2 && parsed.Any(e => e.Enabled && !e.DenyOnly), "Bounded valid SID entries");
            Check(parsed.Any(e => e.SidBytesHex == administrators && !e.Enabled && !e.DenyOnly),
                "Admin SID presence does not imply enabled membership");
            Check(R7TokenGroupInventory.Digest(parsed, [], []) ==
                R7TokenGroupInventory.Digest([adminDisabled, enabled], [], []), "Canonical order independent digest");
        }
        Check(R7TokenGroupInventory.Digest([enabled], [], []) !=
            R7TokenGroupInventory.Digest([deny], [], []), "Attributes change digest at unchanged count");
        Check(R7TokenGroupInventory.Digest([enabled], [], []) !=
            R7TokenGroupInventory.Digest([], [enabled], []), "Inventory class domain separation");
        Check(R7TokenGroupInventory.Digest([], [enabled], []) !=
            R7TokenGroupInventory.Digest([], [], [enabled]), "Capability domain separation");
        using (var duplicate = new OwnedGroups([enabled, enabled]))
        {
            var parsed = R7TokenGroupInventory.ParseOwnedBuffer(duplicate.Pointer, duplicate.Bytes);
            Check(parsed.Count == 2, "Legal duplicate restricted SID multiplicity preserved");
            Check(R7TokenGroupInventory.Digest([], parsed, []) !=
                R7TokenGroupInventory.Digest([], [enabled], []), "Multiplicity changes digest");
        }
        using (var empty = new OwnedGroups([]))
            Check(R7TokenGroupInventory.ParseOwnedBuffer(empty.Pointer, 4).Count == 0, "Four-byte empty buffer accepted");

        void Reject(Action<OwnedGroups> tamper, int? returnedSize = null)
        {
            using var own = new OwnedGroups([enabled]);
            tamper(own);
            bool rejected = false;
            try { R7TokenGroupInventory.ParseOwnedBuffer(own.Pointer, returnedSize ?? own.Bytes); }
            catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "Malformed bounded native buffer rejected");
        }
        Reject(x => Marshal.WriteInt32(x.Pointer, -1));
        Reject(x => Marshal.WriteInt32(x.Pointer, R7TokenGroupInventory.MaximumEntries + 1));
        Reject(_ => {}, 3);
        Reject(_ => {}, 4);
        Reject(_ => {}, R7TokenGroupInventory.MaximumBytes + 1);
        Reject(x => Marshal.WriteIntPtr(x.Entries, IntPtr.Zero));
        Reject(x => Marshal.WriteIntPtr(x.Entries, IntPtr.Subtract(x.Pointer, 4)));
        Reject(x => Marshal.WriteIntPtr(x.Entries, IntPtr.Add(x.Pointer, x.Bytes)));
        Reject(x => Marshal.WriteIntPtr(x.Entries, IntPtr.Add(x.Pointer, x.Bytes - 4)));
        Reject(x => Marshal.WriteIntPtr(x.Entries, x.Entries));
        Reject(x => Marshal.WriteIntPtr(x.Entries, IntPtr.Add(x.SidAt(0), 1)));
        Reject(x => Marshal.WriteByte(x.SidAt(0), 0, 2));
        Reject(x => Marshal.WriteByte(x.SidAt(0), 1, 16));
        Reject(x => Marshal.WriteByte(x.SidAt(0), 1, 15));
        Reject(x => Marshal.WriteInt32(x.Entries, IntPtr.Size, 0x14));
        Reject(_ => {}, R7TokenGroupInventory.EntryOffset + R7TokenGroupInventory.EntrySize);
        // High attribute bits are preserved, including logon/resource semantics.
        using var high = new OwnedGroups([new(world, 0xe0000004)]);
        Check(R7TokenGroupInventory.ParseOwnedBuffer(high.Pointer, high.Bytes)[0].Attributes == 0xe0000004,
            "All native attribute bits retained");
    }
    private sealed class OwnedGroups : IDisposable
    {
        internal IntPtr Pointer { get; }
        internal int Bytes { get; }
        internal IntPtr Entries => IntPtr.Add(Pointer, R7TokenGroupInventory.EntryOffset);
        internal IntPtr SidAt(int index) => Marshal.ReadIntPtr(Entries, index * R7TokenGroupInventory.EntrySize);
        internal OwnedGroups(IReadOnlyList<R7TokenGroupEntry> entries)
        {
            var sids = entries.Select(e => Convert.FromHexString(e.SidBytesHex)).ToArray();
            int end = R7TokenGroupInventory.EntryOffset + entries.Count * R7TokenGroupInventory.EntrySize;
            Bytes = end + sids.Sum(s => s.Length);
            Pointer = Marshal.AllocHGlobal(Bytes);
            Marshal.Copy(new byte[Bytes], 0, Pointer, Bytes);
            Marshal.WriteInt32(Pointer, entries.Count);
            int cursor = end;
            for (int i = 0; i < entries.Count; i++)
            {
                int entryOffset = R7TokenGroupInventory.EntryOffset + i * R7TokenGroupInventory.EntrySize;
                Marshal.WriteIntPtr(Pointer, entryOffset, IntPtr.Add(Pointer, cursor));
                Marshal.WriteInt32(Pointer, entryOffset + IntPtr.Size, unchecked((int)entries[i].Attributes));
                Marshal.Copy(sids[i], 0, IntPtr.Add(Pointer, cursor), sids[i].Length);
                cursor += sids[i].Length;
            }
        }
        public void Dispose() => Marshal.FreeHGlobal(Pointer);
    }
    [DllImport("kernel32.dll")] private static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateTokenEx(SafeAccessTokenHandle existing, uint access,
        IntPtr attributes, int level, int type, out SafeAccessTokenHandle token);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, SafeAccessTokenHandle source,
        IntPtr targetProcess, out SafeAccessTokenHandle target, uint access,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AdjustTokenGroups(SafeAccessTokenHandle token,
        [MarshalAs(UnmanagedType.Bool)] bool reset, IntPtr state, uint length, IntPtr previous, IntPtr returned);
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateRestrictedToken(SafeAccessTokenHandle existing, uint flags,
        uint disableCount, IntPtr disable, uint deletePrivilegeCount, IntPtr deletePrivileges,
        uint restrictCount, IntPtr restrict, out SafeAccessTokenHandle token);
}
