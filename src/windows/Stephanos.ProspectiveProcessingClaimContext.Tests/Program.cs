using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Stephanos.OriginalR7CustodyWitness;

static class Tests {
    static int count;
    static string Hash(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    static void OwnedFixturePath(string path){string full=Path.GetFullPath(path),parent=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;if(!full.StartsWith(parent,StringComparison.OrdinalIgnoreCase)||!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(full),@"\Aprospective-native-scope-[a-f0-9]{32}(?:-moved)?\z"))throw new Exception("FIXTURE_PATH_UNSAFE");}
    static void Check(bool v,string n){count++;if(!v)throw new Exception(n);}
    static byte[] Wire(JsonNode n)=>Encoding.UTF8.GetBytes(n.ToJsonString());
    static (JsonNode m,JsonNode c) Fixture(int issue=1574,int r=5) {
        string id=$"critical-{issue}-elastic-goal",action=$"{id}-r{r}-012345abcdef",source=new('a',40);
        JsonObject m=new(){["schemaVersion"]="stephanos.mission-orchestrator.v1",["missionId"]=id,["revision"]=r+1,["repository"]="Cheekyfellastef/stephan-os",["currentPhase"]="AGENT_IMPLEMENTATION",["dispatch"]=new JsonObject{["adapter"]="foundry-forge",["status"]="running"},["git"]=new JsonObject{["branch"]=$"openclaw/elastic-goal-{issue}",["worktreePath"]=$@"C:\owned\critical-{issue}-elastic-goal"},["storeMetadata"]=new JsonObject{["lastEventId"]="pickup-"+action,["processedEventIds"]=new JsonArray("pickup-"+action)}};
        JsonObject c=new(){["schemaVersion"]="stephanos.mission-worker-queue-item.v1",["missionId"]=id,["actionId"]=action,["adapter"]="foundry-forge",["actionGrant"]=new JsonObject{["schemaVersion"]="stephanos.mission-worker-action-grant.v1",["missionId"]=id,["actionId"]=action,["missionRevision"]=r,["adapter"]="foundry-forge",["sourceRevision"]=source},["executionBinding"]=new JsonObject{["schemaVersion"]="stephanos.mission-worker-queue-execution-binding.v1",["executionId"]=action,["leaseKey"]=$"{id}-r{r}-lease",["missionId"]=id,["missionRevision"]=r,["repository"]="Cheekyfellastef/stephan-os",["issueNumber"]=issue,["branch"]=$"openclaw/elastic-goal-{issue}",["sourceRevision"]=source},["payload"]=new JsonObject{["missionId"]=id,["actionId"]=action,["adapter"]="foundry-forge"}};
        c["actionGrant"]!["repository"]="Cheekyfellastef/stephan-os";c["actionGrant"]!["issueNumber"]=issue;c["actionGrant"]!["branch"]=$"openclaw/elastic-goal-{issue}";
        c["actionGrant"]!["grantId"]="grant-"+action;c["executionBinding"]!["grantId"]="grant-"+action;
        c["payload"]!["schemaVersion"]="stephanos.mission-worker-action.v1";c["payload"]!["repository"]="Cheekyfellastef/stephan-os";c["payload"]!["branch"]=$"openclaw/elastic-goal-{issue}";c["payload"]!["worktreePath"]=$@"C:\owned\critical-{issue}-elastic-goal";
        c["actionGrant"]!["prNumber"]=null;c["executionBinding"]!["prNumber"]=null;c["actionGrant"]!["headSha"]=null;c["executionBinding"]!["headSha"]="";return(m,c);
    }
    static ProspectiveProcessingClaimContext Capture(JsonNode m,JsonNode c)=>ProspectiveProcessingClaimContext.Capture(Wire(m),Wire(c),Hash(Wire(c)),new string('b',40));
    static void Refuse(byte[] m,byte[] c,string label,string? digest=null){try{ProspectiveProcessingClaimContext.Capture(m,c,digest??Hash(c),new string('b',40));throw new Exception("ACCEPTED_"+label);}catch(InvalidDataException){count++;}}
    public static int Main(string[] args){try{
        if(args.Length==2&&args[0]=="--inspect-owned-input-bundle"){
            JsonNode n=JsonNode.Parse(File.ReadAllText(args[1]))!;
            byte[] capturedMission=Convert.FromBase64String(n["missionBase64"]!.GetValue<string>()),capturedClaim=Convert.FromBase64String(n["claimBase64"]!.GetValue<string>());
            var observed=ProspectiveProcessingClaimContext.Capture(capturedMission,capturedClaim,n["expectedClaimSha256"]!.GetValue<string>(),n["operatorSourceRevision"]!.GetValue<string>());
            using var nativeObserved=ProspectiveNativeScopeCapture.Open(observed);nativeObserved.VerifyRetainedIdentity();
            Console.WriteLine(JsonSerializer.Serialize(new{nativeObserved.NativeIdentityDigest,nativeObserved.ScopeBindingDigest,nativeObserved.ChildTreeWriteExclusionProven,nativeObserved.ProductionSigningAuthorized,observed.MissionId,observed.MissionRevision,observed.SourceExecutionId,observed.ProcessingClaimSha256,observed.MissionBytesSha256,observed.ContextDigest,observed.SourceRevision,observed.OperatorSourceRevision,observed.HistoricalExecutionOutcome,observed.CanonicalStorageAuthenticated,observed.ExecutionReceiptHistoryAuthenticated,observed.PhysicalContainmentProven,observed.ProductionKeyAccessAllowed,observed.ProcessingClaimQuarantineAuthority,observed.SourceMutationAuthority}));return 0;
        }
        if(args.Length!=0)return 2;
        var(m,c)=Fixture();var context=Capture(m,c);string digest=context.ContextDigest;
        Check(context.MissionId=="critical-1574-elastic-goal"&&context.MissionRevision==6,"CURRENT_1574");
        Check(!context.CanonicalStorageAuthenticated&&!context.ExecutionReceiptHistoryAuthenticated&&!context.PhysicalContainmentProven&&!context.ProductionKeyAccessAllowed&&!context.ProcessingClaimQuarantineAuthority&&!context.SourceMutationAuthority&&context.HistoricalExecutionOutcome=="UNKNOWN","NO_AUTHORITY");
        byte[] original=Wire(c),mc=Wire(m);var captured=ProspectiveProcessingClaimContext.Capture(mc,original,Hash(original),new string('b',40));Array.Fill(original,(byte)0);Array.Fill(mc,(byte)0);Check(captured.ContextDigest==digest,"CAPTURE_IMMUTABLE");
        Check(Capture(m,c).ContextDigest==digest,"DETERMINISTIC");
        var(m2,c2)=Fixture(1800,8);Check(Capture(m2,c2).ContextDigest!=digest,"OTHER_CURRENT_MISSION");Refuse(Wire(m2),Wire(c),"CROSS_MISSION");
        Guid a=Guid.NewGuid(),b=Guid.NewGuid();Check(!context.RecoveryBindingDigest(a).SequenceEqual(context.RecoveryBindingDigest(b)),"ATTEMPT_BOUND");byte[] result=context.RecoveryBindingDigest(a);result[0]^=255;Check(!result.SequenceEqual(context.RecoveryBindingDigest(a)),"NO_RETURN_ALIAS");try{context.RecoveryBindingDigest(Guid.Empty);throw new Exception("EMPTY_ATTEMPT_ACCEPTED");}catch(InvalidDataException){count++;}
        foreach(string p in new[]{"missionId","actionId","adapter","schemaVersion"}){var cc=c.DeepClone();cc[p]="bad";Refuse(Wire(m),Wire(cc),p);}
        foreach(string group in new[]{"actionGrant","executionBinding","payload"})foreach(string field in ((JsonObject)c[group]!).Select(x=>x.Key).ToArray()){var cc=c.DeepClone();cc[group]![field]=field is "missionRevision" or "issueNumber"?JsonValue.Create(999):JsonValue.Create("bad");Refuse(Wire(m),Wire(cc),group+field);}
        foreach(string field in new[]{"missionId","repository","schemaVersion","currentPhase","revision"}){var mm=m.DeepClone();mm[field]=field=="revision"?JsonValue.Create(99):JsonValue.Create("bad");Refuse(Wire(mm),Wire(c),field);}
        foreach(string p in new[]{@"C:\owned\..\escape",@"C:\owned\leaf.",@"C:\owned\leaf ",@"\\server\share",@"C:\owned\file:ads",@"C:\owned\\leaf",@"C:\owned\*"}){var mm=m.DeepClone();mm["git"]!["worktreePath"]=p;Refuse(Wire(mm),Wire(c),"PATH");}
        var cancelled=m.DeepClone();cancelled["cancelled"]=true;Refuse(Wire(cancelled),Wire(c),"CANCELLED");
        var(retiredMission,retiredClaim)=Fixture(2962,7);retiredMission["currentPhase"]="CANCELLED";Refuse(Wire(retiredMission),Wire(retiredClaim),"RETIRED_R7_NOT_CURRENT");
        var stale=m.DeepClone();stale["storeMetadata"]!["processedEventIds"]=new JsonArray();Refuse(Wire(stale),Wire(c),"UNCONSUMED_PICKUP");
        Refuse(Wire(m),Wire(c),"DIGEST",new string('c',64));
        string cw=Encoding.UTF8.GetString(Wire(c));Refuse(Wire(m),Encoding.UTF8.GetBytes(cw.Insert(1,"\"actionId\":\"bad\",")),"DUPLICATE_TOP");
        Refuse(Wire(m),Encoding.UTF8.GetBytes(cw.Replace("\"adapter\":\"foundry-forge\"","\"adapter\":\"bad\",\"adapter\":\"foundry-forge\"")),"DUPLICATE_NESTED");
        Refuse(Wire(m),new byte[]{255},"INVALID_UTF8");Refuse(new byte[ProspectiveProcessingClaimContext.MaxInputBytes+1],Wire(c),"BOUND");
        byte[] valid=Wire(c);for(int i=0;i<valid.Length;i++)Refuse(Wire(m),valid.AsSpan(0,i).ToArray(),"TORN");
        for(int i=1;i<=100;i++){var mm=m.DeepClone();mm["git"]!["worktreePath"]=$@"C:\owned\scope{i}";var cc=c.DeepClone();cc["payload"]!["worktreePath"]=mm["git"]!["worktreePath"]!.GetValue<string>();Check(Capture(mm,cc).ContextDigest!=digest,"WORKTREE_BOUND");}
        string fixtureRoot=Path.Combine(Path.GetTempPath(),"prospective-native-scope-"+Guid.NewGuid().ToString("N"));OwnedFixturePath(fixtureRoot);OwnedFixturePath(fixtureRoot+"-moved");Directory.CreateDirectory(fixtureRoot);
        try {
            var owned=m.DeepClone();owned["git"]!["worktreePath"]=fixtureRoot;var scopedClaim=c.DeepClone();scopedClaim["payload"]!["worktreePath"]=fixtureRoot;var scopedContext=Capture(owned,scopedClaim);
            using(var native=ProspectiveNativeScopeCapture.Open(scopedContext)){
                native.VerifyRetainedIdentity();Check(native.NativeIdentityDigest.Length==64&&native.ScopeBindingDigest.Length==64,"NATIVE_NTFS_IDENTITY");
                Check(!native.ChildTreeWriteExclusionProven&&!native.ProductionSigningAuthorized&&!native.ProcessingClaimQuarantineAuthority,"NATIVE_NOT_AUTHORITY");
                string child=Path.Combine(fixtureRoot,"owned-child.txt");File.WriteAllText(child,"child writes still possible");Check(File.ReadAllText(child)=="child writes still possible","DIRECTORY_GUARD_DOES_NOT_EXCLUDE_CHILD_WRITES");
                bool refused=false;try{Directory.Move(fixtureRoot,fixtureRoot+"-moved");}catch(IOException){refused=true;}Check(refused,"ROOT_RENAME_DENIED_WHILE_RETAINED");
                string other=Path.Combine(fixtureRoot,"other");Directory.CreateDirectory(other);var otherM=owned.DeepClone();otherM["git"]!["worktreePath"]=other;var otherC=scopedClaim.DeepClone();otherC["payload"]!["worktreePath"]=other;using var second=ProspectiveNativeScopeCapture.Open(Capture(otherM,otherC));Check(second.NativeIdentityDigest!=native.NativeIdentityDigest,"DISTINCT_NATIVE_OBJECT");
            }
            Directory.Move(fixtureRoot,fixtureRoot+"-moved");Directory.Move(fixtureRoot+"-moved",fixtureRoot);Check(true,"ROOT_RENAME_AFTER_CLOSE");
            string file=Path.Combine(fixtureRoot,"owned-child.txt");var fileM=owned.DeepClone();fileM["git"]!["worktreePath"]=file;try{var fileC=scopedClaim.DeepClone();fileC["payload"]!["worktreePath"]=file;using var bad=ProspectiveNativeScopeCapture.Open(Capture(fileM,fileC));throw new Exception("FILE_AS_ROOT_ACCEPTED");}catch(IOException){count++;}
            var closed=ProspectiveNativeScopeCapture.Open(scopedContext);closed.Dispose();try{closed.VerifyRetainedIdentity();throw new Exception("CLOSED_CAPTURE_ACCEPTED");}catch(ObjectDisposedException){count++;}
        }finally{OwnedFixturePath(fixtureRoot);if(Directory.Exists(fixtureRoot)){if((File.GetAttributes(fixtureRoot)&FileAttributes.ReparsePoint)!=0)throw new Exception("FIXTURE_REPARSE_CLEANUP_REFUSED");Directory.Delete(fixtureRoot,true);}}
        Console.WriteLine("PROSPECTIVE_CLAIM_CONTEXT_ASSERTIONS_PASSED="+count);return 0;
    }catch(Exception e){Console.Error.WriteLine("PROSPECTIVE_CLAIM_CONTEXT_TEST_FAILED="+e.GetType().Name+":"+e.Message);return 1;}}
}
