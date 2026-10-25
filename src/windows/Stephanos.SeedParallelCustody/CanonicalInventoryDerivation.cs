using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stephanos.SeedParallelCustody;

// Fixed data transformation only. An expected base/blob binds bytes to caller
// expectations; the existing owner/base admission boundary must authenticate
// those expectations. Neither a hash nor this derived projection grants authority.
internal static class CanonicalInventoryDerivation
{
    internal const int MaximumManifestBytes = 16 * 1024;
    internal const int MaximumProjectionBytes = 1024 * 1024;
    private const string ProjectionSchema = "stephanos.seed-canopy-canonical-inventory.v1";
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static string TargetPath(string workspaceRoot, string relativeTarget)
    {
        if (!DocumentTarget(relativeTarget) || string.IsNullOrEmpty(workspaceRoot)
            || !Path.IsPathFullyQualified(workspaceRoot)) throw Held("SEED_INVENTORY_TARGET_INVALID");
        try
        {
            string root = Path.GetFullPath(workspaceRoot).TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            string target = Path.GetFullPath(Path.Combine(root, relativeTarget.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                throw Held("SEED_INVENTORY_TARGET_INVALID");
            return target;
        }
        catch (SeedWriterHeldException) { throw; }
        catch { throw Held("SEED_INVENTORY_TARGET_INVALID"); }
    }

    internal static byte[] Render(byte[] manifestBytes, byte[] projectionBytes,
        string expectedBase, string expectedTarget, string expectedProjectionBlob)
    {
        if (!Matches(expectedBase, "^[a-f0-9]{40}$") || !Matches(expectedProjectionBlob, "^[a-f0-9]{40}$"))
            throw Held("SEED_INVENTORY_BASE_EXPECTATION_INVALID");
        // Git uses the byte length, not UTF-16 string length. This is object
        // identity, not a signature or an authentication mechanism.
        using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA1))
        {
            hash.AppendData(Encoding.ASCII.GetBytes("blob " + projectionBytes.Length.ToString(CultureInfo.InvariantCulture) + "\0"));
            hash.AppendData(projectionBytes);
            if (!CryptographicOperations.FixedTimeEquals(hash.GetHashAndReset(), Convert.FromHexString(expectedProjectionBlob)))
                throw Held("SEED_INVENTORY_PROJECTION_BLOB_MISMATCH");
        }
        using var manifest = Parse(manifestBytes, MaximumManifestBytes);
        using var projection = Parse(projectionBytes, MaximumProjectionBytes);
        var seed = SelectSeed(projection.RootElement, String(manifest.RootElement, "seedId", 80));
        ValidateRequest(manifest.RootElement, seed, expectedBase, expectedTarget);
        string intent = String(manifest.RootElement, "intent", MaximumManifestBytes);
        string content = string.Join('\n', new[]
        {
            "# " + Scalar(seed.Title) + ": " + seed.FirstRung + " source inventory",
            "",
            "> SOURCE PROPOSAL ONLY. No Battle Bridge observation, live builder pickup,",
            "> source merge, runtime deployment or seed completion is claimed.",
            "",
            "## Canonical ownership",
            "",
            "- Seed: `" + seed.SeedId + "`",
            "- Owner: " + Scalar(seed.Issue),
            "- Contract source: `" + Scalar(seed.Source) + "`",
            "- Exact request base: `" + expectedBase + "`",
            "- Approved target (proposal): `" + expectedTarget + "`",
            "",
            "## Requested outcome",
            "",
            Scalar(intent),
            "",
            "## Evidence to collect before implementation",
            "",
            "- [ ] Confirm the current source and running host match this base.",
            "- [ ] Verify the owner and check competing canonical, Island and Seed claims.",
            "- [ ] Record independent, current physical evidence for any claimed gap.",
            "- [ ] Identify the smallest disjoint implementation scope and test.",
            "- [ ] Obtain exact-head independent review and protected merge approval.",
            "- [ ] Prove post-merge runtime outcome before marking this seed grown.",
            "",
            "## Unverified observations",
            "",
            "No physical observations were supplied by this deterministic renderer.",
            "Treat every proposed acceptance check as pending real evidence.",
            "",
        });
        byte[] bytes = StrictUtf8.GetBytes(content);
        if (bytes.Length == 0 || bytes.Length > PinnedNewFile.MaximumBytes)
            throw Held("SEED_INVENTORY_OUTPUT_LIMIT_EXCEEDED");
        return bytes;
    }

    private sealed record Seed(string SeedId, string Title, string Issue, string Source, string FirstRung);

    private static Seed SelectSeed(JsonElement root, string wanted)
    {
        Object(root, ["schemaVersion", "seeds"]);
        if (String(root, "schemaVersion", 100) != ProjectionSchema)
            throw Held("SEED_INVENTORY_PROJECTION_SCHEMA_INVALID");
        JsonElement seeds = root.GetProperty("seeds");
        if (seeds.ValueKind != JsonValueKind.Array || seeds.GetArrayLength() is < 1 or > 64)
            throw Held("SEED_INVENTORY_PROJECTION_LIMIT_INVALID");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        Seed? selected = null;
        foreach (var item in seeds.EnumerateArray())
        {
            Object(item, ["seedId", "title", "issue", "source", "firstRung"]);
            var seed = new Seed(String(item, "seedId", 80), String(item, "title", 2400),
                String(item, "issue", 80), String(item, "source", 220), String(item, "firstRung", 90));
            if (!Matches(seed.SeedId, "^[a-z0-9][a-z0-9-]{2,79}$") || !ids.Add(seed.SeedId)
                || Trim(seed.Title).Length == 0 || !Matches(seed.Issue, "^#[0-9]+$")
                || !SafePath(seed.Source) || !Matches(seed.FirstRung, "^[A-Z0-9_]{3,90}$"))
                throw Held("SEED_INVENTORY_CANONICAL_RECORD_INVALID");
            if (seed.SeedId == wanted) selected = seed;
        }
        return selected ?? throw Held("SEED_INVENTORY_UNKNOWN_CANONICAL_SEED");
    }

    private static void ValidateRequest(JsonElement request, Seed seed, string expectedBase, string expectedTarget)
    {
        Object(request, ["schemaVersion", "seedId", "ownerIssue", "contractSource", "taskId", "intent",
            "targetPath", "expectedTargetSha256", "baseSha", "testPaths", "reviewAuthority",
            "sourceScopeApproval", "generationMode"], ["mergeAllowed", "deployAllowed", "runtimeMutationAllowed"]);
        if (String(request, "schemaVersion", 100) != "stephanos.seed-parallel-build-request.v1"
            || String(request, "generationMode", 100) != "CANONICAL_INVENTORY_V1"
            || String(request, "seedId", 80) != seed.SeedId
            || String(request, "ownerIssue", 80) != seed.Issue
            || String(request, "contractSource", 220) != seed.Source
            || !Matches(String(request, "taskId", 80), "^[a-z0-9][a-z0-9-]{2,79}$")
            || String(request, "baseSha", 40) != expectedBase
            || String(request, "targetPath", 220) != expectedTarget || !DocumentTarget(expectedTarget)
            || request.GetProperty("expectedTargetSha256").ValueKind != JsonValueKind.Null
            || String(request, "reviewAuthority", 100) != "PROTECTED_REVIEW_REQUIRED"
            || String(request, "sourceScopeApproval", 100) != "EXACT_TARGET_ONLY")
            throw Held("SEED_INVENTORY_REQUEST_BINDING_INVALID");
        string intent = Trim(String(request, "intent", MaximumManifestBytes));
        if (intent.Length is < 1 or > 2400) throw Held("SEED_INVENTORY_INTENT_INVALID");
        foreach (string name in new[] { "mergeAllowed", "deployAllowed", "runtimeMutationAllowed" })
            if (request.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.False)
                throw Held("SEED_INVENTORY_AUTHORITY_ESCALATION");
        JsonElement tests = request.GetProperty("testPaths");
        if (tests.ValueKind != JsonValueKind.Array || tests.GetArrayLength() is < 1 or > 5)
            throw Held("SEED_INVENTORY_TEST_SCOPE_INVALID");
        var paths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in tests.EnumerateArray())
        {
            string path = StringValue(element, 220);
            if (!SafePath(path) || !Matches(path,
                "^(?:shared/runtime|stephanos-server/services|tests)/[a-zA-Z0-9/_-]+\\.test\\.(?:mjs|js)$")
                || !paths.Add(path)) throw Held("SEED_INVENTORY_TEST_SCOPE_INVALID");
        }
    }

    private static JsonDocument Parse(byte[] bytes, int maximum)
    {
        if (bytes.Length == 0 || bytes.Length > maximum) throw Held("SEED_INVENTORY_JSON_SIZE_INVALID");
        try
        {
            string text = StrictUtf8.GetString(bytes);
            ValidateEscapedSurrogates(text);
            return JsonDocument.Parse(text, new JsonDocumentOptions
                { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 8 });
        }
        catch (SeedWriterHeldException) { throw; }
        catch (Exception error) when (error is JsonException or DecoderFallbackException)
        { throw Held("SEED_INVENTORY_JSON_INVALID"); }
    }

    // JSON permits escaped surrogate halves that do not denote Unicode scalar
    // values. Reject them before a library string decoder can replace them.
    private static void ValidateEscapedSurrogates(string text)
    {
        bool quoted = false;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == '"') { quoted = !quoted; continue; }
            if (!quoted || text[i] != '\\' || ++i >= text.Length) continue;
            if (text[i] != 'u') continue;
            int value = Escape(text, i + 1); i += 4;
            if (value is >= 0xD800 and <= 0xDBFF)
            {
                if (i + 6 >= text.Length || text[i + 1] != '\\' || text[i + 2] != 'u')
                    throw Held("SEED_INVENTORY_JSON_INVALID");
                int low = Escape(text, i + 3);
                if (low is < 0xDC00 or > 0xDFFF) throw Held("SEED_INVENTORY_JSON_INVALID");
                i += 6;
            }
            else if (value is >= 0xDC00 and <= 0xDFFF) throw Held("SEED_INVENTORY_JSON_INVALID");
        }
    }

    private static int Escape(string text, int start)
    {
        if (start + 4 > text.Length) throw Held("SEED_INVENTORY_JSON_INVALID");
        int value = 0;
        for (int i = start; i < start + 4; i++)
        {
            int digit = text[i] switch { >= '0' and <= '9' => text[i] - '0',
                >= 'a' and <= 'f' => text[i] - 'a' + 10, >= 'A' and <= 'F' => text[i] - 'A' + 10, _ => -1 };
            if (digit < 0) throw Held("SEED_INVENTORY_JSON_INVALID");
            value = value * 16 + digit;
        }
        return value;
    }

    private static void Object(JsonElement value, string[] required, string[]? optional = null)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Held("SEED_INVENTORY_JSON_OBJECT_REQUIRED");
        var allowed = new HashSet<string>(required, StringComparer.Ordinal);
        if (optional is not null) allowed.UnionWith(optional);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name) || !seen.Add(property.Name))
                throw Held("SEED_INVENTORY_JSON_PROPERTIES_INVALID");
        if (required.Any(name => !seen.Contains(name))) throw Held("SEED_INVENTORY_JSON_PROPERTIES_INVALID");
    }

    private static string String(JsonElement parent, string name, int maximum)
    {
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(name, out var value))
            throw Held("SEED_INVENTORY_JSON_STRING_REQUIRED");
        return StringValue(value, maximum);
    }

    private static string StringValue(JsonElement value, int maximum)
    {
        if (value.ValueKind != JsonValueKind.String) throw Held("SEED_INVENTORY_JSON_STRING_REQUIRED");
        string text = value.GetString()!;
        if (text.Length > maximum || text.Contains('\0')) throw Held("SEED_INVENTORY_JSON_STRING_INVALID");
        return text;
    }

    private static bool SafePath(string value) => value.Length is > 0 and <= 220
        && value == Trim(value) && !value.Contains('\\') && !value.Contains("//")
        && !value.StartsWith('/') && !value.EndsWith('/')
        && !value.Split('/').Any(part => part is "" or "." or "..")
        && !Matches(value, "[\\x00-\\x1f:*?\"<>|]");

    private static bool DocumentTarget(string value) => value is not null && SafePath(value)
        && Matches(value, "^docs/architecture/[a-zA-Z0-9/_-]+\\.md$")
        && !Regex.IsMatch(value, "/(?:auth|credential|secret|protected|operatorMerge|lease|security|approval)[^/]*[/.]",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static bool Matches(string? text, string pattern) => text is not null
        && Regex.IsMatch(text, pattern.EndsWith('$') ? pattern[..^1] + @"\z" : pattern, RegexOptions.CultureInvariant);

    // ECMAScript WhiteSpace + LineTerminator, deliberately not .NET Trim:
    // U+FEFF is trimmed; U+0085 is retained. Length/slicing use UTF-16 units.
    private static bool Space(char c) => c is >= '\u0009' and <= '\u000D' or '\u0020' or '\u00A0'
        or '\u1680' or >= '\u2000' and <= '\u200A' or '\u2028' or '\u2029' or '\u202F'
        or '\u205F' or '\u3000' or '\uFEFF';
    private static string Trim(string text)
    {
        int first = 0, last = text.Length;
        while (first < last && Space(text[first])) first++;
        while (last > first && Space(text[last - 1])) last--;
        return text[first..last];
    }
    private static string Scalar(string text)
    {
        string value = Trim(text).Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ')
            .Replace('<', ' ').Replace('>', ' ');
        return value[..Math.Min(2400, value.Length)];
    }
    private static SeedWriterHeldException Held(string code) => new(code);
}
