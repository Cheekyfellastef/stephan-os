import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  executePostSyncRefreshPlan,
  parseGitChangedPathStatus,
  projectPostSyncSovereignRelayProof,
  projectPostSyncTargetFailureHistory,
  reducePostSyncTargetFailureHistory as reduceTargetFailureHistory,
} from './postSyncRuntimeRefreshCoordinator.mjs';
import { projectPostSyncSovereignRelayProof as projectSyncPolicyRelayProof }
  from '../../scripts/battle-bridge-github-sync-policy.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS = Object.freeze([
  'scripts/battle-bridge-sovereign-relay-daemon.mjs',
  'scripts/control-tower-build-consumer-v1.mjs',
  'scripts/sovereign-commander-native-inspect.mjs',
]);

function pass(sourceHead = B) {
  return { ok: true, exactHeadProofOk: true, sourceHead };
}

function relayProof(sourceHead = B) {
  return { schemaVersion: 'stephanos.post-sync-sovereign-relay-proof.v1', watchdogSucceeded: true,
    healthy: true, sourceHead, sourceHeadMatchesLive: true, processCount: 1, heartbeatAgeSeconds: 2, blocker: '' };
}

test('fresh execution and retained-debt admission share the identical closed relay proof projector', () => {
  assert.equal(projectPostSyncSovereignRelayProof, projectSyncPolicyRelayProof);
  assert.deepEqual(projectPostSyncSovereignRelayProof(relayProof(), B), relayProof());
  let accessed = false;
  const hostile = relayProof();
  Object.defineProperty(hostile, 'sourceHead', { enumerable: true, get() { accessed = true; return B; } });
  assert.equal(projectPostSyncSovereignRelayProof(hostile, B), null);
  assert.equal(accessed, false);
});

test('guarded Ignition sync preflight is loaded fresh and requires no runtime refresh', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-ignition-sync-preflight.mjs',
    'scripts/battle-bridge-ignition-sync-preflight.test.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.equal(plan.noRuntimePathCount, 2);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('maintenance custody store changes refresh Sovereign Commander instead of fail-closing as unclassified', () => {
  const source = 'scripts/sovereign-maintenance-custody-store-v1.mjs';
  const plan = classifyPostSyncRefresh([source, source.replace('.mjs', '.test.mjs')]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.equal(plan.sovereignRelayRefreshRequired, false);
});

test('only the inspected offline installer package preparer is exempt from runtime refresh', async () => {
  const source = 'scripts/sovereign-fixed-runtime-install-source-package-v1.mjs';
  const paths = [source, source.replace('.mjs', '.test.mjs'),
    'docs/architecture/sovereign-fixed-runtime-job-custody-v1.md', '.github/workflows/sovereign-core-repair-custody.yml'];
  const plan = classifyPostSyncRefresh(paths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.equal(plan.noRuntimePathCount, paths.length);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.sovereignRelayRefreshRequired, false);
  let calls = 0;
  const adapters = Object.fromEntries(['refreshUi', 'proveVrAtlas', 'restartBackend', 'restartMissionWorker',
    'restartGitHubMailbox', 'refreshSovereignCommander', 'confirmNaturalReload'].map(id => [id, () => { calls++; return pass(); }]));
  const offline = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: paths, adapters });
  assert.equal(offline.ok, true);
  for (const unknown of [source.replace('-v1.mjs', '-v2.mjs'), source.replace('.mjs', '.ps1'),
    source.replace('-package-', '-packages-'), source.replace('-v1.mjs', '-runtime-v1.mjs')]) {
    const refused = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [source, unknown], adapters });
    assert.equal(refused.ok, false);
    assert.equal(refused.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  }
  assert.equal(calls, 0);
});

const OUTCOME_TIME = '2026-10-31T01:00:00.000Z';
const NEXT_OUTCOME_TIME = '2026-10-31T01:01:00.000Z';
const reducePostSyncTargetFailureHistory = (history, event) => reduceTargetFailureHistory(history,
  { nowMs: Date.parse(NEXT_OUTCOME_TIME), ...event });
function targetRefusal(history, targetId, overrides = {}) {
  return reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B, observedAtUtc: OUTCOME_TIME,
    targetId, failureKind: 'RESULT_UNPROVEN', result: { ok: false, exactHeadProofOk: true, sourceHead: B }, ...overrides });
}

test('target refusal model preserves every target through retry prefixes and retires only its new exact success', () => {
  const ids = Object.values(POST_SYNC_REFRESH_TARGETS);
  let history = null;
  for (const targetId of ids) history = targetRefusal(history, targetId);
  assert.equal(history.failures.length, ids.length);
  const original = JSON.parse(JSON.stringify(history));
  for (let retry = 1; retry <= 3; retry++) {
    history = projectPostSyncTargetFailureHistory(history, { expectedSourceHead: B, nowMs: Date.parse(OUTCOME_TIME) + retry * 60_000 });
    assert.deepEqual(history, original);
    for (const targetId of ids) {
      const replay = reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B, observedAtUtc: NEXT_OUTCOME_TIME,
        targetId, result: { ...pass(), resumed: true } });
      assert.deepEqual(replay, history, 'Resume is not a new terminal observation');
    }
  }
  for (const targetId of ids) {
    const previous = history.failures;
    history = reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B,
      observedAtUtc: NEXT_OUTCOME_TIME, targetId, result: pass() });
    assert.deepEqual(history.failures, previous.filter(row => row.targetId !== targetId));
  }
  assert.deepEqual(history.failures, []);
});

test('target history rejects contradictory identities and never promotes a wrong-head or stale success', () => {
  const targetId = POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER;
  const history = targetRefusal(null, targetId);
  for (const result of [pass(A), { ...pass(), sourceHead: [B] }, { ...pass(), exactHeadProofOk: false },
    { ...pass(), blocker: 'SOVEREIGN_COMMANDER_NOT_HEALTHY' }]) {
    assert.deepEqual(reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B,
      observedAtUtc: NEXT_OUTCOME_TIME, targetId, result }), history);
  }
  assert.deepEqual(reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B,
    observedAtUtc: '2026-10-31T00:59:59.000Z', targetId, result: pass() }), history);
  const twoTargets = targetRefusal(history, POST_SYNC_REFRESH_TARGETS.UI_4173);
  assert.deepEqual(reducePostSyncTargetFailureHistory(twoTargets, { expectedSourceHead: B,
    observedAtUtc: '2026-10-31T00:58:59.000Z', targetId, result: pass() }), twoTargets);
  assert.deepEqual(reducePostSyncTargetFailureHistory(twoTargets, { expectedSourceHead: B,
    observedAtUtc: NEXT_OUTCOME_TIME, targetId, result: pass(), failureKind: 'RESULT_UNPROVEN' }), twoTargets);
  assert.equal(projectPostSyncTargetFailureHistory(history, { expectedSourceHead: A, nowMs: Date.parse(NEXT_OUTCOME_TIME) }), null);
  const mismatch = targetRefusal(history, targetId, { observedAtUtc: NEXT_OUTCOME_TIME, result: pass(A) });
  assert.equal(mismatch.failures[0].reportedSourceHead, A);
  assert.equal(mismatch.expectedSourceHead, B);
  assert.equal(mismatch.failures[0].failureKind, 'RESULT_UNPROVEN');
});

test('target history is bounded closed-schema diagnostic data with no favorable-prefix selection', () => {
  const history = targetRefusal(null, POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER, {
    result: { ok: false, sourceHead: B, blocker: 'PRIVATE_ARBITRARY_UPPERCASE_SECRET', stdout: 'PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR' },
  });
  assert.equal(history.failures[0].blocker, 'REFRESH_TARGET_PROOF_FAILED');
  assert.equal(JSON.stringify(history).includes('PRIVATE_'), false);
  const row = history.failures[0];
  const invalid = [
    { ...history, expectedSourceHead: [B] },
    { ...history, failures: [row, row] },
    { ...history, failures: Array(8).fill(row) },
    ...[{ targetId: 'private-unknown-target' }, { observedAtUtc: '2026-10-31T01:03:00.000Z' },
      { observedAtUtc: 'not-a-time' }, { reportedSourceHead: [B] }, { failureKind: 'HEALTHY' },
      { blocker: 'PRIVATE_ARBITRARY_UPPERCASE_SECRET' },
      { failureKind: 'INVOCATION_FAILED', blocker: 'REFRESH_TARGET_INVOCATION_FAILED', reportedSourceHead: B },
    ].map(change => ({ ...history, failures: [{ ...row, ...change }] })),
  ];
  for (const value of invalid) assert.equal(projectPostSyncTargetFailureHistory(value,
    { expectedSourceHead: B, nowMs: Date.parse(NEXT_OUTCOME_TIME) }), null);
  const stripped = projectPostSyncTargetFailureHistory({ ...history, token: 'PRIVATE_TOKEN',
    failures: [{ ...row, stdout: 'PRIVATE_STDOUT', path: 'PRIVATE_PATH' }] },
  { expectedSourceHead: B, nowMs: Date.parse(NEXT_OUTCOME_TIME) });
  assert.deepEqual(stripped, history);
});

test('terminal target observation distinguishes refusal invocation and missing handler without raw error history', async () => {
  for (const kind of ['RESULT_UNPROVEN', 'INVOCATION_FAILED', 'HANDLER_MISSING']) {
    const observations = [];
    let history = null;
    const adapter = kind === 'HANDLER_MISSING' ? undefined : () => {
      if (kind === 'INVOCATION_FAILED') throw new Error('PRIVATE_RAW_HANDLER_ERROR');
      return { ...pass(), exactHeadProofOk: false, blocker: 'PRIVATE_RAW_HANDLER_DENIAL' };
    };
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: ['main.js'],
      adapters: { refreshUi: adapter }, onTargetComplete: (results, observation) => {
        observations.push({ results, observation });
        history = reducePostSyncTargetFailureHistory(history,
          { expectedSourceHead: B, observedAtUtc: OUTCOME_TIME, ...observation });
      } });
    assert.equal(result.ok, false);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].observation.failureKind, kind);
    assert.equal(history.failures[0].failureKind, kind);
    assert.equal(history.failures[0].reportedSourceHead, kind === 'RESULT_UNPROVEN' ? B : '');
    assert.equal(JSON.stringify(history).includes('PRIVATE_'), false);
  }
});

test('checkpoint publication failure after a proven handler is never a target invocation failure', async () => {
  const targetId = POST_SYNC_REFRESH_TARGETS.UI_4173;
  const otherTarget = POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER;
  let history = targetRefusal(targetRefusal(null, targetId), otherTarget);
  const otherFailure = history.failures.find(row => row.targetId === otherTarget);
  const observations = [];
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: ['main.js'],
    adapters: { refreshUi: () => pass() }, onTargetComplete: (results, observation) => {
      observations.push(observation);
      history = reducePostSyncTargetFailureHistory(history,
        { expectedSourceHead: B, observedAtUtc: NEXT_OUTCOME_TIME, ...observation });
      throw new Error('PRIVATE_STATUS_WRITE_ERROR');
    } });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, `REFRESH_CHECKPOINT_PUBLICATION_FAILED:${targetId}`);
  assert.equal(result.results[0].ok, true);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].failureKind, '');
  assert.deepEqual(history.failures, [otherFailure]);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('fixed native inspector uses the existing guarded Commander refresh and its exact fixture has no runtime action', async () => {
  const parent = 'scripts/sovereign-fixed-runtime-parent-v1.mjs';
  const fixture = 'scripts/fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v1.mjs';
  const plan = classifyPostSyncRefresh([parent, fixture, 'scripts/sovereign-fixed-runtime-parent-v1.test.mjs']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.noRuntimePathCount, 2);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(classifyPostSyncRefresh([fixture]).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  let calls = 0;
  const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [parent, fixture],
    adapters: { refreshSovereignCommander: () => { calls++; return { ok: false, exactHeadProofOk: false,
      blocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN' }; } } });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN');
});

test('native inspector classification remains exact and refuses unknown neighboring runtime or fixture paths', () => {
  for (const path of ['scripts/sovereign-fixed-runtime-parent-v2.mjs',
    'scripts/sovereign-fixed-runtime-extra.mjs',
    'scripts/fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v2.mjs']) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
    assert.equal(plan.automaticExecutionAllowed, false);
  }
});

test('Sovereign control runtime imports share their existing Commander lifecycle for every changed subset', () => {
  // The watchdog owns the relay, which statically imports the consumer, which
  // statically imports the inspector. The inspector's CLI is not its only loader.
  for (let mask = 1; mask < 1 << SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS.length; mask++) {
    const paths = SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS.filter((_, index) => mask & (1 << index));
    for (const changedPaths of [paths, [...paths].reverse(), [...paths, ...paths],
      paths.map(path => path.replaceAll('/', '\\'))]) {
      const plan = classifyPostSyncRefresh(changedPaths);
      assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
      assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
      assert.equal(plan.noRuntimePathCount, 0);
      assert.equal(plan.unknownPathCount, 0);
      assert.equal(plan.unsafePathCount, 0);
      assert.equal(plan.openClawApprovalRequired, false);
      assert.equal(plan.automaticExecutionAllowed, true);
    }
  }
});

test('Sovereign control runtime cannot complete from natural reload without its existing Commander handler', async () => {
  for (const path of SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS) {
    let naturalCalls = 0;
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths: [path],
      adapters: { confirmNaturalReload: () => { naturalCalls++; return pass(); } } });
    assert.equal(result.ok, false);
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED);
    assert.equal(result.blocker, `REFRESH_HANDLER_MISSING:${POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER}`);
    assert.equal(result.exactHeadProofOk, false);
    assert.deepEqual(result.results, []);
    assert.equal(naturalCalls, 0);
  }
});

test('Sovereign control runtime preserves existing native refusal and exact-head proof requirements', async () => {
  for (const outcome of [
    { result: { ok: false, exactHeadProofOk: false, blocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN' },
      blocker: 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN' },
    { result: pass(A), blocker: `REFRESH_PROOF_FAILED:${POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER}` },
    { result: { ...pass(), exactHeadProofOk: false }, blocker: `REFRESH_PROOF_FAILED:${POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER}` },
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
      changedPaths: SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS,
      adapters: {
        refreshSovereignCommander: ({ targetId }) => { calls.push(targetId); return outcome.result; },
        confirmNaturalReload: () => { assert.fail('Cached relay imports cannot fall through to natural reload'); },
      } });
    assert.equal(result.ok, false);
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED);
    assert.equal(result.blocker, outcome.blocker);
    assert.equal(result.exactHeadProofOk, false);
    assert.deepEqual(calls, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  }
});

test('unregistered Sovereign control runtime neighbors block before any existing target is invoked', async () => {
  for (const unknown of [
    'scripts/battle-bridge-sovereign-relay-daemon-extra.mjs',
    'scripts/control-tower-build-consumer-v2.mjs',
    'scripts/sovereign-commander-native-inspect-v2.mjs',
    'scripts/unregistered-runtime.mjs',
  ]) {
    const changedPaths = [...SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS, unknown];
    const plan = classifyPostSyncRefresh(changedPaths);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
    assert.deepEqual(plan.internal.unknownPaths, [unknown]);
    assert.equal(plan.automaticExecutionAllowed, false);
    let calls = 0;
    const result = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B, changedPaths,
      adapters: { refreshSovereignCommander: () => { calls++; return pass(); } } });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
    assert.deepEqual(result.results, []);
    assert.equal(calls, 0);
  }
});

test('merged PR3333 full 43-path range selects existing owners and retains the separate plugin activation gate', async () => {
  // Exact merged 78899d5..30ba156 range; no Git or host execution is needed.
  const beforeHead = '78899d5f6298f6ca1df1f1ee080194d532d52415';
  const afterHead = '30ba1567ba01e77fd7f4db421cc3133abc258e1b';
  const changedPaths = [
    '.github/workflows/stephanos-control-tower-build.yml',
    'apps/stephanos-ai/controlSurface.mjs',
    'apps/stephanos-ai/index.html',
    'apps/stephanos-ai/workspace.css',
    'apps/stephanos-ai/workspace.js',
    'docs/architecture/control-tower-build-start-v1.md',
    'docs/architecture/sovereign-conversational-control-v1.md',
    'package.json',
    'plugins/sovereign-commander/.codex-plugin/plugin.json',
    'plugins/sovereign-commander/plugin.json',
    'plugins/sovereign-commander/skills/repair-stephanos-continuously/SKILL.md',
    'plugins/sovereign-commander/skills/saturated-mailbox-sovereign-recovery/SKILL.md',
    'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
    'plugins/sovereign-commander/skills/use-sovereign-commander/references/conversational-control-v1.md',
    'plugins/sovereign-commander/skills/verify-sovereign-runtime/SKILL.md',
    'scripts/battle-bridge-sovereign-relay-daemon.mjs',
    'scripts/canonical-mailbox-control-tower-observation.test.mjs',
    'scripts/canonical-mailbox-execution-ledger-v1.mjs',
    'scripts/control-tower-build-consumer-v1.mjs',
    'scripts/control-tower-build-consumer-v1.test.mjs',
    'scripts/sovereign-commander-native-inspect.mjs',
    'scripts/sovereign-commander-native-inspect.test.mjs',
    'shared/agents/controlTowerBuildBeaconFactsV1.mjs',
    'shared/agents/controlTowerBuildBeaconFactsV1.test.mjs',
    'shared/agents/controlTowerBuildReaderV1.mjs',
    'shared/agents/controlTowerBuildReaderV1.test.mjs',
    'shared/agents/controlTowerBuildRequestV1.mjs',
    'shared/agents/controlTowerBuildRequestV1.test.mjs',
    'shared/agents/controlTowerRequestObservationV1.mjs',
    'shared/agents/controlTowerRequestObservationV1.test.mjs',
    'shared/agents/originalSourceCustodyInspectionV1.test.mjs',
    'shared/agents/sovereignCommanderDesktopPlugin.test.mjs',
    'shared/agents/sovereignControlConversationV1.mjs',
    'shared/agents/sovereignControlConversationV1.test.mjs',
    'shared/agents/sovereignControlSystemStatusV1.mjs',
    'shared/agents/sovereignControlSystemStatusV1.test.mjs',
    'shared/agents/stephanosConversationRouterV1.mjs',
    'stephanos-server/routes/ai.js',
    'stephanos-server/services/sovereignControlConversationService.js',
    'stephanos-server/services/sovereignControlConversationService.test.js',
    'tests/stephanos-ai-control-surface.test.mjs',
    'tests/stephanos-ai-sovereign-control.browser.test.mjs',
    'tests/stephanos-conversation-router-v1.test.mjs',
  ];
  const expectedTargets = [
    POST_SYNC_REFRESH_TARGETS.UI_4173,
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.changedPathCount, 43);
  assert.equal(new Set(changedPaths).size, 43);
  assert.equal(plan.noRuntimePathCount, 23);
  assert.deepEqual(plan.internal.unknownPaths, []);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.equal(plan.pluginHostActivationRequired, true);
  assert.deepEqual(plan.targetIds, expectedTargets);

  const calls = [];
  const proveTarget = ({ targetId }) => { calls.push(targetId); return { ...pass(afterHead),
    ...(targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER ? { sovereignRelayProof: relayProof(afterHead) } : {}) }; };
  const result = await executePostSyncRefreshPlan({ beforeHead, afterHead, changedPaths,
    adapters: { refreshUi: proveTarget, restartBackend: proveTarget, restartMissionWorker: proveTarget,
      refreshSovereignCommander: proveTarget, confirmNaturalReload: proveTarget } });
  assert.deepEqual(calls, expectedTargets);
  assert.equal(result.ok, false);
  assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED);
  assert.equal(result.blocker, 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN');
  assert.equal(result.exactHeadProofOk, false);
  assert.equal(result.safeRefreshesCompleted, true);
  assert.equal(result.pluginHostActivationRequired, true);
});

test('relay source proof is required before fresh success checkpoint history and serialized resume', async () => {
  const targetId = POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER;
  const invalidProofs = [undefined, null, {}, ...[
    { watchdogSucceeded: false }, { healthy: false }, { sourceHead: A }, { sourceHeadMatchesLive: false },
    { processCount: 0 }, { processCount: 2 }, { processCount: '1' },
    { heartbeatAgeSeconds: -1 }, { heartbeatAgeSeconds: 31 }, { heartbeatAgeSeconds: '2' },
    { blocker: 'SOVEREIGN_RELAY_DAEMON_STALE_RECYCLE_FAILED' }, { extra: 'PRIVATE_VALUE' },
  ].map(change => ({ ...relayProof(), ...change }))];
  for (const sovereignRelayProof of invalidProofs) {
    let history = null;
    const blocked = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
      changedPaths: SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS,
      adapters: { refreshSovereignCommander: () => ({ ...pass(), sovereignRelayProof }) },
      onTargetComplete: (rows, observation) => {
        assert.equal(rows[0].ok, false);
        assert.equal(observation.failureKind, 'RESULT_UNPROVEN');
        history = reducePostSyncTargetFailureHistory(history, { expectedSourceHead: B,
          observedAtUtc: OUTCOME_TIME, ...observation });
      } });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocker, 'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN');
    assert.equal(history.failures[0].blocker, blocked.blocker);
    let calls = 0;
    const repaired = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
      changedPaths: SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS,
      completedResults: [{ targetId, ...pass(), sovereignRelayProof }],
      adapters: { refreshSovereignCommander: () => { calls++; return { ...pass(), sovereignRelayProof: relayProof() }; } } });
    assert.equal(calls, 1, 'Generic or malformed old proof cannot skip the existing owner');
    assert.equal(repaired.ok, true);
    const persisted = JSON.parse(JSON.stringify(buildPostSyncRefreshProjection(repaired, { beforeHead: A, afterHead: B })));
    assert.equal(persisted.sovereignRelayRefreshRequired, true);
    assert.deepEqual(persisted.resultTargets[0].sovereignRelayProof, relayProof());
    const resumed = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
      changedPaths: SOVEREIGN_RELAY_CONTROL_RUNTIME_PATHS, completedResults: persisted.resultTargets,
      adapters: { refreshSovereignCommander: () => { assert.fail('Validated same-head proof must resume'); } } });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.results[0].resumed, true);
  }
});

test('retained relay obligation survives a net revert without making unrelated Commander refresh relay-mandatory', async () => {
  const targetId = POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER;
  const unrelated = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: ['scripts/sovereign-commander-http.mjs'], adapters: { refreshSovereignCommander: () => pass() } });
  assert.equal(unrelated.ok, true);
  assert.equal(unrelated.plan.sovereignRelayRefreshRequired, false);
  const retained = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: ['docs/reverted-runtime.md'], sovereignRelayRefreshRequired: true,
    adapters: { refreshSovereignCommander: () => ({ ...pass(), sovereignRelayProof: relayProof() }) } });
  assert.equal(retained.ok, true);
  assert.deepEqual(retained.plan.targetIds, [targetId]);
  assert.equal(retained.plan.sovereignRelayRefreshRequired, true);
  const blocked = await executePostSyncRefreshPlan({ beforeHead: A, afterHead: B,
    changedPaths: ['scripts/unregistered-runtime.mjs'], sovereignRelayRefreshRequired: true,
    adapters: { refreshSovereignCommander: () => { assert.fail('Retained debt cannot exempt unknown source'); } } });
  assert.equal(blocked.blocker, 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH');
});

test('Git changed-path status parser includes deletions and both rename sides', () => {
  const parsed = parseGitChangedPathStatus([
    'D\tstephanos-server/server.js',
    'R100\tstephanos-server/legacy.js\tdocs/legacy.md',
    'M\tmain.js',
  ].join('\n'));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.paths, [
    'stephanos-server/server.js',
    'stephanos-server/legacy.js',
    'docs/legacy.md',
    'main.js',
  ]);
  assert.equal(parseGitChangedPathStatus('R100\tonly-one-path').ok, false);
});

test('classifies docs and tests as no-runtime changes', () => {
  const plan = classifyPostSyncRefresh(['docs/runbook.md', 'scripts/example.test.mjs']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.noRuntimePathCount, 2);
});

test('classifies the exact GitHub-hosted review toolchain as no-runtime', () => {
  const hostedReviewPaths = [
    'scripts/exact-head-review-dispatch.mjs',
    'scripts/exact-head-review-current-main-admission-v1.mjs',
    'scripts/bind-independent-review-handoff-provenance-v1.mjs',
    'scripts/retry-independent-review.mjs',
    'scripts/launch-missing-independent-review-v1.mjs',
    'scripts/recover-successful-independent-review-v1.mjs',
  ];
  const plan = classifyPostSyncRefresh(hostedReviewPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.noRuntimePathCount, hostedReviewPaths.length);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('classifies the exact GitHub-hosted mobile recovery attester as no-runtime', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-mobile-recovery-attestation-v1.yml',
    'scripts/battle-bridge-mobile-recovery-attestation-v1.mjs',
    'scripts/battle-bridge-mobile-recovery-attestation-v1.test.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.noRuntimePathCount, 3);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('mobile recovery attester allowance remains exact and does not admit arbitrary scripts', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-mobile-recovery-attestation-v1-unregistered.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.unknownPathCount, 1);
  assert.equal(plan.automaticExecutionAllowed, false);
});

test('hosted review dispatch changes do not poison unrelated safe runtime refresh targets', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/exact-head-review-dispatch.mjs',
    'shared/agents/unattendedReadinessV1.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  ]);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('classifies UI backend worker and natural reload targets deterministically', () => {
  const plan = classifyPostSyncRefresh([
    'stephanos-ui/src/main.jsx',
    'stephanos-server/server.js',
    'shared/agents/missionOrchestratorV1.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
  ]);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.UI_4173,
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
});


test('continuous repair script is a natural-reload source and never becomes an unclassified runtime blocker', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/sovereign-commander-stephanos-repair.mjs',
    'scripts/sovereign-commander-stephanos-repair.test.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.deepEqual(plan.internal.unknownPaths, []);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('exact six-path mailbox starvation delivery is installable through natural reload', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-mailbox-outbox-starvation-v1.yml',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.test.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/battle-bridge-github-command-mailbox.test.mjs',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, 6);
  assert.equal(plan.noRuntimePathCount, 3);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('complete mailbox ledger and guardian-chain repair range has no unclassified runtime path', () => {
  const changedPaths = [
    '.github/workflows/battle-bridge-mailbox-outbox-starvation-v1.yml',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.test.mjs',
    'scripts/battle-bridge-github-command-mailbox-with-receipt-index.test.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/battle-bridge-github-command-mailbox.test.mjs',
    'scripts/battle-bridge-recovery-mesh-guardian.test.mjs',
    'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.test.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, changedPaths.length);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('mailbox runtime changes require a fresh mailbox process before natural reload proof', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['scripts/battle-bridge-github-command-mailbox.mjs'],
    adapters: {
      restartGitHubMailbox: async () => { calls.push('mailbox'); return pass(); },
      confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['mailbox', 'natural']);
});

test('launcher-critical shell sources select the UI refresh target', () => {
  for (const path of [
    'main.js',
    'modules/command-deck/command-deck.js',
    'system/module_loader.js',
    'system/workspace.js',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173]);
  }
});

test('merged Music Intelligence Centre changes automatically select the served UI refresh', () => {
  const plan = classifyPostSyncRefresh([
    'apps/music-tile/index.html',
    'apps/music-tile/main.js',
    'apps/music-tile/style.css',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173]);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('actual UI build verify serve and exact-proof tools select UI refresh', () => {
  for (const path of [
    'scripts/build-stephanos-ui.mjs',
    'scripts/clean-stephanos-dist.mjs',
    'scripts/stephanos-build-utils.mjs',
    'scripts/verify-stephanos-dist.mjs',
    'scripts/serve-stephanos-dist.mjs',
    'scripts/refresh-stephanos-ui-4173.mjs',
    'scripts/battle-bridge-ignition-supervisor.mjs',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY, path);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173], path);
  }
});

test('merged Control Tower commissioning range refreshes the existing UI backend and worker owners', async () => {
  // Exact d729d17..02f5dea merge range that previously blocked all refreshes.
  const changedPaths = [
    'docs/architecture/launcher-publication-readiness-separation-2961.md',
    'docs/architecture/source-worker-grant-custody-contract-2961.md',
    'scripts/battle-bridge-ignition-supervisor.mjs',
    'scripts/battle-bridge-ignition-supervisor.test.mjs',
    'scripts/battle-bridge-ui-4173-repair.mjs',
    'scripts/battle-bridge-ui-4173-repair.test.mjs',
    'scripts/fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs',
    'scripts/launcher-publication-readiness.test.mjs',
    'scripts/launcher-readiness-live-facts.mjs',
    'scripts/launcher-readiness-live-facts.test.mjs',
    'scripts/launcher-readiness-planner.mjs',
    'scripts/mission-orchestrator-worker-supervised.mjs',
    'scripts/mission-orchestrator-worker-supervised.test.mjs',
    'scripts/mission-orchestrator-worker.mjs',
    'scripts/sovereign-fixed-runtime-worker-v1.test.mjs',
    'scripts/sovereign-maintenance-installer-source-job-v3.test.mjs',
    'shared/agents/battleBridgePublisher.mjs',
    'shared/agents/durableFlywheelControllerVNext.mjs',
    'shared/agents/engineeringIncidentMethodMemoryV1.mjs',
    'shared/agents/engineeringIncidentMethodMemoryV1.test.mjs',
    'shared/agents/missionOrchestratorWorker.mjs',
    'shared/agents/missionWorkerGrantCompositionV1.test.mjs',
    'shared/agents/sharedWorkspaceOperationalFactsV1.mjs',
    'stephanos-server/services/criticalBacklogConveyorServiceCore.js',
    'stephanos-server/services/missionOrchestratorWorkerConsumer.js',
    'stephanos-server/services/missionOrchestratorWorkerConsumer.test.js',
    'stephanos-server/services/missionOrchestratorWorkerService.js',
    'stephanos-server/services/missionOrchestratorWorkerService.test.js',
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.changedPathCount, 28);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.internal.unknownPaths, []);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.UI_4173,
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  ]);

  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
      restartMissionWorker: async () => { calls.push('worker'); return pass(); },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.exactHeadProofOk, true);
  assert.deepEqual(calls, ['ui', 'backend', 'worker']);
});

test('each launcher readiness dependency requires served UI proof and cannot use natural reload proof', async () => {
  for (const path of [
    'scripts/launcher-readiness-live-facts.mjs',
    'scripts/launcher-readiness-planner.mjs',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY, path);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173], path);
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [path],
      adapters: {
        refreshUi: async () => { calls.push('ui'); return pass(A); },
        confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
      },
    });
    assert.equal(result.ok, false, path);
    assert.equal(result.exactHeadProofOk, false, path);
    assert.equal(result.blocker, `REFRESH_PROOF_FAILED:${POST_SYNC_REFRESH_TARGETS.UI_4173}`, path);
    assert.deepEqual(calls, ['ui'], path);
  }
});

test('the parse-only fixed-runtime closure fixture needs no runtime refresh', () => {
  const path = 'scripts/fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs';
  const plan = classifyPostSyncRefresh([path]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.targetIds, []);
  assert.deepEqual(plan.internal.noRuntimePaths, [path]);
});

test('launcher and fixture allowances stay exact and refuse unregistered neighbors before any refresh', async () => {
  for (const path of [
    'scripts/launcher-readiness-live-facts-unregistered.mjs',
    'scripts/launcher-readiness-planner-unregistered.mjs',
    'scripts/launcher-readiness-unregistered.mjs',
    'scripts/fixtures/sovereign-fixed-runtime-closure-fixture-unregistered.mjs',
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [path, 'main.js'],
      adapters: { refreshUi: async () => { calls.push('ui'); return pass(); } },
    });
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH, path);
    assert.equal(result.plan.automaticExecutionAllowed, false, path);
    assert.deepEqual(result.plan.internal.unknownPaths, [path], path);
    assert.deepEqual(calls, [], path);
  }
});

test('shared runtime refreshes UI and backend', () => {
  const plan = classifyPostSyncRefresh(['shared/runtime/runtimeStatusModel.mjs']);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173, POST_SYNC_REFRESH_TARGETS.BACKEND_8787]);
});

test('OpenClaw changes remain approval-gated while safe targets stay classified', () => {
  const plan = classifyPostSyncRefresh(['integrations/openclaw/stephanos-ignite-command/index.mjs', 'stephanos-ui/src/main.jsx']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW);
  assert.equal(plan.openClawApprovalRequired, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.UI_4173));
});

test('Sovereign Commander runtime estate is explicitly refreshable and boot installer stays non-runtime', () => {
  const changedPaths = [
    'docs/architecture/sovereign-commander-v1.md',
    'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
    'scripts/sovereign-commander-http.mjs',
    'scripts/sovereign-commander-ignition-autoheal.mjs',
    'scripts/sovereign-commander-ignition-autoheal.test.mjs',
    'scripts/sovereign-commander-mcp.mjs',
    'scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1',
    'scripts/windows/run-sovereign-commander-hidden.ps1',
    'shared/agents/sovereignCommanderCapabilityParityV1.mjs',
    'shared/agents/sovereignCommanderCapabilityParityV1.test.mjs',
    'shared/agents/sovereignCommanderMcp.test.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.test.mjs',
    'shared/agents/sovereignCommanderV1.mjs',
    'shared/agents/sovereignCommanderV1.test.mjs',
    'shared/agents/sovereignCommanderWindows.test.mjs',
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
  ]);
  assert.equal(plan.changedPathCount, changedPaths.length);
  assert.equal(plan.noRuntimePathCount, 9);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('merged controller-lane status estate is fully classified and refreshable', () => {
  const changedPaths = [
    'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/battle-bridge-github-command-mailbox.test.mjs',
    'scripts/sovereign-commander-http.mjs',
    'scripts/sovereign-commander-ignition-autoheal.mjs',
    'scripts/sovereign-commander-ignition-autoheal.test.mjs',
    'scripts/sovereign-commander-mcp.mjs',
    'scripts/sovereign-controller-lane-status.mjs',
    'scripts/sovereign-controller-lane-status.test.mjs',
    'shared/agents/sovereignCommanderBattleBridgeV1.mjs',
    'shared/agents/sovereignCommanderBattleBridgeV1.test.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.test.mjs',
    'shared/agents/sovereignCommanderRepairVerbs.test.mjs',
    'shared/agents/sovereignCommanderV1.mjs',
    'shared/agents/sovereignCommanderV1.test.mjs',
    'shared/agents/stephanosCoreDaemonSovereign.test.mjs',
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX));
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER));
});

test('qualified Goal Builder maintenance child is exact Commander runtime and the merged repair range is fully classified', () => {
  const runtime = 'scripts/sovereign-commander-goal-builder-repair.mjs';
  const single = classifyPostSyncRefresh([runtime]);
  assert.equal(single.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(single.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(single.unknownPathCount, 0);
  assert.equal(single.automaticExecutionAllowed, true);

  const mergedRange = classifyPostSyncRefresh([
    runtime,
    'scripts/sovereign-commander-goal-builder-repair.test.mjs',
    'scripts/sovereign-commander-http.mjs',
    'shared/agents/sovereignCommanderHttp.test.mjs',
  ]);
  assert.equal(mergedRange.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(mergedRange.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(mergedRange.noRuntimePathCount, 2);
  assert.equal(mergedRange.unknownPathCount, 0);
  assert.equal(mergedRange.automaticExecutionAllowed, true);

  const unknown = classifyPostSyncRefresh(['scripts/sovereign-commander-goal-builder-repair-v2.mjs']);
  assert.equal(unknown.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.deepEqual(unknown.internal.unknownPaths, ['scripts/sovereign-commander-goal-builder-repair-v2.mjs']);
});

test('Sovereign Commander runtime changes execute only the dedicated fixed refresh target', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['scripts/sovereign-commander-http.mjs'],
    adapters: {
      refreshSovereignCommander: async () => {
        calls.push('sovereign');
        return pass();
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sovereign']);
  assert.deepEqual(result.results.map((entry) => entry.targetId), [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
});


test('zero-gap Sovereign closure estate stays automatically classifiable', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-observation.mjs',
    'scripts/battle-bridge-ui-4173-repair.mjs',
    'scripts/browser-proof-runner.mjs',
    'scripts/sovereign-commander-http.mjs',
    'scripts/sovereign-commander-ignition-autoheal.mjs',
    'scripts/sovereign-commander-mcp.mjs',
    'scripts/sovereign-commander-fleet-goal-supervisor.mjs',
    'scripts/sovereign-commander-ui-4173-repair.mjs',
    'scripts/sovereign-commander-ui-runtime-proof.mjs',
    'scripts/windows/configure-sovereign-commander-tailscale.ps1',
    'scripts/windows/repair-openclaw-full-stack.ps1',
    'shared/agents/sovereignCommanderV1.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
    'shared/agents/sovereignCommanderCapabilityParityV1.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
    'scripts/battle-bridge-post-sync-refresh.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.UI_4173));
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER));
});

test('VR Atlas changes refresh UI then require exact-head browser proof', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['apps/vr-capability-atlas/main.js'],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      proveVrAtlas: async () => { calls.push('vr-proof'); return pass(); },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['ui', 'vr-proof']);
  assert.deepEqual(result.results.map((entry) => entry.targetId), [
    POST_SYNC_REFRESH_TARGETS.UI_4173,
    POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF,
  ]);
});


test('retained maintenance owner observer changes restart only Sovereign Commander', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/sovereign-maintenance-owner-observation-v2.mjs',
    'scripts/sovereign-maintenance-owner-observation-v2.test.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('Sovereign visibility snapshot changes restart the Sovereign runtime', () => {
  const plan = classifyPostSyncRefresh(['scripts/sovereign-commander-visibility-snapshot.mjs']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('unknown and unsafe runtime paths fail closed', () => {
  assert.equal(classifyPostSyncRefresh(['shared/new-runtime-surface.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.equal(classifyPostSyncRefresh(['scripts/unregistered-long-running-service.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.equal(classifyPostSyncRefresh(['../outside.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNSAFE_CHANGED_PATH);
});

test('executes only selected targets and requires exact after-head proof', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['shared/runtime/runtimeStatusModel.mjs'],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['ui', 'backend']);
  assert.equal(result.exactHeadProofOk, true);

  const failed = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['stephanos-server/server.js'],
    adapters: { restartBackend: async () => pass(A) },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.blocker, /REFRESH_PROOF_FAILED/);
});

test('completes safe refreshes but blocks final completion for OpenClaw approval', async () => {
  let uiCalls = 0;
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['integrations/openclaw/plugin.mjs', 'stephanos-ui/src/main.jsx'],
    adapters: { refreshUi: async () => { uiCalls += 1; return pass(); }, confirmNaturalReload: async () => pass() },
  });
  assert.equal(uiCalls, 1);
  assert.equal(result.safeRefreshesCompleted, true);
  assert.equal(result.blocker, 'OPENCLAW_REFRESH_APPROVAL_REQUIRED');
});

test('resumes already-proven targets without repeating mutation', async () => {
  const calls = [];
  const checkpoints = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['shared/runtime/runtimeStatusModel.mjs'],
    completedResults: [{ targetId: POST_SYNC_REFRESH_TARGETS.UI_4173, ...pass() }],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
    },
    onTargetComplete: async (results) => checkpoints.push(results.map((item) => item.targetId)),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['backend']);
  assert.equal(result.results[0].resumed, true);
  assert.deepEqual(checkpoints, [[POST_SYNC_REFRESH_TARGETS.UI_4173, POST_SYNC_REFRESH_TARGETS.BACKEND_8787]]);
});

test('projection publishes counts and target proofs but no changed path values', () => {
  const result = {
    ok: true,
    classification: POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_COMPLETE,
    exactHeadProofOk: true,
    plan: classifyPostSyncRefresh(['stephanos-server/server.js']),
    results: [{ targetId: POST_SYNC_REFRESH_TARGETS.BACKEND_8787, ...pass() }],
  };
  const projection = buildPostSyncRefreshProjection(result, { beforeHead: A, afterHead: B });
  assert.equal(projection.pathValuesPublished, false);
  assert.equal(projection.changedPathCount, 1);
  assert.doesNotMatch(JSON.stringify(projection), /stephanos-server\/server\.js/);
});

test('new Sovereign Commander skill manifests and full nine-file skill pack classify to real refresh', () => {
  const paths = [
    'plugins/sovereign-commander/.codex-plugin/plugin.json',
    'plugins/sovereign-commander/plugin.json',
    'plugins/sovereign-commander/skills/commission-original-source-custody/SKILL.md',
    'plugins/sovereign-commander/skills/repair-build-conveyors/SKILL.md',
    'plugins/sovereign-commander/skills/repair-sovereign-fast-bridge/SKILL.md',
    'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
    'shared/agents/sovereignCommanderDesktopPlugin.test.mjs',
    'shared/agents/sovereignGoalRecoveryTriageV1.mjs',
    'shared/agents/sovereignGoalRecoveryTriageV1.test.mjs',
  ];
  const observed = classifyPostSyncRefresh(paths);
  assert.equal(observed.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(observed.automaticExecutionAllowed, true);
  assert.deepEqual(observed.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
  ]);
  assert.equal(observed.unknownPathCount, 0);
  assert.equal(observed.changedPathCount, paths.length);
});

test('Sovereign Commander manifest allowance stays exact, rejects unrelated plugin entrypoint', () => {
 const result=classifyPostSyncRefresh(['plugins/untrusted-plugin/plugin.json']);
 assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
 assert.equal(result.automaticExecutionAllowed,false);
 assert.equal(result.unknownPathCount,1);
});

test('versioned Sovereign manifests never claim desktop skill activation from the HTTP daemon alone', async () => {
  const changedPaths = ['plugins/sovereign-commander/plugin.json'];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.pluginHostActivationRequired, true);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]);

  const onlyDaemon = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: { refreshSovereignCommander: async () => pass() },
  });
  assert.equal(onlyDaemon.ok, false);
  assert.equal(onlyDaemon.blocker, 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN');
  assert.equal(onlyDaemon.safeRefreshesCompleted, true);
  assert.equal(buildPostSyncRefreshProjection(onlyDaemon, { beforeHead: A, afterHead: B }).pluginHostActivationRequired, true);

  const fakeHost = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: {
      refreshSovereignCommander: async () => pass(),
      verifySovereignPluginHost: async () => ({ ...pass(), desktopPluginHostHandshakeVerified: false, loadedManifestVerified: true }),
    },
  });
  assert.equal(fakeHost.ok, false);
  assert.equal(fakeHost.blocker, 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN');

  const wrongHead = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: {
      refreshSovereignCommander: async () => pass(),
      verifySovereignPluginHost: async () => ({
        ...pass(A), desktopPluginHostHandshakeVerified: true, loadedManifestVerified: true,
      }),
    },
  });
  assert.equal(wrongHead.ok, false);

  const witnessed = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: {
      refreshSovereignCommander: async () => pass(),
      verifySovereignPluginHost: async () => ({
        ...pass(), desktopPluginHostHandshakeVerified: true, loadedManifestVerified: true,
      }),
    },
  });
  assert.equal(witnessed.ok, true);
  assert.equal(witnessed.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_PASS');
});

test('ordinary Commander script refreshes remain independent of desktop-plugin reattachment', async () => {
  const changedPaths = ['scripts/sovereign-commander-http.mjs'];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths,
    adapters: { refreshSovereignCommander: async () => pass() },
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.pluginHostActivationRequired, false);
});

test('attended fixed-runtime commissioning helpers are startup-only and create no post-sync target', async () => {
  for (const path of [
    'scripts/sovereign-fixed-runtime-install-current-v1.mjs',
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [path],
      adapters: Object.fromEntries([
        'refreshUi', 'restartBackend', 'restartMissionWorker',
        'restartGitHubMailbox', 'refreshSovereignCommander', 'confirmNaturalReload',
      ].map(name => [name, async () => { calls.push(name); return pass(); }])),
    });
    assert.equal(result.ok, true, path);
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED, path);
    assert.deepEqual(result.plan.internal.noRuntimePaths, [path], path);
    assert.deepEqual(result.plan.targetIds, [], path);
    assert.deepEqual(calls, [], path);
  }
});

test('invocation-loaded ignition sources do not introduce a post-sync service launch', async () => {
  for (const path of [
    'scripts/ignite-stephanos-local.mjs',
    'scripts/ignition-cockpit-model.mjs',
    'scripts/run-battle-bridge-ignition.mjs',
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [path],
      adapters: Object.fromEntries([
        'refreshUi', 'restartBackend', 'restartMissionWorker',
        'restartGitHubMailbox', 'refreshSovereignCommander', 'confirmNaturalReload',
      ].map(name => [name, async () => { calls.push(name); return pass(); }])),
    });
    assert.equal(result.ok, true, path);
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED, path);
    assert.deepEqual(result.plan.internal.noRuntimePaths, [path], path);
    assert.deepEqual(result.plan.targetIds, [], path);
    assert.deepEqual(calls, [], path);
  }
});

test('the existing relay core uses natural reload and rejects stale source proof', async () => {
  const path = 'scripts/chatgpt-shared-workspace-github-relay-core.mjs';
  for (const observedHead of [A, B]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [path],
      adapters: {
        confirmNaturalReload: async () => { calls.push('natural'); return pass(observedHead); },
        refreshUi: async () => { calls.push('ui'); return pass(); },
        restartBackend: async () => { calls.push('backend'); return pass(); },
        restartMissionWorker: async () => { calls.push('worker'); return pass(); },
      },
    });
    assert.deepEqual(result.plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
    assert.deepEqual(calls, ['natural']);
    assert.equal(result.ok, observedHead === B);
    assert.equal(result.exactHeadProofOk, observedHead === B);
    assert.equal(result.blocker, observedHead === B ? '' : 'REFRESH_PROOF_FAILED:natural-reload');
  }
});

// Authenticated protected-main comparison 5e0cdfc..dcecfc6 (PRs 2344, 1832,
// 3263 and 2481). This is source-range proof, not the private host's debt list.
const POST_3328_PROTECTED_RANGE = [
  'docs/architecture/autonomous-failure-sentinel-m1-v1.md',
  'docs/operations/universal-project-chat-bootstrap-v1.md',
  'scripts/chatgpt-shared-workspace-github-relay-core.mjs',
  'scripts/chatgpt-universal-project-chat-bootstrap-wiring.test.mjs',
  'scripts/ignite-stephanos-local.mjs',
  'scripts/ignite-stephanos-local.test.mjs',
  'scripts/ignition-cockpit-model.mjs',
  'scripts/ignition-cockpit-model.test.mjs',
  'scripts/mission-orchestrator-worker-supervised.mjs',
  'scripts/mission-orchestrator-worker-supervised.test.mjs',
  'scripts/ollama-ignition-autostart.test.mjs',
  'scripts/run-battle-bridge-ignition.mjs',
  'scripts/run-battle-bridge-ignition.test.mjs',
  'shared/agents/autonomousFailureSentinelV1.mjs',
  'shared/agents/autonomousFailureSentinelV1.test.mjs',
  'shared/agents/universalProjectChatBootstrapV1.mjs',
];

test('the actual later protected range retains backend and worker proof requirements', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B, changedPaths: POST_3328_PROTECTED_RANGE,
    adapters: {
      restartBackend: async () => { calls.push('backend'); return pass(); },
      restartMissionWorker: async () => { calls.push('worker'); return pass(); },
      confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
    },
  });
  assert.equal(result.plan.changedPathCount, 16);
  assert.deepEqual(result.plan.internal.unknownPaths, []);
  assert.deepEqual(result.plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.deepEqual(calls, ['backend', 'worker', 'natural']);
  assert.equal(result.ok, true);
  assert.equal(result.exactHeadProofOk, true);
});

test('invocation-loaded additions cannot satisfy retained launcher debt with stale UI proof', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A, afterHead: B,
    changedPaths: [...POST_3328_PROTECTED_RANGE, 'scripts/battle-bridge-ignition-supervisor.mjs'],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(A); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
      restartMissionWorker: async () => { calls.push('worker'); return pass(); },
      confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.exactHeadProofOk, false);
  assert.equal(result.blocker, 'REFRESH_PROOF_FAILED:stephanos-ui-4173');
  assert.deepEqual(calls, ['ui']);
});

test('relay and ignition allowances refuse unknown neighboring scripts before any target executes', async () => {
  for (const path of [
    'scripts/chatgpt-shared-workspace-github-relay-core-unregistered.mjs',
    'scripts/chatgpt-shared-workspace-github-relay-new-core.mjs',
    'scripts/ignition-cockpit-model-unregistered.mjs',
    'scripts/run-battle-bridge-ignition-unregistered.mjs',
    'scripts/unregistered-ignition.mjs',
  ]) {
    const calls = [];
    const result = await executePostSyncRefreshPlan({
      beforeHead: A, afterHead: B, changedPaths: [...POST_3328_PROTECTED_RANGE, path],
      adapters: {
        restartBackend: async () => { calls.push('backend'); return pass(); },
        restartMissionWorker: async () => { calls.push('worker'); return pass(); },
        confirmNaturalReload: async () => { calls.push('natural'); return pass(); },
      },
    });
    assert.equal(result.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH, path);
    assert.equal(result.plan.automaticExecutionAllowed, false, path);
    assert.ok(result.plan.internal.unknownPaths.includes(path), path);
    assert.deepEqual(calls, [], path);
  }
});
