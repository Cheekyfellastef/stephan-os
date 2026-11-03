// Fleet acceptance: every executable builder exit must retain proof-backed pickup and terminal truth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { buildMissionWorkerAction } from '../shared/agents/missionOrchestratorWorker.mjs';
import {
  SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE,
  buildSovereignCommanderCapabilityParityLedger,
  classifyRemoteCommanderCapabilityObservation,
} from '../shared/agents/sovereignCommanderCapabilityParityV1.mjs';
import { readExecutionReceiptHistory } from '../shared/agents/executionReceiptV1.mjs';
import { appendMissionEvent, createMissionRecord } from '../stephanos-server/services/missionOrchestratorStore.js';
import {
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
} from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import {
  processNextCodexItem,
  processNextOpenClawLocalItem,
  processNextOpenClawStandaloneItem,
  processNextStephanosNativeItem,
} from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';
import { processNextProviderNeutralSourceBuild } from '../stephanos-server/services/providerNeutralSourceBuilderService.js';

// Retain Builder 8's new independent capacity and publisher regressions in the
// existing proof entry point, without altering the protected Actions workflow.
import '../shared/agents/sovereignCommanderBuilder8CapacityV1.test.mjs';
import '../stephanos-server/services/sovereignBuilder8CapacityService.test.js';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const proof = (requirement, receiptId, source = 'all-builder-exits-proof') => ({
  receiptId,
  requirement,
  source,
  evidenceType: 'command-output',
  verified: true,
  exitCode: 0,
});

function run(executable, args, options = {}) {
  const normalized = executable === 'git.exe'
    ? 'git'
    : executable === 'node.exe'
      ? process.execPath
      : executable;
  return spawnSync(normalized, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

async function runtime(issueNumber, adapter) {
  const parent = await mkdtemp(join(tmpdir(), `all-builder-${adapter}-`));
  const repoRoot = join(parent, 'repo');
  const worktreePath = repoRoot;
  const root = join(parent, 'state');
  const snapshotRoot = join(parent, 'proof');
  const queueRoot = join(parent, 'queue');
  const sharedWorkspaceRoot = join(parent, 'workspace');
  await Promise.all([
    mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true }),
    mkdir(root, { recursive: true }),
    mkdir(snapshotRoot, { recursive: true }),
    mkdir(queueRoot, { recursive: true }),
    mkdir(sharedWorkspaceRoot, { recursive: true }),
  ]);
  await writeFile(join(repoRoot, 'shared', 'agents', 'example.mjs'), 'export const value = 1;\n');
  await writeFile(join(repoRoot, 'focused.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './shared/agents/example.mjs';",
    "test('value is updated', () => assert.equal(value, 2));",
    '',
  ].join('\n'));
  for (const args of [
    ['init'],
    ['config', 'user.email', 'all-builder-proof@example.invalid'],
    ['config', 'user.name', 'All Builder Proof'],
    ['add', '.'],
    ['commit', '-m', 'baseline'],
  ]) {
    const result = run('git.exe', ['-C', repoRoot, ...args], { cwd: repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }
  const sourceHeadResult = run('git.exe', ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot });
  assert.equal(sourceHeadResult.status, 0, sourceHeadResult.stderr);
  const sourceHead = sourceHeadResult.stdout.trim().toLowerCase();
  assert.match(sourceHead, /^[0-9a-f]{40}$/);
  const missionId = `critical-${issueNumber}-${adapter.replace(/[^a-z0-9]+/g, '-')}`;
  const branch = `openclaw/all-builder-${issueNumber}-${adapter.replace(/[^a-z0-9]+/g, '-')}`.slice(0, 120);
  const options = {
    root,
    snapshotRoot,
    queueRoot,
    sharedWorkspaceRoot,
    repoRoot,
    env: {
      STEPHANOS_MISSION_WORKER_QUEUE_DIR: queueRoot,
      STEPHANOS_SHARED_AGENT_WORKSPACE: sharedWorkspaceRoot,
      STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: repoRoot,
    },
  };
  const created = await createMissionRecord({
    missionId,
    operatorIntent: `Prove ${adapter} can claim one bounded goal packet.`,
    intendedOutcome: `${adapter} reaches real execution truth without false running state.`,
    missionKind: 'implementation',
    repository: REPOSITORY,
    repositoryRoot: repoRoot,
    branch,
    worktreePath,
    allowedFiles: ['shared/agents/example.mjs'],
    requiredEvidence: ['focused test output'],
    requiredTests: ['node --test focused.test.mjs'],
  }, options);
  const ready = await appendMissionEvent(missionId, {
    eventId: `${adapter}-worktree-ready`.slice(0, 120),
    eventType: 'WORKTREE_READY',
    worktreePath,
    clean: true,
    receipt: proof('isolated worktree', `${adapter}-worktree-proof`),
  }, options);
  return { parent, repoRoot, worktreePath, missionId, branch, sourceHead, options, ready: ready.state };
}

async function publishExactBuilder(runtimeState, { adapter, route, issueNumber }) {
  const { options, ready } = runtimeState;
  const draft = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    sourceRevision: runtimeState.sourceHead,
    boundedActionCount: 1,
    missionId: ready.missionId,
    missionRevision: ready.revision,
    currentPhase: ready.currentPhase,
    adapter,
    workerId: `${adapter}-proof-worker`,
    capacityRoute: route,
    capacityReceiptId: `${adapter}-proof-capacity`,
    capacityProofRefs: [`receipts/${adapter}/proof-capacity.json`],
    repository: ready.repository,
    issueNumber,
    prNumber: null,
    branch: ready.git.branch,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const action = buildMissionWorkerAction(ready, { actionGrant: draft });
  assert.equal(action.actionKind, 'agent-handoff');
  assert.equal(action.adapter, adapter);
  const grant = {
    ...draft,
    actionId: action.actionId,
    actionKind: action.actionKind,
    operation: action.operation || '',
  };
  const dispatch = await publishNextMissionWorkerAction({
    ...options,
    actionGrant: grant,
    sourceRevision: runtimeState.sourceHead,
  });
  assert.equal(dispatch.published, true);
  assert.equal(dispatch.adapter, adapter);
  assert.equal(dispatch.handoffResponsibility.state, 'PICKUP_PENDING');
  const queued = (await readMissionWorkerQueue(options)).find((entry) => entry.adapter === adapter);
  assert.ok(queued);
  assert.equal(queued.item.executionBinding.executionId, action.actionId);
  assert.equal(queued.item.actionGrant.issueNumber, issueNumber);
  return { action, grant, queued };
}

async function assertReceiptChain(runtimeState, published) {
  const binding = published.queued.item.executionBinding;
  const history = await readExecutionReceiptHistory(
    runtimeState.options.sharedWorkspaceRoot,
    {
      executionId: binding.executionId,
      leaseKey: binding.leaseKey,
      expectedHead: runtimeState.sourceHead,
    },
    { repoRoot: runtimeState.repoRoot },
  );
  assert.equal(history.ok, true);
  assert.deepEqual(
    history.receipts.map((receipt) => receipt.state),
    ['queued', 'accepted', 'started', 'progress', 'completed'],
  );
}

function successfulNoMutationExecution(adapter) {
  return async (action) => ({
    success: true,
    resultId: `${adapter}-result`,
    changedFiles: [],
    completedAt: new Date().toISOString(),
    receipt: proof(`${adapter} result`, `${adapter}-result-receipt`, adapter),
    evidenceReceipts: [proof('focused test output', `${adapter}-evidence`, adapter)],
  });
}

for (const builder of [
  { adapter: 'codex', route: 'CODEX', issueNumber: 7101, process: processNextCodexItem, executeKey: 'executeCodexAction' },
  { adapter: 'openclaw-standalone', route: 'OPENCLAW_STANDALONE', issueNumber: 7102, process: processNextOpenClawStandaloneItem, executeKey: 'executeOpenClawStandaloneAction' },
  { adapter: 'openclaw-local', route: 'OPENCLAW_LOCAL', issueNumber: 7103, process: processNextOpenClawLocalItem, executeKey: 'executeOpenClawLocalAction' },
  { adapter: 'stephanos-native', route: 'STEPHANOS_NATIVE', issueNumber: 7104, process: processNextStephanosNativeItem, executeKey: 'executeStephanosNativeAction' },
]) {
  test(`${builder.adapter} claims exact goal packet and emits full execution truth`, async () => {
    const fx = await runtime(builder.issueNumber, builder.adapter);
    const published = await publishExactBuilder(fx, builder);
    const processed = await builder.process({
      ...fx.options,
      actionGrant: published.grant,
      [builder.executeKey]: successfulNoMutationExecution(builder.adapter),
    });
    assert.equal(processed.processed, true);
    assert.equal(processed.result.finalVerdict, 'MISSION_WORKER_ITEM_COMPLETE');
    assert.equal(processed.claim.pickupProof.state, 'PROCESSING_CLAIM_PROVEN');
    await assertReceiptChain(fx, published);
  });
}

const PATCH = [
  'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
  '--- a/shared/agents/example.mjs',
  '+++ b/shared/agents/example.mjs',
  '@@ -1 +1 @@',
  '-export const value = 1;',
  '+export const value = 2;',
  '',
].join('\n');

for (const builder of [
  { adapter: 'foundry-forge', route: 'FOUNDRY_FORGE', issueNumber: 7105 },
  { adapter: 'chatgpt-github', route: 'CHATGPT_GITHUB', issueNumber: 7106 },
  { adapter: 'sovereign-commander', route: 'SOVEREIGN_COMMANDER', issueNumber: 7108 },
]) {
  test(`${builder.adapter} claims exact goal packet, mutates/tests source, and emits full execution truth`, async () => {
    const fx = await runtime(builder.issueNumber, builder.adapter);
    const published = await publishExactBuilder(fx, builder);
    const processed = await processNextProviderNeutralSourceBuild({
      ...fx.options,
      preferredAdapter: builder.adapter,
      actionGrant: published.grant,
      runCommand: run,
      generatePatch: async () => ({ patch: PATCH, summary: `${builder.adapter} bounded proof mutation` }),
    });
    assert.equal(processed.processed, true);
    assert.equal(processed.success, true, processed.error);
    assert.equal(processed.finalVerdict, 'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED');
    assert.equal(processed.adapter, builder.adapter);
    await assertReceiptChain(fx, published);
  });
}

test('Desktop Commander source handoff is absorbed by the green Sovereign source-construction lane', () => {
  const observation = {
    adapter: 'desktop-commander',
    path: 'C:/queue/desktop-source-build.json',
    item: {
      missionId: 'critical-7107-desktop-commander',
      actionId: 'desktop-source-build',
      payload: { actionKind: 'agent-handoff' },
    },
  };
  const classified = classifyRemoteCommanderCapabilityObservation(observation);
  assert.equal(classified.capabilityId, 'source-construction');
  assert.equal(classified.state, SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATE.PARITY_PRESENT);
  assert.equal(classified.sovereignEquivalent, 'sovereign-source-construction-lane');
  const ledger = buildSovereignCommanderCapabilityParityLedger([observation], {
    nowUtc: '2026-10-06T15:30:00.000Z',
  });
  assert.equal(ledger.buildableGapCount, 0);
  assert.equal(ledger.parityPresentCount, 1);
  assert.equal(ledger.zeroGapInvariantSatisfied, true);
  assert.equal(ledger.daemonMayReportGreen, true);
  assert.equal(ledger.finalVerdict, 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN');
});
