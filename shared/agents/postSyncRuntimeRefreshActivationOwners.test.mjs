import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPostSyncRefresh, executePostSyncRefreshPlan } from './postSyncRuntimeRefreshCoordinator.mjs';

const onDemand = [
  'scripts/report-starfield-vr-telemetry.mjs',
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
  'scripts/windows/launch-starfield-vr.ps1',
  'scripts/windows/new-vr-telemetry-session.ps1',
  'scripts/windows/read-starfield-vr-performance-diagnosis.ps1',
  'scripts/windows/run-starfield-aer-stabilizer-observe.ps1',
  'scripts/windows/starfield-vr-flight-recorder.ps1',
  'scripts/windows/starfield-vr-performance-mode.ps1',
  'scripts/windows/starfield-vr-runtime-metrics-producer.ps1',
  'scripts/windows/vr-visual-fault-marker.ps1',
  'shared/vr/vrTelemetrySensorContractV1.mjs',
];
const offline = [
  'scripts/windows/install-vr-openxr-telemetry-layer.ps1',
  'src/vr/Stephanos.OpenXrTelemetryLayer/layer.json',
  'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.cpp',
  'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.test.cpp',
  'src/windows/Stephanos.OriginalR7CustodyWitness.Tests/LegacySigningInterop.mjs',
  'src/windows/Stephanos.OriginalR7CustodyWitness.Tests/OriginalR7SigningProviderTests.cs',
  'src/windows/Stephanos.OriginalR7CustodyWitness/OriginalR7SigningPrimitives.cs',
];

test('measured 18-path source adoption routes through explicit activation owners', () => {
  const plan = classifyPostSyncRefresh([...onDemand, ...offline]);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.classification, 'REFRESH_READY');
  assert.deepEqual(plan.targetIds, ['natural-reload']);
  for (const path of onDemand) assert.deepEqual(classifyPostSyncRefresh([path]).targetIds, ['natural-reload'], path);
  for (const path of offline) assert.equal(classifyPostSyncRefresh([path]).classification, 'NO_RUNTIME_REFRESH_REQUIRED', path);
});

test('source adoption never dispatches native installation, VR launch, signing or unrelated service repair', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({beforeHead:'a'.repeat(40), afterHead:'b'.repeat(40), changedPaths:[...onDemand,...offline], adapters:{
    confirmNaturalReload:async()=>{calls.push('natural-reload');return {ok:true,exactHeadProofOk:true,sourceHead:'b'.repeat(40)};},
  }});
  assert.equal(result.ok, true);
  assert.deepEqual(calls,['natural-reload']);
});

test('uninspected neighbours and unsafe paths remain fenced', () => {
  for (const path of ['scripts/windows/launch-another-vr.ps1','shared/vr/newSensor.mjs','src/vr/Stephanos.OpenXrTelemetryLayer/uninspected.cpp','src/windows/Stephanos.OriginalR7CustodyWitness/Uninspected.cs','src/windows/Stephanos.OriginalR7CustodyWitnessV2/OriginalR7SigningPrimitives.cs']) {
    assert.equal(classifyPostSyncRefresh([path]).classification,'BLOCKED_UNCLASSIFIED_RUNTIME_PATH',path);
  }
  assert.equal(classifyPostSyncRefresh(['../escape.ps1']).classification,'BLOCKED_UNSAFE_CHANGED_PATH');
  const mixed=classifyPostSyncRefresh([...onDemand,...offline,'scripts/uninspected.mjs']);
  assert.equal(mixed.classification,'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

test('two protected advisory entries adopt source without invoking or trusting their installed parent',async()=>{
 const paths=['scripts/sovereign-high-risk-advisory-launcher-v1.mjs','scripts/sovereign-high-risk-advisory-v1.mjs'];
 const plan=classifyPostSyncRefresh(paths);
 assert.equal(plan.classification,'NO_RUNTIME_REFRESH_REQUIRED');
 assert.deepEqual(plan.targetIds,[]);
 const result=await executePostSyncRefreshPlan({beforeHead:'a'.repeat(40),afterHead:'b'.repeat(40),changedPaths:paths,adapters:new Proxy({}, {get(){return async()=>{throw Error('no activation permitted');};}})});
 assert.equal(result.ok,true);
 for(const path of ['scripts/sovereign-high-risk-advisory-v2.mjs','scripts/sovereign-high-risk-advisory-launcher-v2.mjs'])
  assert.equal(classifyPostSyncRefresh([path]).classification,'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
 assert.equal(classifyPostSyncRefresh([...paths,'scripts/uninspected-review.mjs']).classification,'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

// Captured from the actual nine-file PR3400 rollout, not a selected activation subset.
const ignitionRollout = [
  "docs/architecture/ignition-source-activation-routing.md",
  "scripts/battle-bridge-sync-housekeeper-runner.mjs",
  "scripts/ignite-stephanos-local.mjs",
  "scripts/serve-stephanos-dist.mjs",
  "scripts/serve-stephanos-dist.test.mjs",
  "scripts/served-build-rollback.test.mjs",
  "shared/agents/postSyncRuntimeRefreshActivationOwners.test.mjs",
  "shared/agents/postSyncRuntimeRefreshCoordinator.mjs",
  "shared/runtime/buildParity.mjs"
];
test('complete merged Ignition rollout has an existing activation owner for every path',()=>{
 assert.equal(ignitionRollout.length,9);
 const plan=classifyPostSyncRefresh(ignitionRollout);
 assert.equal(plan.unknownPathCount,0);
 assert.deepEqual(plan.targetIds,['stephanos-ui-4173','stephanos-backend-8787','github-command-mailbox','natural-reload']);
 assert.equal(plan.classification,'REFRESH_READY');
 assert.deepEqual(classifyPostSyncRefresh(['scripts/battle-bridge-sync-housekeeper-runner.mjs']).targetIds,['natural-reload']);
 assert.equal(classifyPostSyncRefresh(['scripts/battle-bridge-sync-housekeeper-runner.mjs']).noRuntimePathCount,0);
});
test('scheduled sync child adoption confirms source without running housekeeping or starting a service',async()=>{
 const calls=[];
 const result=await executePostSyncRefreshPlan({beforeHead:'a'.repeat(40),afterHead:'b'.repeat(40),changedPaths:['scripts/battle-bridge-sync-housekeeper-runner.mjs'],adapters:{confirmNaturalReload:async()=>{calls.push('natural-reload');return {ok:true,exactHeadProofOk:true,sourceHead:'b'.repeat(40)};}}});
 assert.equal(result.ok,true);assert.deepEqual(calls,['natural-reload']);
 for(const path of ['scripts/battle-bridge-sync-housekeeper-runner-v2.mjs','scripts/battle-bridge-sync-housekeeper-other.mjs'])assert.equal(classifyPostSyncRefresh([path]).classification,'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
 const denied=[];const held=await executePostSyncRefreshPlan({beforeHead:'a'.repeat(40),afterHead:'b'.repeat(40),changedPaths:[...ignitionRollout,'scripts/uninspected-refresh-owner.mjs'],adapters:new Proxy({}, {get(){return async()=>{denied.push('called');throw Error('held plan must not invoke adapters');};}})});
 assert.equal(held.ok,false);assert.deepEqual(denied,[]);
});
test('the shared owner cannot turn stale natural-reload evidence into current adoption',async()=>{
 const result=await executePostSyncRefreshPlan({beforeHead:'a'.repeat(40),afterHead:'b'.repeat(40),changedPaths:['scripts/battle-bridge-sync-housekeeper-runner.mjs'],adapters:{confirmNaturalReload:async()=>({ok:true,exactHeadProofOk:true,sourceHead:'c'.repeat(40)})}});
 assert.equal(result.ok,false);
});
