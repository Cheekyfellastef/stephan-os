import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeFixedRuntimePrelaunchExclusionV1, consumeFixedRuntimeTerminalProvenanceV1, executeFixedMaintenanceRuntimeV1, executeFixedSourceTaskRuntimeV1} from './sovereign-fixed-runtime-parent-v1.mjs';
import {observeCurrentFixedRuntimeInstallationV1, observeCurrentFixedRuntimeQualificationV1} from './sovereign-fixed-runtime-install-current-v1.mjs';

test('child JSON copies and caller qualification cannot mint native provenance', async () => {
  const binding={requestId:'fixture-request-123',sourceHead:'a'.repeat(40),custodyRecordSha256:'b'.repeat(64),nativeRecordId:26};
  for(const value of [{executionCustodyReleased:true}, Object.freeze({executionCustodyReleased:true}), JSON.parse('{"executionCustodyReleased":true}')]) {
    assert.equal(consumeFixedRuntimeTerminalProvenanceV1(value,binding),false);
  }
  const result=await executeFixedMaintenanceRuntimeV1({ok:true,dispatchAllowed:true,profiles:['MAINTENANCE_GOAL_BUILDER_V1']},binding,{onPrepared:()=>true});
  assert.equal(result.reason,'FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED');
  assert.equal(result.taskRootCreated,false);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1({...result},binding),false);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),true);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),false);
  assert.equal(consumeFixedRuntimeTerminalProvenanceV1(result,binding),false);
});


test('a mutable or nonprimitive caller binding cannot issue a cross-task exclusion', async () => {
  const binding={requestId:'fixture-original',sourceHead:'a'.repeat(40),custodyRecordSha256:'b'.repeat(64),nativeRecordId:26,actionId:'task-a',missionId:'mission-a',claimSha256:'c'.repeat(64)};
  const original={...binding};
  const result=await executeFixedSourceTaskRuntimeV1({ok:true},binding);
  binding.actionId='task-b';
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(result,binding),false);
  const again=await executeFixedSourceTaskRuntimeV1({ok:true},original);
  assert.equal(consumeFixedRuntimePrelaunchExclusionV1(again,original),true);
  const bad=await executeFixedSourceTaskRuntimeV1({ok:true},{...original,actionId:{toString:()=>original.actionId}});
  assert.equal(bad.reason,'FIXED_RUNTIME_PRIMITIVE_BINDING_REQUIRED');
});


test('isolated actual parent protocol preserves zero across refusal cancellation late binding and input mutation', () => {
  const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-parent-protocol-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',timeout:10000,windowsHide:true});
  const result=JSON.parse(output);
  assert.equal(result.cases,27);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});

test('actual inspector preserves only closed native denials and never qualifies failure', () => {
  const output=execFileSync(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v1.mjs',import.meta.url))],{encoding:'utf8',timeout:10000,windowsHide:true});
  const result=JSON.parse(output);
  assert.equal(result.cases,46);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});


test('fixed runtime commissioning observation separates missing, present, restart-required and qualified', () => {
  const head='a'.repeat(40), hash='b'.repeat(64);
  const missing=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:false,reason:'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'})});
  assert.deepEqual(missing,{ok:true,state:'MISSING',reason:'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',installed:false,sourceHead:head});
  const present=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:true,installed:true,sourceHead:head,helperSha256:hash,manifestSha256:'c'.repeat(64)})});
  assert.equal(present.ok,true);assert.equal(present.state,'PRESENT');assert.equal(present.installed,true);
  const restart=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:false,reason:'RUNTIME_PENDING_LATER_BOOT_UNPROVEN'})});
  assert.deepEqual(restart,{ok:true,state:'RESTART_REQUIRED',reason:'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',qualified:false,sourceHead:head});
  const qualified=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:true,dispatchAllowed:true,sourceHead:head})});
  assert.deepEqual(qualified,{ok:true,state:'QUALIFIED',reason:'',qualified:true,sourceHead:head});
});

test('fixed runtime commissioning observation refuses wrong identity and unrelated denial', () => {
  const head='a'.repeat(40);
  const wrong=observeCurrentFixedRuntimeInstallationV1(head,{platform:'win32',
    inspectPresence:()=>({ok:true,installed:true,sourceHead:'d'.repeat(40),helperSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)})});
  assert.equal(wrong.ok,false);assert.equal(wrong.reason,'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
  const blocked=observeCurrentFixedRuntimeQualificationV1(head,{platform:'win32',
    inspectQualification:()=>({ok:false,reason:'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD'})});
  assert.equal(blocked.ok,false);assert.equal(blocked.state,'BLOCKED');assert.equal(blocked.reason,'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
});

test('current-main fixed runtime preparer stays fixed-source and carries no restart or arbitrary shell surface', () => {
  const source=readFileSync(fileURLToPath(new URL('./sovereign-fixed-runtime-install-current-v1.mjs',import.meta.url)),'utf8');
  assert.match(source,/FIXED_RUNTIME_SOURCE_PATHS_V1/);
  assert.match(source,/buildFixedRuntimeInstallerCandidateV1/);
  assert.match(source,/rev-parse', expectedMain \+ ':' \+ relative/);
  assert.match(source,/cat-file', 'blob', blobSha/);
  assert.match(source,/hash-object', '--path=' \+ relative, '--stdin/);
  assert.match(source,/input: physicalBytes/);
  assert.match(source,/materializedBlobSha !== expectedBlobSha/);
  assert.match(source,/return hash\(physicalBytes\)/);
  assert.match(source,/materializedSha256/);
  assert.match(source,/FIXED_RUNTIME_INSTALL_SOURCE_MATERIALIZATION_CHANGED/);
  assert.doesNotMatch(source,/Buffer\.from\(actual\)\.equals\(expectedBytes\)/);
  assert.match(source,/writeFileFn\(candidate\.payloadPath, payload, \{ flag: 'wx', mode: 0o600 \}\)/);
  assert.doesNotMatch(source,/cmd\.exe|Invoke-Expression|Restart-Computer|Stop-Computer|shutdown\.exe|git\s+reset|git\s+clean|git\s+push/i);
});
