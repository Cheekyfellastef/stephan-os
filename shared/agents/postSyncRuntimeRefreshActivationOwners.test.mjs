import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPostSyncRefresh, executePostSyncRefreshPlan, parseGitChangedPathStatus, LOCAL_LAUNCHER_FRESH_ENTRY_PATHS } from './postSyncRuntimeRefreshCoordinator.mjs';

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

test('Control Tower Actions producer is exact source-only while its existing resident consumer requires relay adoption', async () => {
  const producer = 'scripts/control-tower-build-request-v1.mjs';
  const isolated = classifyPostSyncRefresh([producer]);
  assert.equal(isolated.classification, 'NO_RUNTIME_REFRESH_REQUIRED');
  assert.deepEqual(isolated.targetIds, []);
  const result = await executePostSyncRefreshPlan({ beforeHead: 'a'.repeat(40), afterHead: 'b'.repeat(40), changedPaths: [producer],
    adapters: new Proxy({}, { get() { return async () => { throw Error('Actions producer must not invoke a local activation adapter'); }; } }) });
  assert.equal(result.ok, true);
  const consumer = classifyPostSyncRefresh([producer, 'scripts/control-tower-build-consumer-v1.mjs']);
  assert.equal(consumer.classification, 'REFRESH_READY');
  assert.equal(consumer.sovereignRelayRefreshRequired, true);
  assert(consumer.targetIds.includes('sovereign-commander'));
  for (const neighbour of ['scripts/control-tower-build-request-v2.mjs', 'scripts/control-tower-free-form-request.mjs'])
    assert.equal(classifyPostSyncRefresh([neighbour]).classification, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

// Complete source increment against main 440f940f101666de3cf8f0230aeaa2915c201266.
const controlTowerOwnerCommentRollout = [
  '.github/workflows/stephanos-control-tower-build.yml',
  'apps/stephanos-ai/controlSurface.mjs',
  'docs/architecture/control-tower-build-start-v1.md',
  'docs/architecture/ignition-source-activation-routing.md',
  'docs/architecture/sovereign-conversational-control-v1.md',
  'scripts/canonical-mailbox-execution-ledger-v1.mjs',
  'scripts/control-tower-build-consumer-v1.mjs',
  'scripts/control-tower-build-consumer-v1.test.mjs',
  'scripts/control-tower-build-request-v1.mjs',
  'scripts/sovereign-commander-native-inspect.mjs',
  'scripts/sovereign-commander-native-inspect.test.mjs',
  'shared/agents/controlTowerBuildBeaconFactsV1.mjs',
  'shared/agents/controlTowerBuildReaderV1.mjs',
  'shared/agents/controlTowerBuildReaderV1.test.mjs',
  'shared/agents/controlTowerBuildRequestV1.mjs',
  'shared/agents/controlTowerBuildRequestV1.test.mjs',
  'shared/agents/controlTowerRequestObservationV1.mjs',
  'shared/agents/fixtures/controlTowerBuildV1.mjs',
  'shared/agents/mailboxFreeGitHubEvidenceReaderV1.mjs',
  'shared/agents/postSyncRuntimeRefreshActivationOwners.test.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  'shared/agents/sovereignControlConversationV1.mjs',
  'shared/agents/sovereignControlConversationV1.test.mjs',
  'tests/stephanos-ai-control-surface.test.mjs',
  'tests/stephanos-ai-sovereign-control.browser.test.mjs',
];
test('complete owner-comment rollout retains existing relay adoption and refuses mixed unknown debt', () => {
  assert.equal(controlTowerOwnerCommentRollout.length, 25);
  const plan = classifyPostSyncRefresh(controlTowerOwnerCommentRollout);
  assert.equal(plan.classification, 'REFRESH_READY'); assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.sovereignRelayRefreshRequired, true);
  assert(plan.targetIds.includes('sovereign-commander'));
  assert.equal(classifyPostSyncRefresh([...controlTowerOwnerCommentRollout, 'scripts/unclassified-current-debt.mjs']).classification,
    'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

const unattendedIgnitionRollout = [
  'windows/Launch-Stephanos-Local.ps1',
  'windows/Launch-Stephanos-Local.cmd',
  'windows/Invoke-Stephanos-Ignite-With-Approval.ps1',
  'shared/agents/stephanosChatUpdate.mjs',
  'shared/agents/stephanosChatUpdate.test.mjs',
  'scripts/run-battle-bridge-ignition.mjs',
  'scripts/run-battle-bridge-ignition.test.mjs',
  'scripts/windows-ignition-browser-surfaces.test.mjs',
  'scripts/windows-ignition-preflight-recovery.test.mjs',
  'scripts/windows-launcher-defaults.test.mjs',
  'docs/architecture/ignition-source-activation-routing.md',
  'scripts/battle-bridge-github-sync-and-refresh.mjs',
  'scripts/battle-bridge-ignition-sync-preflight.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  'shared/agents/postSyncRuntimeRefreshActivationOwners.test.mjs',
];

test('one exact fresh launcher owner covers the real guarded invocation chain', () => {
  assert.deepEqual(LOCAL_LAUNCHER_FRESH_ENTRY_PATHS, [
    'windows/Launch-Stephanos-Local.cmd',
    'windows/Launch-Stephanos-Local.ps1',
    'windows/Invoke-Stephanos-Ignite-With-Approval.ps1',
  ]);
  const cmd = readFileSync(new URL('../../windows/Launch-Stephanos-Local.cmd', import.meta.url), 'utf8');
  const launcher = readFileSync(new URL('../../windows/Launch-Stephanos-Local.ps1', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../../windows/Invoke-Stephanos-Ignite-With-Approval.ps1', import.meta.url), 'utf8');
  assert(cmd.includes('POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Local.ps1'));
  assert(launcher.includes('windows/Invoke-Stephanos-Ignite-With-Approval.ps1'));
  assert(helper.includes('npm run stephanos:ignite'));
  for (const member of LOCAL_LAUNCHER_FRESH_ENTRY_PATHS) {
    const plan = classifyPostSyncRefresh([member]);
    assert.equal(plan.classification, 'REFRESH_READY', member);
    assert.deepEqual(plan.targetIds, ['natural-reload'], member);
  }
});

test('the complete unattended ignition source increment has canonical activation owners', () => {
  assert.equal(unattendedIgnitionRollout.length, 15);
  const plan = classifyPostSyncRefresh(unattendedIgnitionRollout);
  assert.equal(plan.classification, 'REFRESH_READY');
  assert.equal(plan.unknownPathCount, 0);
  assert(plan.targetIds.includes('natural-reload'));
  for (const neighbor of [
    'windows/Launch-Stephanos-Local-copy.cmd',
    'windows/Invoke-Stephanos-Ignite-With-Approval-override.ps1',
    'windows/Unattended-Launcher.ps1',
  ]) {
    assert.equal(classifyPostSyncRefresh([...unattendedIgnitionRollout, neighbor]).classification,
      'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
  }
});

test('every essential launcher-chain member remains protected against removal or rename', () => {
  for (const member of LOCAL_LAUNCHER_FRESH_ENTRY_PATHS) {
    for (const line of ['D\t' + member, 'R100\t' + member + '\twindows/unqualified-launcher.ps1']) {
      const parsed = parseGitChangedPathStatus(line);
      assert.equal(parsed.ok, false, line);
      assert.equal(parsed.blocker, 'POST_SYNC_REQUIRED_LOCAL_LAUNCHER_REMOVED', line);
    }
  }
  const copied = parseGitChangedPathStatus(
    'C100\twindows/Launch-Stephanos-Local.cmd\twindows/unqualified-copy.cmd');
  assert.equal(copied.ok, true);
  assert.equal(classifyPostSyncRefresh(copied.paths).classification, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});
