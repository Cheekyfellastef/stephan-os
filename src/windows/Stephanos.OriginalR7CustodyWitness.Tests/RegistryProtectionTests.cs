using System;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32;
using Stephanos.OriginalR7CustodyWitness;

internal static class RegistryProtectionTests
{
    internal static void Run(Action<bool, string> check)
    {
        // Synthetic service SID: policy fixtures do not enroll a real service.
        const string sid = "S-1-5-80-1-2-3-4-5";
        var service = new SecurityIdentifier(sid);
        const string grants = "(A;;KA;;;SY)(A;;KA;;;BA)";
        string valid = "O:BAG:BAD:P" + grants + "(A;;KR;;;" + sid + ")";
        byte[] Bytes(string sddl)
        {
            var descriptor = new RawSecurityDescriptor(sddl);
            byte[] bytes = new byte[descriptor.BinaryLength];
            descriptor.GetBinaryForm(bytes, 0);
            return bytes;
        }
        check(OriginalR7RegistryProtection.Evaluate(Bytes(valid), service), "REGISTRY_POLICY_FIXTURE");
        string[] invalid =
        {
            valid.Replace("O:BA", "O:BU"),
            valid.Replace("D:P", "D:"),
            "O:BAG:BAD:P", // Empty DACL is denial, not usable service configuration.
            "O:BAG:BAD:PNO_ACCESS_CONTROL", // NULL DACL grants access, never trust it.
            valid.Replace("KR;;;" + sid, "KA;;;" + sid),
            valid.Replace("KR;;;" + sid, "KW;;;" + sid),
            valid.Replace("KR;;;" + sid, "0x2001b;;;" + sid), // KEY_SET_VALUE
            valid.Replace("KR;;;" + sid, "0x60019;;;" + sid), // WRITE_DAC
            valid.Replace("KR;;;" + sid, "0xa0019;;;" + sid), // WRITE_OWNER
            valid.Replace("KR;;;" + sid, "0x30019;;;" + sid), // DELETE
            valid.Replace("KR;;;" + sid, "GR;;;" + sid), // Generic mapping not admitted.
            valid.Replace("(A;;KR", "(A;ID;KR"),
            valid.Replace("(A;;KR", "(A;IO;KR"),
            valid.Replace("(A;;KR", "(D;;KR"),
            valid.Replace("(A;;KA;;;SY)", "(A;;KR;;;SY)"),
            valid.Replace("(A;;KA;;;BA)", "(A;;KA;;;SY)"), // Duplicate trusted ACE.
            valid + "(A;;KW;;;BU)",
            valid.Replace(sid, "S-1-5-80-5-4-3-2-1"),
            "O:BAG:BAD:P" + grants // Missing service access.
        };
        for (int i = 0; i < invalid.Length; i++)
            check(!OriginalR7RegistryProtection.Evaluate(Bytes(invalid[i]), service),
                "REGISTRY_POLICY_NEGATIVE_" + i);
        var callback = new RawSecurityDescriptor(valid);
        callback.DiscretionaryAcl![2] = new CommonAce(AceFlags.None,
            AceQualifier.AccessAllowed, 0x20019, service, true, null);
        byte[] callbackBytes = new byte[callback.BinaryLength];
        callback.GetBinaryForm(callbackBytes, 0);
        check(!OriginalR7RegistryProtection.Evaluate(callbackBytes, service), "REGISTRY_CALLBACK_HOLD");
        check(!OriginalR7RegistryProtection.Evaluate(null, service), "REGISTRY_MISSING");
        check(!OriginalR7RegistryProtection.Evaluate(new byte[0], service), "REGISTRY_EMPTY_BYTES");
        check(!OriginalR7RegistryProtection.Evaluate(new byte[] { 1, 2, 3 }, service), "REGISTRY_MALFORMED");
        check(!OriginalR7RegistryProtection.Evaluate(new byte[65537], service), "REGISTRY_OVERSIZED");

        // Actual read-only Win32 handle read, no HKLM writes or elevation.
        // Decode its self-relative bytes; no positive custody assertion follows.
        using RegistryKey? key = Registry.CurrentUser.OpenSubKey("Software", writable: false);
        check(key is not null, "REGISTRY_NATIVE_FIXTURE_AVAILABLE");
        byte[]? actual = OriginalR7RegistryProtection.ReadDescriptor(key!);
        check(actual is not null && actual.Length > 0, "REGISTRY_NATIVE_HANDLE_READ");
        var parsed = new RawSecurityDescriptor(actual!, 0);
        check(parsed.Owner is not null, "REGISTRY_NATIVE_OWNER_DECODED");
        key!.Dispose();
        check(OriginalR7RegistryProtection.ReadDescriptor(key) is null, "REGISTRY_CLOSED_HANDLE_HOLD");
    }
}
