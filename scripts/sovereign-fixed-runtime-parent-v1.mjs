// Private adapter of the existing Commander/worker. No public command surface.
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {inspectStephanosNativeCapacityGamingAdmissionV1} from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
import {createBattleBridgeMinimalChildEnvironment} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const ROOT = 'C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1';
const SOURCE = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WORKSPACE='C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace';
const resourceAllowed=()=>{try{return inspectStephanosNativeCapacityGamingAdmissionV1({workspaceRoot:WORKSPACE,repoRoot:SOURCE}).ok===true;}catch{return false;}};
const SHA = /^[a-f0-9]{64}$/;
const proof = new WeakMap();
const qualifications = new WeakMap();
const exclusions = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const denied = (reason,binding) => {const result=Object.freeze({ok:false, reason, executionCustodyReleased:true,
  taskRootCreated:false, taskExecuted:false, dispatchAllowed:false});if(binding)exclusions.set(result,Object.freeze({...binding}));return result;};
export function consumeFixedRuntimePrelaunchExclusionV1(result,binding) {
  const stored=exclusions.get(result);exclusions.delete(result);
  return Boolean(stored && binding && ['requestId','sourceHead','custodyRecordSha256','nativeRecordId','actionId','missionId','claimSha256'].every(k=>stored[k]===binding[k]));
}
function freezeTree(value) {
  if(value && typeof value==='object' && !Object.isFrozen(value)){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}
  return value;
}
function boundedFile(path, maximum) {
  const metadata=lstatSync(path);
  if(!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink!==1 || metadata.size>maximum)
    throw new Error('FIXED_RUNTIME_FILE_UNPROVEN');
  return readFileSync(path);
}
function exactHead() {
  if(boundedFile(join(SOURCE,'.git','HEAD'),256).toString('utf8').trim()!=='ref: refs/heads/main')
    throw new Error('FIXED_RUNTIME_CANONICAL_BRANCH_REQUIRED');
  const head=boundedFile(join(SOURCE,'.git','refs','heads','main'),256).toString('utf8').trim();
  if(!/^[a-f0-9]{40}$/.test(head)) throw new Error('FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN');
  return head;
}
function protectedInstallation() {
  const head=exactHead(), directory=join(ROOT,head), helper=join(directory,'host.exe');
  for(let path=directory;;path=dirname(path)) {
    const row=lstatSync(path);
    if(!row.isDirectory() || row.isSymbolicLink()) throw new Error('FIXED_RUNTIME_PARENT_REDIRECTION');
    if(dirname(path)===path) break;
  }
  // Fixed paths only. Verify OS-owned write protection BEFORE executing the PE.
  // Source helper later holds the physical pins and checks complete source/boot identity.
  const script=String.raw`$ErrorActionPreference='Stop'
$paths=@('C:\','C:\Program Files','C:\Program Files\Stephanos','C:\Program Files\Stephanos\SovereignFixedRuntimeV1','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__\host.exe','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__\pending.json')
foreach($path in $paths){
 $acl=if([IO.Directory]::Exists($path)){[IO.Directory]::GetAccessControl($path)}else{[IO.File]::GetAccessControl($path)}
 $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
 $ancestor=$path -ceq 'C:\' -or $path -ceq 'C:\Program Files'
 $allowed=@('S-1-5-18','S-1-5-32-544')
 if($ancestor){$allowed+= 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'}
 $mask=if($ancestor){0x500D0150}else{0x500D0156}
 if($owner -cnotin $allowed){throw 'FIXED_RUNTIME_OWNER_UNPROVEN'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0 -and $ancestor){continue}
  if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
   (($rule.FileSystemRights -band $mask) -ne 0) -and
   $rule.IdentityReference.Value -cnotin $allowed){throw 'FIXED_RUNTIME_WRITE_AUTHORITY_UNPROVEN'}
 }
}
[Console]::Write('FIXED_RUNTIME_PROTECTED_V1')`.replaceAll('__HEAD__',head);
  const acl=spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:4096,
      env:createBattleBridgeMinimalChildEnvironment()});
  if(acl.error || acl.status!==0 || acl.stdout!=='FIXED_RUNTIME_PROTECTED_V1')
    throw new Error('FIXED_RUNTIME_PROTECTION_UNPROVEN');
  const pending=JSON.parse(boundedFile(join(directory,'pending.json'),32768));
  const helperSha256=digest(boundedFile(helper,2097152));
  if(pending.SchemaVersion!=='stephanos.fixed-runtime-pending.v1' || pending.SourceHead!==head ||
      pending.HelperSha256!==helperSha256 || !SHA.test(pending.ManifestSha256))
    throw new Error('FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
  return Object.freeze({head,helper,helperSha256,manifestSha256:pending.ManifestSha256});
}
function singleReport(stdout,marker,maximum=262144) {
  if(Buffer.byteLength(stdout)>maximum) throw new Error('FIXED_RUNTIME_REPORT_BOUND');
  const lines=stdout.trim().split(/\r?\n/);
  if(lines.length!==1 || !lines[0].startsWith(marker)) throw new Error('FIXED_RUNTIME_REPORT_SHAPE');
  return JSON.parse(lines[0].slice(marker.length));
}
export function inspectFixedRuntimeQualificationV1() {
  if(process.platform!=='win32') return denied('FIXED_RUNTIME_WINDOWS_REQUIRED');
  try {
    if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    const installation=protectedInstallation();
    const observed=spawnSync(installation.helper,['--inspect-v1'],{shell:false,windowsHide:true,
      timeout:15000,maxBuffer:32768,encoding:'utf8',env:createBattleBridgeMinimalChildEnvironment()});
    if(observed.error || observed.status!==0) return denied('FIXED_RUNTIME_IDENTITY_INSPECTION_UNPROVEN');
    const row=singleReport(observed.stdout,'SOVEREIGN_RUNTIME_INVENTORY_V1=',32768);
    if(row.SchemaVersion!=='stephanos.fixed-runtime-inventory.v1' || row.Ok!==true ||
      row.SourceHead!==installation.head || row.HelperSha256!==installation.helperSha256 ||
      row.ManifestSha256!==installation.manifestSha256 || row.AuthenticatedCustodyIdle!==true ||
      row.RuntimeActivationGranted!==false || row.MutationAttempted!==false ||
      !Array.isArray(row.Profiles) || row.Profiles.some(p=>!['MAINTENANCE_GOAL_BUILDER_V1','SOURCE_TASK_V1'].includes(p)) ||
      !SHA.test(row.CustodyRecordSha256??'') || !Number.isSafeInteger(row.NativeRecordId) || row.NativeRecordId<1)
      return denied('FIXED_RUNTIME_AUTHENTICATED_IDLE_UNPROVEN');
    if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    const qualified=Object.freeze({ok:true,sourceHead:installation.head,
      profiles:Object.freeze([...row.Profiles]), observedAtUtc:new Date().toISOString(),
      bootStartedAtUtc:row.BootStartedAtUtc,custodyRecordSha256:row.CustodyRecordSha256,
      nativeRecordId:row.NativeRecordId,dispatchAllowed:true});
    qualifications.set(qualified,{installation,custodyRecordSha256:row.CustodyRecordSha256,nativeRecordId:row.NativeRecordId,expires:performance.now()+5000});
    return qualified;
  } catch(error) { return denied(/^[A-Z0-9_]{1,96}$/.test(error.message)?error.message:'FIXED_RUNTIME_QUALIFICATION_UNPROVEN'); }
}
// Pure validation cannot mint provenance. Only the actual fixed private transport
// below can put an original object into proof; JSON roundtrips/copies never inherit it.
export function consumeFixedRuntimeTerminalProvenanceV1(result,binding) {
  const stored=proof.get(result);
  proof.delete(result);
  return Boolean(stored && binding && stored.requestId===binding.requestId &&
    stored.custodyRecordSha256===binding.custodyRecordSha256 &&
    stored.nativeRecordId===binding.nativeRecordId && stored.sourceHead===binding.sourceHead &&
    ['actionId','missionId','claimSha256'].every(key=>stored[key]===binding[key]) &&
    result.executionCustodyReleased===true);
}
export function executeFixedMaintenanceRuntimeV1(qualification,binding,options) {
  return executeFixedRuntimeV1(qualification,binding,'MAINTENANCE_GOAL_BUILDER_V1',options);
}
export function executeFixedSourceTaskRuntimeV1(qualification,binding,options) {
  return executeFixedRuntimeV1(qualification,binding,'SOURCE_TASK_V1',options);
}
async function executeFixedRuntimeV1(qualification,inputBinding,profile,{signal,onPrepared}={}) {
  const binding=Object.freeze(Object.fromEntries(['requestId','sourceHead','custodyRecordSha256','nativeRecordId','actionId','missionId','claimSha256'].map(key=>[key,inputBinding?.[key]])));
  if(Object.values(binding).some(value=>value!==undefined && typeof value!=='string' && typeof value!=='number'))
    return denied('FIXED_RUNTIME_PRIMITIVE_BINDING_REQUIRED',binding);
  const qualified=qualifications.get(qualification);
  // One use even if admission fails. No caller-qualified boolean or fake transport.
  qualifications.delete(qualification);
  if(!qualified || performance.now()>qualified.expires) return denied('FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED',binding);
  if(!/^[a-z0-9][a-z0-9._-]{7,79}$/.test(binding?.requestId??'') ||
    binding.sourceHead!==qualified.installation.head || !SHA.test(binding.custodyRecordSha256??'') ||
    !Number.isSafeInteger(binding.nativeRecordId) || binding.nativeRecordId<1 ||
    typeof onPrepared!=='function' || signal?.aborted)
    return denied('FIXED_RUNTIME_EXACT_RESERVATION_REQUIRED',binding);
  if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',binding);
  if(!qualification.profiles.includes(profile)) return denied('FIXED_RUNTIME_PROFILE_NOT_COMPILED',binding);
  const source=profile==='SOURCE_TASK_V1';
  if(source && (!['actionId','missionId'].every(k=>/^[a-z0-9][a-z0-9._-]{0,127}$/.test(binding[k]??'')) ||
    !SHA.test(binding.claimSha256??'') || binding.custodyRecordSha256!==qualified.custodyRecordSha256 ||
    binding.nativeRecordId!==qualified.nativeRecordId)) return denied('FIXED_RUNTIME_ORIGINAL_SOURCE_CLAIM_REQUIRED',binding);
  const taskBody=source?Buffer.from(JSON.stringify({actionId:binding.actionId,missionId:binding.missionId,claimSha256:binding.claimSha256})):Buffer.alloc(0);
  const frame={SchemaVersion:'stephanos.fixed-runtime-request.v1',RequestId:binding.requestId,
    Profile:profile,RuntimeSourceHead:binding.sourceHead,OwnerPid:process.pid,
    TaskFrameBase64:taskBody.toString('base64'),TaskBindingSha256:digest(taskBody)};
  const raw=JSON.stringify(frame), frameSha256=digest(raw);
  return new Promise(resolve=>{
    let child,buffer='',terminal=null,prepared=null,protocolFault=false,cancelRequested=false,closed=false,timeout,resourceTimer,bindingPending=Promise.resolve();
    const fail=()=>{protocolFault=true;try{child?.stdin.end('CANCEL\n');}catch{}};
    const cancel=()=>{if(cancelRequested)return;cancelRequested=true;try{child?.stdin.end('CANCEL\n');}catch{}};
    try {
      child=spawn(qualified.installation.helper,[],{shell:false,windowsHide:true,
        stdio:['pipe','pipe','pipe'],env:createBattleBridgeMinimalChildEnvironment()});
      timeout=setTimeout(()=>{cancel();try{child.kill();}catch{}},source?1815000:160000);
      // Task-local cancellation of the existing Job, using the SAME canonical
      // governor reader; this is not another resource controller or GPU proof.
      resourceTimer=setInterval(()=>{if(!resourceAllowed())cancel();},1000);
      resourceTimer.unref?.();
      signal?.addEventListener('abort',cancel,{once:true});
      child.stdin.on('error',()=>{cancelRequested=true;}); child.stderr.on('data',fail);
      child.on('error',fail);
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        if(Buffer.byteLength(buffer)>300000){fail();return;}
        while(buffer.includes('\n')) {
          const end=buffer.indexOf('\n'),line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          try {
            if(line.startsWith('SOVEREIGN_RUNTIME_PREPARED_V1=')) {
              if(prepared || terminal) throw new Error('DUPLICATE_PREPARED');
              prepared=JSON.parse(line.slice('SOVEREIGN_RUNTIME_PREPARED_V1='.length));
              if(prepared.SchemaVersion!=='stephanos.fixed-runtime-prepared.v1' ||
                prepared.RequestId!==frame.RequestId || prepared.FrameSha256!==frameSha256 ||
                prepared.Profile!==frame.Profile || prepared.OwnerPid!==process.pid ||
                prepared.RuntimeSourceHead!==frame.RuntimeSourceHead ||
                prepared.HelperSha256!==qualified.installation.helperSha256 ||
                prepared.ManifestSha256!==qualified.installation.manifestSha256 ||
                prepared.CustodyRecordSha256!==binding.custodyRecordSha256 ||
                prepared.NativeRecordId!==binding.nativeRecordId ||
                !Number.isSafeInteger(prepared.RootPid) || prepared.RootPid<1 ||
                !Number.isFinite(Date.parse(prepared.RootCreatedAtUtc)) ||
                !Number.isFinite(Date.parse(prepared.OwnerCreatedAtUtc))) throw new Error('PREPARED_UNBOUND');
              bindingPending=Promise.resolve().then(()=>onPrepared(Object.freeze({...prepared}))).then(accepted=>{
                if(accepted!==true || cancelRequested || closed || signal?.aborted){
                  if(!closed)cancel();else cancelRequested=true;return;
                }
                if(protocolFault)return;
                child.stdin.write(`ACK ${frameSha256} ${process.pid} ${prepared.OwnerCreatedAtUtc} ${prepared.RootPid} ${prepared.RootCreatedAtUtc}\n`);
              },()=>{if(!closed)cancel();else cancelRequested=true;});
            } else if(line.startsWith('SOVEREIGN_RUNTIME_TERMINAL_V1=')) {
              if(terminal) throw new Error('DUPLICATE_TERMINAL');
              terminal=JSON.parse(line.slice('SOVEREIGN_RUNTIME_TERMINAL_V1='.length));
            } else throw new Error('UNEXPECTED_NATIVE_OUTPUT');
          } catch {fail();}
        }
      });
      child.on('close',async code=>{
        closed=true;clearTimeout(timeout);clearInterval(resourceTimer);signal?.removeEventListener('abort',cancel);
        // The original receipt-binding write must settle before any completion.
        // A late ACK is suppressed once close/cancel is observed.
        await bindingPending;
        const stage=terminal?.TaskStage;
        const bound=!protocolFault && !buffer.trim() && prepared &&
          terminal?.SchemaVersion==='stephanos.fixed-runtime-job.v1' &&
          terminal.RequestId===frame.RequestId && terminal.FrameSha256===frameSha256 &&
          terminal.Profile===frame.Profile && terminal.OwnerPid===process.pid &&
          terminal.OwnerCreatedAtUtc===prepared.OwnerCreatedAtUtc &&
          terminal.RuntimeSourceHead===frame.RuntimeSourceHead && terminal.SourceHeadMatched===true &&
          terminal.CustodyRecordSha256===binding.custodyRecordSha256 &&
          terminal.NativeRecordId===binding.nativeRecordId &&
          (!source || (terminal.ActionId===binding.actionId && terminal.MissionId===binding.missionId && terminal.ClaimSha256===binding.claimSha256)) && stage?.RootPid===prepared.RootPid &&
          stage.RootCreatedAtUtc===prepared.RootCreatedAtUtc && stage.AssignedBeforeExecution===true &&
          stage.ZeroActiveProcessesObserved===true && stage.ActiveProcesses===0 &&
          stage.ExecutionCustodyReleased===true && terminal.ExecutionCustodyReleased===true &&
          [0,2].includes(code) && code===(terminal.OperationOk===true?0:2);
        const operationProven=bound && !cancelRequested && terminal.OperationOk===true &&
          terminal.TaskExecuted===true && terminal.TaskResumed===true && stage.ResumeConfirmed===true &&
          stage.ParentBindingAccepted===true && stage.NormalRootExit===true && stage.OutputComplete===true &&
          stage.ExitCode===0 && typeof stage.Output==='string' && Buffer.byteLength(stage.Output)<=16384 &&
          stage.OutputSha256===digest(stage.Output);
        const result=Object.freeze({ok:Boolean(operationProven),
          reason:bound?(cancelRequested?'FIXED_RUNTIME_OPERATION_CANCELLED':terminal.OperationOk===true && !operationProven?'FIXED_RUNTIME_OPERATION_EVIDENCE_UNPROVEN':terminal.Reason):'FIXED_RUNTIME_TERMINAL_CUSTODY_UNPROVEN',
          executionCustodyReleased:Boolean(bound),taskRootCreated:terminal?.TaskRootCreated===true,
          taskExecuted:Boolean(bound && terminal.TaskExecuted===true),stdout:stage?.Output??'',
          nativeReceipt:freezeTree(terminal)});
        if(bound) proof.set(result,Object.freeze({...binding}));
        resolve(result);
      });
      child.stdin.write(raw+'\n');
    } catch {
      clearTimeout(timeout);clearInterval(resourceTimer);signal?.removeEventListener('abort',cancel);
      if(child){fail();try{child.kill();}catch{}}
      // Once the native helper launch was attempted, absence of a terminal is held.
      resolve(Object.freeze({ok:false,reason:'FIXED_RUNTIME_TRANSPORT_UNPROVEN',executionCustodyReleased:false}));
    }
  });
}
