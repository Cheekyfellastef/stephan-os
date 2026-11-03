using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Stephanos.OriginalR7CustodyWitness;


namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7AuditJournalTests
{
internal static int Run()
{
if (!OperatingSystem.IsWindows()) return 2;
int checks = 0;
void Check(bool ok, string name)
{
    checks++;
    if (!ok) throw new InvalidOperationException("AUDIT_TEST_FAILED_" + name);
}
void Reject(Action action, string name)
{
    try { action(); } catch (InvalidOperationException) { Check(true, name); return; }
    throw new InvalidOperationException("AUDIT_TEST_ACCEPTED_" + name);
}
var binding = new OriginalR7AuditBinding(new string('a', 40), new string('b', 64),
    "r7-recovery-test-request", "r7-recovery-test-command",
    "critical-2962-elastic-goal-r1-27828c3fdb2c", "4e5023eef829b285095db4eeb09d6f2b365e33e4");
var stamp = DateTimeOffset.Parse("2026-10-21T14:00:00.000Z");
const string evidence = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
string createdScratch = Path.Combine(Path.GetTempPath(), "r7-audit-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(createdScratch);
string scratch = createdScratch;
// Windows TEMP may contain an 8.3 alias. Tests qualify their own disposable
// root using its real native name; production continues to reject aliases.
using (SafeFileHandle root = Native.CreateFileW(createdScratch,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero))
{
    var name = new StringBuilder(512);
    uint length = Native.GetFinalPathNameByHandleW(root,name,512,0);
    Check(length > 0 && length < 512 && name.ToString().StartsWith(@"\\?\",StringComparison.Ordinal),
        "DISPOSABLE_ROOT_NATIVE_NAME_AVAILABLE");
    scratch = name.ToString()[4..];
    Check(new DirectoryInfo(scratch).Name == new DirectoryInfo(createdScratch).Name,
        "DISPOSABLE_ROOT_EXACT_RANDOM_NAME");
}
string Fresh() => Path.Combine(scratch, Guid.NewGuid().ToString("N") + ".ndjson");
FileStream StreamFor(string path) => new(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read,
    1, FileOptions.WriteThrough);
OriginalR7AuditJournal Journal(string path, OriginalR7AuditBinding? b = null)
    => new(StreamFor(path), b ?? binding, () => stamp, () => 1000);
void RejectBytes(byte[] bytes, string name, OriginalR7AuditBinding? b = null)
{
    string path = Fresh(); File.WriteAllBytes(path, bytes);
    using var stream = StreamFor(path);
    Reject(() => { using var j = new OriginalR7AuditJournal(stream, b ?? binding); }, name);
}
try
{
    string validPath = Fresh();
    string firstDigest;
    using (var j = Journal(validPath))
    {
        Check(j.LastCheckpoint is null, "EMPTY_CHECKPOINT");
        var a = j.Append(OriginalR7AuditEvent.Start, evidence); firstDigest = a.EntryDigest;
        Check(a.Sequence == 1 && a.EntryDigest.Length == 64, "FIRST_DURABLE_APPEND");
        Check(!a.PhysicalContainmentProven && !a.IndependentSignatureProven && !a.LeaseReleaseAuthorized,
            "CHECKPOINT_IS_NOT_AUTHORITY");
        var b = j.Append(OriginalR7AuditEvent.Observation, evidence);
        Check(b.Sequence == 2 && b.EntryDigest != firstDigest && b.BindingDigest == a.BindingDigest,
            "CHAIN_ADVANCES");
        var c = j.Append(OriginalR7AuditEvent.Stop, evidence);
        Check(c.Sequence == 3 && j.LastCheckpoint == c, "STOP_CHECKPOINT");
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "AFTER_STOP");
    }
    byte[] valid = File.ReadAllBytes(validPath);
    Check(valid[^1] == 10 && !valid.Contains((byte)13), "CANONICAL_LF");
    using (var reopened = Journal(validPath))
    {
        Check(reopened.LastCheckpoint?.Sequence == 3, "REAL_REPLAY_READBACK");
        Reject(() => reopened.Append(OriginalR7AuditEvent.Observation, evidence), "RESTART_NOT_CONTINUITY");
    }
    string interrupted = Fresh();
    using (var j = Journal(interrupted)) j.Append(OriginalR7AuditEvent.Start, evidence);
    using (var j = Journal(interrupted))
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "UNTERMINATED_SESSION_CANNOT_RESUME");
    string states = Fresh();
    using (var j = Journal(states))
    {
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "MISSING_START");
        Reject(() => j.Append((OriginalR7AuditEvent)999, evidence), "UNKNOWN_EVENT");
        Reject(() => j.Append(OriginalR7AuditEvent.Start, "bad"), "SHORT_DIGEST");
        Reject(() => j.Append(OriginalR7AuditEvent.Start, evidence.ToUpperInvariant()), "UPPER_DIGEST");
        j.Append(OriginalR7AuditEvent.Start, evidence);
        Reject(() => j.Append(OriginalR7AuditEvent.Start, evidence), "DUPLICATE_START");
        j.Append(OriginalR7AuditEvent.Fault, evidence);
        Reject(() => j.Append(OriginalR7AuditEvent.Stop, evidence), "AFTER_FAULT");
    }
    var badBindings = new[] {
        binding with { HeadSha = new string('a',40) },
        binding with { SourceRevision = "bad" },
        binding with { OriginalLeaseDigest = new string('B',64) },
        binding with { RequestId = "untrusted\nrequest" },
        binding with { CommandId = "x" },
        binding with { SourceExecutionId = "different-mission-r1-27828c3fdb2c" },
        binding with { SourceExecutionId = "critical-2962-elastic-goal-r" + new string('9',1000) + "-27828c3fdb2c" },
    };
    foreach (var bad in badBindings)
    {
        using var stream = StreamFor(Fresh());
        Reject(() => { using var j = new OriginalR7AuditJournal(stream, bad); }, "BINDING_REJECTED");
    }
    RejectBytes(valid, "WRONG_REQUEST_REPLAY", binding with { RequestId = "different-request" });
    RejectBytes(valid[..^1], "TORN_TAIL");
    RejectBytes(valid.Concat(new byte[]{10}).ToArray(), "EMPTY_LINE");
    RejectBytes(Encoding.UTF8.GetPreamble().Concat(valid).ToArray(), "BOM");
    RejectBytes(new byte[] { 255, 10 }, "INVALID_UTF8");
    RejectBytes(new byte[OriginalR7AuditJournal.MaxJournalBytes + 1], "JOURNAL_LIMIT");
    RejectBytes(Encoding.UTF8.GetBytes(new string('x', OriginalR7AuditJournal.MaxEntryBytes) + "\n"), "ENTRY_BYTE_LIMIT");
    string text = Encoding.UTF8.GetString(valid);
    string[] lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
    RejectBytes(Encoding.UTF8.GetBytes(string.Join('\n', lines.Reverse()) + "\n"), "REORDER");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace(evidence, new string('e',64))), "CONTENT_TAMPER");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace("\"Sequence\":1", "\"Sequence\":2")), "SEQUENCE_TAMPER");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace("\"Sequence\":1", "\"Sequence\":1,\"Sequence\":1")), "DUPLICATE_KEY");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace("\"Sequence\":1", "\"Extra\":true,\"Sequence\":1")), "UNKNOWN_KEY");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace("\"Sequence\":1", "\"Sequence\":1 ")), "NONCANONICAL_WHITESPACE");
    RejectBytes(Encoding.UTF8.GetBytes(text.Replace("2026-10-21T14:00:00.000Z", "2026-10-21T15:00:00+01:00")), "ALTERNATE_TIMESTAMP");
    long tick = 100;
    var time = stamp;
    using (var j = new OriginalR7AuditJournal(StreamFor(Fresh()), binding, () => time, () => tick))
    {
        j.Append(OriginalR7AuditEvent.Start, evidence);
        tick = 99;
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "MONOTONIC_ROLLBACK");
        tick = 101;
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "ROLLBACK_POISONS_INSTANCE");
    }
    using (var j = new OriginalR7AuditJournal(StreamFor(Fresh()), binding, () => time, () => 200))
    {
        j.Append(OriginalR7AuditEvent.Start, evidence); time = stamp.AddMilliseconds(-1);
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "WALL_CLOCK_ROLLBACK");
    }
    time = stamp;
    string changed = Fresh();
    using (var stream = StreamFor(changed))
    using (var j = new OriginalR7AuditJournal(stream, binding))
    {
        j.Append(OriginalR7AuditEvent.Start, evidence);
        stream.SetLength(0); // explicit disposable-file fault injection
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "EXTERNAL_LENGTH_CHANGE");
        Reject(() => { _ = j.LastCheckpoint; }, "NO_CHECKPOINT_AFTER_IO_FAILURE");
    }
    string torn = Fresh();
    using (var broken = new PartialWriteStream(torn))
    using (var j = new OriginalR7AuditJournal(broken, binding))
    {
        Reject(() => j.Append(OriginalR7AuditEvent.Start, evidence), "PARTIAL_WRITE");
        Reject(() => j.Append(OriginalR7AuditEvent.Start, evidence), "PARTIAL_WRITE_POISONS");
    }
    RejectBytes(File.ReadAllBytes(torn), "PARTIAL_WRITE_REPLAY");
    using (var broken = new FlushFailureStream(Fresh()))
    using (var j = new OriginalR7AuditJournal(broken, binding))
    {
        Reject(() => j.Append(OriginalR7AuditEvent.Start, evidence), "DISK_FLUSH_FAILURE");
        Reject(() => { _ = j.LastCheckpoint; }, "NO_CHECKPOINT_AFTER_FLUSH_FAILURE");
    }
    string concurrent = Fresh();
    using (var j = Journal(concurrent))
    {
        j.Append(OriginalR7AuditEvent.Start, evidence);
        Parallel.For(0, 24, _ => j.Append(OriginalR7AuditEvent.Observation, evidence));
        Check(j.LastCheckpoint?.Sequence == 25, "SERIALIZED_CONCURRENT_APPEND");
        try { using var other = new FileStream(concurrent, FileMode.Open, FileAccess.Write, FileShare.ReadWrite); }
        catch (IOException) { Check(true, "REAL_SECOND_WRITER_SHARING_DENIED"); goto shareDenied; }
        throw new InvalidOperationException("AUDIT_TEST_SECOND_WRITER_ACCEPTED");
        shareDenied:;
    }
    using (var j = Journal(concurrent)) Check(j.LastCheckpoint?.Sequence == 25, "CONCURRENT_REPLAY");
    using (var j = Journal(Fresh()))
    {
        j.Append(OriginalR7AuditEvent.Start, evidence);
        for (int i = 1; i < OriginalR7AuditJournal.MaxEntries; i++) j.Append(OriginalR7AuditEvent.Observation, evidence);
        Reject(() => j.Append(OriginalR7AuditEvent.Observation, evidence), "ENTRY_COUNT_LIMIT");
    }
    const string serviceSid = "S-1-5-80-111-222-333-444-555"; // synthetic, never enrolled
    byte[] Descriptor(bool directory, Action<RawSecurityDescriptor>? change = null)
    {
        int mask = directory ? OriginalR7AuditStorage.ServiceDirectoryMask : OriginalR7AuditStorage.ServiceFileMask;
        var sd = new RawSecurityDescriptor($"O:SYG:SYD:P(A;;0x1f01ff;;;SY)(A;;0x1f01ff;;;BA)(A;;0x{mask:x};;;{serviceSid})");
        change?.Invoke(sd);
        byte[] bytes = new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes,0); return bytes;
    }
    Check(OriginalR7AuditStorage.PolicyMatches(Descriptor(false), serviceSid, false), "EXACT_APPEND_FILE_POLICY");
    Check(OriginalR7AuditStorage.PolicyMatches(Descriptor(true), serviceSid, true), "EXACT_READ_DIRECTORY_POLICY");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(true), serviceSid, false), "DIRECTORY_POLICY_NOT_FILE");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(false, sd => sd.Owner = new SecurityIdentifier(serviceSid)), serviceSid, false), "SERVICE_CANNOT_OWN_AUDIT");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(false, sd => sd.SetFlags(ControlFlags.DiscretionaryAclPresent)), serviceSid, false), "INHERITING_DACL_DENIED");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(false, sd => sd.DiscretionaryAcl = null), serviceSid, false), "NULL_DACL_DENIED");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(false, sd => sd.DiscretionaryAcl!.InsertAce(0,
        new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x1f01ff, new SecurityIdentifier("S-1-1-0"), false, null))), serviceSid, false), "EXTRA_PRINCIPAL_DENIED");
    Check(!OriginalR7AuditStorage.PolicyMatches(Descriptor(false), "S-1-5-21-1-2-3-4", false), "USER_NOT_SERVICE_SID");
    Check(!OriginalR7AuditStorage.PolicyMatches(new byte[]{1,2,3},serviceSid,false), "MALFORMED_DESCRIPTOR");
    Reject(() => { using var storage = OriginalR7AuditStorage.OpenFixed(binding); }, "INTERACTIVE_CANNOT_OPEN_PRODUCTION_AUDIT");
    var matches = typeof(OriginalR7AuditStorage).GetMethod("NativeIdentityMatches",
        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
    string nativeFixture = Fresh(); File.WriteAllText(nativeFixture, "untrusted native fixture");
    using (SafeFileHandle nativeFile = Native.CreateFileW(nativeFixture, 0x20080, 3, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero))
    {
        Check((bool)matches.Invoke(null, new object[]{nativeFile,nativeFixture,false})!, "REAL_FILE_NATIVE_NAME");
        Check(!(bool)matches.Invoke(null, new object[]{nativeFile,nativeFixture,true})!, "REAL_FILE_NOT_DIRECTORY");
        Check(!(bool)matches.Invoke(null, new object[]{nativeFile,nativeFixture + ".alias",false})!, "REAL_NATIVE_ALIAS_REJECTED");
        if (!string.Equals(createdScratch,scratch,StringComparison.OrdinalIgnoreCase))
            Check(!(bool)matches.Invoke(null,new object[]{nativeFile,Path.Combine(createdScratch,Path.GetFileName(nativeFixture)),false})!, "REAL_83_ALIAS_REJECTED");
    }
    using (SafeFileHandle nativeDirectory = Native.CreateFileW(scratch, 0x20080, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
        Check((bool)matches.Invoke(null, new object[]{nativeDirectory,scratch,true})!, "REAL_DIRECTORY_NATIVE_NAME");
    string hardlink = Fresh();
    Check(Native.CreateHardLinkW(hardlink,nativeFixture,IntPtr.Zero), "DISPOSABLE_HARDLINK_CREATED");
    using (SafeFileHandle linked = Native.CreateFileW(nativeFixture,0x20080,3,IntPtr.Zero,3,0x00200000,IntPtr.Zero))
        Check(!(bool)matches.Invoke(null,new object[]{linked,nativeFixture,false})!, "REAL_MULTINAME_FILE_REJECTED");

    // Kernel append-only handle behavior, using a disposable ordinary file.
    // No production identity, DACL commissioning, source or lease is touched.
    string appendOnly = Fresh(); File.WriteAllBytes(appendOnly, Array.Empty<byte>());
    using (SafeFileHandle handle = Native.CreateFileW(appendOnly, OriginalR7AuditStorage.ServiceFileMask,
        1, IntPtr.Zero, 3, 0x80200000, IntPtr.Zero))
    {
        Check(!handle.IsInvalid, "REAL_APPEND_ONLY_HANDLE_OPEN");
        using var stream = new FileStream(handle, FileAccess.ReadWrite, 1, false);
        using var j = new OriginalR7AuditJournal(stream, binding);
        Check(j.Append(OriginalR7AuditEvent.Start, evidence).Sequence == 1, "REAL_APPEND_ONLY_FLUSH_READBACK");
        Check(j.Append(OriginalR7AuditEvent.Observation, evidence).Sequence == 2, "REAL_SECOND_APPEND_ONLY_FLUSH");
        try { stream.SetLength(0); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { Check(true, "REAL_APPEND_HANDLE_CANNOT_TRUNCATE"); goto truncateDenied; }
        throw new InvalidOperationException("AUDIT_TEST_APPEND_HANDLE_TRUNCATED");
        truncateDenied:;
    }
    using (var j = Journal(appendOnly)) Check(j.LastCheckpoint?.Sequence == 2, "NATIVE_APPEND_REPLAY");
    Console.WriteLine(JsonSerializer.Serialize(new {
        schemaVersion="local.r7-native-audit-tests.v1", passed=checks, failed=0,
        operatingSystem="Windows", actualKernelAppendAndFlushObserved=true,
        fixedProductionStorageOpened=false, protectedAuditCommissioned=false,
        originalWriterExcluded=false, signedWitnessIssued=false, leaseReleased=false
    }));
    return checks;
}
finally
{
    // Only this exact newly-created disposable directory is removed.
    // No canonical checkout, service data, policy or source lease is touched.
    if (Directory.Exists(scratch))
    {
        if (new DirectoryInfo(scratch).Name != new DirectoryInfo(createdScratch).Name)
            throw new InvalidOperationException("TEST_CLEANUP_ROOT_CHANGED");
        foreach (string file in Directory.EnumerateFiles(scratch)) File.Delete(file);
        Directory.Delete(scratch); // no recursive traversal
    }
}

}
}

sealed class PartialWriteStream : FileStream
{
    internal PartialWriteStream(string path) : base(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read) { }
    public override void Write(ReadOnlySpan<byte> buffer)
    {
        base.Write(buffer[..Math.Min(buffer.Length, 13)]);
        base.Flush(true);
        throw new IOException("TEST_PARTIAL_WRITE");
    }
}
sealed class FlushFailureStream : FileStream
{
    internal FlushFailureStream(string path) : base(path,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read) { }
    public override void Flush(bool flushToDisk) => throw new IOException("TEST_DISK_FLUSH_FAILURE");
}
static class Native
{
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint length,uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateHardLinkW(string name,string existing,IntPtr security);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    internal static extern SafeFileHandle CreateFileW(string name, int access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
}
