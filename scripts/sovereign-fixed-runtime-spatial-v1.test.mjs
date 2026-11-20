import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {FIXED_SPATIAL_PREPARE_RUNTIME_ROUTE_V1, fixedRuntimeMaintenanceRouteV1,
  fixedRuntimeMaintenanceActionQualifiedV1, executeFixedMaintenanceRuntimeV1,
  consumeFixedRuntimePrelaunchExclusionV1, consumeFixedRuntimeTerminalProvenanceV1}
  from './sovereign-fixed-runtime-parent-v1.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const actionId='prepare-spatial-workspace',profile='SPATIAL_WORKSPACE_PREPARE_V1';

test('Spatial preparation is a closed declaration, never caller-minted native qualification',async()=>{
  assert.deepEqual(FIXED_SPATIAL_PREPARE_RUNTIME_ROUTE_V1,{actionId,profile,executionTimeoutMs:240000});
  assert.equal(fixedRuntimeMaintenanceRouteV1(actionId),FIXED_SPATIAL_PREPARE_RUNTIME_ROUTE_V1);
  assert.equal(fixedRuntimeMaintenanceActionQualifiedV1(actionId),true);
  for(const value of ['start-spatial-workspace','launch-spatial-workspace','prepare-spatial-workspace --command',
    '',null,{toString:()=>actionId}]) {
    assert.equal(fixedRuntimeMaintenanceRouteV1(value),null);
    assert.equal(fixedRuntimeMaintenanceActionQualifiedV1(value),false);
  }
  const binding={requestId:'spatial-fixture-1234',actionId,sourceHead:'a'.repeat(40),
    custodyRecordSha256:'b'.repeat(64),nativeRecordId:26};
  const result=await executeFixedMaintenanceRuntimeV1({ok:true,dispatchAllowed:true,profiles:[profile]},binding,{onPrepared:()=>true});
  assert.equal(result.reason,'FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED');
  assert.equal(result.taskRootCreated,false);
  assert.equal(consumeFixedRuntimeTerminalProvenanceV1(result,binding),false);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),true);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),false);
});

test('actual Spatial parent protocol binds the compiled profile and retains custody on incomplete native zero',()=>{
  const output=execFileSync(process.execPath,['--experimental-vm-modules',
    fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-parent-protocol-fixture-v1.mjs',import.meta.url)),'--spatial'],
    {cwd:root,encoding:'utf8',timeout:10000,windowsHide:true});
  const result=JSON.parse(output);
  assert.equal(result.cases,34);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});

test('compiled Spatial entry keeps fixed arguments, exact operation binding and bounded native cleanup',()=>{
  const host=readFileSync(new URL('./windows/SovereignFixedRuntimeHostV1.cs',import.meta.url),'utf8');
  const job=readFileSync(new URL('./windows/SovereignFixedRuntimeJobV1.cs',import.meta.url),'utf8');
  assert.match(host,/custody\.Operation!=RuntimeMaintenanceOperationV1\(frame\.Profile\)/);
  assert.match(host,/int deadline=source\?RuntimeSourceDeadlineMsV1:spatial\?225000:145000/);
  assert.match(host,/"sovereign-commander-spatial-workspace\.mjs"/);
  assert.match(host,/\+" --expected-main "\+frame\.RuntimeSourceHead/);
  assert.doesNotMatch(host,/launch-stephanos-spatial-workspace|start-spatial-window-host/);
  assert.match(host,/frame\.Profile!="SOURCE_TASK_V1" && body\.Length!=0/);
  assert.match(job,/r\.ZeroActiveProcessesObserved=empty\(\) && WaitForSingleObject\(pi\.process,0\)==0/);
  assert.match(job,/LIVE_DESCENDANT_REMAINS/);
});

test('Windows compiled Spatial parser, fixed selection and terminal evidence reject substituted or incomplete results',
  {skip:process.platform!=='win32',timeout:30000},()=>{
  const head='a'.repeat(40);
  const good={schemaVersion:'stephanos.spatial-workspace-readiness.v1',ok:true,actionId,sourceHead:head,
    buildId:'b'.repeat(64),blocker:'',installationVerified:true,uiReady:true,helperProbePassed:true,
    nativeProbePassed:true,existingHostPreserved:false,createdProbeStopped:true,hostRunningAfter:false,
    mutationAttempted:true,readyForOperatorLaunch:true,interactiveAcceptance:false,voiceAcceptance:false,
    headsetAcceptance:false};
  const vectors=[];
  const add=(name,report,expectedExecuted=false,expectedOk=false,extra={})=>vectors.push({name,report,
    exitCode:report.ok?0:2,expectedExecuted,expectedOk,...extra});
  add('temporary probe completed',good,true,true);
  add('resident preserved only as hold',{...good,ok:false,readyForOperatorLaunch:false,
    existingHostPreserved:true,hostRunningAfter:true,mutationAttempted:false,
    blocker:'SPATIAL_PREPARE_PORT_OCCUPIED'},true,false);
  add('resident reuse cannot report success',{...good,existingHostPreserved:true,hostRunningAfter:true});
  add('success without fresh preparation is refused',{...good,mutationAttempted:false});
  add('bounded failure',{...good,ok:false,readyForOperatorLaunch:false,blocker:'SPATIAL_BUILD_FAILED'},true,false);
  add('preflight failure does not require mutation',{...good,ok:false,readyForOperatorLaunch:false,
    mutationAttempted:false,blocker:'SPATIAL_PREPARE_PORT_OCCUPIED'},true,false);
  add('probe stop remains unproven',{...good,ok:false,readyForOperatorLaunch:false,
    createdProbeStopped:false,blocker:'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN'},true,false);
  add('contradictory probe stop',{...good,ok:false,readyForOperatorLaunch:false,
    blocker:'SPATIAL_PREPARE_PROBE_STOP_UNPROVEN'});
  for(const flag of ['installationVerified','uiReady','helperProbePassed','nativeProbePassed','createdProbeStopped','readyForOperatorLaunch'])
    add('missing success prerequisite '+flag,{...good,[flag]:false});
  for(const [flag,value] of Object.entries(good).filter(([,value])=>typeof value==='boolean' && value!==undefined)) {
    const missing={...good};delete missing[flag];add('absent boolean '+flag,missing,false,false,{exitCode:0});
    add('coerced boolean '+flag,{...good,[flag]:String(value)},false,false,{exitCode:0});
  }
  for(const flag of ['interactiveAcceptance','voiceAcceptance','headsetAcceptance'])add('unproven acceptance '+flag,{...good,[flag]:true});
  for(const [field,value] of [['sourceHead','c'.repeat(40)],['actionId','launch-spatial-workspace'],
    ['schemaVersion','other.schema'],['buildId','invalid'],['blocker','SPATIAL_FAILURE']])add('substituted '+field,{...good,[field]:value});
  add('unexpected new listener',{...good,hostRunningAfter:true});
  add('preserved listener disappeared',{...good,existingHostPreserved:true});
  add('failure without blocker',{...good,ok:false,readyForOperatorLaunch:false});
  add('failure claims ready',{...good,ok:false,blocker:'SPATIAL_BUILD_FAILED'});
  add('contradictory exit',good,false,false,{exitCode:2});
  add('duplicate terminal',good,false,false,{duplicate:true});
  const encoded=Buffer.from(JSON.stringify(vectors)).toString('base64');
  const emptyHash=createHash('sha256').update('').digest('hex');
  const bodyHash=createHash('sha256').update('{}').digest('hex');
  const code=String.raw`$ErrorActionPreference='Stop'
$root=(Get-Location).Path
$names=@('SovereignCoreJobCustodyV1.cs','SovereignFixedRuntimeJobV1.cs','SovereignFixedRuntimeIdentityV1.cs','SovereignFixedRuntimeAuthorityV1.cs','SovereignFixedRuntimeHostV1.cs','SovereignFixedRuntimeSourceV1.cs')
$src=($names|ForEach-Object{[IO.File]::ReadAllText((Join-Path $root ('scripts\windows\'+$_)))}) -join [Environment]::NewLine
Add-Type -TypeDefinition $src -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management'
$type=[Stephanos.Sovereign.CoreJobCustodyV1]
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$operation=$type.GetMethod('RuntimeMaintenanceOperationV1',$flags)
if($operation.Invoke($null,@('SPATIAL_WORKSPACE_PREPARE_V1')) -cne 'prepare-spatial-workspace'){throw 'SPATIAL_OPERATION_CHANGED'}
if($operation.Invoke($null,@('MAINTENANCE_GOAL_BUILDER_V1')) -cne 'repair-goal-builder-flow'){throw 'GOAL_OPERATION_CHANGED'}
try{$operation.Invoke($null,@('UNKNOWN'))|Out-Null;throw 'UNKNOWN_PROFILE_ACCEPTED'}catch{if($_.Exception.InnerException.Message -cne 'RUNTIME_MAINTENANCE_PROFILE_UNPROVEN'){throw}}
$frame=[Stephanos.Sovereign.FixedRuntimeRequestV1]::new()
$frame.Profile='SPATIAL_WORKSPACE_PREPARE_V1';$frame.RuntimeSourceHead='__HEAD__'
$select=$type.GetMethod('RuntimeTaskArgumentsV1',$flags)
$selected=[string]$select.Invoke($null,@($frame))
$expected='"C:\Users\Stephan Callear\Documents\GitHub\stephan-os\scripts\sovereign-commander-spatial-workspace.mjs" --expected-main __HEAD__'
if($selected -cne $expected){throw 'SPATIAL_FIXED_ARGUMENTS_CHANGED'}
$frame.RuntimeSourceHead='__HEAD__;other'
try{$select.Invoke($null,@($frame))|Out-Null;throw 'INJECTED_HEAD_ACCEPTED'}catch{if($_.Exception.InnerException.Message -cne 'RUNTIME_SOURCE_HEAD_UNPROVEN'){throw}}
$parse=$type.GetMethod('ParseFixedRuntimeRequestV1',$flags)
$wire=[ordered]@{SchemaVersion='stephanos.fixed-runtime-request.v1';RequestId='spatial-fixture-1234';Profile='SPATIAL_WORKSPACE_PREPARE_V1';RuntimeSourceHead='__HEAD__';InstallationSourceHead='__HEAD__';SourceProofSha256=('b'*64);OwnerPid=$PID;TaskFrameBase64='';TaskBindingSha256='__EMPTY__'}
$parsed=$parse.Invoke($null,@([string]($wire|ConvertTo-Json -Compress)))
if($parsed.Profile -cne 'SPATIAL_WORKSPACE_PREPARE_V1'){throw 'SPATIAL_FRAME_REFUSED'}
$wire.TaskFrameBase64='e30=';$wire.TaskBindingSha256='__BODY__'
try{$parse.Invoke($null,@([string]($wire|ConvertTo-Json -Compress)))|Out-Null;throw 'SPATIAL_CALLER_BODY_ACCEPTED'}catch{if($_.Exception.InnerException.Message -cne 'RUNTIME_TASK_BINDING_UNPROVEN'){throw}}
$vectors=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__VECTORS__'))|ConvertFrom-Json)
$project=$type.GetMethod('ProjectRuntimeTaskEvidenceV1',$flags)
foreach($vector in $vectors){
 $receipt=[Stephanos.Sovereign.FixedRuntimeReceiptV1]::new();$receipt.Profile='SPATIAL_WORKSPACE_PREPARE_V1';$receipt.RuntimeSourceHead='__HEAD__'
 $stage=[Stephanos.Sovereign.FixedRuntimeStageV1]::new()
 $stage.Launched=$true;$stage.ResumeConfirmed=$true;$stage.ParentBindingAccepted=$true;$stage.NormalRootExit=$true;$stage.OutputComplete=$true
 $stage.OperationOk=($vector.exitCode -eq 0);$stage.ExitCode=[uint32]$vector.exitCode
 $line='SOVEREIGN_SPATIAL_WORKSPACE_RESULT='+($vector.report|ConvertTo-Json -Depth 8 -Compress)
 $stage.Output=if($vector.duplicate){$line+[Environment]::NewLine+$line}else{$line}
 [void]$project.Invoke($null,@($receipt,$stage))
 if($receipt.TaskExecuted -ne $vector.expectedExecuted -or $receipt.OperationOk -ne $vector.expectedOk){throw ('SPATIAL_TERMINAL_VECTOR_FAILED:'+ $vector.name+':'+$receipt.Reason)}
}
[Console]::Write('SPATIAL_COMPILED_CONTRACT_PASS_'+$vectors.Count)`
    .replaceAll('__HEAD__',head).replace('__EMPTY__',emptyHash).replace('__BODY__',bodyHash).replace('__VECTORS__',encoded);
  const directory=mkdtempSync(join(tmpdir(),'stph-spatial-contract-'));
  let output;
  try {
    const driver=join(directory,'driver.ps1');
    writeFileSync(driver,code,{encoding:'utf8',flag:'wx'});
    output=execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',driver],
      {cwd:root,encoding:'utf8',timeout:25000,windowsHide:true,maxBuffer:65536});
  } finally {rmSync(directory,{recursive:true,force:true});}
  assert.match(output,new RegExp('SPATIAL_COMPILED_CONTRACT_PASS_'+vectors.length+'\\s*$'));
});
