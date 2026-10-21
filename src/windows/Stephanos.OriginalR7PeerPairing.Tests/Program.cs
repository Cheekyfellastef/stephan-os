using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Reflection;
using System.Runtime.InteropServices;
using Stephanos.OriginalR7CustodyWitness;

try
{
    NativePeerFixture.SetErrorMode(NativePeerFixture.GetErrorMode() | 3);
    int assertions = 0;
    void Check(bool value, string code) { assertions++; if (!value) throw new InvalidOperationException(code); }
    void Reject(Action action, string code)
    {
        try { action(); } catch { assertions++; return; }
        throw new InvalidOperationException(code);
    }
    async Task RejectAsync(Func<Task> action, string code)
    {
        try { await action(); } catch { assertions++; return; }
        throw new InvalidOperationException(code);
    }
    string[] parsed = OriginalR7OwnerPeerOperation.ParseStrings("{\"operation\":\"fixture\",\"runId\":\"1\"}", "operation", "runId");
    Check(parsed.SequenceEqual(new[] { "fixture", "1" }), "CLOSED_PUBLIC_PROTOCOL_VALUES");
    foreach (string invalid in new[] { "[]", "{}", "{\"operation\":true,\"runId\":\"1\"}",
        "{\"operation\":\"fixture\",\"operation\":\"other\",\"runId\":\"1\"}",
        "{\"operation\":\"fixture\",\"runId\":\"1\",\"osConsent\":true}",
        "{\"operation\":\"fixture\",\"runId\":{\"nested\":\"1\"}}" })
        Reject(() => OriginalR7OwnerPeerOperation.ParseStrings(invalid, "operation", "runId"), "REJECT_PUBLIC_PROTOCOL_WIDENING");
    using (var stream = new MemoryStream(Encoding.UTF8.GetBytes("one\r\ntwo\n")))
    {
        var lines = new OriginalR7OwnerPeerOperation.BoundedPublicLines(stream);
        Check(await lines.ReadAsync(8, TimeSpan.FromSeconds(1)) == "one", "BOUNDED_CRLF_LINE");
        Check(await lines.ReadAsync(8, TimeSpan.FromSeconds(1)) == "two", "BUFFERED_SECOND_LINE_KEPT");
        await RejectAsync(() => lines.ReadAsync(8, TimeSpan.FromSeconds(1)), "EOF_IS_TERMINAL");
    }
    foreach (byte[] invalid in new[] { Encoding.UTF8.GetBytes("12345\n"), Encoding.UTF8.GetBytes("\n"),
        Encoding.UTF8.GetBytes("no-eol"), new byte[] { 0xc3, 0x28, 10 } })
    {
        using var stream = new MemoryStream(invalid);
        var lines = new OriginalR7OwnerPeerOperation.BoundedPublicLines(stream);
        await RejectAsync(() => lines.ReadAsync(4, TimeSpan.FromSeconds(1)), "BOUNDED_MALFORMED_PUBLIC_LINE_REJECTED");
    }
    using (var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"operation\":\"wrong\",\"permitSha256\":\"bad\",\"expectedMain\":\"bad\"}\n")))
    using (var output = new StringWriter(CultureInfo.InvariantCulture))
    {
        Check(await OriginalR7OwnerPeerOperation.RunAsync(stream, output) == 6, "INVALID_OPERATION_FAILS_BEFORE_NATIVE_OWNER_OR_DIALOG");
        using JsonDocument failure = JsonDocument.Parse(output.ToString());
        Check(failure.RootElement.GetProperty("classification").GetString() == "R7_OWNER_PEER_AUTHENTICATION_HELD"
            && !output.ToString().Contains("permitSha256", StringComparison.Ordinal), "FIXED_FAILURE_DOES_NOT_ECHO_PUBLIC_INPUT");
    }
    string path = Path.Combine(AppContext.BaseDirectory, "PeerPairingGolden.fixture.json");
    byte[] bytes = File.ReadAllBytes(path);
    Check(bytes.Length <= 12288, "PUBLIC_GOLDEN_BOUND");
    using JsonDocument fixture = JsonDocument.Parse(bytes);
    var root = fixture.RootElement;
    Check(root.GetProperty("fixtureOnly").GetBoolean() && root.GetProperty("notLiveFreshnessEvidence").GetBoolean(),
        "GOLDEN_IS_NOT_LIVE_AUTHORITY");
    var challenge = root.GetProperty("challenge").Deserialize<OriginalR7OwnerTransportChallenge>()
        ?? throw new InvalidOperationException("PUBLIC_CHALLENGE_MISSING");
    var context = root.GetProperty("context");
    string main = context.GetProperty("expectedMain").GetString()!;
    string run = context.GetProperty("runId").GetString()!;
    string permit = context.GetProperty("permitSha256").GetString()!;
    // The golden vector is historical PUBLIC test data. Never substitute this
    // fixture clock at a real native consent/producer consumption boundary.
    DateTimeOffset fixtureNow = DateTimeOffset.ParseExact(challenge.IssuedAtUtc,
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal).AddSeconds(1);
    OriginalR7OwnerPeerTranscript Build(OriginalR7OwnerTransportChallenge? c = null,
        string? m = null, string? r = null, string attempt = "1", DateTimeOffset? now = null, string? p = null)
        => OriginalR7OwnerPeerPairing.BuildUntrustedFixture(c ?? challenge, m ?? main, r ?? run,
            attempt, now ?? fixtureNow, p ?? permit);
    var pairing = Build();
    Check(pairing.Wire == root.GetProperty("expectedWire").GetString(), "NODE_DOTNET_EXACT_CANONICAL_BYTES");
    Check(Encoding.UTF8.GetByteCount(pairing.Wire) == 892, "NODE_DOTNET_892_UTF8_BYTES");
    Check(pairing.Fingerprint == "442ba74864242c8139ee8e760d6846ba4646c585980aa557ff73c770d29cb22b"
        && pairing.Fingerprint == root.GetProperty("expectedFingerprint").GetString(), "NODE_DOTNET_DOMAIN_SEPARATED_DIGEST");
    Check(pairing.ApprovalComment == root.GetProperty("expectedComment").GetString(), "EXACT_OWNER_ENDPOINT_ENROLLMENT_COMMENT");
    Check(pairing.RunUrl == root.GetProperty("expectedRunUrl").GetString(), "FIXED_OWNER_RUN_LINK");
    using (JsonDocument transcript = JsonDocument.Parse(pairing.Wire))
    {
        string[] expected = ["schemaVersion", "purpose", "repository", "workflowRef", "expectedMain", "runId", "runAttempt",
            "permitSha256", "nativeAudience", "nativeRecipientSpkiSha256", "nativeIssuedAtUtc", "nativeExpiresAtUtc"];
        Check(transcript.RootElement.EnumerateObject().Select(p => p.Name).SequenceEqual(expected), "CLOSED_TWELVE_FIELD_ORDER");
        Check(transcript.RootElement.EnumerateObject().All(p => p.Value.ValueKind == JsonValueKind.String), "ALL_CONSTRAINED_ASCII_STRINGS");
    }
    Check(!pairing.NativeEndpointAuthenticated && !pairing.OwnerEnrollmentAuthenticated && !pairing.OsConsentProven
        && !pairing.HostPolicyAdopted && !pairing.RootEnrollmentAuthorized && !pairing.CanonicalLeaseReleaseAuthorized,
        "TRANSCRIPT_CANNOT_ENROLL_OR_AUTHORIZE");
    foreach (string invalid in new[] { "0", "01", "+1", "1 ", "1\n", "18446744073709551616", "-1", "1e3", "" })
        Reject(() => Build(r: invalid), "RUN_ID_ALIAS_OR_OVERFLOW");
    foreach (string invalid in new[] { "0", "2", "01", "+1", "1 ", "" })
        Reject(() => Build(attempt: invalid), "ATTEMPT_MUST_BE_EXACT_FIRST_ATTEMPT");
    foreach (string invalid in new[] { new string('0', 40), new string('B', 40), "a", main + "\n", "" })
        Reject(() => Build(m: invalid), "MAIN_MUST_BE_EXACT_NONZERO_LOWERCASE_HASH");
    Reject(() => Build(p: new string('d', 64)), "PERMIT_AUDIENCE_DRIFT");
    Reject(() => Build(c: challenge with { Audience = challenge.Audience.Replace(new string('a', 64), new string('d', 64)) }), "WRONG_PERMIT_IN_AUDIENCE");
    Reject(() => Build(c: challenge with { PublicSpkiSha256 = new string('d', 64) }), "SPKI_AUDIENCE_DRIFT");
    Reject(() => Build(c: challenge with { PublicSpkiBase64 = challenge.PublicSpkiBase64 + "=" }), "NONCANONICAL_PUBLIC_KEY_ENCODING");
    Reject(() => Build(c: challenge with { PublicSpkiBase64 = Convert.ToBase64String(new byte[294]) }), "MALFORMED_DER_IS_NOT_RECIPIENT");
    Reject(() => Build(c: challenge with { IssuedAtUtc = "2026-10-21T21:30:00Z" }), "TIMESTAMP_ALIAS_REJECTED");
    Reject(() => Build(c: challenge with { ExpiresAtUtc = "2026-10-21T21:35:00.001Z" }), "LIFETIME_EXCEEDS_NATIVE_FIVE_MINUTES");
    Reject(() => Build(now: fixtureNow.AddMinutes(5)), "EXPIRED_CHALLENGE_NOT_REFRESHED");
    Reject(() => Build(now: fixtureNow.AddSeconds(-2)), "FUTURE_CHALLENGE_REJECTED");
    foreach (var changed in new[] {
        Build(r: "123456789013"), Build(m: new string('d', 40)),
        Build(c: challenge with { Audience = challenge.Audience.Replace(new string('c', 64), new string('d', 64)) }),
        Build(c: challenge with { ExpiresAtUtc = "2026-10-21T21:34:59.999Z" }) })
        Check(changed.Fingerprint != pairing.Fingerprint, "EVERY_RUN_MAIN_NONCE_WINDOW_CHANGE_REQUIRES_NEW_PAIRING");
    // Prove that the real Windows bindings exist without displaying a prompt
    // or attempting any account logon. Symbol presence is not OS consent.
    Check(NativePeerFixture.FixedBindingsIgnoreOwnedShadow(), "PRODUCTION_BINDINGS_IGNORE_APP_AND_CWD_SHADOW_SYSTEM32_MODULES_ACTUAL");
    foreach (var module in new[] {
        ("credui.dll", new[] { "CredUIPromptForWindowsCredentialsW", "CredUnPackAuthenticationBufferW", "CredPackAuthenticationBufferW" }),
        ("advapi32.dll", new[] { "LogonUserW", "CredIsMarshaledCredentialW" }),
        ("kernel32.dll", new[] { "GetCurrentProcess", "DuplicateHandle" }) })
    {
        nint library = NativeLibrary.Load(Path.Combine(Environment.SystemDirectory, module.Item1));
        try { foreach (string symbol in module.Item2) Check(NativeLibrary.TryGetExport(library, symbol, out _), "ACTUAL_WINDOWS_EXPORT_" + symbol); }
        finally { NativeLibrary.Free(library); }
    }
    var decisionType = typeof(OriginalR7OperatingSystemPeerDecision);
    var actualImports = decisionType.GetMethods(BindingFlags.Static | BindingFlags.NonPublic)
        .Where(method => method.GetCustomAttribute<DllImportAttribute>() is not null).ToArray();
    Check(actualImports.Length == 0, "OS_DECISION_HAS_NO_BARE_PINVOKE_PROBING_ON_DOTNET8_SINGLE_FILE");
    Check(decisionType.GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
        .All(c => c.IsPrivate), "NO_CALLER_CONSTRUCTED_OS_DECISION");
    const string publicUser = "r7-public-fixture-not-an-account", publicPassword = "PUBLIC fixture data, never an account credential";
    uint packedSize = 0;
    Check(!NativePeerFixture.CredPackAuthenticationBufferW(1, publicUser, publicPassword, 0, ref packedSize)
        && Marshal.GetLastWin32Error() == 122 && packedSize is > 0 and <= 65536, "REAL_PUBLIC_FIXTURE_PACK_SIZE");
    nint packed = Marshal.AllocCoTaskMem((int)packedSize);
    try
    {
        Check(NativePeerFixture.CredPackAuthenticationBufferW(1, publicUser, publicPassword, packed, ref packedSize), "REAL_PUBLIC_FIXTURE_PROTECTED_PACK");
        Type ownedType = decisionType.GetNestedType("OwnedAuthenticationFields", BindingFlags.NonPublic)!;
        var unpack = ownedType.GetMethod("Unpack", BindingFlags.Static | BindingFlags.NonPublic)!;
        using var fields = (IDisposable)unpack.Invoke(null, [packed, packedSize])!;
        Check((string)ownedType.GetProperty("UserName", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(fields)! == publicUser,
            "ACTUAL_NATIVE_UNPACK_PUBLIC_USER");
        nint passwordPointer = (nint)ownedType.GetProperty("PasswordPointer", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(fields)!;
        bool matches = true;
        for (int i = 0; i <= publicPassword.Length; i++)
            matches &= Marshal.ReadInt16(passwordPointer, i * 2) == (i == publicPassword.Length ? 0 : publicPassword[i]);
        Check(matches, "ACTUAL_NATIVE_UNPACK_PUBLIC_BUFFER_NOT_REAL_SECRET");
    }
    finally
    {
        decisionType.GetMethod("WipeOwned", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, [packed, packedSize]);
        bool zero = true;
        for (int i = 0; i < packedSize; i++) zero &= Marshal.ReadByte(packed, i) == 0;
        Check(zero, "OWNED_UNMANAGED_EXTENT_WIPED_BEFORE_FREE");
        Marshal.FreeCoTaskMem(packed);
    }
    Console.WriteLine(JsonSerializer.Serialize(new {
        schemaVersion = "stephanos.r7-owner-peer-transcript-fixture.v1", result = "PASS", assertions,
        nodeDotNetGoldenBytesMatched = true, goldenFingerprint = pairing.Fingerprint,
        nativeOsPromptPerformed = false, realCredentialsRead = false, authenticatedEndpoint = false,
        actualWindowsCredentialApiExportsVerified = true, publicFixtureNativePackUnpackOnly = true,
        nativeApiModulesObservedFromSystem32 = true, invalidOwnedAppAndCwdShadowsIgnored = true,
        nativeApiBindingUsesBarePInvoke = false, framework = RuntimeInformation.FrameworkDescription,
        actualAccountLogonAttempted = false,
        policyAdopted = false, rootEnrollmentAuthorized = false, leaseReleaseAuthorized = false,
    }));
    return 0;
}

catch (Exception error)
{
    Console.Error.WriteLine("R7_PEER_PAIRING_FIXTURE_FAILED:" + error.GetType().Name + ":" + error.Message);
    return 1;
}

internal static class NativePeerFixture
{
    internal static bool FixedBindingsIgnoreOwnedShadow()
    {
        if (Assembly.GetEntryAssembly()?.GetName().Name != "Stephanos.OriginalR7PeerPairing.Tests")
            throw new InvalidOperationException("OWNED_FIXTURE_ASSEMBLY_REQUIRED");
        string adjacent = Path.Combine(AppContext.BaseDirectory, "credui.dll");
        string directory = Path.Combine(Path.GetTempPath(), "r7-os-bindings-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string cwdShadow = Path.Combine(directory, "credui.dll"), previous = Environment.CurrentDirectory;
        bool appCreated = false, cwdCreated = false;
        try
        {
            // PUBLIC invalid image bytes, never executable DLL code. CreateNew
            // cannot overwrite a preexisting sidecar. Both files stay readable
            // during resolution; the production loader checks actual module
            // filenames and absolute OS paths, not fixture success booleans.
            using var app = new FileStream(adjacent, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            appCreated = true;
            using var cwd = new FileStream(cwdShadow, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            cwdCreated = true;
            byte[] marker = Encoding.ASCII.GetBytes("R7 PUBLIC NON_EXECUTABLE SHADOW DLL FIXTURE");
            app.Write(marker); app.Flush(true); cwd.Write(marker); cwd.Flush(true);
            Environment.CurrentDirectory = directory;
            return OriginalR7OperatingSystemPeerDecision.FixedNativeModulesObserved();
        }
        finally
        {
            Environment.CurrentDirectory = previous;
            // Owned disposable fixture paths only; no hostile-parent cleanup
            // or production disposition claim follows from these deletions.
            if (appCreated) File.Delete(adjacent);
            if (cwdCreated) File.Delete(cwdShadow);
            Directory.Delete(directory, false);
        }
    }
    [DllImport("kernel32.dll")] internal static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] internal static extern uint SetErrorMode(uint mode);
    [DllImport("credui.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CredPackAuthenticationBufferW(uint flags, string user, string password, nint buffer, ref uint bytes);
}
