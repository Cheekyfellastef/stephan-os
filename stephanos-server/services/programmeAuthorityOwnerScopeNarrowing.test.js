import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGithubGoalMirrorEstate } from './programmeAuthorityService.js';
import { createMissionRecord, appendMissionEvent, readMissionRecord } from './missionOrchestratorStore.js';
import { retrySafelyBlockedAgentFailure } from './criticalBacklogConveyorService.js';
import { projectFreshOwnerGoalRetryContractV1, projectStrengthenedRetryTestsV1 } from '../../shared/agents/goalAdmissionRequiredTestsV1.mjs';

const NOW = '2026-10-28T20:20:00.000Z';
const BEFORE = '2026-10-28T20:19:00.000Z';
const REPO = 'Cheekyfellastef/stephan-os';
const PREFIX = 'repo:cheekyfellastef/stephan-os:path:';
const CODE = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.mjs';
const NEW_TEST = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.identity.test.mjs';
const ORACLE = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.test.mjs';
const ORIGINAL = [CODE, NEW_TEST, ORACLE];
const TESTS = ['npm run stephanos:verify', 'node --test shared/agents/goalBuildingAgentV1.continuation.test.mjs'];
const HEAD = 'a'.repeat(40);
const sorted = values => [...values].sort();
function prior(overrides = {}) {
  return { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-1557', issueNumber: 1557, repository: REPO, participantId: 'programme-authority',
    title: 'Goal: Autonomous Build Continuity Controller V1', source: 'github-goal-estate-mirror',
    state: 'READY', status: 'READY', route: 'OPENCLAW_LOCAL', resourceIds: ORIGINAL, requiredTests: TESTS,
    mirrorSchema: 'stephanos.github-goal-mirror.v1', mirrorRepository: REPO, mirrorIssueNumber: 1557,
    mirrorObservedAtUtc: BEFORE, githubAdmissionState: 'ADMISSION_PROVEN', mirrorBuildPickupAllowed: true,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false,
    arbitraryShellAllowed: false, ...overrides };
}
function live(overrides = {}, admission = {}) {
  return { issueNumber: 1557, repository: REPO, title: prior().title, state: 'open', labels: ['goal'],
    creatorLogin: 'Cheekyfellastef', authorAssociation: 'OWNER', updatedAt: BEFORE, retrievedAt: NOW,
    admissionProofSource: 'OWNER_AUTHENTICATED_COMMENT', admissionState: 'ADMISSION_PROVEN', schedulerEligible: true,
    admission: { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 1557, repository: REPO,
      state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], resourceIds: [CODE, NEW_TEST], requiredTests: TESTS,
      sourceImplementationAllowed: true, mergeAuthority: false, deploymentAuthority: false,
      runtimeMutationAuthority: false, arbitraryShellAllowed: false, ...admission }, ...overrides };
}
const estate = issue => ({ ok: true, issues: [issue] });
const select = (record = prior(), issue = live(), source = estate(issue)) =>
  projectFreshOwnerGoalRetryContractV1(record, source, 1557, REPO, NOW);

test('fresh future contract narrows the retry while retained mirror and manual scopes remain unchanged', () => {
  for (const participantId of ['goal-intake', 'programme-authority', undefined]) {
    const manual = prior({ source: 'operator', participantId, mirrorSchema: undefined });
    const stamped = buildGithubGoalMirrorEstate([manual], estate(live()), NOW).records[0];
    const again = buildGithubGoalMirrorEstate([stamped], estate(live()), NOW).records[0];
    assert.deepEqual(again.resourceIds, ORIGINAL);
    const contract = select(again);
    assert.equal(contract.valid, true);
    assert.deepEqual(sorted(contract.resourceIds), sorted([CODE, NEW_TEST]));
    assert.equal(projectStrengthenedRetryTestsV1(['npm run stephanos:verify'], contract.commands,
      contract.resourceIds.map(path => path.slice(PREFIX.length))).valid, true);
    assert.deepEqual(manual.resourceIds, ORIGINAL);
  }
});

test('every nonempty proper exact subset is intent; widening and disjoint replacement are rejected', () => {
  for (let mask = 1; mask < 7; mask++) {
    const subset = ORIGINAL.filter((_, i) => mask & (1 << i));
    assert.deepEqual(sorted(select(prior(), live({}, { resourceIds: subset })).resourceIds), sorted(subset));
  }
  for (const resources of [[], ORIGINAL, [...ORIGINAL, PREFIX + 'scripts/other.mjs'], [CODE, PREFIX + 'scripts/other.mjs'],
    [CODE, CODE], [CODE, CODE.toLowerCase()], ['repo:other/repository:path:scripts/a.mjs']]) {
    assert.equal(select(prior(), live({}, { resourceIds: resources })).valid, false);
  }
});

test('unknown, cached, ambiguous, stale, foreign or consequential authority cannot select the new contract', () => {
  for (const issue of [live({ admissionProofSource: 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT' }),
    live({ admissionProofSource: 'PRIOR_MIRROR_ADMISSION_REVALIDATED' }),
    live({ retrievedAt: '2026-10-28T20:14:59.999Z' }), live({ retrievedAt: '2026-10-28T20:20:00.001Z' }),
    live({ retrievedAt: '2026-10-28T20:18:59.999Z' }), live({ repository: 'other/repository' }),
    live({}, { issueNumber: 1558 }), live({}, { sourceImplementationAllowed: false }),
    live({}, { mergeAuthority: true }), live({}, { requiredTests: undefined })]) assert.equal(select(prior(), issue).valid, false);
  for (const source of [null, { ok: false, issues: [live()] }, { ok: true, issues: [] },
    { ok: true, issues: [live(), live()] }]) assert.equal(select(prior(), live(), source).valid, false);
  assert.equal(select(prior({ mirrorBuildPickupAllowed: false })).valid, false);
});

test('existing retry rebinds fresh primary intent after ownership and worktree awaits', async t => {
  for (const mode of ['pass', 'raw-missing', 'raw-failed', 'cached', 'stale', 'body-moved', 'head-moved',
    'scope-moved', 'tests-moved', 'prior-processing', 'outside-original', 'self-dated-stale', 'elapsed-expired']) await t.test(mode, async t => {
    let elapsed = 0;
    if (mode === 'elapsed-expired') t.mock.method(performance, 'now', () => elapsed);
    const tempBase = await realpath(tmpdir());
    const root = await mkdtemp(join(tempBase, 'owner-retry-'));
    t.after(async () => {
      const resolved = await realpath(root);
      assert.ok(resolved.startsWith(join(tempBase, 'owner-retry-')));
      await rm(resolved, { recursive: true, force: true });
    });
    const paths = Object.fromEntries(['repoRoot', 'workspaceRoot', 'worktreeRoot', 'orchestratorRoot', 'snapshotRoot']
      .map(key => [key, join(root, key)]));
    await Promise.all(Object.values(paths).map(path => mkdir(path, { recursive: true })));
    const options = { root: paths.orchestratorRoot, now: new Date(NOW), env: {} };
    let { state } = await createMissionRecord({ missionId: 'critical-1557-elastic-goal', title: 'Continuity repair',
      operatorIntent: 'Same bounded source mission', intendedOutcome: 'Preserve identity before continuation',
      missionKind: 'implementation', repository: REPO, branch: 'openclaw/elastic-goal-1557',
      worktreePath: join(root, 'worker'), allowedFiles: mode === 'outside-original' ? [CODE.slice(PREFIX.length)] : ['**'],
      requiredEvidence: ['focused source proof'], requiredTests: ['npm run stephanos:verify'] }, options);
    const proof = receiptId => ({ receiptId, requirement: 'fixture', source: 'fixture', evidenceType: 'command-output', verified: true, exitCode: 0 });
    for (const event of [
      { eventType: 'WORKTREE_READY', worktreePath: state.git.worktreePath, clean: true, receipt: proof('retry-worktree-proof') },
      { eventType: 'AGENT_DISPATCHED', agentId: 'foundry-forge' },
      { eventType: 'AGENT_RESULT_RECEIVED', success: false, resultId: 'critical-1557-elastic-goal-r1-original', error: 'SOURCE_ARTIFACT_DIFF_CHECK_FAILED' },
      { eventType: 'MISSION_PARKED_FOR_REPAIR', reason: 'Keep original failure', repairOwner: '#2961', receipt: proof('retry-park-proof') },
    ]) ({ state } = await appendMissionEvent(state.missionId, { eventId: `owner-fixture-${event.eventType.toLowerCase()}`, ...event }, options));
    const original = structuredClone(state);
    let reads = 0;
    const result = await retrySafelyBlockedAgentFailure({ paths, backlog: [], env: {}, now: new Date(NOW),
      listMissions: async () => [(await readMissionRecord(state.missionId, options)).state],
      readProgrammeProjection: async () => {
        const issue = live();
        if (++reads > 1) {
          if (mode === 'cached') issue.admissionProofSource = 'PRIOR_MIRROR_ADMISSION_REVALIDATED';
          if (mode === 'stale') issue.retrievedAt = '2026-10-28T20:14:00.000Z';
          if (mode === 'body-moved') issue.updatedAt = NOW;
          if (mode === 'scope-moved') issue.admission.resourceIds = [CODE];
          if (mode === 'tests-moved') issue.admission.requiredTests = [...TESTS, 'node --test shared/agents/goalBuildingAgentV1.resume.test.mjs'];
        }
        const record = prior();
        if (mode === 'self-dated-stale') {
          issue.retrievedAt = '2026-10-28T20:14:00.000Z';
          issue.updatedAt = '2026-10-28T20:13:00.000Z';
          record.mirrorObservedAtUtc = '2026-10-28T20:10:00.000Z';
        }
        return { observedAtUtc: mode === 'self-dated-stale' ? issue.retrievedAt : NOW,
          machineryInventory: { sourceHead: reads > 1 && mode === 'head-moved' ? 'b'.repeat(40) : HEAD },
          goalMirrorEstate: { records: [record] }, githubGoalEstateRead: reads > 1 && mode === 'raw-missing' ? undefined
            : reads > 1 && mode === 'raw-failed' ? { ok: false, issues: [issue] } : estate(issue) };
      },
      proveRetryOwnershipReleased: async () => {
        if (mode === 'elapsed-expired') elapsed = 300_001;
        return { ok: mode !== 'prior-processing' };
      },
      refreshRetryWorktree: async () => ({ ok: true, clean: true, afterHead: HEAD }),
    });
    const persisted = (await readMissionRecord(state.missionId, options)).state;
    if (mode === 'pass') {
      assert.equal(result.retried, true, JSON.stringify(result));
      assert.equal(persisted.repair.currentRound, 1);
      assert.equal(persisted.allowedFiles.includes(ORACLE.slice(PREFIX.length)), false);
      assert.deepEqual(persisted.requiredTests, TESTS);
      assert.deepEqual(persisted.repair.history[0].previousDispatch, original.dispatch);
    } else {
      assert.equal(result.retried, false, JSON.stringify(result));
      assert.equal(persisted.revision, original.revision);
      assert.deepEqual(persisted.allowedFiles, original.allowedFiles);
    }
  });
});
