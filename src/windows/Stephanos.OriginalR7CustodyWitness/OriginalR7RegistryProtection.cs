using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Stephanos.OriginalR7CustodyWitness;

// A sampled descriptor prerequisite, not effective access, protected provenance,
// historical writer authentication, continuous containment or signer authority.
internal static class OriginalR7RegistryProtection
{
    private const int KeyRead = 0x20019;
    private const int KeyAllAccess = 0xf003f;

    internal static bool Evaluate(byte[]? descriptor, SecurityIdentifier serviceSid)
    {
        try
        {
            if (descriptor is null || descriptor.Length == 0 || descriptor.Length > 65536)
                return false;
            var sd = new RawSecurityDescriptor(descriptor, 0);
            string? owner = sd.Owner?.Value;
            if (owner != "S-1-5-18" && owner != "S-1-5-32-544") return false;
            if ((sd.ControlFlags & (ControlFlags.DiscretionaryAclPresent |
                ControlFlags.DiscretionaryAclProtected)) !=
                (ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected)
                || sd.DiscretionaryAcl is null || sd.DiscretionaryAcl.Count != 3)
                return false;

            // Accept only three explicit unconditional ACEs. Generic access,
            // callback/object/deny/inherited/duplicate ACEs fail closed instead
            // of attempting to predict Windows effective-access semantics.
            bool system = false, admins = false, witness = false;
            foreach (GenericAce generic in sd.DiscretionaryAcl)
            {
                if (generic is not CommonAce ace || ace.IsCallback
                    || ace.AceQualifier != AceQualifier.AccessAllowed
                    || ace.AceFlags != AceFlags.None) return false;
                string sid = ace.SecurityIdentifier.Value;
                if (sid == "S-1-5-18" && !system && ace.AccessMask == KeyAllAccess)
                    system = true;
                else if (sid == "S-1-5-32-544" && !admins && ace.AccessMask == KeyAllAccess)
                    admins = true;
                else if (ace.SecurityIdentifier.Equals(serviceSid) && !witness
                    && sid != "S-1-5-18" && sid != "S-1-5-32-544"
                    && ace.AccessMask == KeyRead)
                    witness = true;
                else return false;
            }
            return system && admins && witness;
        }
        catch { return false; }
    }

    // The caller retains the same open registration key for descriptor and
    // value reads. No path-selected object, privilege enablement or mutation.
    internal static byte[]? ReadDescriptor(RegistryKey key)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            const uint ownerAndDacl = 5;
            uint length = 0;
            int result = RegGetKeySecurity(key.Handle, ownerAndDacl, null, ref length);
            if (result != 122 /* ERROR_INSUFFICIENT_BUFFER */) return null;
            if (length == 0 || length > 65536) return null;
            byte[] bytes = new byte[(int)length];
            result = RegGetKeySecurity(key.Handle, ownerAndDacl, bytes, ref length);
            if (result != 0 || length == 0 || length > bytes.Length) return null;
            if (length != bytes.Length) Array.Resize(ref bytes, (int)length);
            return bytes;
        }
        catch { return null; }
    }

    [DllImport("advapi32.dll", ExactSpelling = true)]
    private static extern int RegGetKeySecurity(SafeRegistryHandle key,
        uint information, [Out] byte[]? descriptor, ref uint length);
}
