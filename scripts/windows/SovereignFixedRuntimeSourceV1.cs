// Fixed source-task adapter of the existing canonical Mission Worker.
namespace Stephanos.Sovereign {
  using System;
  using System.IO;
  using System.Text;
  using System.Text.RegularExpressions;
  using System.Web.Script.Serialization;
  using System.Collections.Generic;

  sealed class FixedRuntimeSourceBindingV1 {
    internal string ActionId,MissionId,ClaimSha256,ClaimPath;
  }
  public static partial class CoreJobCustodyV1 {
    const int RuntimeSourceDeadlineMsV1=1800000;
    const string RuntimeWorkerWorkspaceV1=@"C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace";
    const string RuntimeWorkerQueueV1=@"C:\Users\Stephan Callear\Documents\OpenClaw-Standalone\mission-runner\orchestrator\worker-queue";
    static Dictionary<string,object> RuntimeReadObjectV1(string path,int maximum,FixedRuntimeIdentityPinsV1 pins) {
      RuntimePinParentsV1(path,pins);
      byte[] bytes=RuntimeReadPinnedV1(path,maximum,pins);
      return RuntimeObjectV1(new JavaScriptSerializer {MaxJsonLength=maximum,RecursionLimit=64}
        .DeserializeObject(new UTF8Encoding(false,true).GetString(bytes)));
    }
    static void RuntimeEqualV1(Dictionary<string,object> row,string key,string expected) {
      if(RuntimeStringV1(row,key)!=expected) throw new InvalidOperationException("RUNTIME_SOURCE_IDENTITY_UNPROVEN");
    }
    static void RuntimeFalseV1(Dictionary<string,object> row,string key) {
      object value;
      if(!row.TryGetValue(key,out value) || !(value is bool) || (bool)value)
        throw new InvalidOperationException("RUNTIME_SOURCE_AUTHORITY_UNPROVEN");
    }
    static FixedRuntimeSourceBindingV1 RuntimeSourceBindingV1(FixedRuntimeRequestV1 frame,
      FixedRuntimeIdentityPinsV1 pins,long ownerBirth) {
      byte[] body=Convert.FromBase64String(frame.TaskFrameBase64);
      var parser=new JavaScriptSerializer {MaxJsonLength=16384,RecursionLimit=4};
      var meta=RuntimeObjectV1(parser.DeserializeObject(new UTF8Encoding(false,true).GetString(body)));
      if(meta.Count!=3) throw new InvalidOperationException("RUNTIME_SOURCE_FRAME_SHAPE_UNPROVEN");
      var binding=new FixedRuntimeSourceBindingV1 {ActionId=RuntimeStringV1(meta,"actionId"),
        MissionId=RuntimeStringV1(meta,"missionId"),ClaimSha256=RuntimeStringV1(meta,"claimSha256")};
      foreach(string id in new string[]{binding.ActionId,binding.MissionId})
        if(!Regex.IsMatch(id,@"^[a-z0-9][a-z0-9._-]{0,127}$"))
          throw new InvalidOperationException("RUNTIME_SOURCE_TASK_ID_UNPROVEN");
      if(!RuntimeHexV1(binding.ClaimSha256,64)) throw new InvalidOperationException("RUNTIME_SOURCE_CLAIM_DIGEST_UNPROVEN");
      // Snapshot pin is deliberately short-lived: heartbeat atomic publication
      // must continue while the original worker owns a long source task.
      Dictionary<string,object> heartbeat;
      using(var snapshot=new FixedRuntimeIdentityPinsV1()) {
        heartbeat=RuntimeReadObjectV1(Path.Combine(RuntimeWorkerWorkspaceV1,@"status\mission-orchestrator-worker-heartbeat.json"),16384,snapshot);
      }
      RuntimeEqualV1(heartbeat,"schemaVersion","stephanos.mission-orchestrator-worker-heartbeat.v1");
      RuntimeEqualV1(heartbeat,"repositoryRoot",RuntimeSourceRootV1);
      RuntimeEqualV1(heartbeat,"headSha",pins.SourceHead); RuntimeEqualV1(heartbeat,"branch","main");
      RuntimeEqualV1(heartbeat,"taskName","Stephanos Mission Orchestrator Worker");
      RuntimeEqualV1(heartbeat,"activeTaskId",binding.ActionId);
      if(RuntimeIntegerV1(heartbeat,"pid")!=frame.OwnerPid ||
        RuntimeInstantV1(RuntimeStringV1(heartbeat,"workerStartedAtUtc")).ToFileTimeUtc()!=ownerBirth)
        throw new InvalidOperationException("RUNTIME_SOURCE_WORKER_BIRTH_UNPROVEN");
      DateTime observed=RuntimeInstantV1(RuntimeStringV1(heartbeat,"timestampUtc")),now=DateTime.UtcNow;
      if(observed>now || (now-observed).TotalMilliseconds>120000)
        throw new InvalidOperationException("RUNTIME_SOURCE_WORKER_HEARTBEAT_STALE");
      string launchId=RuntimeStringV1(heartbeat,"launchIdentityId");
      if(!RuntimeHexV1(launchId,64)) throw new InvalidOperationException("RUNTIME_SOURCE_WORKER_LAUNCH_UNPROVEN");
      var launch=RuntimeReadObjectV1(Path.Combine(RuntimeWorkerWorkspaceV1,"status",
        "mission-orchestrator-worker-launch-identity-"+launchId+".json"),8192,pins);
      RuntimeEqualV1(launch,"schemaVersion","stephanos.mission-worker-launch-identity.v1");
      RuntimeEqualV1(launch,"launchIdentityId",launchId);
      RuntimeEqualV1(launch,"repositoryRoot",RuntimeSourceRootV1);
      RuntimeEqualV1(launch,"branch","main"); RuntimeEqualV1(launch,"headSha",pins.SourceHead);
      RuntimeEqualV1(launch,"taskName","Stephanos Mission Orchestrator Worker");
      RuntimeEqualV1(launch,"canonicalNode",@"C:\Program Files\nodejs\node.exe");
      RuntimeEqualV1(launch,"canonicalWorkerScript",Path.Combine(RuntimeSourceRootV1,@"scripts\mission-orchestrator-worker-supervised.mjs"));
      string kind=RuntimeStringV1(launch,"launchKind");
      if((kind!="ordinary" && kind!="guarded-restart") ||
        (kind=="ordinary" && RuntimeStringV1(launch,"restartInvocationId")!="") ||
        (kind=="guarded-restart" && RuntimeStringV1(launch,"restartInvocationId")!=launchId) || RuntimeIntegerV1(launch,"workerPid")!=frame.OwnerPid ||
        RuntimeInstantV1(RuntimeStringV1(launch,"workerStartedAtUtc")).ToFileTimeUtc()!=ownerBirth)
        throw new InvalidOperationException("RUNTIME_SOURCE_WORKER_LAUNCH_UNPROVEN");
      binding.ClaimPath=Path.Combine(RuntimeWorkerQueueV1,"foundry-forge","processing",binding.ActionId+".json");
      RuntimePinParentsV1(binding.ClaimPath,pins);
      byte[] claimBytes=RuntimeReadPinnedV1(binding.ClaimPath,131072,pins);
      if(RuntimeHashV1(claimBytes)!=binding.ClaimSha256)
        throw new InvalidOperationException("RUNTIME_SOURCE_ORIGINAL_CLAIM_CHANGED");
      var claim=RuntimeObjectV1(new JavaScriptSerializer {MaxJsonLength=131072,RecursionLimit=64}
        .DeserializeObject(new UTF8Encoding(false,true).GetString(claimBytes)));
      RuntimeEqualV1(claim,"schemaVersion","stephanos.mission-worker-queue-item.v1");
      RuntimeEqualV1(claim,"adapter","foundry-forge");
      RuntimeEqualV1(claim,"missionId",binding.MissionId);RuntimeEqualV1(claim,"actionId",binding.ActionId);
      object value;
      if(!claim.TryGetValue("payload",out value)) throw new InvalidOperationException("RUNTIME_SOURCE_PAYLOAD_UNPROVEN");
      var action=RuntimeObjectV1(value);
      if(!claim.TryGetValue("actionGrant",out value)) throw new InvalidOperationException("RUNTIME_SOURCE_GRANT_UNPROVEN");
      var grant=RuntimeObjectV1(value);
      foreach(var row in new Dictionary<string,object>[] {action,grant}) {
        RuntimeEqualV1(row,"adapter","foundry-forge");RuntimeEqualV1(row,"actionKind","agent-handoff");
        RuntimeEqualV1(row,"missionId",binding.MissionId);RuntimeEqualV1(row,"actionId",binding.ActionId);
        if(!String.Equals(RuntimeStringV1(row,"repository"),"Cheekyfellastef/stephan-os",StringComparison.OrdinalIgnoreCase))
          throw new InvalidOperationException("RUNTIME_SOURCE_REPOSITORY_UNPROVEN");
      }
      RuntimeEqualV1(grant,"schemaVersion","stephanos.mission-worker-action-grant.v1");
      RuntimeEqualV1(grant,"capacityRoute","FOUNDRY_FORGE");
      RuntimeEqualV1(grant,"workerId","stephanos-forge-lifeboat-local");
      if(RuntimeIntegerV1(grant,"boundedActionCount")!=1 ||
        !RuntimeHexV1(RuntimeStringV1(grant,"sourceRevision"),40) ||
        RuntimeStringV1(action,"branch")!=RuntimeStringV1(grant,"branch"))
        throw new InvalidOperationException("RUNTIME_SOURCE_GRANT_UNPROVEN");
      RuntimeFalseV1(grant,"mergeAuthority");RuntimeFalseV1(grant,"leaseSeizureAllowed");
      return binding;
    }
  }
}
