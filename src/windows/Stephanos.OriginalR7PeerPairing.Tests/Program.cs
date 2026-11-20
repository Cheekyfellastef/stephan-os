using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Diagnostics;
using Stephanos.OriginalR7CustodyWitness;

try
{
    bool portableProtocolOnly = args.SequenceEqual(new[] { "--portable-protocol-only" });
    if (!portableProtocolOnly) NativePeerFixture.SetErrorMode(NativePeerFixture.GetErrorMode() | 3);
    if (args.SequenceEqual(new[] { "--owned-system32-attribute-control" }))
    {
        uint size = 0;
        NativePeerFixture.CredPackAuthenticationBufferW(1, "r7-public-not-an-account", "PUBLIC fixture, never a real password", 0, ref size);
        Console.WriteLine(NativePeerFixture.LoadedCredentialOrigin());
        return 0;
    }
    if (args.SequenceEqual(new[] { "--owned-fixed-system32-binding" }))
    {
        Console.WriteLine(OriginalR7OperatingSystemPeerDecision.FixedNativeModulesObserved()
            ? NativePeerFixture.LoadedCredentialOrigin() : "UNPROVEN");
        return 0;
    }
    if (!portableProtocolOnly && args.Length != 0) return 2;
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
    foreach (string invalidStart in new[] {
        "{\"operation\":\"begin-inactive-roots\",\"permitWire\":\"public-invalid-permit\"}",
        "{\"operation\":\"begin-inactive-roots\",\"permitWire\":\"public-invalid-permit\",\"osConsent\":\"true\"}",
        "{\"operation\":\"begin-owner-peer\",\"permitWire\":\"public-invalid-permit\"}" })
    using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(invalidStart + "\n")))
    using (var output = new StringWriter(CultureInfo.InvariantCulture))
    {
        Check(await OriginalR7OwnerPeerOperation.RunInactiveRootPurposeAuthenticationAsync(stream, output) == 7,
            "INVALID_PROVISIONING_SOURCE_OR_CALLER_CONSENT_REJECTED_BEFORE_PROMPT_OR_WRITES");
        using JsonDocument failure = JsonDocument.Parse(output.ToString());
        Check(!failure.RootElement.GetProperty("rootEnrollmentAuthorized").GetBoolean()
            && !failure.RootElement.GetProperty("signingAuthorized").GetBoolean()
            && !failure.RootElement.GetProperty("leaseReleaseAuthorized").GetBoolean()
            && !output.ToString().Contains("public-invalid-permit", StringComparison.Ordinal),
            "PROVISIONING_FAILURE_IS_BOUNDED_AND_GRANTS_NO_AUTHORITY");
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
    var inactiveChallenge = challenge with { Audience = OriginalR7OwnerPeerPairing.InactiveRootAudiencePrefix
        + challenge.Audience[OriginalR7OwnerPeerPairing.PeerAudiencePrefix.Length..] };
    var inactivePairing = Build(c: inactiveChallenge);
    Check(inactivePairing.Purpose == OriginalR7OwnerPeerPairing.InactiveRootPurpose
        && inactivePairing.ApprovalComment == OriginalR7OwnerPeerPairing.InactiveRootPurpose + ":" + inactivePairing.Fingerprint
        && inactivePairing.Fingerprint != pairing.Fingerprint, "PROVISIONING_REQUIRES_DISTINCT_FULL_PURPOSE_APPROVAL");
    Check(Encoding.UTF8.GetByteCount(inactivePairing.Wire) == 899
        && inactivePairing.Fingerprint == "4bb41bf002c2631316e413587d60ed20cf8e99d42d027610479961c5983587ba",
        "NODE_DOTNET_DISTINCT_PROVISIONING_PURPOSE_GOLDEN_BYTES");
    Check(!inactivePairing.OsConsentProven && !inactivePairing.RootEnrollmentAuthorized
        && !inactivePairing.HostPolicyAdopted && !inactivePairing.CanonicalLeaseReleaseAuthorized,
        "FULL_PURPOSE_TRANSCRIPT_IS_STILL_NOT_A_NATIVE_GRANT");
    foreach (string invalidPrefix in new[] { "stephanos:r7:inactive-first-root-provisioning:v2:",
        "stephanos:r7:inactive-first-root-provisioning:v1", "stephanos:r7:inactive-first-root-provisioning:v1::",
        "stephanos:r7:first-root-owner-permit:v1:PROVISION_INACTIVE_R7_SIGNING_ROOTS_ONLY:" })
        Reject(() => Build(c: challenge with { Audience = invalidPrefix
            + challenge.Audience[OriginalR7OwnerPeerPairing.PeerAudiencePrefix.Length..] }), "PURPOSE_PREFIX_ALIASES_REJECTED");
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
    foreach (var purpose in Enum.GetValues<OriginalR7OwnerOperationPurpose>())
    {
        using var untrusted = OriginalR7OwnerEnvelopeTransport.CreateUntrustedFixture(new string('a', 64),
            new string('b', 64), purpose);
        using var constructed = new OriginalR7OwnerEnvelopeTransport.InactiveRootProvisioningGrant(untrusted);
        Reject(() => constructed.RequireCurrent(), "FIXTURE_SESSION_CANNOT_REGISTER_CALLER_AUTHORITY_OBJECT");
        Reject(() => constructed.ClaimTransaction(), "CALLER_OBJECT_CANNOT_CLAIM_NATIVE_PROVISIONING");
        Check(await untrusted.ConsumeInactiveRootProvisioningAsync("not-an-envelope", null) is null,
            "NO_NATIVE_ISSUER_OR_OS_CONSENT_FROM_FIXTURE_OR_PEER_PURPOSE");
    }
    if (portableProtocolOnly)
    {
        Console.WriteLine(JsonSerializer.Serialize(new {
            schemaVersion = "stephanos.r7-owner-peer-protocol-fixture.v1", result = "PASS", assertions,
            nodeDotNetGoldenBytesMatched = true, goldenFingerprint = pairing.Fingerprint,
            inactivePurposeFingerprint = inactivePairing.Fingerprint,
            nativeOsPromptPerformed = false, realCredentialsRead = false, productionKeyCreated = false,
            nativeWindowsBindingsTested = false, physicalCustodyProven = false, leaseReleaseAuthorized = false
        }));
        return 0;
    }
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
        nativeApiModulesObservedFromSystem32 = true, genuineOwnedSidecarCopiesIgnoredByFixedChild = true,
        system32AttributeControlOrigin = NativePeerFixture.AttributeControlOrigin,
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
    internal static string AttributeControlOrigin { get; private set; } = "NOT_RUN";
    internal static bool FixedBindingsIgnoreOwnedShadow()
    {
        if (Assembly.GetEntryAssembly()?.GetName().Name != "Stephanos.OriginalR7PeerPairing.Tests")
            throw new InvalidOperationException("OWNED_FIXTURE_ASSEMBLY_REQUIRED");
        string adjacent = Path.Combine(AppContext.BaseDirectory, "credui.dll");
        string directory = Path.Combine(Path.GetTempPath(), "r7-os-bindings-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string cwdShadow = Path.Combine(directory, "credui.dll");
        bool appCreated = false, cwdCreated = false;
        try
        {
            // Copy ONLY the genuine OS DLL, never malicious/test DLL code.
            // Fresh owned children distinguish pre10 attribute-only probing
            // from the production absolute loader before either loads credui.
            using var app = new FileStream(adjacent, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            appCreated = true;
            using var cwd = new FileStream(cwdShadow, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            cwdCreated = true;
            using var original = new FileStream(Path.Combine(Environment.SystemDirectory, "credui.dll"),
                FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (original.Length is < 1 or > 8388608) throw new InvalidOperationException("OS_DLL_FIXTURE_BOUND");
            original.CopyTo(app); original.Position = 0; original.CopyTo(cwd); app.Flush(true); cwd.Flush(true);
            // A writable file handle can prevent image mapping; close the
            // completed copies before asking a cold child to load the image.
            app.Dispose(); cwd.Dispose();
            AttributeControlOrigin = RunOwnedBindingChild("--owned-system32-attribute-control", directory);
            if (AttributeControlOrigin is not ("GENUINE_APPDIR_COPY" or "SYSTEM32"))
                throw new InvalidOperationException("ATTRIBUTE_CONTROL_MODULE_ORIGIN_UNKNOWN");
            string fixedOrigin = RunOwnedBindingChild("--owned-fixed-system32-binding", directory);
            return fixedOrigin == "SYSTEM32" && OriginalR7OperatingSystemPeerDecision.FixedNativeModulesObserved();
        }
        finally
        {
            // Owned disposable fixture paths only; no hostile-parent cleanup
            // or production disposition claim follows from these deletions.
            if (appCreated) File.Delete(adjacent);
            if (cwdCreated) File.Delete(cwdShadow);
            Directory.Delete(directory, false);
        }
    }

    private static string RunOwnedBindingChild(string mode, string directory)
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("OWNED_RUNTIME_REQUIRED");
        using var child = new Process { StartInfo = new(executable) { UseShellExecute = false, CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = directory,
            RedirectStandardOutput = true, RedirectStandardError = true } };
        string assembly = Assembly.GetExecutingAssembly().GetName().Name ?? throw new InvalidOperationException("OWNED_ASSEMBLY_REQUIRED");
        if (Path.GetFileName(executable).Equals("dotnet.exe", StringComparison.OrdinalIgnoreCase))
        {
            string dll = (string?)typeof(Assembly).GetProperty("Location")!.GetValue(Assembly.GetExecutingAssembly()) ?? "";
            if (!Path.IsPathFullyQualified(dll) || Path.GetFileName(dll) != assembly + ".dll")
                throw new InvalidOperationException("OWNED_DLL_REQUIRED");
            child.StartInfo.ArgumentList.Add(dll);
        }
        else if (!string.Equals(Path.GetFullPath(executable), Path.Combine(AppContext.BaseDirectory, assembly + ".exe"),
            StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("OWNED_APPHOST_REQUIRED");
        child.StartInfo.ArgumentList.Add(mode);
        child.Start();
        Task<string> output = child.StandardOutput.ReadToEndAsync(), error = child.StandardError.ReadToEndAsync();
        if (!child.WaitForExit(10000))
        {
            // Exactly the fresh process created above, never a PID selector or
            // production subject. A timeout is a failed fixture, never success.
            child.Kill(); child.WaitForExit(3000);
            throw new InvalidOperationException("OWNED_MODULE_CHILD_TIMEOUT");
        }
        string result = output.GetAwaiter().GetResult(), diagnostic = error.GetAwaiter().GetResult();
        if (child.ExitCode != 0 || result.Length > 128 || diagnostic.Length != 0)
            throw new InvalidOperationException("OWNED_MODULE_CHILD_FAILED");
        return result.Trim();
    }

    internal static string LoadedCredentialOrigin()
    {
        // A query-only fixed bootstrap, independent of the production binder:
        // obtaining the name must not load credui before the control import.
        nint kernel = NativeLibrary.Load(Path.Combine(Environment.SystemDirectory, "kernel32.dll"));
        try
        {
            var get = Marshal.GetDelegateForFunctionPointer<ModuleHandle>(NativeLibrary.GetExport(kernel, "GetModuleHandleW"));
            var name = Marshal.GetDelegateForFunctionPointer<ModuleName>(NativeLibrary.GetExport(kernel, "GetModuleFileNameW"));
            nint borrowed = get("credui.dll");
            var path = new StringBuilder(1024);
            uint length = name(borrowed, path, (uint)path.Capacity);
            if (borrowed == 0 || length == 0 || length >= path.Capacity) return "UNPROVEN";
            if (string.Equals(path.ToString(), Path.Combine(Environment.SystemDirectory, "credui.dll"), StringComparison.OrdinalIgnoreCase)) return "SYSTEM32";
            if (string.Equals(path.ToString(), Path.Combine(AppContext.BaseDirectory, "credui.dll"), StringComparison.OrdinalIgnoreCase)) return "GENUINE_APPDIR_COPY";
            return "UNPROVEN";
        }
        finally { NativeLibrary.Free(kernel); }
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    private delegate nint ModuleHandle(string name);
    [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
    private delegate uint ModuleName(nint module, StringBuilder path, uint capacity);
    [DllImport("kernel32.dll")] internal static extern uint GetErrorMode();
    [DllImport("kernel32.dll")] internal static extern uint SetErrorMode(uint mode);
    [DllImport("credui.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CredPackAuthenticationBufferW(uint flags, string user, string password, nint buffer, ref uint bytes);
}
