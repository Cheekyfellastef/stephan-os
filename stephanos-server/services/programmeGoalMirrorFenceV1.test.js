import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import {
  buildGithubGoalMirrorEstate, projectGoalMirrorReconciliationState,
  publishGithubGoalMirrorEstate, projectGithubGoalMirrorFallback,
  selectGoalRecordsForProgrammeProjection, readAuthoritativeProgrammeProjection,
  projectGoalMirrorAdmissionSnapshot,
} from './programmeAuthorityService.js';
import { createSharedWorkspaceStatusRecord, writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { createProgrammeControllerHeartbeat } from '../../shared/agents/programmeAuthorityV1.mjs';
import { createMissionWorkerHeartbeatRecord, resolveCanonicalMissionWorkerPaths } from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

const NOW = '2026-10-30T01:00:00.000Z';
const HEAD = 'a'.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os';
const missing = () => Object.assign(new Error('fixture missing'), { code: 'ENOENT' });
const root = path.resolve(os.tmpdir(), 'goal-mirror-fence-never-created');
const home = path.resolve(os.tmpdir(), 'goal-mirror-home-never-created');
const paths = resolveCanonicalMissionWorkerPaths({ env: {}, home });
const issue = { issueNumber: 2002, repository: REPO, title: 'Mirror fence fixture', retrievedAt: NOW,
  admission: { resourceIds: ['repo:Cheekyfellastef/stephan-os:path:shared/agents'] },
  operatorLaneContainment: { active: false } };
const estate = { ok: true, retrievedAt: NOW, issues: [issue],
  discoveredIssues: [{ issueNumber: 2002, retrievedAt: NOW }] };
const mirror = buildGithubGoalMirrorEstate([], estate, NOW);

function fence(overrides = {}) {
  return {
    ...createSharedWorkspaceStatusRecord({ statusId: 'github-goal-mirror-reconciliation',
      participantId: 'programme-authority', timestampUtc: NOW, status: 'RECONCILING' }),
    schema: 'stephanos.github-goal-mirror-reconciliation.v1',
    mirrorObservedAtUtc: NOW, mirrorLeaseExpiresAtUtc: '2026-10-31T01:00:00.000Z',
    mirroredIssueNumbers: [2002], fallbackAllowed: false,
    singleCanonicalScheduler: true, duplicateMissionPreventionByCanonicalIssueIdentity: true,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false,
    ...overrides,
  };
}

const invalid = [
  ['missing', null], ['bad-json-envelope', { schemaVersion: 'foreign' }],
  ['foreign-kind', { kind: 'stephanos.shared_workspace.goal' }],
  ['foreign-status', { statusId: 'other' }], ['foreign-participant', { participantId: 'other' }],
  ['foreign-schema', { schema: 'foreign.v1' }], ['foreign-repository', { repository: 'Other/repo' }],
  ['coerced-false', { fallbackAllowed: 'false' }], ['missing-fallback', { fallbackAllowed: undefined }],
  ['inconsistent-ready', { status: 'READY' }], ['unknown-state', { status: 'UNKNOWN' }],
  ['missing-issues', { mirroredIssueNumbers: undefined }], ['coerced-issue', { mirroredIssueNumbers: ['2002'] }],
  ['duplicate-issues', { mirroredIssueNumbers: [2002, 2002] }],
  ['expired', { mirrorLeaseExpiresAtUtc: NOW }],
  ['oversized-lease', { mirrorLeaseExpiresAtUtc: '2026-11-01T01:00:00.000Z' }],
  ['future', { timestampUtc: '2026-11-01T01:00:00.000Z', mirrorObservedAtUtc: '2026-11-01T01:00:00.000Z', mirrorLeaseExpiresAtUtc: '2026-11-02T01:00:00.000Z' }],
  ['timestamp-before-observation', { timestampUtc: '2026-10-30T00:59:00.000Z' }],
  ...['singleCanonicalScheduler', 'duplicateMissionPreventionByCanonicalIssueIdentity'].map((field) => [field, { [field]: false }]),
  ...['mergeAuthority', 'deploymentAuthority', 'runtimeMutationAuthority', 'arbitraryShellAllowed']
    .flatMap((field) => [[field, { [field]: true }], [field + '-missing', { [field]: undefined }]]),
];

test('one reconciliation state model has disjoint READY, FENCED and UNKNOWN outcomes', () => {
  for (const [status, allowed, expected] of [
    ['READY', true, 'READY'], ['RECONCILING', false, 'FENCED'], ['BLOCKED', false, 'FENCED'],
  ]) {
    const state = projectGoalMirrorReconciliationState(fence({ status, fallbackAllowed: allowed }), NOW);
    assert.equal(state.valid, true);
    assert.equal(state.state, expected);
    assert.equal(state.fallbackAllowed, allowed);
    assert.equal(state.fallbackFenced, !allowed);
    assert.equal(state.fallbackAllowed && state.fallbackFenced, false);
  }
  for (const [name, delta] of invalid) {
    const state = projectGoalMirrorReconciliationState(delta === null ? null : fence(delta), NOW);
    assert.equal(state.valid, false, name);
    assert.equal(state.state, 'UNKNOWN', name);
    assert.equal(state.fallbackAllowed || state.fallbackFenced, false, name);
  }
});

async function busy(record) {
  let writes = 0;
  const result = await publishGithubGoalMirrorEstate(mirror, { root, nowUtc: NOW, testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({ ok: false, reason: 'FIXTURE_BUSY' }),
      readFile: async () => { if (record === null) throw missing(); return JSON.stringify(record); },
      writeAtomicJson: async () => { writes++; throw new Error('BUSY must not write'); },
    } });
  assert.equal(writes, 0);
  return result;
}

test('BUSY observes a legitimate fence without granting outage fallback or publication completion', async () => {
  for (const status of ['RECONCILING', 'BLOCKED']) {
    const result = await busy(fence({ status }));
    assert.equal(result.ok, false);
    assert.equal(result.fallbackFenced, true);
    assert.equal(result.goalRecordsSource, 'durable-winner');
    assert.equal(projectGithubGoalMirrorFallback(mirror.records, { ok: false }, { selectedGoal: 2002 }, NOW, [result.reconciliationStatus]).valid, false);
  }
  for (const [name, delta] of invalid) {
    const result = await busy(delta === null ? null : fence(delta));
    assert.equal(result.ok || result.fallbackFenced, false, name);
  }
});

test('canonical READY winner is completion evidence, never evidence fallback is disabled', async () => {
  const result = await busy(fence({ status: 'READY', fallbackAllowed: true }));
  assert.equal(result.ok, true);
  assert.equal(result.fallbackFenced, false);
  assert.equal(result.goalRecordsSource, 'durable-winner');
  assert.equal(projectGithubGoalMirrorFallback(mirror.records, { ok: false }, { selectedGoal: 2002 }, NOW, [result.reconciliationStatus]).valid, true);
});

test('a newer fence observed during feed refresh invalidates the earlier READY row', async () => {
  const publication = await busy(fence({ status: 'READY', fallbackAllowed: true }));
  const observed = '2026-10-30T01:00:30.000Z';
  const later = fence({ timestampUtc: observed, mirrorObservedAtUtc: observed,
    mirrorLeaseExpiresAtUtc: '2026-10-31T01:00:30.000Z' });
  const records = selectGoalRecordsForProgrammeProjection(mirror, publication, { records: {
    goalRecords: mirror.records, statusRecords: [later],
  } }, NOW);
  assert.deepEqual(records, []);
});

test('admission snapshot properties reconcile phase, epoch and row order together', () => {
  const at = (offset) => new Date(Date.parse(NOW) + offset).toISOString();
  const statusAt = (offset, status) => fence({ timestampUtc: at(offset), mirrorObservedAtUtc: at(offset),
    mirrorLeaseExpiresAtUtc: at(offset + 86400000), status, fallbackAllowed: status === 'READY' });
  const rowAt = (offset, state = 'READY') => ({ ...mirror.records[0], timestampUtc: at(offset),
    mirrorObservedAtUtc: at(offset), mirrorLeaseExpiresAtUtc: at(offset + 86400000),
    state, status: state, route: state === 'CLOSED' ? 'CLOSED' : mirror.records[0].route,
    mirrorBuildPickupAllowed: state === 'READY' });
  for (const priorPhase of ['READY', 'RECONCILING', 'BLOCKED']) {
    for (const laterPhase of ['READY', 'RECONCILING', 'BLOCKED']) {
      for (const offset of [-30000, 0, 30000]) {
        for (const rowPhase of ['READY', 'CLOSED']) {
          const winningOffset = Math.max(0, offset);
          const winningPhase = offset >= 0 ? laterPhase : priorPhase;
          const row = rowAt(winningOffset, rowPhase);
          const snapshot = projectGoalMirrorAdmissionSnapshot(mirror,
            { ok: true, reconciliationStatus: statusAt(0, priorPhase) }, { records: {
              statusRecords: [statusAt(offset, laterPhase)], goalRecords: [rowAt(-60000), row],
            } }, NOW);
          assert.equal(snapshot.valid, true);
          assert.equal(snapshot.winningObservedAtUtc, at(winningOffset));
          assert.equal(snapshot.publicationComplete, winningPhase === 'READY');
          assert.equal(snapshot.fallbackFenced, winningPhase !== 'READY');
          assert.deepEqual(snapshot.goalRecords, winningPhase === 'READY' || rowPhase === 'CLOSED' ? [row] : []);
          assert.equal(snapshot.publicationComplete && snapshot.fallbackFenced, false);
        }
      }
    }
  }
  const prior = { ok: true, reconciliationStatus: statusAt(0, 'READY') };
  for (const [, delta] of invalid) {
    const record = delta === null ? null : fence(delta);
    const snapshot = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
      statusRecords: record ? [record] : [], goalRecords: mirror.records,
    } }, NOW);
    assert.equal(snapshot.valid, false);
    assert.equal(snapshot.publicationComplete || snapshot.fallbackFenced, false);
    assert.deepEqual(snapshot.goalRecords, []);
  }
  const ambiguous = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
    statusRecords: [statusAt(0, 'READY'), statusAt(0, 'RECONCILING')], goalRecords: [rowAt(0)],
  } }, NOW);
  assert.equal(ambiguous.state, 'FENCED');
  assert.deepEqual(ambiguous.goalRecords, []);
  const duplicate = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
    statusRecords: [statusAt(0, 'READY')], goalRecords: [rowAt(0), rowAt(0, 'CLOSED')],
  } }, NOW);
  assert.deepEqual(duplicate.goalRecords, []);
  const ahead = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
    statusRecords: [statusAt(0, 'READY')], goalRecords: [rowAt(0), rowAt(30000, 'CLOSED')],
  } }, NOW);
  assert.equal(ahead.valid, false);
  assert.deepEqual(ahead.goalRecords, []);
  const noMember = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
    statusRecords: [fence({ status: 'READY', fallbackAllowed: true, mirroredIssueNumbers: [] })], goalRecords: mirror.records,
  } }, NOW);
  assert.deepEqual(noMember.goalRecords, []);
  const contradictoryPhase = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
    statusRecords: [fence()], goalRecords: [{ ...rowAt(0), mirrorBuildPickupAllowed: false }],
  } }, NOW);
  assert.deepEqual(contradictoryPhase.goalRecords, []);
  const ready = statusAt(0, 'READY');
  for (const bad of [
    { ...rowAt(0), mergeAuthority: true }, { ...rowAt(0), status: 'CLOSED' },
    { ...rowAt(0), mirrorBuildPickupAllowed: 'true' }, { ...rowAt(0), mirrorRepository: 'Foreign/repo' },
  ]) {
    const snapshot = projectGoalMirrorAdmissionSnapshot(mirror, prior, { records: {
      statusRecords: [ready], goalRecords: [bad],
    } }, NOW);
    assert.deepEqual(snapshot.goalRecords, []);
    assert.equal(projectGithubGoalMirrorFallback([bad], { ok: false }, { selectedGoal: 2002 }, NOW, [ready]).valid, false);
  }
  assert.equal(projectGithubGoalMirrorFallback([rowAt(0), rowAt(0, 'CLOSED')],
    { ok: false }, { selectedGoal: 2002 }, NOW, [ready]).valid, false);
});

test('newer in-progress winner excludes older memory and old durable mirror rows', async () => {
  const observed = '2026-10-30T01:00:30.000Z';
  const result = await busy(fence({ timestampUtc: observed, mirrorObservedAtUtc: observed,
    mirrorLeaseExpiresAtUtc: '2026-10-31T01:00:30.000Z' }));
  const winner = { ...mirror.records[0], timestampUtc: observed, mirrorObservedAtUtc: observed,
    mirrorLeaseExpiresAtUtc: result.reconciliationStatus.mirrorLeaseExpiresAtUtc,
    state: 'CLOSED', status: 'CLOSED', route: 'CLOSED', mirrorBuildPickupAllowed: false, marker: 'durable-winner' };
  const older = { ...mirror.records[0], goalId: 'goal-2003', marker: 'stale-durable' };
  const records = selectGoalRecordsForProgrammeProjection(mirror, result, { records: {
    goalRecords: [winner, older], statusRecords: [result.reconciliationStatus],
  } }, NOW);
  assert.deepEqual(records, [winner]);
  assert.equal(records[0].state, 'CLOSED');
});

test('older publisher cannot displace a newer live primary observation', async () => {
  const result = await busy(fence({ timestampUtc: '2026-10-30T00:59:30.000Z',
    mirrorObservedAtUtc: '2026-10-30T00:59:30.000Z', mirrorLeaseExpiresAtUtc: '2026-10-31T00:59:30.000Z' }));
  assert.equal(result.fallbackFenced, true);
  assert.equal(result.goalRecordsSource, 'live-observation');
  const closed = { ...mirror.records[0], state: 'CLOSED', status: 'CLOSED', route: 'CLOSED', mirrorBuildPickupAllowed: false };
  assert.deepEqual(selectGoalRecordsForProgrammeProjection({ ...mirror, records: [closed] }, result,
    { records: { goalRecords: mirror.records, statusRecords: [result.reconciliationStatus] } }, NOW), [closed]);
});

test('a malformed newer observation cannot suppress an admitted publisher', async () => {
  let writes = 0;
  const foreign = fence({ participantId: 'foreign', mirrorObservedAtUtc: '2026-10-30T01:00:30.000Z' });
  const result = await publishGithubGoalMirrorEstate(mirror, { root, nowUtc: NOW, testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({ ok: true, release: async () => true }),
      readFile: async (p) => {
        if (String(p).includes('github-goal-mirror-reconciliation.json')) return JSON.stringify(foreign);
        throw missing();
      },
      writeAtomicJson: async () => { writes++; return { ok: true }; },
    } });
  assert.equal(result.ok, true);
  assert.equal(result.classification, 'GITHUB_GOAL_MIRROR_PUBLISHED');
  assert.ok(writes >= 3);
});

test('lock-release failure reads actual state instead of synthesizing a closed fallback fence', async () => {
  for (const [record, expected] of [[fence(), true], [fence({ status: 'READY', fallbackAllowed: true }), false], [null, false]]) {
    let reads = 0;
    const result = await publishGithubGoalMirrorEstate(mirror, { root, nowUtc: NOW, testOnly: true,
      dependencies: {
        acquireSharedWorkspaceOperationLock: async () => ({ ok: true, release: async () => false }),
        readFile: async (p) => {
          if (!String(p).includes('github-goal-mirror-reconciliation.json') || reads++ === 0 || record === null) throw missing();
          return JSON.stringify(record);
        },
        writeAtomicJson: async () => ({ ok: true }),
      } });
    assert.equal(result.classification, 'GITHUB_GOAL_MIRROR_LOCK_RELEASE_FAILED');
    assert.equal(result.ok, false);
    assert.equal(result.fallbackFenced, expected);
  }
});

test('failed fence write and lock release cannot resurrect an older durable READY goal', async () => {
  const observed = '2026-10-30T00:59:30.000Z';
  const olderFence = fence({ timestampUtc: observed, mirrorObservedAtUtc: observed,
    mirrorLeaseExpiresAtUtc: '2026-10-31T00:59:30.000Z' });
  const olderReady = { ...mirror.records[0], mirrorObservedAtUtc: observed };
  const closed = { ...mirror.records[0], state: 'CLOSED', status: 'CLOSED', route: 'CLOSED', mirrorBuildPickupAllowed: false };
  const current = { ...mirror, records: [closed] };
  const publication = await publishGithubGoalMirrorEstate(current, { root, nowUtc: NOW, testOnly: true,
    dependencies: {
      acquireSharedWorkspaceOperationLock: async () => ({ ok: true, release: async () => false }),
      readFile: async () => JSON.stringify(olderFence),
      writeAtomicJson: async () => ({ ok: false, reason: 'FIXTURE_STORAGE_WRITE_FAILED' }),
    } });
  assert.equal(publication.ok, false);
  assert.equal(publication.fallbackFenced, true);
  const records = selectGoalRecordsForProgrammeProjection(current, publication,
    { records: { goalRecords: [olderReady], statusRecords: [olderFence] } }, NOW);
  assert.deepEqual(records, [closed]);
  assert.equal(records[0].state, 'CLOSED');
});

test('actual programme projection clears only the proven BUSY fence veto and refreshes durable winner records', async () => {
  const controller = createProgrammeControllerHeartbeat({ controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD, cycleState: 'RECONCILING', timestampUtc: NOW, boundedMutationSteps: 0 });
  const worker = createMissionWorkerHeartbeatRecord({ timestampUtc: NOW, repositoryRoot: paths.repositoryRoot,
    branch: 'main', headSha: HEAD, pid: 12345, launchIdentityId: '1'.repeat(64), workerStartedAtUtc: '2026-10-30T00:59:00.000Z' });
  const ready = fence({ status: 'READY', fallbackAllowed: true });
  const newerFence = fence({ timestampUtc: '2026-10-30T01:00:30.000Z', mirrorObservedAtUtc: '2026-10-30T01:00:30.000Z',
    mirrorLeaseExpiresAtUtc: '2026-10-31T01:00:30.000Z' });
  for (const [record, later, expectedVeto] of [
    [fence(), fence(), false], [fence({ mergeAuthority: true }), fence({ mergeAuthority: true }), true], [null, null, true],
    [ready, newerFence, false], [ready, fence({ mergeAuthority: true }), true], [ready, null, true],
  ]) {
    let feedReads = 0;
    const projection = await readAuthoritativeProgrammeProjection({ root, home, repoRoot: paths.repositoryRoot,
      env: {}, nowUtc: NOW, testOnly: true, sharedGoalEstateSnapshot: false,
      dependencies: {
        validateWorkspaceConfig: async () => ({ ok: true, root }),
        readRepositoryHead: async () => ({ ok: true, branch: 'main', headSha: HEAD }),
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'fixture-only', authority: 'test-only' }),
        fetchGithubGoalIssues: async () => ({ status: 'fetched', ...estate }),
        fetchGithubPrEvidence: async () => { throw new Error('unexpected PR access'); },
        readCurrentExecutionReceipt: async () => { throw new Error('unexpected execution access'); },
        readWorkspaceFeed: async () => { feedReads++; const observed = feedReads === 1 ? record : later; return { state: 'ready', records: {
          goalRecords: mirror.records, statusRecords: observed ? [observed] : [], proofRecords: [], receiptRecords: [], capabilityRecords: [],
        } }; },
        listMissionRecords: async () => [],
        // Prevent non-injected specialized status publication. Only the actual
        // mirror predicate is asserted; unrelated invalid-scheduler gates stay.
        buildMissionScheduler: () => ({ schemaVersion: 'deliberately-invalid-fixture', portfolio: [], parallelCandidateDetails: [], activeGoals: [] }),
        buildCriticalBacklogProjection: () => ({ decision: 'NO_WORK_REQUIRED', activeMission: null, remainingItems: [] }),
        buildCapabilityRegistry: () => ({ sourceHead: HEAD, components: [] }),
        acquireSharedWorkspaceOperationLock: async () => ({ ok: false, reason: 'FIXTURE_BUSY' }),
        readFile: async (p) => {
          const name = String(p).replaceAll('\\', '/');
          if (name.endsWith('/programme-controller-heartbeat.json')) return JSON.stringify(controller);
          if (name.endsWith('/mission-orchestrator-worker-heartbeat.json')) return JSON.stringify(worker);
          if (name.endsWith('/github-goal-mirror-reconciliation.json') && record) return JSON.stringify(record);
          throw missing();
        },
        writeAtomicJson: async () => { throw new Error('unexpected fixture publication'); },
        writeFile: async () => { throw new Error('unexpected write'); }, unlink: async () => { throw new Error('unexpected unlink'); },
      } });
    assert.equal(projection.goalMirrorEstate.ok, true);
    assert.equal(projection.blockers.includes('source:github-goal-mirror-fail-closed-fence-unproven'), expectedVeto);
    assert.equal(feedReads, 2);
    assert.equal(projection.goalMirrorAdmission.goalRecordsCount, 0);
  }
});

test('real concurrent publisher keeps the newer revocation and never projects the older READY goal', { timeout: 10000 }, async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'goal-mirror-concurrency-'));
  assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(os.tmpdir()));
  const observed = '2026-10-30T01:00:30.000Z';
  const newer = buildGithubGoalMirrorEstate(mirror.records,
    { ok: true, retrievedAt: observed, issues: [], discoveredIssues: [] }, observed);
  let entered;
  const held = new Promise((resolve) => { entered = resolve; });
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let writer;
  try {
    await writeAtomicJson(fixtureRoot, ['goals', 'goal-2002.json'], mirror.records[0], { nowMs: Date.parse(NOW) });
    writer = publishGithubGoalMirrorEstate(newer, { root: fixtureRoot, nowUtc: observed, testOnly: true,
      dependencies: { writeAtomicJson: async (rootInput, segments, record, options) => {
        const result = await writeAtomicJson(rootInput, segments, record, options);
        if (record.status === 'RECONCILING') { entered(); await barrier; }
        return result;
      } } });
    await held;
    const reader = await publishGithubGoalMirrorEstate(mirror, { root: fixtureRoot, nowUtc: observed });
    assert.equal(reader.classification, 'GITHUB_GOAL_MIRROR_RECONCILIATION_BUSY');
    assert.equal(reader.fallbackFenced, true);
    assert.equal(reader.ok, false);
    const before = JSON.parse(await readFile(path.join(fixtureRoot, 'goals', 'goal-2002.json'), 'utf8'));
    const inProgress = JSON.parse(await readFile(path.join(fixtureRoot, 'status', 'github-goal-mirror-reconciliation.json'), 'utf8'));
    assert.deepEqual(selectGoalRecordsForProgrammeProjection(mirror, reader, { records: {
      goalRecords: [before], statusRecords: [inProgress],
    } }, observed), []);
    release();
    assert.equal((await writer).ok, true);
    const after = JSON.parse(await readFile(path.join(fixtureRoot, 'goals', 'goal-2002.json'), 'utf8'));
    assert.equal(after.state, 'CLOSED');
    assert.equal(after.mirrorBuildPickupAllowed, false);
    assert.equal(after.mirrorObservedAtUtc, observed);
    const winner = await publishGithubGoalMirrorEstate(mirror, { root: fixtureRoot, nowUtc: observed });
    assert.equal(winner.classification, 'GITHUB_GOAL_MIRROR_OBSERVATION_SUPERSEDED');
    const committed = JSON.parse(await readFile(path.join(fixtureRoot, 'status', 'github-goal-mirror-reconciliation.json'), 'utf8'));
    assert.deepEqual(selectGoalRecordsForProgrammeProjection(mirror, winner, { records: {
      goalRecords: [after], statusRecords: [committed],
    } }, observed), [after]);
  } finally {
    release();
    if (writer) await writer;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
