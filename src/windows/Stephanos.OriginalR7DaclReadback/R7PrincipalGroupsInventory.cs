using System.Collections.ObjectModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7DaclReadback;

// Private, instantaneous primary-token metadata. Never serialize this SID
// inventory to a public mailbox or treat it as enrollment, membership consent,
// complete token authority, whole-estate exclusion or continuous custody.
internal sealed record R7TokenGroupEntry(string SidBytesHex, uint Attributes)
{
    internal bool Enabled => (Attributes & 0x4) != 0;
    internal bool DenyOnly => (Attributes & 0x10) != 0;
}

internal sealed record R7TokenGroupObservation(
    string Classification, bool SampleStable,
    R7NativePrincipalStamp Principal,
    ReadOnlyCollection<R7TokenGroupEntry> Groups,
    ReadOnlyCollection<R7TokenGroupEntry> RestrictedSids,
    ReadOnlyCollection<R7TokenGroupEntry> Capabilities,
    string InventoryDigest)
{
    public bool SourcePrincipalAuthenticated => false;
    public bool CompleteCapabilityInventoryProven => false;
    public bool ContinuousCustodyProven => false;
    public bool SourceMutationAuthorized => false;
    public bool LeaseReleaseAuthorized => false;
    public bool HostPolicyAdopted => false;
}

internal static class R7TokenGroupInventory
{
    internal const int MaximumBytes = 65536;
    internal const int MaximumEntries = 1024;
    private const string Observed = "R7_PRIMARY_TOKEN_GROUP_SAMPLE_OBSERVED_NOT_CUSTODY";
    private static readonly ReadOnlyCollection<R7TokenGroupEntry> Empty =
        Array.AsReadOnly(Array.Empty<R7TokenGroupEntry>());

    // Mirrors TOKEN_GROUPS alignment without defining TOKEN_STATISTICS again.
    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct GroupsHeader { public uint Count; public SidAndAttributes First; }
    internal static int EntryOffset => checked((int)Marshal.OffsetOf<GroupsHeader>(nameof(GroupsHeader.First)));
    internal static int EntrySize => Marshal.SizeOf<SidAndAttributes>();

    internal static R7TokenGroupObservation ObserveRetained(SafeAccessTokenHandle retained)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64
            || retained is null || retained.IsClosed || retained.IsInvalid)
            return Unknown("R7_GROUP_TOKEN_OR_PLATFORM_UNAVAILABLE");
        bool added = false;
        try
        {
            retained.DangerousAddRef(ref added);
            // Reuse the sole canonical object/privilege-aware mutation identity.
            // Its current contract supports primary tokens only. Impersonation
            // tokens must remain UNKNOWN, never receive an invented stamp.
            R7NativePrincipalStamp before = R7NativePrincipalIdentity.ObserveRetained(retained);
            if (!before.NativeIdentityObserved)
                return Unknown("R7_GROUP_CANONICAL_PRIMARY_IDENTITY_UNAVAILABLE");
            var first = ReadSample(retained);
            var middle = R7NativePrincipalIdentity.ObserveRetained(retained);
            var second = ReadSample(retained);
            var after = R7NativePrincipalIdentity.ObserveRetained(retained);
            if (!R7NativePrincipalIdentity.SameRetainedObjectAndState(before, middle)
                || !R7NativePrincipalIdentity.SameRetainedObjectAndState(before, after)
                || first.Digest != second.Digest)
                return Unknown("R7_GROUP_SAMPLE_CHANGED");
            return new(Observed, true, after, second.Groups, second.Restricted,
                second.Capabilities, second.Digest);
        }
        catch { return Unknown("R7_GROUP_SAMPLE_UNAVAILABLE_OR_UNBOUNDED"); }
        finally { if (added) retained.DangerousRelease(); }
    }

    internal static bool SameRetainedObjectAndGroupState(
        R7TokenGroupObservation left, R7TokenGroupObservation right)
        => left is { SampleStable: true, Classification: Observed }
            && right is { SampleStable: true, Classification: Observed }
            && R7NativePrincipalIdentity.SameRetainedObjectAndState(left.Principal, right.Principal)
            && left.InventoryDigest == right.InventoryDigest;

    internal sealed record Sample(ReadOnlyCollection<R7TokenGroupEntry> Groups,
        ReadOnlyCollection<R7TokenGroupEntry> Restricted,
        ReadOnlyCollection<R7TokenGroupEntry> Capabilities, string Digest);

    private static Sample ReadSample(SafeAccessTokenHandle token)
    {
        Sample sample = ReadBoundedInventory(token);
        if (R7ProcessBoundWriteDenial.ReadStamp(token).GroupCount != sample.Groups.Count)
            throw new InvalidOperationException();
        return sample;
    }

    // Pure bounded native inventory layer. It never calls ReadStamp, the
    // principal wrapper or the high-level observer; the canonical stamp can
    // therefore reuse it without recursion or another statistics layout.
    internal static Sample ReadBoundedInventory(SafeAccessTokenHandle token)
    {
        var groups = ReadGroups(token, 2 /* TokenGroups */);
        var restricted = ReadGroups(token, 11 /* TokenRestrictedSids */);
        var capabilities = ReadGroups(token, 30 /* TokenCapabilities */);
        string digest = Digest(groups, restricted, capabilities);
        return new(groups, restricted, capabilities, digest);
    }

    private static ReadOnlyCollection<R7TokenGroupEntry> ReadGroups(SafeAccessTokenHandle token, int kind)
    {
        if (GetTokenInformation(token, kind, IntPtr.Zero, 0, out int required)
            || Marshal.GetLastWin32Error() != 122
            || required < 4 || required > MaximumBytes)
            throw new InvalidOperationException();
        IntPtr owned = Marshal.AllocHGlobal(required);
        try
        {
            if (!GetTokenInformation(token, kind, owned, required, out int actual)
                || actual < 4 || actual > required)
                throw new InvalidOperationException();
            // Parse only the successful returned extent, not allocation capacity.
            return ParseOwnedBuffer(owned, actual);
        }
        finally { Marshal.FreeHGlobal(owned); }
    }

    // Only the private reader or tests may supply a currently owned allocation.
    // This cannot validate the existence/lifetime of an arbitrary caller pointer.
    // Bound every embedded pointer BEFORE touching SID memory or invoking an API.
    internal static ReadOnlyCollection<R7TokenGroupEntry> ParseOwnedBuffer(IntPtr owned, int bytes)
    {
        if (RuntimeInformation.ProcessArchitecture != Architecture.X64
            || owned == IntPtr.Zero || bytes < 4 || bytes > MaximumBytes)
            throw new InvalidOperationException();
        ulong start = unchecked((ulong)owned.ToInt64());
        if (start > ulong.MaxValue - (uint)bytes) throw new InvalidOperationException();
        uint count = unchecked((uint)Marshal.ReadInt32(owned));
        if (count > MaximumEntries) throw new InvalidOperationException();
        long entriesEnd = (long)EntryOffset + (long)count * EntrySize;
        // An empty TOKEN_GROUPS may report only its DWORD count.
        if (count == 0) return Empty;
        if (entriesEnd > bytes) throw new InvalidOperationException();
        var entries = new List<R7TokenGroupEntry>(checked((int)count));
        for (int index = 0; index < count; index++)
        {
            int offset = checked(EntryOffset + index * EntrySize);
            IntPtr sidPointer = Marshal.ReadIntPtr(owned, offset);
            uint attributes = unchecked((uint)Marshal.ReadInt32(owned, offset + IntPtr.Size));
            ulong pointer = unchecked((ulong)sidPointer.ToInt64());
            if (pointer < start || pointer - start < (ulong)entriesEnd
                || pointer - start > (ulong)(bytes - 8) || (pointer & 3) != 0)
                throw new InvalidOperationException();
            int sidOffset = checked((int)(pointer - start));
            byte revision = Marshal.ReadByte(owned, sidOffset);
            byte subauthorities = Marshal.ReadByte(owned, sidOffset + 1);
            int length = 8 + 4 * subauthorities;
            if (revision != 1 || subauthorities > 15 || length > bytes - sidOffset)
                throw new InvalidOperationException();
            byte[] sid = new byte[length];
            Marshal.Copy(sidPointer, sid, 0, length);
            if (!IsValidSid(sid) || (attributes & 0x14) == 0x14)
                throw new InvalidOperationException();
            entries.Add(new(Convert.ToHexString(sid), attributes));
        }
        // Restricted tokens can legally contain duplicate restricting SIDs.
        // Retain multiplicity and all 32 attribute bits; do not deduplicate.
        entries.Sort((a, b) => {
            int sid = StringComparer.Ordinal.Compare(a.SidBytesHex, b.SidBytesHex);
            return sid != 0 ? sid : a.Attributes.CompareTo(b.Attributes);
        });
        return entries.AsReadOnly();
    }

    internal static string Digest(IReadOnlyList<R7TokenGroupEntry> groups,
        IReadOnlyList<R7TokenGroupEntry> restricted, IReadOnlyList<R7TokenGroupEntry> capabilities)
    {
        var text = new StringBuilder("stephanos.r7.primary-token-group-inventory.v1\0");
        void Add(string kind, IReadOnlyList<R7TokenGroupEntry> values)
        {
            text.Append(kind).Append(':').Append(values.Count.ToString(CultureInfo.InvariantCulture)).Append('\n');
            foreach (var value in values.OrderBy(v => v.SidBytesHex, StringComparer.Ordinal).ThenBy(v => v.Attributes))
                text.Append(value.SidBytesHex).Append(':')
                    .Append(value.Attributes.ToString("x8", CultureInfo.InvariantCulture)).Append('\n');
        }
        Add("groups", groups); Add("restricted", restricted); Add("capabilities", capabilities);
        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(text.ToString()))).ToLowerInvariant();
    }

    private static R7TokenGroupObservation Unknown(string code)
        => new(code, false, new(false, 0, "", ""), Empty, Empty, Empty, "");

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind,
        IntPtr information, int size, out int actual);
    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsValidSid([In] byte[] sid);
}
