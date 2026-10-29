import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeFixedRuntimePrelaunchExclusionV1, consumeFixedRuntimeTerminalProvenanceV1, executeFixedMaintenanceRuntimeV1, executeFixedSourceTaskRuntimeV1} from './sovereign-fixed-runtime-parent-v1.mjs';

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
  assert.equal(result.cases,10);assert.equal(result.nativeExecuted,false);assert.equal(result.productionQualification,false);
});
