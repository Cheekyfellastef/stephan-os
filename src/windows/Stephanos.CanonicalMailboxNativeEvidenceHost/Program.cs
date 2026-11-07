using System;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;

namespace Stephanos.CanonicalMailboxNativeEvidenceHost
{
    // One-shot executable for the ORIGINAL #2315 owner, not a daemon/task/key
    // enrollment. The existing protected runtime must qualify the installed
    // image and independently protected principal BEFORE any signing route
    // is added. This source checkpoint deliberately has NO signer invocation.
    internal static class NativeRotationOneShotHostV1
    {
        private const string Profile = "CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1";
        private const string ProtectedRoot =
            @"C:\Program Files\Stephanos\SovereignFixedRuntimeV1\";

        private static int Refuse(string reason, bool linked, bool closed)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(new {
                schemaVersion = "stephanos.canonical-mailbox-native-one-shot-host.v1",
                status = "BLOCKED", reason, profile = Profile,
                nativeSigningLibraryLinked = linked,
                nativeSigningLibraryClosed = closed,
                originalGuardHeld = false,
                separatelyProtectedSignerQualified = false,
                keyEnrollmentCommissioned = false,
                signedEvidenceIssued = false,
                freezeCertified = false,
                sourceSyncAuthorized = false,
                newMailboxActive = false
            }));
            return 2;
        }

        private static int Main(string[] args)
        {
            if (args.Length != 0)
                return Refuse("NATIVE_ROTATION_ARGUMENTS_FORBIDDEN", false, false);
            if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                return Refuse("NATIVE_ROTATION_WINDOWS_REQUIRED", false, false);
            try
            {
                // This project-reference load only proves the real .NET 8
                // dependency closure. It is NOT native identity or key trust.
                Assembly linked = Assembly.Load(
                    new AssemblyName("Stephanos.CanonicalMailboxNativeEvidence"));
                Type session = linked.GetType(
                    "Stephanos.CanonicalMailboxNativeEvidence.NativeEvidenceSigningSession",
                    throwOnError: false);
                bool closed = session != null && session.IsNotPublic
                    && linked.EntryPoint == null
                    && linked.GetExportedTypes().Length == 0;
                bool crypto = linked.GetReferencedAssemblies().Any(
                    a => a.Name == "BouncyCastle.Cryptography");
                if (!closed || !crypto)
                    return Refuse("NATIVE_ROTATION_SIGNING_LIBRARY_UNVERIFIED", true, closed);

                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    if (!identity.IsSystem)
                        return Refuse("NATIVE_ROTATION_PRINCIPAL_NOT_SEPARATED", true, true);
                }
                string image = Environment.ProcessPath ?? "";
                if (!image.StartsWith(ProtectedRoot, StringComparison.OrdinalIgnoreCase))
                    return Refuse("NATIVE_ROTATION_PROTECTED_IMAGE_UNPROVEN", true, true);

                // Even a process launched by SYSTEM under a protected-looking
                // path cannot qualify itself as an enrolled signer.
                return Refuse("NATIVE_ROTATION_PRODUCER_UNQUALIFIED", true, true);
            }
            catch (Exception)
            {
                return Refuse("NATIVE_ROTATION_DEPENDENCY_OR_IDENTITY_UNPROVEN", false, false);
            }
        }
    }
}
