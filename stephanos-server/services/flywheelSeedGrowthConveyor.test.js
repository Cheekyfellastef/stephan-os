import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HIGH_LEVEL_FLYWHEEL_SEEDS_V1 } from '../../shared/project/seedGardenProjectionV1.mjs';
import { buildHighLevelFlywheelSeedHeartbeatV1, buildStarfieldVrOutcomeOwnershipSeedV1 } from '../../shared/agents/starfieldVrOutcomeOwnershipSeedV1.mjs';
import { deriveFlywheelWorkspaceView } from '../../shared/runtime/upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1, projectSeedGrowthWorkV1 } from '../../shared/runtime/seedGrowthWorkV1.mjs';
import { reconcileFlywheelLearningGoalsV1 } from './flywheelLearningGoalBridgeService.js';
import { admitFlywheelCanonicalGoalV1, createFixedFlywheelGitHubIssueAdapterV1 } from './flywheelCanonicalGoalAdmissionService.js';
import { buildGithubGoalMirrorEstate } from './programmeAuthorityService.js';
import { planElasticGoalMissionAdmissions } from './elasticGoalMissionAdmissionService.js';

const NOW = '2026-10-07T20:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PATH_SCOPE = ['repo:cheekyfellastef/stephan-os:path:shared/runtime/conversationalIntelligenceSeedV1.mjs'];

function feed({ wholeGap = false } = {}) {
  return {
    schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1', state: 'ready', errors: [],
    records: { goalRecords: [], proofRecords: [], capabilityRecords: [], lessonRecords: [], receiptRecords: [],
      statusRecords: HIGH_LEVEL_FLYWHEEL_SEEDS_V1.map((seed) => seed.issue === '#2655'
        ? buildStarfieldVrOutcomeOwnershipSeedV1({ timestampUtc: NOW })
        : buildHighLevelFlywheelSeedHeartbeatV1(seed, { timestampUtc: NOW })),
      eventRecords: wholeGap ? [{
        schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.event',
        eventId: 'whole-system-gap', timestampUtc: NOW, participantId: 'flywheel',
        missionId: 'stephanos-whole-system-capability-closure', relatedIssue: '#2670',
        eventKind: 'capability-gap', capabilityId: 'real-observability-gap', status: 'CURRENT',
        summary: 'A material capability gap needs proof.', proofRefs: ['proof/whole-system-gap'],
      }] : [],
    },
  };
}

function pressures(payload) {
  return planSeedGrowthWorkV1(deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS }), payload, NOW_MS);
}

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'seed-growth-conveyor-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  await Promise.all([mkdir(root), mkdir(repoRoot)]);
  return { root, repoRoot };
}

function github() {
  const issues = new Map();
  const shapes = [];
  return { repository: REPOSITORY, issues, shapes,
    async findByMarker(marker) { return { ok: true, issue: issues.get(marker) || null }; },
    async findOwnerCandidates() { return { ok: true, candidates: [] }; },
    async createIssue(shape) {
      shapes.push(shape);
      const issue = { number: 9000 + shapes.length, title: shape.title, state: 'open' };
      issues.set(shape.marker, issue);
      return { ok: true, issue };
    },
  };
}

test('registered seeds generate stable owned pressure; healthy whole-system observation creates no repair', () => {
  const payload = feed({ wholeGap: true });
  const planned = pressures(payload);
  assert.equal(planned.length, 6);
  assert.deepEqual(planned.map((work) => work.ownerIssueRef), ['#2655', '#2670', '#2796', '#2798', '#2519', '#2968']);
  const keys = planned.map((work) => work.pressureKey);
  payload.records.statusRecords = payload.records.statusRecords.map((record) => ({ ...record, timestampUtc: '2026-10-07T19:59:59.000Z' }));
  assert.deepEqual(pressures(payload).map((work) => work.pressureKey), keys);
  assert.equal(pressures(feed()).length, 5);
});

test('stale, future, unavailable and conflicting feeds cannot authorize seed goals', () => {
  for (const state of ['stale', 'error', 'unavailable']) {
    assert.equal(pressures({ ...feed(), state }).length, 0);
  }
  assert.equal(pressures({ ...feed(), errors: ['corrupt-owner'] }).length, 0);
  for (const time of ['2026-10-06T20:00:00.000Z', '2026-10-08T20:00:00.000Z']) {
    const payload = feed();
    payload.records.statusRecords = payload.records.statusRecords.map((record) => ({ ...record, timestampUtc: time }));
    assert.equal(pressures(payload).length, 0);
  }
  const payload = feed({ wholeGap: true });
  payload.records.eventRecords[0].timestampUtc = '2026-10-06T20:00:00.000Z';
  assert.equal(pressures(payload).some((work) => work.ownerIssueRef === '#2670'), false);
});

test('existing reconciliation admits one owned goal per pressure and repeats without duplicate machinery', async () => {
  const paths = await fixture();
  const adapter = github();
  const payload = feed({ wholeGap: true });
  const options = { ...paths, nowMs: NOW_MS, canonicalGoalAdmissionAuthorized: true,
    readSeedFeed: async () => payload,
    readEvents: async () => ({ records: payload.records.eventRecords, errors: [] }),
    readGoalCandidates: async () => ({ receipts: [] }),
    canonicalGoalAdmissionOptions: { githubAdapter: adapter },
  };
  const first = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(first.createdCanonicalGoalCount, 4);
  assert.equal(first.seedGrowthAttachments.length, 6);
  assert.equal(first.authority.dispatchAllowed, false);
  assert.equal(first.authority.mergeAllowed, false);
  const second = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(second.createdCanonicalGoalCount, 2);
  assert.equal(second.dedupedCanonicalGoalCount, 4);
  assert.equal(adapter.shapes.length, 6);
  const third = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(third.createdCanonicalGoalCount, 0);
  assert.equal(adapter.shapes.length, 6);
  const goal = JSON.parse(await readFile(join(paths.root, 'goals/goal-9001.json'), 'utf8'));
  assert.ok(goal.seedGrowthWork.ownerIssueRef);
  assert.equal(goal.dispatchAllowed, false);
  assert.match(adapter.shapes[0].body, /Seed owner: #2655/);
  assert.match(adapter.shapes[0].body, /seed-specific acceptance evidence/);
});

test('production authority, ownership lookup and binding conflicts fail closed without fallback queues', async () => {
  const paths = await fixture();
  const payload = feed();
  const adapter = github();
  const options = { ...paths, nowMs: NOW_MS,
    readSeedFeed: async () => payload, readEvents: async () => ({ records: [], errors: [] }),
    readGoalCandidates: async () => ({ receipts: [] }),
    canonicalGoalAdmissionOptions: { githubAdapter: adapter },
    createGoalCandidate: async () => { throw new Error('must not create seed fallback'); },
  };
  const held = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(held.createdCanonicalGoalCount, 0);
  assert.equal(adapter.shapes.length, 0);
  adapter.findOwnerCandidates = async () => ({ ok: true, candidates: [{ number: 1444 }] });
  const ownerHold = await reconcileFlywheelLearningGoalsV1({ ...options, canonicalGoalAdmissionAuthorized: true });
  assert.equal(ownerHold.createdCanonicalGoalCount, 0);
  assert.equal(ownerHold.canonicalGoalAdmissionHeldCount, 4);
  assert.equal(adapter.shapes.length, 0);
});

function admissionIssue(number) {
  return { issueNumber: number, repository: REPOSITORY, state: 'open', title: 'Canonical seed work',
    labels: ['goal'], retrievedAt: NOW, creatorLogin: 'Cheekyfellastef', authorAssociation: 'OWNER',
    admissionState: 'ADMISSION_PROVEN', admissionProofSource: 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT',
    schedulerEligible: true, operatorLaneContainment: { active: false },
    admission: { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: number,
      repository: REPOSITORY, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [],
      sourceImplementationAllowed: true, resourceIds: PATH_SCOPE, mergeAuthority: false,
      deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false },
  };
}

test('pressure reaches the existing admitted mission and completion returns proof without fabricating rung growth', async () => {
  const paths = await fixture();
  const payload = feed();
  const work = pressures(payload).find((item) => item.ownerIssueRef === '#2798');
  const { existingGoal, identityConflict, ...seedGrowthWork } = work;
  const result = await admitFlywheelCanonicalGoalV1({ ...paths, nowMs: NOW_MS, nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true, capabilityId: work.pressureKey, eventId: work.pressureKey,
    seedGrowthWork, githubAdapter: github() });
  const proposal = result.schedulerGoal;
  const issue = admissionIssue(proposal.issueNumber);
  const mirror = buildGithubGoalMirrorEstate([proposal], { ok: true, issues: [issue], retrievedAt: NOW }, NOW);
  const ready = mirror.records[0];
  assert.equal(ready.status, 'READY');
  assert.equal(ready.seedGrowthWork.pressureKey, work.pressureKey);
  const scheduler = { schemaVersion: 'stephanos.mission-scheduler.v1', readOnly: true,
    failClosed: false, activeGoals: [], elasticCapacity: { status: 'RUNNING', remainingAdmissionSlots: 1 },
    parallelCandidateDetails: [{ issue: ready.issueNumber, resourceIds: PATH_SCOPE }],
    portfolio: [{ issue: ready.issueNumber, title: ready.title, lifecycle: 'READY', route: ready.route, resourceIds: PATH_SCOPE }] };
  const mission = planElasticGoalMissionAdmissions(scheduler, [], { goalRecords: [ready] });
  assert.equal(mission.admitted.length, 1);
  assert.match(mission.admitted[0].missionInput.operatorIntent, /pressure seed-2798:rung:hear_intent/);
  assert.match(mission.admitted[0].missionInput.operatorIntent, /hears and binds the operator intent/);
  assert.equal(mission.mergeAuthority, false);
  payload.records.goalRecords = [{ ...ready, status: 'COMPLETE', state: 'COMPLETE',
    resultProofRefs: ['proof/real-result'], reusableCapabilityId: 'retained-context', sharedLessonId: 'context-method' }];
  const before = deriveFlywheelWorkspaceView(feed(), { nowMs: NOW_MS });
  const after = deriveFlywheelWorkspaceView(payload, { nowMs: NOW_MS });
  const seed = after.outcomeSeeds.find((item) => item.issueRef === '#2798');
  assert.equal(seed.growthWork.completedGoalCount, 1);
  assert.deepEqual(seed.growthWork.goals[0].resultProofRefs, ['proof/real-result']);
  assert.equal(seed.stage, before.conversationalIntelligenceSeedGrowth.stage);
  assert.equal(pressures(payload).find((item) => item.ownerIssueRef === '#2798').existingGoal.issueNumber, ready.issueNumber);
  payload.records.eventRecords.push({ eventId: 'proved-context', missionId: work.seedId, relatedIssue: '#2798',
    timestampUtc: NOW, status: 'CURRENT', summary: 'Operator intent understood; context continuity across turns proved.',
    proofRefs: ['proof/context-replay'] });
  assert.notEqual(pressures(payload).find((item) => item.ownerIssueRef === '#2798').pressureKey, work.pressureKey);
});

test('invalid, missing, stale or contained canonical admission cannot release proposal hold', async () => {
  const paths = await fixture();
  const { existingGoal, identityConflict, ...work } = pressures(feed())[0];
  const result = await admitFlywheelCanonicalGoalV1({ ...paths, nowMs: NOW_MS, nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true, capabilityId: work.pressureKey, eventId: work.pressureKey,
    seedGrowthWork: work, githubAdapter: github() });
  for (const patch of [
    { admissionState: 'DISCOVERED_CANDIDATE' },
    { retrievedAt: '2026-10-06T20:00:00.000Z' },
    { retrievedAt: '2026-10-08T20:00:00.000Z' },
    { admissionProofSource: 'UNPROVEN' },
    { admission: { ...admissionIssue(9001).admission, issueNumber: 9999 } },
    { admission: { ...admissionIssue(9001).admission, mergeAuthority: true } },
  ]) {
    const issue = { ...admissionIssue(9001), ...patch };
    const mirror = buildGithubGoalMirrorEstate([result.schedulerGoal], { ok: true, issues: [issue], retrievedAt: NOW }, NOW);
    assert.equal(mirror.records[0].status, 'BLOCKED');
  }
  const issue = { ...admissionIssue(9001), operatorLaneContainment: { active: true } };
  const mirror = buildGithubGoalMirrorEstate([result.schedulerGoal], { ok: true, issues: [issue], retrievedAt: NOW }, NOW);
  assert.equal(mirror.records[0].mirrorBuildPickupAllowed, false);
});

test('closed history and concurrent repeats never create a second pressure owner', async () => {
  const paths = await fixture();
  const { existingGoal, identityConflict, ...work } = pressures(feed())[0];
  const adapter = github();
  const options = { ...paths, nowMs: NOW_MS, nowUtc: NOW, canonicalGoalAdmissionAuthorized: true,
    capabilityId: work.pressureKey, eventId: work.pressureKey, seedGrowthWork: work, githubAdapter: adapter };
  await Promise.all([admitFlywheelCanonicalGoalV1(options), admitFlywheelCanonicalGoalV1(options)]);
  assert.equal(adapter.shapes.length, 1);
  const [marker, issue] = adapter.issues.entries().next().value;
  adapter.issues.set(marker, { ...issue, state: 'closed' });
  const held = await admitFlywheelCanonicalGoalV1(options);
  assert.equal(held.reason, 'FLYWHEEL_SEED_GROWTH_CLOSED_OWNER_REQUIRES_COMPLETION_PROOF');
  assert.equal(adapter.shapes.length, 1);
  const bad = await admitFlywheelCanonicalGoalV1({ ...options, seedGrowthWork: { ...work, ownerIssueRef: '#1' } });
  assert.equal(bad.reason, 'FLYWHEEL_SEED_GROWTH_BINDING_INVALID');
});

test('closed-issue lookup includes exact markers and rejects ambiguous ownership', async () => {
  const calls = [];
  const marker = 'stephanos-flywheel-gap:seed-2798:rung:hold_context';
  const adapter = createFixedFlywheelGitHubIssueAdapterV1({ execFileFn(command, args, options, callback) {
    calls.push(args);
    callback(null, JSON.stringify({ total_count: 1, items: [{ number: 9001, state: 'closed', body: `<!-- ${marker} -->` }] }));
  } });
  const found = await adapter.findByMarker(marker, { includeClosed: true });
  assert.equal(found.issue.number, 9001);
  assert.equal(calls[0].join(' ').includes('is:open'), false);
  const ambiguous = createFixedFlywheelGitHubIssueAdapterV1({ execFileFn(command, args, options, callback) {
    callback(null, JSON.stringify({ total_count: 2, items: [9001, 9002].map((number) => ({
      number, state: 'open', body: `<!-- ${marker} -->`,
    })) }));
  } });
  assert.equal((await ambiguous.findByMarker(marker, { includeClosed: true })).ok, false);
});

test('incomplete, failed, foreign and mismatched goal evidence never earns completion credit', () => {
  const { existingGoal, identityConflict, ...work } = pressures(feed())[0];
  const base = { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-9001', issueNumber: 9001, repository: REPOSITORY, timestampUtc: NOW,
    seedGrowthWork: work, status: 'COMPLETE', state: 'COMPLETE',
    resultProofRefs: ['proof/completion'], reusableCapabilityId: 'real-capability', sharedLessonId: 'real-lesson' };
  assert.equal(projectSeedGrowthWorkV1(work.seedId, [base], NOW_MS).completedGoalCount, 1);
  for (const patch of [
    { status: 'BUILDING' }, { state: 'FAILED' }, { status: 'CLOSED', state: 'CLOSED' },
    { resultProofRefs: [] }, { sharedLessonId: '' }, { reusableCapabilityId: '' },
    { repository: 'other/repo' }, { goalId: 'goal-9999' },
    { seedGrowthWork: { ...work, ownerIssueRef: '#1' } },
    { timestampUtc: '2026-10-08T20:00:00.000Z' },
  ]) assert.equal(projectSeedGrowthWorkV1(work.seedId, [{ ...base, ...patch }], NOW_MS).completedGoalCount, 0);
});

test('one failed seed admission does not stop resource-disjoint seed reconciliation', async () => {
  const paths = await fixture();
  const payload = feed();
  let attempts = 0;
  const result = await reconcileFlywheelLearningGoalsV1({ ...paths, nowMs: NOW_MS,
    canonicalGoalAdmissionAuthorized: true, readSeedFeed: async () => payload,
    readEvents: async () => ({ records: [], errors: [] }), readGoalCandidates: async () => ({ receipts: [] }),
    admitCanonicalGoal: async () => { attempts += 1; if (attempts === 1) throw new Error('surface-unavailable');
      return { ok: false, reason: 'existing-owner-resolution-required' }; },
  });
  assert.equal(attempts, 4);
  assert.equal(result.seedGrowthAttachments.length, 4);
});
