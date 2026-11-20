import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMissionOrchestratorState, applyMissionOrchestratorEvent } from './missionOrchestrator.mjs';
import { buildMissionWorkerAction } from './missionOrchestratorWorker.mjs';
import { classifyCompletionMission } from './completionGuardianV1.mjs';
import { buildCompletionGuardianProjection } from './completionGuardianV1.mjs';
import { externalMergeCandidateV1, validateExternalMergeObservationV1, hasExternalMergeObservationV1,
  projectExternalMergeExecutionObligationV1 } from './externalMergeObservationV1.mjs';
import { buildCriticalBacklogProjection, DEFAULT_CRITICAL_BACKLOG } from './criticalBacklogConveyor.mjs';
import { controllerRequiresMaterialProgress } from '../../scripts/mission-orchestrator-worker-supervised.mjs';
import { ensureCriticalBacklogMission, publishCriticalBacklogProjection,
  resolveCriticalBacklogRuntimePaths, readmitReentryReadyCriticalMission } from '../../stephanos-server/services/criticalBacklogConveyorService.js';
import { ensureElasticGoalMissions } from '../../stephanos-server/services/elasticGoalMissionAdmissionService.js';
import { projectFleetConveyorObservationV1 } from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { fetchExternalMergeObservation } from '../../stephanos-server/services/githubPrEvidenceService.js';
import { reconcileExternalMergeObservation } from '../../stephanos-server/services/completionGuardianMergeObservationService.js';
import { appendMissionEvent } from '../../stephanos-server/services/missionOrchestratorStore.js';
import { runCompletionGuardian } from '../../scripts/completion-guardian.mjs';

const HEAD = 'a'.repeat(40), MERGE = 'b'.repeat(40), MAIN = 'c'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
function mission() {
  const m = createMissionOrchestratorState({ missionId: 'critical-1284-1286-completion-controller',
    title: 'Completion Guardian', operatorIntent: 'Reconcile unfinished work through existing controllers',
    intendedOutcome: 'Verified goal completion', repository: REPOSITORY, missionKind: 'implementation',
    repositoryRoot: '/fixture/repo', worktreePath: '/fixture/worktree', branch: 'openclaw/completion-guardian',
    allowedFiles: ['shared/agents/**'], requiredTests: ['node --test shared/agents/completionGuardianV1.test.mjs'],
    requiredEvidence: ['focused tests'] });
  m.revision = 55; m.currentPhase = 'AWAITING_OPERATOR_APPROVAL'; m.blockers = [];
  m.git.commitSha = HEAD; m.git.worktreeReady = true; m.git.pushed = true; m.git.clean = true;
  m.approval.status = 'pending'; m.approval.requiredToken = `APPROVE_OPENCLAW_SQUASH_MERGE:2463:${HEAD}`;
  m.dispatch.status = 'complete'; m.dispatch.startedAt = '2026-09-27T15:00:00.000Z';
  m.dispatch.adapter = 'desktop-commander'; m.activeWriter = 'none';
  m.pullRequest.number = 2463; m.pullRequest.headSha = HEAD; m.pullRequest.merged = false;
  m.pullRequest.checks = [{ status: 'success', required: true }];
  m.evidenceReceipts = [{ receiptId: 'old-tests', requirement: 'focused tests', source: 'original-worker',
    evidenceType: 'command-output', verified: true, exitCode: 0, createdAt: m.dispatch.startedAt }];
  return m;
}
function reader(m, mutate = () => {}) {
  const calls = [];
  const payloads = [
    { number: 2463, merged: true, state: 'closed', merged_at: '2026-09-27T16:27:17Z', merge_commit_sha: MERGE,
      head: { sha: HEAD, ref: m.git.branch, repo: { full_name: REPOSITORY } },
      base: { ref: 'main', repo: { full_name: REPOSITORY } } },
    { ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } },
    { status: 'ahead', merge_base_commit: { sha: MERGE }, base_commit: { sha: MERGE } },
    { ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } },
  ];
  mutate(payloads);
  return { calls, options: { testOnly: true, auth: { configured: true, token: 'fixture-only', authority: 'gh-cli' },
    fetchImpl: async (url, init) => { calls.push(url); assert.equal(init.redirect, 'error');
      assert.ok(init.signal); return { ok: true, status: 200, json: async () => payloads[calls.length - 1] }; } } };
}
async function validEvent(m) {
  const r = reader(m); const { observation } = await fetchExternalMergeObservation(m, r.options);
  return { eventType: 'EXTERNAL_PULL_REQUEST_MERGE_OBSERVED', eventId: 'external-merge-fixture',
    expectedRevision: m.revision, expectedCurrentPhase: m.currentPhase, observation,
    timestamp: new Date().toISOString(), receipt: { receiptId: 'external-merge-fixture',
      requirement: 'source integration observation only', source: 'completion-guardian-github-observation',
      evidenceType: 'github-merged-observation', verified: true, exitCode: 0,
      createdAt: observation.observedAtUtc, commandOutputHash: createHash('sha256').update(JSON.stringify(observation)).digest('hex') } };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'completion-observation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const m = mission(), file = path.join(root, `${m.missionId}.state.json`);
  await writeFile(file, JSON.stringify(m));
  return { root, m, file, snapshotRoot: path.join(root, 'snapshots') };
}

test('exact external integration leaves historical authority intact and becomes proof pending, never deployment', async () => {
  const m = mission(), before = structuredClone(m), e = await validEvent(m);
  assert.equal(externalMergeCandidateV1(m), true);
  const n = applyMissionOrchestratorEvent(m, e);
  assert.equal(n.currentPhase, 'VERIFYING');
  assert.equal(n.revision, 56);
  assert.equal(hasExternalMergeObservationV1(n), true);
  assert.equal(classifyCompletionMission(n), 'PROOF_PENDING');
  assert.equal(n.nextAction.type, 'RECONCILE_GOAL_ACCEPTANCE');
  assert.equal(buildMissionWorkerAction(n).executable, false);
  for (const key of ['approval', 'dispatch', 'deployment', 'pullRequest', 'git', 'continuity']) assert.deepEqual(n[key], before[key], key);
  assert.deepEqual(m, before);
  assert.equal(n.externalMergeObservation.goalAcceptanceProven, false);
  assert.equal(n.externalMergeObservation.runtimeMutationAuthority, false);
});

test('real observed-merge transition retains acceptance without consuming construction or demanding a grant', async () => {
  const before = mission(), n = applyMissionOrchestratorEvent(before, await validEvent(before));
  const unchanged = structuredClone(n);
  const backlog = DEFAULT_CRITICAL_BACKLOG.filter(entry => entry.mission.missionId === n.missionId);
  assert.equal(backlog.length, 1);
  const obligation = projectExternalMergeExecutionObligationV1(n);
  assert.equal(obligation.state, 'ACCEPTANCE_PENDING');
  assert.equal(obligation.materialProgressRequired, false);
  for (const key of ['goalComplete', 'sourceMutationAllowed', 'leaseReleaseAllowed',
    'claimReleaseAllowed', 'mergeAuthority', 'runtimeMutationAuthority']) assert.equal(obligation[key], false, key);
  const projection = buildCriticalBacklogProjection({ backlog, missionRecords: [n] });
  assert.equal(projection.decision, 'PARKED_ACCEPTANCE_ONLY');
  assert.deepEqual(projection.parkedAcceptanceMissionIds, [n.missionId]);
  assert.equal(projection.parkedAcceptanceCount, 1);
  assert.deepEqual(projection.parkedApprovalMissionIds, []);
  assert.deepEqual(projection.completedItemIds, []);
  assert.equal(projection.activeMission, null);
  const staleController = { authoritativeProjection: { status: 'READY' },
    actionResult: { projection: { decision: 'WAIT_ACTIVE_MISSION', activeMission: n } } };
  assert.equal(controllerRequiresMaterialProgress(staleController), false);
  assert.equal(controllerRequiresMaterialProgress({ ...staleController, allowWorkerTick: true }), true);
  assert.equal(controllerRequiresMaterialProgress({ ...staleController,
    authoritativeProjection: { status: 'ACTIVE', lane: { active: true } } }), true);
  assert.equal(controllerRequiresMaterialProgress({ ...staleController,
    actionResult: { ...staleController.actionResult, elasticAdmission: { selectedMission: { missionId: 'material-work' } } } }), true);
  const guardian = buildCompletionGuardianProjection({ missions: [n], backlog });
  assert.equal(guardian.repairQueue[0].nextAction, 'RECONCILE_GOAL_ACCEPTANCE');
  assert.equal(guardian.missionRows[0].classification, 'PROOF_PENDING');
  const regressed = buildCompletionGuardianProjection({ missions: [n], backlog, regressedMissionIds: [n.missionId] });
  assert.equal(regressed.missionRows[0].classification, 'REGRESSION_REPAIR_REQUIRED');
  assert.equal(regressed.repairQueue[0].nextAction, 'RECONCILE_EXISTING_MISSION_IDENTITY');
  assert.equal(regressed.runtimeMutationAuthority, false);
  assert.equal(regressed.mergeAuthority, false);
  assert.equal(buildMissionWorkerAction(n).executable, false);
  assert.deepEqual(n, unchanged);
});

test('acceptance accounting fails closed for malformed observation, live writer and incomplete authority', async () => {
  const m = mission(), accepted = applyMissionOrchestratorEvent(m, await validEvent(m));
  const changes = [
    x => x.currentPhase = 'AGENT_IMPLEMENTATION', x => x.missionKind = 'live-runtime-investigation',
    x => x.cancelled = true, x => x.blockers.push('source-custody-held'),
    x => x.dispatch.status = 'running', x => x.activeWriter = 'codex',
    x => x.simultaneousWritersAllowed = true, x => x.continuity.parkingStatus = 'PARKED_BLOCKED',
    x => x.storeMetadata = { originalSourceAttemptFence: {} },
    x => x.storeMetadata = { supervisedRecoveryMaintenance: {} },
    x => x.git.commitSha = MAIN, x => x.pullRequest.headSha = MAIN,
    x => x.externalMergeObservation.branch = 'openclaw/foreign',
    x => x.externalMergeObservation.evidenceSha256 = 'd'.repeat(64),
    x => x.externalMergeObservation.expectedRevision = x.revision,
    x => x.evidenceReceipts = {}, x => x.evidenceReceipts = [],
    x => x.evidenceReceipts = null, x => delete x.evidenceReceipts,
    x => x.nextAction.type = 'COLLECT_AND_JUDGE_EVIDENCE',
    x => x.nextAction.approvalRequired = true,
    x => x.nextAction.historicalApprovalProven = true,
    x => x.nextAction.runtimeMutationAuthority = true,
    x => delete x.nextAction.sourceIntegrationObserved,
  ];
  for (const change of changes) {
    const candidate = structuredClone(accepted); change(candidate);
    const result = projectExternalMergeExecutionObligationV1(candidate);
    assert.equal(result.acceptanceOnly, false, change.toString());
    assert.equal(result.constructionCapacityRequired, true, change.toString());
    assert.equal(controllerRequiresMaterialProgress({ authoritativeProjection: { status: 'READY' },
      actionResult: { projection: { activeMission: candidate } } }), true, change.toString());
  }
  const ordinary = structuredClone(accepted);
  delete ordinary.externalMergeObservation;
  ordinary.nextAction = { type: 'COLLECT_AND_JUDGE_EVIDENCE' };
  assert.equal(projectExternalMergeExecutionObligationV1(ordinary).materialProgressRequired, true);
  assert.equal(buildMissionWorkerAction(ordinary).actionKind, 'evidence-judgment');
});

test('acceptance parking publishes retained identity and never bypasses a canonical source-custody HOLD', async t => {
  const f = await fixture(t), n = applyMissionOrchestratorEvent(f.m, await validEvent(f.m));
  const backlog = DEFAULT_CRITICAL_BACKLOG.filter(entry => entry.mission.missionId === n.missionId);
  const paths = resolveCriticalBacklogRuntimePaths({ repoRoot: path.join(f.root, 'repo'),
    workspaceRoot: path.join(f.root, 'workspace'), orchestratorRoot: f.root,
    snapshotRoot: f.snapshotRoot, worktreeRoot: path.join(f.root, 'worktrees') });
  const result = await ensureCriticalBacklogMission({ backlog, paths, env: {}, allowLegacyMissionCreation: false,
    listMissions: async () => [n],
    readProgrammeProjection: async () => ({ status: 'HOLD', blockers: ['mutation-lease-without-lane-projection'],
      machineryInventory: { sourceHead: MAIN }, scheduler: { failClosed: false, elasticCapacity: { status: 'RUNNING' } } }),
    ensureElasticMissions: async () => assert.fail('source-custody HOLD must prevent elastic admission'),
    dispatchElasticBuilds: async () => assert.fail('source-custody HOLD must prevent dispatch'),
    appendMissionEvent: async () => assert.fail('acceptance accounting must preserve the retained revision'),
    publishProjection: async () => ({ ok: true }),
  });
  assert.equal(result.classification, 'PARKED_ACCEPTANCE_ONLY');
  assert.equal(result.programmeStatus, 'HOLD');
  assert.equal(result.elasticAdmissionGate.admissionPreflightEligible, false);
  assert.deepEqual(result.programmeBlockers, ['mutation-lease-without-lane-projection']);
  assert.equal(result.elasticAdmission, null);
  assert.equal(result.elasticIgnition, null);
  assert.equal((await publishCriticalBacklogProjection(result.projection, { paths })).ok, true);
  const status = JSON.parse(await readFile(path.join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json')));
  assert.deepEqual(status.parkedAcceptanceMissionIds, [n.missionId]);
  assert.equal(status.parkedAcceptanceCount, 1);
  assert.deepEqual(status.completedItemIds, []);
  const writes = [];
  await runCompletionGuardian({ testOnly: true, repoRoot: f.root, workspaceRoot: paths.workspaceRoot,
    missionRoot: f.root, missions: [n], goals: [], backlog,
    writeRecord: async (_root, segments, record) => { writes.push({ segments: segments.join('/'), record }); return { ok: true }; } });
  const handoff = writes.find(row => row.segments === 'handoffs/completion-guardian-repair-current.json').record;
  assert.equal(handoff.existingMissionId, n.missionId);
  assert.equal(handoff.requestedAction, 'RECONCILE_GOAL_ACCEPTANCE');
  for (const key of ['sourceMutationAllowed', 'runtimeMutationAuthority', 'goalComplete', 'mergeAuthority']) assert.equal(handoff[key], false);
});

test('legacy reentry uses the same acceptance accounting while preserving the pending mission', async () => {
  const m = mission(), pending = applyMissionOrchestratorEvent(m, await validEvent(m));
  const entry = DEFAULT_CRITICAL_BACKLOG.find(item => item.mission.missionId !== pending.missionId);
  const proof = id => ({ receiptId: id, requirement: 'fixture repair evidence', source: 'fixture',
    evidenceType: 'command-output', verified: true, exitCode: 0 });
  let repaired = createMissionOrchestratorState(entry.mission);
  for (const event of [
    { eventType: 'MISSION_BLOCKED', reason: 'fixture-failure' },
    { eventType: 'MISSION_PARKED_FOR_REPAIR', reason: 'fixture-failure', repairOwner: 'goal-building-agent', receipt: proof('fixture-park') },
    { eventType: 'MISSION_REPAIR_PROVEN', resolvedBlockers: ['fixture-failure'], receipt: proof('fixture-repair') },
  ]) repaired = applyMissionOrchestratorEvent(repaired, event);
  assert.equal(repaired.continuity.parkingStatus, 'REENTRY_READY');
  const unchanged = structuredClone(pending);
  const result = await readmitReentryReadyCriticalMission({ backlog: [entry], paths: {}, env: {},
    listMissions: async () => [pending, repaired],
    appendEvent: async (id, event) => {
      assert.equal(id, repaired.missionId);
      assert.equal(event.expectedRevision, repaired.revision);
      return { state: applyMissionOrchestratorEvent(repaired, event) };
    },
  });
  assert.equal(result.classification, 'REENTRY_ADMITTED');
  assert.deepEqual(pending, unchanged);
});

test('elastic admission retains acceptance ownership and selects unrelated existing work without a duplicate', async () => {
  const m = mission(); m.missionId = 'critical-1284-elastic-goal';
  const pending = applyMissionOrchestratorEvent(m, await validEvent(m));
  const other = { missionId: 'critical-1287-elastic-goal', currentPhase: 'CREATE_WORKTREE',
    revision: 1, repository: REPOSITORY, continuity: { parkingStatus: 'ACTIVE' },
    allowedFiles: ['scripts/other.mjs'],
    dispatch: { status: 'pending' }, git: { branch: 'openclaw/elastic-goal-1287' } };
  const goals = [
    { issue: 1284, title: 'Original acceptance', lifecycle: 'READY', route: 'CHATGPT_GITHUB', resourceIds: ['repo:cheekyfellastef/stephan-os:path:shared/agents'] },
    { issue: 1287, title: 'Independent source work', lifecycle: 'READY', route: 'CHATGPT_GITHUB', resourceIds: ['repo:cheekyfellastef/stephan-os:path:scripts/other.mjs'] },
  ];
  const scheduler = { schemaVersion: 'stephanos.mission-scheduler.v1', readOnly: true, failClosed: false,
    activeGoals: [], elasticCapacity: { status: 'RUNNING', desiredWidth: 1, remainingAdmissionSlots: 1 },
    portfolio: goals, parallelCandidateDetails: goals.map(goal => ({ ...goal, candidateId: '#' + goal.issue })) };
  const before = structuredClone(pending);
  const admission = await ensureElasticGoalMissions({ scheduler }, { testOnly: true, dependencies: {
    listMissionRecords: async () => [pending, other],
    createMissionRecord: async () => assert.fail('existing acceptance and source identities must never be recreated'),
  } });
  assert.equal(admission.createdMissionCount, 0);
  assert.equal(admission.selectedMission.missionId, other.missionId);
  assert.deepEqual(admission.activeMissions.map(item => item.missionId), [other.missionId]);
  assert.deepEqual(admission.runnableMissions.map(item => item.missionId), [other.missionId]);
  assert.ok(admission.held.some(item => item.issueNumber === 1284 && item.reason === 'EXISTING_GOAL_MISSION_ACCEPTANCE_PENDING'));
  assert.ok(projectFleetConveyorObservationV1({ elasticAdmission: admission }).held.reasons.some(item =>
    item.issueNumber === 1284 && item.reasonCode === 'EXISTING_GOAL_MISSION_ACCEPTANCE_PENDING'));
  assert.deepEqual(pending, before);
});

test('observation cannot repair cancellation, custody, fences, held missions, or mismatched retained identity', async () => {
  const m = mission(), e = await validEvent(m);
  for (const change of [x => x.cancelled = true, x => x.blockers.push('blocked'),
    x => x.continuity.parkingStatus = 'PARKED_BLOCKED', x => x.dispatch.status = 'running',
    x => x.activeWriter = 'codex', x => x.storeMetadata = { originalSourceAttemptFence: {} },
    x => x.storeMetadata = { supervisedRecoveryMaintenance: {} }, x => x.repository = 'other/repo',
    x => x.git.commitSha = MAIN, x => x.approval.status = 'approved']) {
    const invalid = structuredClone(m); change(invalid);
    assert.equal(validateExternalMergeObservationV1(invalid, e.observation, e.timestamp).valid, false);
  }
  for (const fields of [{ expectedRevision: 54 }, { headSha: MAIN }, { repository: 'other/repo' },
    { mainRecheckHead: HEAD }, { merged: false }, { mergeAncestorOfMain: false }, { branch: 'different' },
    { observedAtUtc: '2020-01-01T00:00:00Z' }, { observedAtUtc: '2099-01-01T00:00:00Z' }]) {
    const invalid = { ...e.observation, ...fields };
    assert.equal(validateExternalMergeObservationV1(m, invalid, e.timestamp).valid, false, JSON.stringify(fields));
    assert.notEqual(applyMissionOrchestratorEvent(m, { ...e, observation: invalid }).currentPhase, 'VERIFYING');
  }
  assert.equal(hasExternalMergeObservationV1({ ...m, externalMergeObservation: e.observation }), false);
  const forged = applyMissionOrchestratorEvent(m, { ...e, receipt: { ...e.receipt, verified: false } });
  assert.equal(hasExternalMergeObservationV1(forged), false);
});

test('bounded GitHub reader binds the retained PR, immutable ancestry and main recheck', async () => {
  const m = mission(), r = reader(m);
  const result = await fetchExternalMergeObservation(m, r.options);
  assert.equal(result.status, 'fetched');
  assert.deepEqual(r.calls.map(url => url.replace(`https://api.github.com/repos/${REPOSITORY}/`, '')),
    ['pulls/2463', 'git/ref/heads/main', `compare/${MERGE}...${MAIN}`, 'git/ref/heads/main']);
  for (const mutate of [p => p[0].merged = false, p => p[0].number = 2464,
    p => p[0].head.sha = MAIN, p => p[0].head.repo.full_name = 'fork/repo', p => p[0].base.ref = 'other',
    p => p[2].status = 'diverged', p => p[2].merge_base_commit.sha = HEAD, p => p[3].object.sha = HEAD]) {
    const r2 = reader(m, mutate);
    assert.equal((await fetchExternalMergeObservation(m, r2.options)).status, 'error');
    assert.ok(r2.calls.length <= 4);
  }
});

test('network failure and deadline never become observations', async () => {
  const m = mission(), r = reader(m);
  assert.equal((await fetchExternalMergeObservation(m, { ...r.options, fetchImpl: async () => { throw new Error('secret must not leak'); } })).reasonCode, 'GITHUB_OBSERVATION_READ_FAILED');
  const timeout = await fetchExternalMergeObservation(m, { ...r.options, timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))) });
  assert.equal(timeout.reasonCode, 'GITHUB_OBSERVATION_DEADLINE');
});

test('guarded store rejects JSON-only observation events, including normalized event spelling', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), e = await validEvent(f.m);
  for (const spelling of [e.eventType, e.eventType.toLowerCase(), ` ${e.eventType} `]) {
    await assert.rejects(appendMissionEvent(f.m.missionId, { ...e, eventType: spelling }, f), /EXTERNAL_MERGE_OBSERVER_REQUIRED/);
    assert.equal(await readFile(f.file, 'utf8'), before);
  }
});

test('existing Guardian sweep records through mission store, reprojects immediately and cannot repeat', async t => {
  const f = await fixture(t), r = reader(f.m), writes = [];
  const result = await runCompletionGuardian({ testOnly: true, repoRoot: f.root, workspaceRoot: f.root,
    missionRoot: f.root, goals: [], backlog: [], observationTestOptions: { ...r.options, snapshotRoot: f.snapshotRoot },
    writeRecord: async (_root, segments, record) => { writes.push({ segments, record }); return { ok: true }; } });
  assert.equal(result.projection.missionRows[0].classification, 'PROOF_PENDING');
  assert.equal(writes[0].record.mergeObservation.status, 'recorded');
  const persisted = JSON.parse(await readFile(f.file));
  assert.equal(persisted.revision, 56);
  assert.deepEqual(persisted.approval, f.m.approval);
  assert.equal((await reconcileExternalMergeObservation([persisted], { ...f, ...r.options })).status, 'skipped');
  assert.equal(r.calls.length, 4);
  const events = (await readFile(path.join(f.root, `${f.m.missionId}.events.ndjson`), 'utf8')).trim().split('\n');
  assert.equal(events.length, 1);
  const duplicate = await appendMissionEvent(f.m.missionId, JSON.parse(events[0]), f);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, persisted);
  assert.equal((await readFile(path.join(f.root, `${f.m.missionId}.events.ndjson`), 'utf8')).trim().split('\n').length, 1);
});

test('revision movement during GitHub reads leaves newer mission untouched', async t => {
  const f = await fixture(t), r = reader(f.m), newer = structuredClone(f.m);
  newer.revision++; newer.cancelled = true; newer.currentPhase = 'CANCELLED';
  const result = await reconcileExternalMergeObservation([f.m], { ...f, ...r.options,
    fetchImpl: async (...args) => { const res = await r.options.fetchImpl(...args);
      if (r.calls.length === 4) await writeFile(f.file, JSON.stringify(newer)); return res; } });
  assert.equal(result.status, 'deferred');
  assert.equal(result.reasonCode, 'MISSION_STATE_PRECONDITION_FAILED');
  assert.deepEqual(JSON.parse(await readFile(f.file)), newer);
});

test('one candidate per sweep and unsuccessful reads cool down without becoming truth', async t => {
  const f = await fixture(t), other = { ...f.m, missionId: 'critical-1645-other-controller' };
  const r = reader(f.m, p => p[0].merged = false);
  const result = await reconcileExternalMergeObservation([f.m, other], { ...f, ...r.options });
  assert.equal(result.status, 'error'); assert.equal(r.calls.length, 1);
  assert.equal((await reconcileExternalMergeObservation([f.m], { ...f, ...r.options })).status, 'skipped');
  assert.equal(r.calls.length, 1);
});

test('failed first mission cannot starve a later merged mission when sweeps exceed cooldown', async t => {
  const f = await fixture(t);
  const later = structuredClone(f.m); later.missionId = 'critical-1645-later-controller'; later.pullRequest.number = 2464;
  const laterFile = path.join(f.root, `${later.missionId}.state.json`);
  await writeFile(laterFile, JSON.stringify(later));
  const failed = reader(f.m, p => p[0].merged = false);
  const good = reader(later, p => p[0].number = 2464);
  const actualNow = Date.now; let now = actualNow(); Date.now = () => now;
  try {
    const options = { ...f, ...good.options, fetchImpl: async (url, init) => url.endsWith('/pulls/2463')
      ? failed.options.fetchImpl(url, init) : good.options.fetchImpl(url, init) };
    // Reverse input order also proves stable tie-breaking for unseen records.
    const first = await reconcileExternalMergeObservation([later, f.m], options);
    assert.equal(first.missionId, f.m.missionId); assert.equal(first.status, 'error');
    now += 61_000;
    const second = await reconcileExternalMergeObservation([f.m, later], options);
    assert.equal(second.missionId, later.missionId); assert.equal(second.status, 'recorded');
    assert.equal(failed.calls.length, 1); assert.equal(good.calls.length, 4);
    const persisted = JSON.parse(await readFile(laterFile));
    assert.equal(classifyCompletionMission(persisted), 'PROOF_PENDING');
    assert.deepEqual(JSON.parse(await readFile(f.file)), f.m);
    now += 61_000;
    const third = await reconcileExternalMergeObservation([f.m, persisted], options);
    assert.equal(third.missionId, f.m.missionId);
    assert.equal(good.calls.length, 4); // Integrated source cannot be dispatched/observed again.
  } finally { Date.now = actualNow; }
});

test('rate limit response enters existing shared repository backoff', async () => {
  const m = mission(), r = reader(m); let reads = 0;
  const opts = { ...r.options, fetchImpl: async () => { reads++; return { status: 429, ok: false,
    headers: { get: () => null }, json: async () => ({ message: 'rate limit exceeded' }) }; } };
  const first = await fetchExternalMergeObservation(m, opts);
  assert.equal(first.reasonCode, 'GITHUB_PR_RATE_LIMIT_BACKOFF');
  assert.equal((await fetchExternalMergeObservation(m, opts)).reasonCode, first.reasonCode);
  assert.equal(reads, 1);
});
