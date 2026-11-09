using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Stephanos.OriginalR7CustodyWitness;

// A bounded claim-specific input binding. It does NOT authenticate its caller,
// source estate, old writer exclusion, roots, native custody or queue history.
// OriginalR7FixedSigningHostProfile remains fixed and unavailable for production.
internal sealed class ProspectiveProcessingClaimContext
{
    private static readonly Regex MissionPattern = new(@"\Acritical-([1-9][0-9]{0,9})-elastic-goal\z", RegexOptions.CultureInvariant);
    private static readonly Regex ActionPattern = new(@"\Acritical-([1-9][0-9]{0,9})-elastic-goal-r(0|[1-9][0-9]{0,8})-[a-f0-9]{12}\z", RegexOptions.CultureInvariant);
    private static readonly UTF8Encoding Utf8 = new(false, true);
    internal const int MaxInputBytes = 262144;
    internal string Repository { get; }
    internal string MissionId { get; }
    internal int MissionRevision { get; }
    internal string SourceExecutionId { get; }
    internal string SourceExecutionLeaseKey { get; }
    internal string ProcessingClaimSha256 { get; }
    internal string MissionBytesSha256 { get; }
    internal string SourceRevision { get; }
    internal string OperatorSourceRevision { get; }
    internal string Branch { get; }
    internal string WorktreePath { get; }
    internal string Adapter { get; }
    internal string ContextDigest { get; }
    internal string HistoricalExecutionOutcome => "UNKNOWN";
    internal bool CanonicalStorageAuthenticated => false;
    internal bool ExecutionReceiptHistoryAuthenticated => false;
    internal bool PhysicalContainmentProven => false;
    internal bool ProductionKeyAccessAllowed => false;
    internal bool ProcessingClaimQuarantineAuthority => false;
    internal bool SourceMutationAuthority => false;

    private ProspectiveProcessingClaimContext(string repository, string mission, int revision,
        string action, string lease, string claimDigest, string missionDigest, string source,
        string operatorSource, string branch, string worktree, string adapter)
    {
        Repository=repository; MissionId=mission; MissionRevision=revision;
        SourceExecutionId=action; SourceExecutionLeaseKey=lease;
        ProcessingClaimSha256=claimDigest; MissionBytesSha256=missionDigest;
        SourceRevision=source; OperatorSourceRevision=operatorSource;
        Branch=branch; WorktreePath=worktree; Adapter=adapter;
        // Fixed ordered length-delimited serialization. Exact captured mission
        // and claim hashes are included; parsed identity is not substituted for
        // the original bytes. Domain is distinct from witness/signature domains.
        ContextDigest=Hash(Utf8.GetBytes("stephanos.prospective-processing-claim-context.v1\0"+
            JsonSerializer.Serialize(new object[] {repository,mission,revision,action,lease,
                claimDigest,missionDigest,source,operatorSource,branch,worktree,adapter})));
    }

    internal static ProspectiveProcessingClaimContext Capture(ReadOnlySpan<byte> missionBytes,
        ReadOnlySpan<byte> processingClaimBytes, string expectedClaimSha256, string operatorSourceRevision)
    {
        if (missionBytes.Length is < 1 or > MaxInputBytes || processingClaimBytes.Length is < 1 or > MaxInputBytes)
            throw Held("INPUT_BOUND");
        if (!Hex(expectedClaimSha256,64) || !Hex(operatorSourceRevision,40)) throw Held("EXPECTED_DIGEST");
        // Capture once. Neither parsing nor returned digest retains caller memory.
        byte[] mission=missionBytes.ToArray(), claim=processingClaimBytes.ToArray();
        if (Hash(claim)!=expectedClaimSha256) throw Held("CLAIM_DIGEST_MISMATCH");
        try {
            using JsonDocument mdoc=JsonDocument.Parse(Utf8.GetString(mission),new(){MaxDepth=24});
            using JsonDocument cdoc=JsonDocument.Parse(Utf8.GetString(claim),new(){MaxDepth=24});
            Unique(mdoc.RootElement); Unique(cdoc.RootElement);
            JsonElement m=mdoc.RootElement,c=cdoc.RootElement;
            if (S(m,"schemaVersion")!="stephanos.mission-orchestrator.v1"
                || S(c,"schemaVersion")!="stephanos.mission-worker-queue-item.v1") throw Held("SCHEMA");
            string id=S(m,"missionId"), action=S(c,"actionId");
            Match mi=MissionPattern.Match(id), ai=ActionPattern.Match(action);
            if (!mi.Success || !ai.Success || mi.Groups[1].Value!=ai.Groups[1].Value
                || !int.TryParse(mi.Groups[1].Value,out int issue) || issue<=0
                || !int.TryParse(ai.Groups[2].Value,out int executionRevision)) throw Held("IDENTITY");
            int revision=N(m,"revision");
            if (revision!=executionRevision+1 || S(c,"missionId")!=id
                || S(m,"repository")!="Cheekyfellastef/stephan-os"
                || S(m,"currentPhase")!="AGENT_IMPLEMENTATION"
                || (m.TryGetProperty("cancelled",out JsonElement cancelled) && cancelled.ValueKind!=JsonValueKind.False))
                throw Held("MISSION_STATE");
            JsonElement dispatch=O(m,"dispatch"),git=O(m,"git"),store=O(m,"storeMetadata");
            string adapter=S(dispatch,"adapter");
            if (adapter is not ("foundry-forge" or "chatgpt-github" or "desktop-commander" or "sovereign-commander")
                || S(dispatch,"status")!="running" || S(c,"adapter")!=adapter
                || S(store,"lastEventId")!="pickup-"+action) throw Held("PICKUP_BINDING");
            JsonElement processed=store.GetProperty("processedEventIds");
            if (processed.ValueKind!=JsonValueKind.Array || processed.GetArrayLength()>2048
                || !processed.EnumerateArray().Any(x=>x.ValueKind==JsonValueKind.String && x.GetString()=="pickup-"+action))
                throw Held("PICKUP_EVENT");
            string branch=S(git,"branch"),worktree=S(git,"worktreePath");
            if (branch.Length is < 1 or > 200 || !Regex.IsMatch(branch,@"\A[A-Za-z0-9][A-Za-z0-9._/-]*\z")
                || branch.Contains("..") || branch.EndsWith('/') || branch.Contains("//")
                || !SafeWindowsPath(worktree)) throw Held("SOURCE_SCOPE");
            JsonElement grant=O(c,"actionGrant"),binding=O(c,"executionBinding"),payload=O(c,"payload");
            string source=S(binding,"sourceRevision"),lease=id+"-r"+executionRevision+"-lease";
            if (S(grant,"schemaVersion")!="stephanos.mission-worker-action-grant.v1"
                || S(binding,"schemaVersion")!="stephanos.mission-worker-queue-execution-binding.v1"
                || S(grant,"missionId")!=id || S(binding,"missionId")!=id || S(payload,"missionId")!=id
                || S(grant,"actionId")!=action || S(binding,"executionId")!=action || S(payload,"actionId")!=action
                || N(grant,"missionRevision")!=executionRevision || N(binding,"missionRevision")!=executionRevision
                || S(grant,"adapter")!=adapter || S(payload,"adapter")!=adapter
                || S(grant,"repository")!="Cheekyfellastef/stephan-os" || N(grant,"issueNumber")!=issue
                || S(grant,"branch")!=branch || S(payload,"repository")!="Cheekyfellastef/stephan-os"
                || S(payload,"schemaVersion")!="stephanos.mission-worker-action.v1"
                || S(payload,"branch")!=branch || S(payload,"worktreePath")!=worktree
                || S(grant,"grantId").Length is < 8 or > 200
                || S(grant,"grantId")!=S(binding,"grantId")
                || OptionalPr(grant)!=OptionalPr(binding) || OptionalHead(grant)!=OptionalHead(binding)
                || S(binding,"leaseKey")!=lease || S(binding,"repository")!="Cheekyfellastef/stephan-os"
                || N(binding,"issueNumber")!=issue || S(binding,"branch")!=branch
                || !Hex(source,40) || S(grant,"sourceRevision")!=source) throw Held("QUEUE_BINDING");
            return new("Cheekyfellastef/stephan-os",id,revision,action,lease,Hash(claim),Hash(mission),
                source,operatorSourceRevision,branch,worktree,adapter);
        }
        catch (InvalidDataException) { throw; }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException
            or FormatException or DecoderFallbackException or ArgumentException) { throw Held("MALFORMED_INPUT"); }
    }

    // Binds an unadopted proposed journal attempt, not a usable kernel capability.
    // The trusted commissioner must still authenticate storage, estate and context.
    internal byte[] RecoveryBindingDigest(Guid attempt)
    {
        if (attempt==Guid.Empty) throw Held("ATTEMPT_REQUIRED");
        return SHA256.HashData(Utf8.GetBytes("stephanos.prospective-recovery-attempt.v1\0"+
            ContextDigest+"\0"+attempt.ToString("D")));
    }
    private static void Unique(JsonElement value) {
        if (value.ValueKind==JsonValueKind.Object) {
            HashSet<string> seen=new(StringComparer.Ordinal);
            foreach(JsonProperty p in value.EnumerateObject()) {
                if(!seen.Add(p.Name)) throw Held("DUPLICATE_PROPERTY"); Unique(p.Value);
            }
        } else if(value.ValueKind==JsonValueKind.Array) foreach(JsonElement x in value.EnumerateArray()) Unique(x);
    }
    private static JsonElement O(JsonElement e,string key) {JsonElement v=e.GetProperty(key);return v.ValueKind==JsonValueKind.Object?v:throw Held("OBJECT");}
    private static string S(JsonElement e,string key) {JsonElement v=e.GetProperty(key);return v.ValueKind==JsonValueKind.String?v.GetString()!:throw Held("STRING");}
    private static int N(JsonElement e,string key) {JsonElement v=e.GetProperty(key);return v.ValueKind==JsonValueKind.Number&&v.TryGetInt32(out int n)?n:throw Held("INTEGER");}
    private static int OptionalPr(JsonElement e){JsonElement p=e.GetProperty("prNumber");if(p.ValueKind==JsonValueKind.Null)return 0;if(p.ValueKind==JsonValueKind.Number&&p.TryGetInt32(out int n)&&n>0)return n;throw Held("PR_IDENTITY");}
    private static string OptionalHead(JsonElement e){JsonElement p=e.GetProperty("headSha");if(p.ValueKind==JsonValueKind.Null)return "";if(p.ValueKind==JsonValueKind.String){string v=p.GetString()!;if(v==""||Hex(v,40))return v;}throw Held("HEAD_IDENTITY");}
    private static bool Hex(string v,int count)=>v is not null&&v.Length==count&&v.Any(c=>c!='0')&&v.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool SafeWindowsPath(string p) {
        if(p.Length is < 4 or > 240||!char.IsAsciiLetter(p[0])||p[1]!=':'||p[2]!='\\'
            ||p.Contains('/')||p.AsSpan(2).Contains(':')||p.Any(c=>c<0x20||c>=0x7f))return false;
        return p.Split('\\').Skip(1).All(s=>s.Length>0&&s is not "." and not ".."
            &&!s.EndsWith('.')&&!s.EndsWith(' ')&&!s.Any(c=>"<>\"|?*".Contains(c)));
    }
    private static InvalidDataException Held(string code)=>new("PROSPECTIVE_CLAIM_CONTEXT_"+code);
}
