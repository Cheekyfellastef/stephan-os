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
