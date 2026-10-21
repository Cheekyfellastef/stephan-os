using Microsoft.Win32.SafeHandles;
using System.Reflection;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Stephanos.OriginalR7CustodyWitness;

namespace Stephanos.OriginalR7CustodyWitness.Tests;

internal static class OriginalR7ProtectedKeyMetadataTests
{
    private static int total;
    private const string Role = "S-1-5-80-11-22-33-44-55";
    private static void Check(bool ok, string name)
    { total++; if (!ok) throw new InvalidOperationException("R7_KEY_METADATA_TEST_FAILED_" + name); }
    private static void Reject(Action action, string name)
    {
        bool held = false;
        try { action(); } catch (InvalidOperationException) { held = true; }
        Check(held, name);
    }
    private static void NoAuthority(OriginalR7KeyMetadataObservation observation)
    {
        Check(!observation.PrivateKeyBytesRead, "NO_PRIVATE_DATA_READ");
        Check(!observation.RootEnrolled && !observation.PolicyAdopted, "NO_ENROLLMENT_OR_ADOPTION");
        Check(!observation.OriginalWriterExcluded && !observation.SigningAuthorized
            && !observation.LeaseReleaseAuthorized, "NO_SOURCE_SIGNING_OR_LEASE_AUTHORITY");
    }
    private static byte[] Descriptor(string text)
    {
        var descriptor = new RawSecurityDescriptor(text);
        byte[] bytes = new byte[descriptor.BinaryLength];
        descriptor.GetBinaryForm(bytes, 0); return bytes;
    }
    internal static int Run()
    {
        var actor = OriginalR7CommissioningOwnerContext.ObserveCurrent();
        Check(actor.ProcessId == Environment.ProcessId && actor.CurrentSid.Length > 0
            && long.TryParse(actor.CreationFileTimeUtc, out long created) && created > 0, "ACTUAL_CURRENT_OWNER_CONTEXT_BINDING");
        Check(!actor.HumanConsentProven && !actor.RepositoryOwnerAuthenticated && !actor.ExecutorAdmitted
            && !actor.PolicyAdopted && !actor.HostExecutionAuthorized && !actor.RootEnrollmentAuthorized
            && !actor.LeaseReleaseAuthorized, "NATIVE_ELEVATION_IS_NOT_ADMISSION_OR_CONSENT");
        var fixedObservation = OriginalR7ProtectedKeyMetadata.ObserveFixedWitness();
        NoAuthority(fixedObservation);
        Check(!fixedObservation.NativeIdentityObserved, "INTERACTIVE_RUNNER_NEVER_OPENS_FIXED_PRODUCTION_KEY");
        string filePolicy = "O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x120089;;;" + Role + ")";
        string directoryPolicy = "O:SYG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;" + Role + ")";
        Check(OriginalR7ProtectedKeyMetadata.PolicyMatches(Descriptor(filePolicy), Role, false), "READ_ONLY_FILE_POLICY_SHAPE");
        Check(OriginalR7ProtectedKeyMetadata.PolicyMatches(Descriptor(directoryPolicy), Role, true), "READ_ONLY_DIRECTORY_POLICY_SHAPE");
        Check(!OriginalR7ProtectedKeyMetadata.PolicyMatches(Descriptor(filePolicy), Role, true), "FILE_AND_DIRECTORY_RIGHTS_DISTINCT");
        foreach (string bad in new[] {
            filePolicy.Replace("D:P", "D:"), filePolicy.Replace("O:SY", "O:" + Role),
            filePolicy.Replace("0x120089", "FA"), filePolicy.Replace("0x120089", "0x12008d"),
            filePolicy.Replace("0x120089", "GR"), filePolicy.Replace("(A;;FA;;;BA)", ""),
            filePolicy + "(A;;GR;;;WD)", filePolicy + "(A;;0x120089;;;" + Role + ")",
            filePolicy.Replace("(A;;0x120089", "(A;ID;0x120089"),
            filePolicy.Replace("(A;;0x120089", "(D;;0x120089")
        }) Check(!OriginalR7ProtectedKeyMetadata.PolicyMatches(Descriptor(bad), Role, false), "ADVERSARIAL_POLICY_REJECTED");
        Check(!OriginalR7ProtectedKeyMetadata.PolicyMatches(Array.Empty<byte>(), Role, false), "MALFORMED_DESCRIPTOR_HELD");

        string tempBase = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        string own = Path.Combine(tempBase, "r7-key-metadata-fixture-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(own);
        var longName = new StringBuilder(1024);
        uint count = GetLongPathNameW(own, longName, (uint)longName.Capacity);
        if (count == 0 || count >= longName.Capacity) throw new InvalidOperationException("FIXTURE_CANONICAL_PATH_UNAVAILABLE");
        own = longName.ToString();
        try
        {
            string file = Path.Combine(own, "public-fixture.seed");
            // Public, synthetic bytes only; this is not an enrolled key.
            File.WriteAllBytes(file, Enumerable.Range(0, 32).Select(x => (byte)x).ToArray());
            using (var held = OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role))
            {
                var first = held.Refresh(); NoAuthority(first);
                Check(first.NativeIdentityObserved && first.MetadataOnlyAccess, "REAL_KERNEL_METADATA_OBSERVED");
                Check(first.FileIdentityDigest.Length == 64 && first.DescriptorDigest.Length == 64, "REAL_KERNEL_ID_AND_DESCRIPTOR_DIGESTS");
                Check(!first.ProtectedAclShapeMatches, "ORDINARY_FIXTURE_IS_NOT_PROTECTED_ROOT_CUSTODY");
                var second = held.Refresh();
                Check(second.FileIdentityDigest == first.FileIdentityDigest
                    && second.DescriptorDigest == first.DescriptorDigest, "RETAINED_READBACK_STABLE");
                using (var writer = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite))
                    Check(writer.CanWrite && !first.DataWriterAndReplacementSharingExcluded,
                        "METADATA_ONLY_NEVER_CLAIMS_WRITER_EXCLUSION");
                bool parentRenameBlocked = false;
                try { Directory.Move(own, own + ".moved"); } catch (IOException) { parentRenameBlocked = true; }
                Check(parentRenameBlocked, "READ_ACCESS_ANCESTOR_HANDLE_BLOCKS_DIRECTORY_REPLACEMENT");

                // Own disposable fixture only. Verify the actual handle rights
                // cannot read data, without exporting a production API/handle.
                var handle = (SafeFileHandle)(typeof(OriginalR7ProtectedKeyMetadata)
                    .GetField("leaf", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(held)!);
                byte[] buffer = new byte[1];
                bool dataBlocked = false;
                try { RandomAccess.Read(handle, buffer, 0); }
                catch (UnauthorizedAccessException) { dataBlocked = true; }
                Check(dataBlocked, "METADATA_HANDLE_HAS_NO_FILE_READ_DATA");
            }
            using (var after = new FileStream(file, FileMode.Open, FileAccess.Write))
                Check(after.CanWrite, "DISPOSE_RELEASES_ONLY_OWNED_FIXTURE_SHARING_LOCK");
            using (var material = OriginalR7ProtectedKeyMetadata.OpenUntrustedMaterialFixture(file, Role))
            {
                var native = material.Refresh(); NoAuthority(native);
                Check(!native.MetadataOnlyAccess && native.DataWriterAndReplacementSharingExcluded,
                    "MATERIAL_FIXTURE_READ_ACCESS_PARTICIPATES_IN_SHARING");
                bool writerBlocked = false, renameBlocked = false;
                try { using var writer = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite); }
                catch (IOException) { writerBlocked = true; }
                try { File.Move(file, file + ".renamed"); } catch (IOException) { renameBlocked = true; }
                Check(writerBlocked, "ACTUAL_READ_ACCESS_BLOCKS_NEW_DATA_WRITER");
                Check(renameBlocked, "ACTUAL_READ_ACCESS_BLOCKS_LEAF_REPLACEMENT");
            }
            // Existing metadata mutation rights are a separate capability from
            // data-write sharing. Exercise only this disposable fixture's DACL,
            // retain its original descriptor and restore it through the same
            // owned handle even when new WRITE_DAC opens are explicitly denied.
            using (var dac = CreateFileW(file, 0x60000 /* READ_CONTROL | WRITE_DAC */,
                7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero))
            {
                Check(!dac.IsInvalid, "ACTUAL_METADATA_MUTATION_HANDLE_CREATED");
                var original = new RawSecurityDescriptor(OriginalR7AuditStorage.ReadDescriptor(dac), 0);
                using var material = OriginalR7ProtectedKeyMetadata.OpenUntrustedMaterialFixture(file, Role);
                using var identity = WindowsIdentity.GetCurrent();
                var deniedOwner = new RawSecurityDescriptor("D:P(D;;WD;;;OW)(A;;RC;;;" + identity.User!.Value + ")");
                try
                {
                    Check(SetFixtureDacl(dac, deniedOwner.DiscretionaryAcl!, true) == 0,
                        "OLD_WRITE_DAC_MUTATES_DESCRIPTOR_DESPITE_READ_SHARING_GUARD");
                    using var newDac = CreateFileW(file, 0x40000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
                    Check(newDac.IsInvalid && Marshal.GetLastWin32Error() == 5,
                        "OWNER_RIGHTS_DENIAL_BLOCKS_NEW_WRITE_DAC_BUT_NOT_OLD_HANDLE");
                    Reject(() => material.Refresh(), "METADATA_RIGHTS_CHANGE_DETECTED_TERMINALLY");
                }
                finally
                {
                    Check(SetFixtureDacl(dac, original.DiscretionaryAcl!,
                        (original.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0) == 0,
                        "OWNED_FIXTURE_DACL_RESTORED_USING_RETAINED_HANDLE");
                }
                Check(File.ReadAllBytes(file).Length == 32, "RESTORED_FIXTURE_DATA_REMAINS_READABLE");
            }
            using (var passive = OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role))
            {
                File.Move(file, file + ".renamed");
                Reject(() => passive.Refresh(), "PASSIVE_METADATA_DETECTS_REPLACEMENT_AND_TERMINATES");
                File.Move(file + ".renamed", file);
            }
            var disposed = OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role);
            disposed.Dispose();
            Reject(() => disposed.Refresh(), "DISPOSE_TERMINAL");

            using (var writer = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
            {
                using var passive = OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role);
                Check(!passive.Refresh().DataWriterAndReplacementSharingExcluded, "PASSIVE_OPEN_DOES_NOT_CONFLICT_WITH_EXISTING_WRITER");
                Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedMaterialFixture(file, Role), "MATERIAL_READ_REJECTS_EXISTING_WRITE_HANDLE");
            }
            // A writable view survives its creating handles. For this actual
            // local fixture Windows also refuses the incompatible sharing open;
            // this narrow observation is not whole-estate mapping exclusion.
            using (var stream = new FileStream(file, FileMode.Open, FileAccess.ReadWrite,
                FileShare.ReadWrite | FileShare.Delete))
            using (var mapping = MemoryMappedFile.CreateFromFile(stream, null, 32,
                MemoryMappedFileAccess.ReadWrite, HandleInheritability.None, true))
            using (var view = mapping.CreateViewAccessor(0, 32, MemoryMappedFileAccess.ReadWrite))
            {
                stream.Dispose();
                mapping.Dispose(); // The mapped view remains valid independently.
                Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedMaterialFixture(file, Role),
                    "MATERIAL_READ_REJECTS_RETAINED_WRITABLE_VIEW_WITH_CREATING_HANDLES_CLOSED");
                view.Write(0, (byte)123); view.Flush();
                Check(view.ReadByte(0) == 123, "OLD_VIEW_STILL_WRITABLE_AFTER_FAILED_GUARD");
            }
            foreach (int size in new[] { 0, 31, 33 })
            {
                string wrong = Path.Combine(own, "length-" + size);
                File.WriteAllBytes(wrong, new byte[size]);
                Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(wrong, Role), "KEY_SIZE_BOUND");
            }
            string link = Path.Combine(own, "second-name.seed");
            Check(CreateHardLinkW(link, file, IntPtr.Zero), "ACTUAL_DISPOSABLE_HARDLINK_CREATED");
            Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role), "MULTIPLE_LINKS_REJECTED");
            File.Delete(link);
            using (var good = OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file, Role))
                Check(good.Refresh().NativeIdentityObserved, "SINGLE_LINK_RESTORED_FIXTURE_METADATA_ONLY");
            Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(
                Path.Combine(own, "child", "..", "public-fixture.seed"), Role), "TRAVERSAL_SYNTAX_HELD");
            Reject(() => OriginalR7ProtectedKeyMetadata.OpenUntrustedFixture(file + ":alternate", Role), "ALTERNATE_STREAM_SYNTAX_HELD");
        }
        finally
        {
            string full = Path.GetFullPath(own);
            var expectedParent = new StringBuilder(1024);
            uint countParent = GetLongPathNameW(tempBase, expectedParent, (uint)expectedParent.Capacity);
            if (countParent == 0 || !string.Equals(Path.GetDirectoryName(full), expectedParent.ToString().TrimEnd('\\'),
                    StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(full).StartsWith("r7-key-metadata-fixture-", StringComparison.Ordinal)
                || (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("FIXTURE_CLEANUP_BOUNDARY_INVALID");
            Directory.Delete(full, true);
        }
        Console.WriteLine("R7_NATIVE_KEY_METADATA_ASSERTIONS_PASSED=" + total);
        Console.WriteLine("R7_PRODUCTION_KEY_BYTES_READ=false");
        Console.WriteLine("R7_ROOT_CUSTODY_ENROLLED=false");
        return total;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetLongPathNameW(string path, StringBuilder expanded, uint capacity);
    private static uint SetFixtureDacl(SafeFileHandle handle, RawAcl dacl, bool protect)
    {
        byte[] bytes = new byte[dacl.BinaryLength]; dacl.GetBinaryForm(bytes, 0);
        var pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try { return SetSecurityInfo(handle, 1, 4u | (protect ? 0x80000000u : 0x20000000u),
            IntPtr.Zero, IntPtr.Zero, pinned.AddrOfPinnedObject(), IntPtr.Zero); }
        finally { pinned.Free(); }
    }
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetSecurityInfo(SafeFileHandle handle, uint type, uint information,
        IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, int access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string name, string existing, IntPtr attributes);
}
