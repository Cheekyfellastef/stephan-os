import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGithubGoalEstate, buildGithubGoalMirrorEstate } from './programmeAuthorityService.js';
import { fetchGithubGoalIssues } from './githubPrEvidenceService.js';
import { projectStrengthenedRetryTestsV1 } from '../../shared/agents/goalAdmissionRequiredTestsV1.mjs';

const NOW = '2026-10-28T20:20:00.000Z';
const BEFORE = '2026-10-28T20:19:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PREFIX = 'repo:cheekyfellastef/stephan-os:path:';
const CODE = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.mjs';
const NEW_TEST = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.identity.test.mjs';
const ORACLE = PREFIX + 'shared/agents/goalBuildingAgentV1.continuation.test.mjs';
const ORIGINAL = [CODE, NEW_TEST, ORACLE];
const TESTS = ['npm run stephanos:verify', 'node --test shared/agents/goalBuildingAgentV1.continuation.test.mjs'];
const sorted = values => [...values].sort();

function prior(overrides = {}) {
  return { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-1557', issueNumber: 1557, repository: REPOSITORY, participantId: 'programme-authority',
    title: 'Goal: Autonomous Build Continuity Controller V1', source: 'github-goal-estate-mirror',
    sourceUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/1557',
    state: 'READY', status: 'READY', route: 'OPENCLAW_LOCAL', resourceIds: ORIGINAL,
    mirrorSchema: 'stephanos.github-goal-mirror.v1', mirrorRepository: REPOSITORY,
    mirrorIssueNumber: 1557, mirrorObservedAtUtc: BEFORE, githubAdmissionState: 'ADMISSION_PROVEN',
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false,
    arbitraryShellAllowed: false, ...overrides };
}
function live(overrides = {}, admission = {}) {
  return { issueNumber: 1557, repository: REPOSITORY, title: prior().title, state: 'open', labels: ['goal'],
    creatorLogin: 'Cheekyfellastef', authorAssociation: 'OWNER', updatedAt: BEFORE, retrievedAt: NOW,
    admissionProofSource: 'OWNER_AUTHENTICATED_COMMENT', admissionState: 'ADMISSION_PROVEN', schedulerEligible: true,
    admission: { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 1557, repository: REPOSITORY,
      state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], resourceIds: [CODE, NEW_TEST],
      requiredTests: TESTS, sourceImplementationAllowed: true, mergeAuthority: false,
      deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false, ...admission }, ...overrides };
}
function project(record = prior(), issue = live()) {
  return buildGithubGoalMirrorEstate([record], { ok: true, issues: [issue] }, NOW).records[0];
}

test('fresh owner narrowing removes the old oracle from future scope through merge and mirror', () => {
  const record = prior();
  const merged = mergeGithubGoalEstate([record], { ok: true, issues: [live()] }, NOW)[0];
  assert.deepEqual(sorted(merged.resourceIds), sorted([CODE, NEW_TEST]));
  const result = project(record);
  assert.deepEqual(sorted(result.resourceIds), sorted([CODE, NEW_TEST]));
  assert.equal(projectStrengthenedRetryTestsV1(['npm run stephanos:verify'], result.requiredTests,
    result.resourceIds.map(path => path.slice(PREFIX.length))).valid, true);
  assert.deepEqual(record.resourceIds, ORIGINAL, 'the previous observation is immutable');
});

test('every nonempty proper exact subset can narrow; adding or replacing resources cannot', () => {
  for (let mask = 1; mask < 7; mask++) {
    const subset = ORIGINAL.filter((_, index) => mask & (1 << index));
    assert.deepEqual(sorted(project(prior(), live({}, { resourceIds: subset })).resourceIds), sorted(subset));
  }
  for (const resources of [[], [...ORIGINAL, PREFIX + 'scripts/other.mjs'], [CODE, PREFIX + 'scripts/other.mjs']]) {
    assert.deepEqual(project(prior(), live({}, { resourceIds: resources })).resourceIds, ORIGINAL);
  }
});

test('only a fresh, exact owner admission can replace mirror-derived scope', () => {
  const rejected = [
    live({ admissionProofSource: 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT' }),
    live({ admissionProofSource: 'PRIOR_MIRROR_ADMISSION_REVALIDATED' }),
    live({ retrievedAt: '2026-10-28T20:14:59.999Z' }),
    live({ retrievedAt: '2026-10-28T20:20:00.001Z' }),
    live({ retrievedAt: '2026-10-28T20:18:59.999Z' }),
    live({ repository: 'other/repository' }),
    live({}, { issueNumber: 1558 }),
    live({}, { resourceIds: [CODE, CODE] }),
    live({}, { resourceIds: ['repo:other/repository:path:scripts/test.mjs'] }),
    live({}, { sourceImplementationAllowed: false }),
    live({}, { mergeAuthority: true }),
  ];
  for (const issue of rejected) assert.deepEqual(project(prior(), issue).resourceIds, ORIGINAL);
  const ambiguous = mergeGithubGoalEstate([prior()], { ok: true, issues: [live(), live()] }, NOW);
  assert.deepEqual(ambiguous[0].resourceIds, ORIGINAL);
});

test('manual, foreign and unbound workspace scopes are preserved', () => {
  for (const changes of [{ source: 'operator', participantId: 'goal-intake' },
    { participantId: 'goal-intake' }, { goalId: 'goal-1558' }, { mirrorIssueNumber: 1558 },
    { repository: 'other/repository' }, { mirrorRepository: 'other/repository' },
    { mirrorObservedAtUtc: undefined }, { mirrorSchema: undefined },
    { admissionSource: 'manual-owner-plan' }, { mergeAuthority: true }]) {
    const record = prior(changes);
    assert.deepEqual(project(record).resourceIds, record.resourceIds);
  }
});

test('initial owner admission can still enrich an unscoped goal without a narrowing claim', () => {
  for (const resourceIds of [undefined, null, []]) {
    const result = project(prior({ resourceIds }));
    assert.deepEqual(sorted(result.resourceIds), sorted([CODE, NEW_TEST]));
    assert.equal(result.state, 'READY');
  }
});

test('narrowing preserves lifecycle and operator containment', () => {
  const blocked = project(prior({ state: 'BLOCKED', status: 'BLOCKED', route: 'BLOCKED_UNSAFE_OR_UNKNOWN' }));
  assert.deepEqual(sorted(blocked.resourceIds), sorted([CODE, NEW_TEST]));
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
  assert.equal(blocked.mirrorBuildPickupAllowed, false);
  const stop = { active: true, action: 'STOP' };
  const contained = project(prior({ operatorLaneContainment: stop }), live({
    operatorLaneContainment: stop, admissionState: 'OPERATOR_CONTAINED', schedulerEligible: false,
  }));
  assert.equal(contained.operatorLaneContainment.active, true);
  assert.equal(contained.state, 'WAITING_FOR_EXTERNAL_CONDITION');
  assert.equal(contained.mirrorBuildPickupAllowed, false);
  assert.equal(contained.mergeAuthority, false);
  assert.equal(contained.runtimeMutationAuthority, false);
});

test('prior-mirror revalidation retains the corrected scope without replaying excluded resources', async () => {
  const corrected = project();
  const issue = { number: 1557, title: prior().title, state: 'open', labels: [{ name: 'goal' }],
    user: { login: 'Cheekyfellastef' }, author_association: 'OWNER', comments: 44,
    body: 'Existing goal text', updated_at: BEFORE, html_url: prior().sourceUrl };
  const observation = await fetchGithubGoalIssues({ owner: 'Cheekyfellastef', repo: 'stephan-os',
    auth: { configured: true, token: 'test-only' }, cacheEnabled: false, maxPages: 1,
    nowMs: () => Date.parse(NOW), priorGoalRecords: [corrected], fetchImpl: async url => {
      assert.equal(url.includes('/comments?'), false);
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => [issue] };
    } });
  assert.equal(observation.issues[0].admissionProofSource, 'PRIOR_MIRROR_ADMISSION_REVALIDATED');
  assert.deepEqual(sorted(observation.issues[0].admission.resourceIds), sorted([CODE, NEW_TEST]));
});
