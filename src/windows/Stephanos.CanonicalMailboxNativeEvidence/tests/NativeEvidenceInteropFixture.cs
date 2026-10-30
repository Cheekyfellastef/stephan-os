// TEST EXECUTABLE ONLY. Excluded from the production library project.
// Public RFC8032 material and synthetic records are not native observations.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using Stephanos.CanonicalMailboxNativeEvidence;

internal static class NativeEvidenceInteropFixture
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 5) throw new InvalidOperationException("TEST_ARGUMENTS");
            string loaded = typeof(Org.BouncyCastle.Math.EC.Rfc8032.Ed25519).Assembly.Location;
            if (NativeEvidenceSigningSession.Hash(File.ReadAllBytes(loaded)) !=
                "4f96977e9c67334742c683410b3a361258219f0d3084a5e0bc10fba96cf23a0d")
                throw new InvalidOperationException("TEST_PROVIDER_PIN");
            JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16384, RecursionLimit = 12 };
            Dictionary<string, object> payload = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(args[2]));
            FileStream retained = new FileStream(args[1], FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            NativeEvidenceSigningSession session = new NativeEvidenceSigningSession(retained,
                "isolated-fixture-enrollment", "isolated-fixture-key", "isolated-fixture-producer",
                new string('a', 64), new string('b', 64), new string('c', 64), args[3], args[4]);
            using (session)
            {
                if (args[0] == "emit")
                {
                    byte[] output = session.Produce(payload);
                    Console.OpenStandardOutput().Write(output, 0, output.Length);
                    return 0;
                }
                if (args[0] == "dispose") session.Dispose();
                else if (args[0] == "mutate" || args[0] == "truncate")
                {
                    session.Produce(payload);
                    using (FileStream writer = new FileStream(args[1], FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
                    {
                        if (args[0] == "truncate") writer.SetLength(31);
                        else { writer.Position = 0; writer.WriteByte(0x00); writer.Flush(true); }
                    }
                }
                else if (args[0] != "poison") throw new InvalidOperationException("TEST_MODE");
                bool refused = false;
                try { session.Produce(payload); }
                catch (InvalidOperationException) { refused = true; }
                if (!refused) throw new InvalidOperationException("TEST_EXPECTED_REFUSAL");
                byte[] owned = (byte[])typeof(NativeEvidenceSigningSession).GetField("owned", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(session);
                foreach (byte b in owned) if (b != 0) throw new InvalidOperationException("TEST_OWNED_BYTES_NOT_ZERO");
                bool terminal = false;
                try { session.Produce(payload); }
                catch (InvalidOperationException e) { terminal = e.Message.EndsWith("SESSION_CLOSED", StringComparison.Ordinal); }
                if (!terminal) throw new InvalidOperationException("TEST_POISON_NOT_TERMINAL");
                Console.Write("CLOSED_AND_ZEROED");
                return 0;
            }
        }
        catch (Exception error)
        {
            Console.Error.Write(error.Message);
            return 42;
        }
    }
}
