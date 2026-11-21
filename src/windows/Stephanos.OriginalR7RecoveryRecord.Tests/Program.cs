using System.Buffers.Binary;
using System.Security.AccessControl;
using System.Security.Cryptography;
using Stephanos.OriginalR7CustodyWitness;

try
{
    if (!OperatingSystem.IsWindows()) throw new InvalidOperationException("R7_RECOVERY_TEST_REQUIRES_WINDOWS");
    int assertions = 0;
    void Check(bool condition, string label)
    { assertions++; if (!condition) throw new InvalidOperationException("R7_RECOVERY_TEST_" + label); }
    byte[] binding = Enumerable.Repeat((byte)0x5a, 32).ToArray();
    Guid attempt = new("d727fa35-2e65-4b24-a9d1-f450a561f3a2");
    byte[] target = new byte[24], journal = new byte[24];
    BinaryPrimitives.WriteUInt64LittleEndian(target, 123); BinaryPrimitives.WriteUInt64LittleEndian(journal, 123);
    target[8] = 11; journal[8] = 22;
    byte[] Descriptor(string sddl)
    { var sd = new RawSecurityDescriptor(sddl); byte[] bytes = new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes, 0); return bytes; }
    byte[] original = Descriptor("O:SYD:(A;;FA;;;SY)"), desired = Descriptor("O:SYD:(D;;FA;;;WD)(A;;FA;;;SY)");
    byte[] journalPolicy = Descriptor("O:SYD:P(A;;FA;;;SY)");
    void U32(byte[] bytes, int offset, uint value) => BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(offset, 4), value);
    void Rehash(byte[] bytes) { bytes.AsSpan(128, 32).Clear(); SHA256.HashData(bytes).CopyTo(bytes, 128); }
    byte[] Fixture(byte[]? beforeImage = null)
    {
        byte[] before = beforeImage ?? original;
        byte[] bytes = new byte[176 + before.Length + desired.Length + journalPolicy.Length];
        "R7SDJ01\0"u8.CopyTo(bytes); U32(bytes, 8, 1); U32(bytes, 12, 176); U32(bytes, 16, (uint)bytes.Length);
        U32(bytes, 20, (uint)before.Length); U32(bytes, 24, (uint)desired.Length); U32(bytes, 28, (uint)journalPolicy.Length);
        target.CopyTo(bytes, 32); journal.CopyTo(bytes, 56); binding.CopyTo(bytes, 80); attempt.ToByteArray().CopyTo(bytes, 112);
        U32(bytes, 160, 1); U32(bytes, 164, 0x80000005);
        before.CopyTo(bytes, 176); desired.CopyTo(bytes, 176 + before.Length);
        journalPolicy.CopyTo(bytes, 176 + before.Length + desired.Length); Rehash(bytes); return bytes;
    }
    OriginalR7RecoveryPreparedRecord.Inspection Inspect(byte[] bytes, byte[]? b = null, Guid? a = null,
        byte[]? t = null, byte[]? j = null) => OriginalR7RecoveryPreparedRecord.Inspect(bytes, b ?? binding,
            a ?? attempt, t ?? target, j ?? journal);
    void Reject(byte[] bytes, string label, byte[]? b = null, Guid? a = null, byte[]? t = null, byte[]? j = null)
    {
        try { _ = Inspect(bytes, b, a, t, j); }
        catch (InvalidDataException error) when (error.Message.StartsWith("R7_RECOVERY_RECORD_", StringComparison.Ordinal))
        { Check(true, label); return; }
        Check(false, label);
    }
    byte[] valid = Fixture(), unchanged = valid.ToArray(); var read = Inspect(valid);
    Check(read.Classification == "R7_PREPARED_RECORD_BOUND_OUTCOME_UNKNOWN" && read.Outcome == "UNKNOWN", "UNKNOWN_EVEN_WHEN_COMPLETE");
    Check(read.AttemptId == attempt && read.Directory && read.IntendedSetInformation == 0x80000005, "FIELDS");
    Check(read.RecordSha256 == Convert.ToHexString(SHA256.HashData(valid)).ToLowerInvariant(), "FULL_RECORD_DIGEST");
    Check(read.OriginalDescriptorSha256 == Convert.ToHexString(SHA256.HashData(original)).ToLowerInvariant(), "BEFORE_IMAGE_DIGEST");
    Check(valid.SequenceEqual(unchanged), "CALLER_BYTES_UNCHANGED");
    valid[0] ^= 1; Check(read.RecordSha256 == Convert.ToHexString(SHA256.HashData(unchanged)).ToLowerInvariant(), "NO_RETURNED_ALIAS"); valid = unchanged;
    // Wire-format diagnostics, never synthetic custody receipts.
    for (int length = 0; length < valid.Length; length++) Reject(valid[..length], "EVERY_TORN_PREFIX");
    for (int index = 0; index < valid.Length; index++)
    { byte[] changed = valid.ToArray(); changed[index] ^= 1; Reject(changed, "EVERY_CORRUPT_BYTE"); }
    Reject(new byte[OriginalR7RecoveryPreparedRecord.MaximumRecordBytes + 1], "OVERSIZE");
    Reject([.. valid, 0], "TRAILING_BYTES"); Reject([.. valid, .. valid], "CONCATENATED_RECORDS");
    Reject(valid, "WRONG_BINDING", b: SHA256.HashData(binding)); Reject(valid, "EMPTY_BINDING", b: new byte[32]);
    Reject(valid, "SHORT_BINDING", b: new byte[31]); Reject(valid, "WRONG_ATTEMPT", a: Guid.NewGuid());
    Reject(valid, "EMPTY_ATTEMPT", a: Guid.Empty); Reject(valid, "SWAPPED_IDENTITIES", t: journal, j: target);
    Reject(valid, "SHORT_TARGET", t: new byte[23]); Reject(valid, "SHORT_JOURNAL", j: new byte[23]);
    void Alter(Action<byte[]> change, string label)
    { byte[] changed = valid.ToArray(); change(changed); Rehash(changed); Reject(changed, label); }
    Alter(x => U32(x, 8, 2), "FUTURE_VERSION"); Alter(x => U32(x, 12, 172), "HEADER_LENGTH");
    Alter(x => U32(x, 16, uint.MaxValue), "TOTAL_OVERFLOW");
    foreach (int offset in new[] { 20, 24, 28 })
        foreach (uint length in new uint[] { 0, 19, 65537, uint.MaxValue }) Alter(x => U32(x, offset, length), "PAYLOAD_LENGTH");
    Alter(x => U32(x, 160, 2), "DIRECTORY_NOT_BOOLEAN");
    foreach (uint flags in new uint[] { 5, 0x80000004, 0x80000015, 0xffffffff }) Alter(x => U32(x, 164, flags), "SET_FLAGS");
    for (int index = 168; index < 176; index++) { int at = index; Alter(x => x[at] = 1, "RESERVED_BYTE"); }
    Alter(x => x[56] ^= 1, "CROSS_VOLUME");
    Alter(x => x.AsSpan(32, 24).CopyTo(x.AsSpan(56, 24)), "JOURNAL_EQUALS_TARGET");
    Alter(x => x.AsSpan(40, 16).Clear(), "ZERO_TARGET_ID");
    foreach (int start in new[] { 176, 176 + original.Length, 176 + original.Length + desired.Length })
    {
        Alter(x => x[start] = 2, "SD_REVISION"); Alter(x => x[start + 1] = 1, "SD_RESERVED");
        Alter(x => x[start + 3] &= 0x7f, "ABSOLUTE_SD"); Alter(x => x[start + 2] &= 0xfb, "NO_DACL_PRESENT");
        foreach (int field in new[] { 4, 16 })
            foreach (uint value in new uint[] { 0, 4, 21, 0x80000000, uint.MaxValue }) Alter(x => U32(x, start + field, value), "COMPONENT_OFFSET");
        Alter(x => U32(x, start + 8, uint.MaxValue), "GROUP_OUT_OF_BOUNDS"); Alter(x => U32(x, start + 12, uint.MaxValue), "SACL_OUT_OF_BOUNDS");
        int owner = start + (int)BinaryPrimitives.ReadUInt32LittleEndian(valid.AsSpan(start + 4, 4));
        int acl = start + (int)BinaryPrimitives.ReadUInt32LittleEndian(valid.AsSpan(start + 16, 4));
        Alter(x => x[owner + 1] = 255, "SID_OVERFLOW"); Alter(x => U32(x, start + 16, (uint)(owner - start)), "OVERLAPPING_COMPONENTS");
        Alter(x => x[acl] = 1, "ACL_REVISION");
        Alter(x => { x[acl + 2] = 0xff; x[acl + 3] = 0xff; }, "ACL_OVERFLOW");
        Alter(x => { x[acl + 4] = 0xff; x[acl + 5] = 0xff; }, "ACE_COUNT_OVERFLOW");
        Alter(x => { x[acl + 10] = 0; x[acl + 11] = 0; }, "ZERO_ACE_SIZE"); Alter(x => x[acl + 10] = 5, "UNALIGNED_ACE_SIZE");
    }
    int journalStart = 176 + original.Length + desired.Length;
    Alter(x => x[journalStart + 3] &= 0xef, "JOURNAL_DACL_NOT_PROTECTED");
    var rmDescriptor = new RawSecurityDescriptor(original, 0);
    rmDescriptor.SetFlags(rmDescriptor.ControlFlags | ControlFlags.RMControlValid);
    rmDescriptor.ResourceManagerControl = 0x7f;
    byte[] rmBytes = new byte[rmDescriptor.BinaryLength]; rmDescriptor.GetBinaryForm(rmBytes, 0);
    Check(Inspect(Fixture(rmBytes)).OriginalDescriptorSha256 == Convert.ToHexString(SHA256.HashData(rmBytes)).ToLowerInvariant(), "RM_CONTROL_VALID_PRESERVED");
    byte[] padded = new byte[original.Length + 8]; original.CopyTo(padded, 0);
    int paddedAcl = (int)BinaryPrimitives.ReadUInt32LittleEndian(padded.AsSpan(16, 4));
    ushort paddedSize = BinaryPrimitives.ReadUInt16LittleEndian(padded.AsSpan(paddedAcl + 2, 2));
    BinaryPrimitives.WriteUInt16LittleEndian(padded.AsSpan(paddedAcl + 2, 2), (ushort)(paddedSize + 8));
    Check(Inspect(Fixture(padded)).Outcome == "UNKNOWN", "VALID_ACL_FREE_PADDING");
    Check(Inspect(Fixture(Descriptor("O:SYD:"))).Outcome == "UNKNOWN", "EMPTY_ORIGINAL_DACL");
    Check(Inspect(Fixture(Descriptor("O:SYD:P(A;;FA;;;SY)"))).Outcome == "UNKNOWN", "PROTECTED_ORIGINAL_DACL");
    byte[] nullSacl = original.ToArray(); nullSacl[2] |= 0x10;
    Check(Inspect(Fixture(nullSacl)).Outcome == "UNKNOWN", "VALID_PRESENT_NULL_SACL");
    Check(Inspect(Fixture(Descriptor("O:SYG:BAD:(A;;FA;;;SY)"))).Outcome == "UNKNOWN", "VALID_OPTIONAL_GROUP");
    Check(Inspect(Fixture(Descriptor("O:SYG:BAD:(A;;FA;;;SY)S:(AU;SA;FA;;;WD)"))).Outcome == "UNKNOWN", "VALID_OPTIONAL_SACL");
    byte[] ancillary = Descriptor("O:SYG:BAD:(A;;FA;;;SY)S:(AU;SA;FA;;;WD)");
    int groupAt = (int)BinaryPrimitives.ReadUInt32LittleEndian(ancillary.AsSpan(8, 4));
    int saclAt = (int)BinaryPrimitives.ReadUInt32LittleEndian(ancillary.AsSpan(12, 4));
    byte[] badGroup = Fixture(ancillary); badGroup[176 + groupAt + 1] = 255; Rehash(badGroup);
    Reject(badGroup, "ANCILLARY_GROUP_BODY_BOUNDED");
    byte[] badSacl = Fixture(ancillary); BinaryPrimitives.WriteUInt16LittleEndian(badSacl.AsSpan(176 + saclAt + 10, 2), 0); Rehash(badSacl);
    Reject(badSacl, "ANCILLARY_SACL_ACE_BOUNDED");
    byte[] badSaclSid = Fixture(ancillary); badSaclSid[176 + saclAt + 8 + 8 + 1] = 255; Rehash(badSaclSid);
    Reject(badSaclSid, "ANCILLARY_SACL_SID_BOUNDED");
    byte[] inactiveSacl = Fixture(ancillary); inactiveSacl[176 + 2] &= 0xef; Rehash(inactiveSacl);
    Reject(inactiveSacl, "SACL_OFFSET_WITHOUT_PRESENCE_INCONSISTENT");
    inactiveSacl[176 + saclAt + 8 + 8 + 1] = 255; Rehash(inactiveSacl);
    Reject(inactiveSacl, "INACTIVE_SACL_BODY_STILL_BOUNDED");
    byte[] ordinaryFile = valid.ToArray(); U32(ordinaryFile, 160, 0); Rehash(ordinaryFile);
    Check(!Inspect(ordinaryFile).Directory, "FILE_NOT_DIRECTORY");
    int originalOwner = (int)BinaryPrimitives.ReadUInt32LittleEndian(original.AsSpan(4, 4));
    int originalAcl = (int)BinaryPrimitives.ReadUInt32LittleEndian(original.AsSpan(16, 4));
    int ownerSize = 8 + 4 * original[originalOwner + 1];
    int aclSize = BinaryPrimitives.ReadUInt16LittleEndian(original.AsSpan(originalAcl + 2, 2));
    byte[] reordered = new byte[20 + aclSize + ownerSize]; original.AsSpan(0, 20).CopyTo(reordered);
    U32(reordered, 4, (uint)(20 + aclSize)); U32(reordered, 16, 20);
    original.AsSpan(originalAcl, aclSize).CopyTo(reordered.AsSpan(20));
    original.AsSpan(originalOwner, ownerSize).CopyTo(reordered.AsSpan(20 + aclSize));
    Check(Inspect(Fixture(reordered)).Outcome == "UNKNOWN", "DACL_BEFORE_OWNER");
    byte[] maximum = new byte[OriginalR7RecoveryPreparedRecord.MaximumSecurityBytes];
    original.AsSpan(0, 20).CopyTo(maximum); U32(maximum, 4, 20); U32(maximum, 16, (uint)(20 + ownerSize));
    original.AsSpan(originalOwner, ownerSize).CopyTo(maximum.AsSpan(20));
    original.AsSpan(originalAcl, aclSize).CopyTo(maximum.AsSpan(20 + ownerSize));
    BinaryPrimitives.WriteUInt16LittleEndian(maximum.AsSpan(20 + ownerSize + 2, 2), (ushort)(maximum.Length - 20 - ownerSize));
    Check(Inspect(Fixture(maximum)).Outcome == "UNKNOWN", "MAXIMUM_COMPONENT_LENGTH");
    Alter(x => x[176 + originalAcl + 8 + 8 + 1] = 255, "TRUNCATED_ACE_SID_BODY");
    byte[] objectDescriptor = Descriptor("O:SYD:(OA;;FA;00112233-4455-6677-8899-aabbccddeeff;;SY)");
    Check(Inspect(Fixture(objectDescriptor)).Outcome == "UNKNOWN", "REVISION_4_OBJECT_ACE");
    byte[] shortObjectAce = Fixture(objectDescriptor);
    int objectAcl = (int)BinaryPrimitives.ReadUInt32LittleEndian(objectDescriptor.AsSpan(16, 4));
    BinaryPrimitives.WriteUInt16LittleEndian(shortObjectAce.AsSpan(176 + objectAcl + 10, 2), 12);
    Rehash(shortObjectAce); Reject(shortObjectAce, "TRUNCATED_OBJECT_GUID_BODY");
    byte[] WithSaclAce(byte[] ace, byte revision = 2)
    {
        byte[] sd = new byte[original.Length + 8 + ace.Length]; original.CopyTo(sd, 0);
        sd[2] |= 0x10; U32(sd, 12, (uint)original.Length);
        int at = original.Length; sd[at] = revision;
        BinaryPrimitives.WriteUInt16LittleEndian(sd.AsSpan(at + 2, 2), (ushort)(8 + ace.Length));
        BinaryPrimitives.WriteUInt16LittleEndian(sd.AsSpan(at + 4, 2), 1);
        ace.CopyTo(sd, at + 8); return Fixture(sd);
    }
    Reject(WithSaclAce(new byte[] { 0x11, 0, 4, 0 }), "REVIEWER_HEADER_ONLY_MANDATORY_LABEL");
    // Every header-only ACE, including opaque/future values, must refuse.
    for (int type = 0; type <= 255; type++) Reject(WithSaclAce(new byte[] { (byte)type, 0, 4, 0 }), "ALL_HEADER_ONLY_ACE_TYPES");
    byte[] label = new byte[] { 0x11,0,20,0, 1,0,0,0, 1,1,0,0,0,0,0,16, 0,16,0,0 };
    Check(Inspect(WithSaclAce(label)).Outcome == "UNKNOWN", "VALID_NATIVE_MANDATORY_LABEL");
    foreach (byte type in new byte[] { 0,1,2,3 })
    {
        byte[] basic = label.ToArray(); basic[0] = type;
        Check(Inspect(WithSaclAce(basic)).Outcome == "UNKNOWN", "SUPPORTED_BASIC_ACE_FAMILIES");
    }
    foreach (byte type in new byte[] { 5,6,7,8 })
        for (uint flags = 0; flags < 4; flags++)
        {
            int sidAt = 12 + ((flags & 1) != 0 ? 16 : 0) + ((flags & 2) != 0 ? 16 : 0);
            byte[] objectAce = new byte[sidAt + 12]; objectAce[0] = type;
            BinaryPrimitives.WriteUInt16LittleEndian(objectAce.AsSpan(2, 2), (ushort)objectAce.Length);
            U32(objectAce, 4, 1); U32(objectAce, 8, flags); label.AsSpan(8).CopyTo(objectAce.AsSpan(sidAt));
            Check(Inspect(WithSaclAce(objectAce, 4)).Outcome == "UNKNOWN", "SUPPORTED_OBJECT_GUID_COMBINATIONS");
            Reject(WithSaclAce(objectAce, 2), "OBJECT_ACE_REQUIRES_DS_ACL");
            byte[] badFlags = objectAce.ToArray(); U32(badFlags, 8, 4);
            Reject(WithSaclAce(badFlags, 4), "OBJECT_ACE_RESERVED_FLAGS");
        }
    foreach (int index in new[] { 4, 8, 9, 10, 15 })
    {
        byte[] broken = label.ToArray(); broken[index] = 0xff;
        Reject(WithSaclAce(broken), "MALFORMED_MANDATORY_LABEL_BODY");
    }
    for (int length = 4; length < label.Length; length += 4)
    {
        byte[] truncated = label[..length]; BinaryPrimitives.WriteUInt16LittleEndian(truncated.AsSpan(2, 2), (ushort)length);
        Reject(WithSaclAce(truncated), "ALL_MANDATORY_LABEL_BODY_TRUNCATIONS");
    }
    byte[] extraLabel = new byte[24]; label.CopyTo(extraLabel, 0);
    BinaryPrimitives.WriteUInt16LittleEndian(extraLabel.AsSpan(2, 2), 24); Reject(WithSaclAce(extraLabel), "LABEL_TRAILING_BODY");
    foreach (byte type in new byte[] { 4,9,10,11,12,13,14,15,16,18,19,20,21,255 })
    {
        byte[] opaque = label.ToArray(); opaque[0] = type;
        Reject(WithSaclAce(opaque, 4), "UNVALIDATED_NATIVE_LAYOUT_UNSUPPORTED");
    }
    var random = new Random(3123);
    for (int sample = 0; sample < 5000; sample++)
    {
        byte[] changed = valid.ToArray();
        for (int mutation = 0; mutation < 1 + sample % 4; mutation++)
            changed[random.Next(176, changed.Length)] = (byte)random.Next(256);
        Rehash(changed);
        try { Check(Inspect(changed).Outcome == "UNKNOWN", "MUTATED_PARSED_OUTCOME_UNKNOWN"); }
        catch (InvalidDataException error) when (error.Message.StartsWith("R7_RECOVERY_RECORD_", StringComparison.Ordinal))
        { Check(true, "MALFORMED_DESCRIPTOR_REFUSED"); }
    }
    // Native OWNER+DACL readback from one owned random file, with no ACL mutation.
    string scratch = Path.Combine(Path.GetTempPath(), "r7-recovery-record-" + Guid.NewGuid().ToString("N"));
    try
    {
        using (var file = new FileStream(scratch, FileMode.CreateNew, FileAccess.Write, FileShare.None)) file.WriteByte(1);
        var actual = new FileInfo(scratch).GetAccessControl(AccessControlSections.Owner | AccessControlSections.Access);
        byte[] observed = actual.GetSecurityDescriptorBinaryForm();
        Console.WriteLine("R7_OWNED_DESCRIPTOR_CONTROL=" + BinaryPrimitives.ReadUInt16LittleEndian(observed.AsSpan(2, 2)).ToString("x4")
            + ";GROUP_PRESENT=" + (BinaryPrimitives.ReadUInt32LittleEndian(observed.AsSpan(8, 4)) != 0)
            + ";SACL_OFFSET_PRESENT=" + (BinaryPrimitives.ReadUInt32LittleEndian(observed.AsSpan(12, 4)) != 0));
        var native = Inspect(Fixture(observed));
        Check(native.OriginalDescriptorSha256 == Convert.ToHexString(SHA256.HashData(observed)).ToLowerInvariant(), "OWNED_NATIVE_BEFORE_IMAGE");
        Check(native.Outcome == "UNKNOWN", "NATIVE_READBACK_CANNOT_PROVE_OUTCOME");
    }
    finally { if (File.Exists(scratch)) File.Delete(scratch); }
    Console.WriteLine("R7_RECOVERY_RECORD_ASSERTIONS_PASSED=" + assertions);
    Console.WriteLine("R7_RECOVERY_FINAL_OUTCOME=UNKNOWN"); Console.WriteLine("R7_PRODUCTION_CUSTODY_PROVEN=false"); return 0;
}
catch (Exception error)
{
    Console.Error.WriteLine("R7_RECOVERY_TEST_FAILED=" + error.GetType().Name + ":" +
        (error.Message.StartsWith("R7_", StringComparison.Ordinal) ? error.Message : "UNEXPECTED_FAILURE")); return 1;
}
