using System.Buffers.Binary;
using System.Security.AccessControl;
using System.Security.Cryptography;

namespace Stephanos.OriginalR7CustodyWitness;

// A bounded decoder of the kernel's prepared before-image format. Expected
// bindings must ultimately come from independently admitted recovery context;
// matching caller bytes authenticates no store, native object or authority.
// This class has no file, native mutation, signing or automatic replay API.
internal static class OriginalR7RecoveryPreparedRecord
{
    internal const int HeaderBytes = 176;
    internal const int MaximumSecurityBytes = 65536;
    internal const int MaximumRecordBytes = HeaderBytes + 3 * MaximumSecurityBytes;
    internal const uint DesiredSecurityInformation = 0x80000005; // OWNER | DACL | PROTECTED_DACL

    internal sealed record Inspection(string RecordSha256, string AdoptedBindingSha256,
        Guid AttemptId, string TargetIdentityHex, string JournalIdentityHex,
        bool Directory, uint IntendedSetInformation, string OriginalDescriptorSha256,
        string DesiredDescriptorSha256, string JournalDescriptorSha256)
    {
        internal string Classification => "R7_PREPARED_RECORD_BOUND_OUTCOME_UNKNOWN";
        internal string Outcome => "UNKNOWN";
    }

    internal static Inspection Inspect(ReadOnlySpan<byte> wire,
        ReadOnlySpan<byte> expectedAdoptedBindingDigest, Guid expectedAttemptId,
        ReadOnlySpan<byte> expectedTargetIdentity, ReadOnlySpan<byte> expectedJournalIdentity)
    {
        Require(wire.Length >= HeaderBytes && wire.Length <= MaximumRecordBytes, "RECORD_LENGTH");
        Require(expectedAdoptedBindingDigest.Length == 32 && !Zero(expectedAdoptedBindingDigest)
            && expectedAttemptId != Guid.Empty && expectedTargetIdentity.Length == 24
            && expectedJournalIdentity.Length == 24, "EXPECTED_BINDING");
        // Capture bounded bytes once. Hashing never edits caller-owned memory;
        // no returned buffer aliases either the caller or this captured record.
        byte[] bytes = wire.ToArray();
        ReadOnlySpan<byte> record = bytes;
        Require(record[..8].SequenceEqual("R7SDJ01\0"u8), "MAGIC");
        Require(U32(record, 8) == 1 && U32(record, 12) == HeaderBytes
            && U32(record, 16) == (uint)record.Length, "HEADER");
        uint originalBytes = U32(record, 20), desiredBytes = U32(record, 24), journalBytes = U32(record, 28);
        Require(Size(originalBytes) && Size(desiredBytes) && Size(journalBytes)
            && (ulong)HeaderBytes + originalBytes + desiredBytes + journalBytes == (ulong)record.Length,
            "PAYLOAD_LENGTHS");
        Require(U32(record, 160) <= 1 && U32(record, 164) == DesiredSecurityInformation
            && Zero(record.Slice(168, 8)), "FLAGS_OR_RESERVED");
        ReadOnlySpan<byte> target = record.Slice(32, 24), journal = record.Slice(56, 24);
        Require(target[..8].SequenceEqual(journal[..8]) && !target.SequenceEqual(journal)
            && !Zero(target[8..]) && !Zero(journal[8..]), "NATIVE_IDENTITIES");
        Require(target.SequenceEqual(expectedTargetIdentity) && journal.SequenceEqual(expectedJournalIdentity)
            && CryptographicOperations.FixedTimeEquals(record.Slice(80, 32), expectedAdoptedBindingDigest)
            && new Guid(record.Slice(112, 16)) == expectedAttemptId, "BINDING_MISMATCH");
        byte[] persistedDigest = record.Slice(128, 32).ToArray();
        bytes.AsSpan(128, 32).Clear();
        byte[] computedDigest = SHA256.HashData(bytes);
        Require(CryptographicOperations.FixedTimeEquals(persistedDigest, computedDigest), "DIGEST");
        persistedDigest.CopyTo(bytes, 128);
        int originalOffset = HeaderBytes, desiredOffset = originalOffset + (int)originalBytes;
        int journalOffset = desiredOffset + (int)desiredBytes;
        byte[] original = record.Slice(originalOffset, (int)originalBytes).ToArray();
        byte[] desired = record.Slice(desiredOffset, (int)desiredBytes).ToArray();
        byte[] journalPolicy = record.Slice(journalOffset, (int)journalBytes).ToArray();
        Descriptor(original, protectedDaclRequired: false);
        // Protection for the intended policy is encoded in the separately
        // hashed SET flags. The kernel's desired descriptor itself need not
        // carry SE_DACL_PROTECTED until that SET actually occurs.
        Descriptor(desired, protectedDaclRequired: false);
        Descriptor(journalPolicy, protectedDaclRequired: true);
        return new Inspection(Hex(SHA256.HashData(bytes)), Hex(record.Slice(80, 32)),
            new Guid(record.Slice(112, 16)), Hex(target), Hex(journal), U32(record, 160) == 1,
            U32(record, 164), Hex(SHA256.HashData(original)), Hex(SHA256.HashData(desired)),
            Hex(SHA256.HashData(journalPolicy)));
    }

    private static void Descriptor(byte[] bytes, bool protectedDaclRequired)
    {
        // Validate descriptor-relative component bounds before allowing the
        // managed decoder to follow offsets. OWNER+DACL are required; valid
        // ancillary group/SACL fields and a present NULL SACL are not proof
        // that the capture requested or authenticated those additional rights.
        ReadOnlySpan<byte> value = bytes;
        Require(value[0] == 1, "SD_REVISION");
        ushort control = BinaryPrimitives.ReadUInt16LittleEndian(value.Slice(2, 2));
        // Sbz1 carries a real resource-manager control byte when the native
        // SE_RM_CONTROL_VALID bit is set. The kernel capture preserves it.
        Require(value[1] == 0 || (control & 0x4000) != 0, "SD_RESOURCE_MANAGER_CONTROL");
        Require((control & 0x8004) == 0x8004
            && (!protectedDaclRequired || (control & 0x1000) != 0), "SD_CONTROL");
        uint ownerOffset = U32(value, 4), daclOffset = U32(value, 16);
        Require(Offset(ownerOffset, value.Length, 8) && Offset(daclOffset, value.Length, 8), "SD_OFFSETS");
        int owner = (int)ownerOffset, dacl = (int)daclOffset;
        Require(value[owner] == 1 && value[owner + 1] <= 15, "OWNER_SID");
        int ownerLength = 8 + 4 * value[owner + 1];
        Require(ownerLength <= value.Length - owner, "OWNER_LENGTH");
        ValidateSid(value, ownerOffset);
        uint groupOffset = U32(value, 8), saclOffset = U32(value, 12);
        Require((control & 0x0010) != 0 || saclOffset == 0, "SD_SACL_PRESENCE");
        if (groupOffset != 0) ValidateSid(value, groupOffset);
        if (saclOffset != 0) ValidateAcl(value, saclOffset);
        ValidateAcl(value, daclOffset);
        int aclLength = BinaryPrimitives.ReadUInt16LittleEndian(value.Slice(dacl + 2, 2));
        Require(owner + ownerLength <= dacl || dacl + aclLength <= owner, "SD_OVERLAP");
        try
        {
            var descriptor = new RawSecurityDescriptor(bytes, 0);
            Require(descriptor.Owner is not null && descriptor.DiscretionaryAcl is not null, "SD_COMPONENTS");
        }
        catch (ArgumentException) { throw Invalid("SD_ENCODING"); }
        catch (IndexOutOfRangeException) { throw Invalid("SD_ENCODING"); }
        // Managed structural decoding is not a native policy readback, an
        // authorization to restore, or proof the current object matches it.
    }

    private static void ValidateSid(ReadOnlySpan<byte> value, uint offset)
    {
        Require(Offset(offset, value.Length, 8), "SID_OFFSET");
        int at = (int)offset;
        Require(value[at] == 1 && value[at + 1] <= 15
            && 8 + 4 * value[at + 1] <= value.Length - at, "SID_LENGTH");
    }

    private static void ValidateAcl(ReadOnlySpan<byte> value, uint offset)
    {
        Require(Offset(offset, value.Length, 8), "ACL_OFFSET");
        int dacl = (int)offset;
        int aclLength = BinaryPrimitives.ReadUInt16LittleEndian(value.Slice(dacl + 2, 2));
        Require((value[dacl] == 2 || value[dacl] == 4) && value[dacl + 1] == 0
            && value[dacl + 6] == 0 && value[dacl + 7] == 0
            && aclLength >= 8 && aclLength <= value.Length - dacl, "DACL_LENGTH");
        int cursor = dacl + 8, limit = dacl + aclLength;
        int aceCount = BinaryPrimitives.ReadUInt16LittleEndian(value.Slice(dacl + 4, 2));
        for (int index = 0; index < aceCount; index++)
        {
            Require(cursor <= limit - 4, "ACE_HEADER");
            int size = BinaryPrimitives.ReadUInt16LittleEndian(value.Slice(cursor + 2, 2));
            Require(size >= 4 && size % 4 == 0 && size <= limit - cursor, "ACE_LENGTH");
            cursor += size;
        }
        // Independently decode the bounded ACL body as well. This is structural
        // parsing, without authenticating any policy or additional rights.
        try { _ = new RawAcl(value.Slice(dacl, aclLength).ToArray(), 0); }
        catch (ArgumentException) { throw Invalid("ACL_ENCODING"); }
        catch (IndexOutOfRangeException) { throw Invalid("ACL_ENCODING"); }
    }

    private static bool Offset(uint offset, int length, int minimum) =>
        offset >= 20 && offset % 4 == 0 && offset <= (uint)(length - minimum);
    private static bool Size(uint size) => size >= 20 && size <= MaximumSecurityBytes;
    private static uint U32(ReadOnlySpan<byte> value, int offset) =>
        BinaryPrimitives.ReadUInt32LittleEndian(value.Slice(offset, 4));
    private static bool Zero(ReadOnlySpan<byte> value)
    {
        foreach (byte item in value) if (item != 0) return false;
        return true;
    }
    private static string Hex(ReadOnlySpan<byte> value) => Convert.ToHexString(value).ToLowerInvariant();
    private static void Require(bool condition, string reason)
    { if (!condition) throw Invalid(reason); }
    private static InvalidDataException Invalid(string reason) => new("R7_RECOVERY_RECORD_" + reason);
}
