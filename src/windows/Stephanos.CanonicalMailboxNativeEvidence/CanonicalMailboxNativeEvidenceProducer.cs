using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
using Ed = Org.BouncyCastle.Math.EC.Rfc8032.Ed25519;

namespace Stephanos.CanonicalMailboxNativeEvidence
{
    // Internal software component, not a host, enrollment, signer endpoint or
    // native custody proof. The original protected producer must qualify its
    // image/principal/loader and retained key handle BEFORE importing material.
    // No production caller is registered by this source increment.
    internal sealed class NativeEvidenceSigningSession : IDisposable
    {
        internal const string Domain = "stephanos.canonical-mailbox-native-evidence.v2";
        internal const int MaxBytes = 16 * 1024;
        private readonly FileStream retained;
        private readonly string enrollmentId, keyId, producerId, device, principal, profile;
        private byte[] owned;
        private bool closed;
        private readonly object gate = new object();
        internal readonly string PublicArtifact;
        internal readonly string PublicSpkiSha256;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

        // This seam accepts UNTRUSTED retained material, never grants host/key
        // custody, and is not an import/enrollment API exposed by an executable.
        // Caller-supplied pins are comparisons only, not protected-source trust.
        internal NativeEvidenceSigningSession(FileStream material, string enrollment,
            string key, string producer, string deviceSha256, string principalSha256,
            string profileSha256, string expectedSpkiSha256, string expectedArtifactSha256)
        {
            retained = material;
            try
            {
                Wire.Id(enrollment); Wire.Id(key); Wire.Id(producer);
                Wire.Digest(deviceSha256); Wire.Digest(principalSha256); Wire.Digest(profileSha256);
                Wire.Digest(expectedSpkiSha256); Wire.Digest(expectedArtifactSha256);
                if (material == null || !material.CanRead || material.CanWrite || !material.CanSeek)
                    throw Held("RETAINED_READONLY_MATERIAL_REQUIRED");
                owned = FreshRead();
                byte[] pub = new byte[32];
                Ed.GeneratePublicKey(owned, 0, pub, 0);
                byte[] spki = PublicSpki(pub);
                PublicSpkiSha256 = Hash(spki);
                PublicArtifact = "-----BEGIN PUBLIC KEY-----\n" + Convert.ToBase64String(spki)
                    + "\n-----END PUBLIC KEY-----\n";
                if (PublicSpkiSha256 != expectedSpkiSha256 || Hash(Utf8.GetBytes(PublicArtifact)) != expectedArtifactSha256)
                    throw Held("PUBLIC_KEY_DOUBLE_PIN_MISMATCH");
                enrollmentId = enrollment; keyId = key; producerId = producer;
                device = deviceSha256; principal = principalSha256; profile = profileSha256;
            }
            catch { Dispose(); throw; }
        }

        internal byte[] Produce(Dictionary<string, object> originalGuardObservation)
        {
            lock (gate)
            {
                if (closed) throw Held("SESSION_CLOSED");
                try
                {
                    // The native adapter accepts only the canonical closed wire
                    // shape. It never offers raw-message/domain signing.
                    Dictionary<string, object> payload = Wire.Payload(originalGuardObservation);
                    if ((string)payload["producerId"] != producerId || (string)payload["deviceIdSha256"] != device
                        || (string)payload["producerPrincipalSha256"] != principal
                        || (string)payload["producerProfileSha256"] != profile)
                        throw Held("PRODUCER_IDENTITY_MISMATCH");
                    DateTime now = DateTime.UtcNow;
                    DateTime observed = Wire.Time(payload["observedAtUtc"]);
                    DateTime expires = Wire.Time(payload["expiresAtUtc"]);
                    Dictionary<string, object> drain = (Dictionary<string, object>)payload["drain"];
                    DateTime actions = Wire.Time(drain["actionsObservedAtUtc"]);
                    if (observed > now || now - observed > TimeSpan.FromSeconds(120)
                        || expires <= now || expires <= observed || expires - observed > TimeSpan.FromSeconds(120)
                        || actions > observed || now - actions > TimeSpan.FromSeconds(120))
                        throw Held("OBSERVATION_NOT_FRESH");
                    byte[] canonical = Utf8.GetBytes(Wire.Canonical(payload));
                    if (canonical.Length > MaxBytes) throw Held("PAYLOAD_BOUND");
                    byte[] prefix = Encoding.ASCII.GetBytes(Domain + "\0");
                    byte[] message = new byte[prefix.Length + canonical.Length];
                    Buffer.BlockCopy(prefix, 0, message, 0, prefix.Length);
                    Buffer.BlockCopy(canonical, 0, message, prefix.Length, canonical.Length);
                    EnsureUnchanged();
                    byte[] signature = new byte[64];
                    Ed.Sign(owned, 0, message, 0, message.Length, signature, 0);
                    byte[] pub = new byte[32];
                    Ed.GeneratePublicKey(owned, 0, pub, 0);
                    if (!Ed.Verify(signature, 0, pub, 0, message, 0, message.Length))
                        throw Held("SIGNATURE_SELF_VERIFY_FAILED");
                    // Re-read from the held OS handle after signing too. A
                    // concurrent mutation never returns signed output.
                    EnsureUnchanged();
                    Dictionary<string, object> envelope = new Dictionary<string, object>(StringComparer.Ordinal) {
                        { "schemaVersion", Domain }, { "algorithm", "Ed25519" },
                        { "enrollmentId", enrollmentId }, { "keyId", keyId },
                        { "payload", payload }, { "signatureBase64", Convert.ToBase64String(signature) }
                    };
                    byte[] output = Utf8.GetBytes(Wire.Canonical(envelope));
                    if (output.Length > MaxBytes) throw Held("ENVELOPE_BOUND");
                    return output;
                }
                catch { Dispose(); throw; }
            }
        }

        private byte[] FreshRead()
        {
            SafeFileHandle handle = retained.SafeFileHandle;
            long length, position;
            if (handle.IsClosed || handle.IsInvalid || !GetFileSizeEx(handle, out length) || length != 32
                || !SetFilePointerEx(handle, 0, out position, 0) || position != 0)
                throw Held("RETAINED_MATERIAL_SIZE_OR_HANDLE");
            byte[] bytes = new byte[32];
            uint read;
            if (!ReadFile(handle, bytes, 32, out read, IntPtr.Zero) || read != 32)
            {
                Array.Clear(bytes, 0, bytes.Length);
                throw Held("RETAINED_MATERIAL_READ");
            }
            return bytes;
        }
        private void EnsureUnchanged()
        {
            byte[] fresh = FreshRead();
            try
            {
                int difference = 0;
                for (int i = 0; i < 32; i++) difference |= fresh[i] ^ owned[i];
                if (difference != 0) throw Held("RETAINED_MATERIAL_CHANGED");
            }
            finally { Array.Clear(fresh, 0, fresh.Length); }
        }
        public void Dispose()
        {
            lock (gate)
            {
                if (closed) return;
                closed = true;
                if (owned != null) Array.Clear(owned, 0, owned.Length);
                if (retained != null) retained.Dispose();
            }
        }
        internal static string Hash(byte[] bytes)
        {
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
        internal static byte[] PublicSpki(byte[] pub)
        {
            byte[] prefix = { 0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00 };
            if (pub == null || pub.Length != 32) throw Held("PUBLIC_KEY_SIZE");
            byte[] result = new byte[44];
            Buffer.BlockCopy(prefix, 0, result, 0, 12); Buffer.BlockCopy(pub, 0, result, 12, 32);
            return result;
        }
        internal static InvalidOperationException Held(string code)
        { return new InvalidOperationException("MAILBOX_NATIVE_PRODUCER_" + code); }
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileSizeEx(SafeFileHandle file, out long size);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(SafeFileHandle file, [Out] byte[] bytes, uint count, out uint read, IntPtr overlapped);
    }

    // Replaceable native wire adapter. The existing Node V2 codec remains
    // canonical; cross-language tests compare its EXACT bytes and refusals.
    // No phase/transaction adjudication, enrollment or execution authority here.
    internal static class Wire
    {
        private static Exception Held(string code) { return NativeEvidenceSigningSession.Held(code); }
        private static void Require(bool value, string code) { if (!value) throw Held(code); }
        private static Dictionary<string, object> Closed(object value, string fields)
        {
            Require(value != null && value.GetType() == typeof(Dictionary<string, object>), "PLAIN_OBJECT_REQUIRED");
            Dictionary<string, object> source = (Dictionary<string, object>)value;
            string[] names = fields.Split(' ');
            Require(source.Count == names.Length && new HashSet<string>(source.Keys, StringComparer.Ordinal).SetEquals(names), "CLOSED_SCHEMA_REQUIRED");
            Dictionary<string, object> copy = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (string name in names) { Require(source.ContainsKey(name), "CLOSED_SCHEMA_REQUIRED"); copy.Add(name, source[name]); }
            return copy;
        }
        internal static void Id(string value) { Require(value != null && Regex.IsMatch(value, @"\A[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\z"), "ID_INVALID"); }
        internal static void Digest(string value) { Require(value != null && Regex.IsMatch(value, @"\A[a-f0-9]{64}\z"), "DIGEST_INVALID"); }
        private static void Git(object value) { Require(value is string && Regex.IsMatch((string)value, @"\A[a-f0-9]{40}\z"), "GIT_ID_INVALID"); }
        private static void Count(object value, bool positive)
        {
            // JSON test adapters may yield Int32 or Int64. No doubles,
            // decimals, coercion, signed-zero or values above JS safe integers.
            Require(value is int || value is long, "SAFE_INTEGER_REQUIRED");
            long n = Convert.ToInt64(value, CultureInfo.InvariantCulture);
            Require(n >= (positive ? 1 : 0) && n <= 9007199254740991L, "SAFE_INTEGER_REQUIRED");
        }
        internal static DateTime Time(object value)
        {
            DateTime parsed;
            Require(value is string && DateTime.TryParseExact((string)value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out parsed), "TIME_INVALID");
            // Definite assignment independent of Require's implementation.
            parsed = DateTime.ParseExact((string)value, "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
            return parsed;
        }
        internal static Dictionary<string, object> Payload(Dictionary<string, object> source)
        {
            Dictionary<string, object> p = Closed(source, "kind repository deviceIdSha256 producerId producerPrincipalSha256 producerProfileSha256 requestId transitionId phase result origin source activation epoch barrier guard drain originalTerminalSha256 proofArtifactSha256 observedAtUtc expiresAtUtc");
            Require((string)p["kind"] == "CONTROL_TERMINAL" || (string)p["kind"] == "DRAIN_OBSERVATION", "KIND_INVALID");
            Require((string)p["repository"] == "Cheekyfellastef/stephan-os", "REPOSITORY_INVALID");
            foreach (string n in "deviceIdSha256 producerPrincipalSha256 producerProfileSha256 originalTerminalSha256 proofArtifactSha256".Split(' ')) Digest(p[n] as string);
            foreach (string n in "producerId requestId transitionId phase result".Split(' ')) Id(p[n] as string);
            Dictionary<string, object> o = Closed(p["origin"], "kind prNumber commentId commentBodySha256 createdAtUtc");
            Require((string)o["kind"] == "ACTIVATION_PR_OWNER_CONTROL_V2", "ORIGIN_INVALID");
            Count(o["prNumber"], true); Count(o["commentId"], true); Digest(o["commentBodySha256"] as string); Time(o["createdAtUtc"]); p["origin"] = o;
            Dictionary<string, object> s = Closed(p["source"], "protectedMainHead protectedMainTreeSha installedHead installedTreeSha installedClosureSha256 sourceRole");
            foreach (string n in "protectedMainHead protectedMainTreeSha installedHead installedTreeSha".Split(' ')) Git(s[n]);
            Digest(s["installedClosureSha256"] as string);
            Require((string)s["sourceRole"] == "PREPARATION" || (string)s["sourceRole"] == "ADOPTED", "SOURCE_ROLE_INVALID"); p["source"] = s;
            Dictionary<string, object> a = Closed(p["activation"], "prNumber headSha baseSha treeSha mergeCommitSha");
            Count(a["prNumber"], true); foreach (string n in "headSha baseSha treeSha".Split(' ')) Git(a[n]);
            if (a["mergeCommitSha"] != null) Git(a["mergeCommitSha"]); p["activation"] = a;
            Dictionary<string, object> e = Closed(p["epoch"], "predecessorIssue successorIssue");
            Count(e["predecessorIssue"], true); Count(e["successorIssue"], true);
            Require(Convert.ToInt64(e["successorIssue"]) > Convert.ToInt64(e["predecessorIssue"]), "EPOCH_INVALID"); p["epoch"] = e;
            Dictionary<string, object> b = Closed(p["barrier"], "highestCommandCommentId inventorySha256 commentCount");
            Count(b["highestCommandCommentId"], false); Count(b["commentCount"], false); Digest(b["inventorySha256"] as string); p["barrier"] = b;
            Dictionary<string, object> g = Closed(p["guard"], "generationId ownerInstanceId transactionSha256");
            Id(g["generationId"] as string); Id(g["ownerInstanceId"] as string); Digest(g["transactionSha256"] as string); p["guard"] = g;
            const string counts = "acceptedCount inlinePublicationCount segmentedPublicationCount ordinaryReceiptDebtCount historyPendingBeforeCount historyPendingAfterCount orphanAcceptedCount actionPendingAggregateCount actionBlockingCount";
            Dictionary<string, object> d = Closed(p["drain"], counts + " outboxInventorySha256 actionsInventorySha256 actionsObservedAtUtc");
            foreach (string n in counts.Split(' ')) Count(d[n], false);
            Digest(d["outboxInventorySha256"] as string); Digest(d["actionsInventorySha256"] as string); Time(d["actionsObservedAtUtc"]); p["drain"] = d;
            Time(p["observedAtUtc"]); Time(p["expiresAtUtc"]);
            return p;
        }
        internal static string Canonical(object value)
        {
            if (value == null) return "null";
            if (value is string)
            {
                string s = (string)value;
                // All accepted V2 scalar fields are bounded ASCII tokens,
                // hashes or timestamps. Refuse unsupported Unicode/control
                // encoding rather than silently diverge from JSON.stringify.
                foreach (char c in s) Require(c >= 0x20 && c <= 0x7e, "ASCII_WIRE_REQUIRED");
                return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
            }
            if (value is int || value is long) return Convert.ToInt64(value).ToString(CultureInfo.InvariantCulture);
            Require(value.GetType() == typeof(Dictionary<string, object>), "WIRE_TYPE_INVALID");
            Dictionary<string, object> obj = (Dictionary<string, object>)value;
            List<string> keys = new List<string>(obj.Keys); keys.Sort(StringComparer.Ordinal);
            List<string> pairs = new List<string>();
            foreach (string key in keys) pairs.Add(Canonical(key) + ":" + Canonical(obj[key]));
            return "{" + String.Join(",", pairs.ToArray()) + "}";
        }
    }
}
