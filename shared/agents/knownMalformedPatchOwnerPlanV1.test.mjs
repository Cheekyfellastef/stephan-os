import test from 'node:test';
import assert from 'node:assert/strict';
import { projectKnownMalformedPatchOwnerPlanV1 as project } from './knownMalformedPatchOwnerPlanV1.mjs';
import { KNOWN_MALFORMED_PATCH_REPAIR_V1 as KNOWN } from './knownMalformedPatchRetryV1.mjs';
import { fetchGithubGoalIssues } from '../../stephanos-server/services/githubPrEvidenceService.js';

const NOW = '2026-11-05T12:00:00.000Z';
const BEFORE = '2026-11-05T11:59:00.000Z';
const PREFIX = 'repo:cheekyfellastef/stephan-os:path:';
const CODE = PREFIX + 'shared/agents/sharedAgentWorkspaceStore.mjs';
const ORACLE = 'node --test shared/agents/sharedAgentWorkspaceStore.test.mjs';
const VERIFY = 'npm run stephanos:verify';
const permissions = { mergeAuthority: false, deploymentAuthority: false,
  runtimeMutationAuthority: false, arbitraryShellAllowed: false };

function fixture() {
  const mission = { missionId: KNOWN.missionId, repository: KNOWN.repository,
    git: { branch: KNOWN.branch, clean: true, worktreeReady: true, changedFiles: [] },
    currentPhase: 'BLOCKED', continuity: { parkingStatus: 'PARKED_BLOCKED' },
    cancelled: false, activeWriter: 'none', revision: 4,
    dispatch: { status: 'failed', adapter: KNOWN.adapter, resultId: KNOWN.actionId },
    repair: { currentRound: 0, maximumRounds: 3 }, blockers: [KNOWN.blocker],
    allowedFiles: ['**'], requiredTests: [VERIFY] };
  const mirror = { schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.goal', goalId: 'goal-1372', issueNumber: 1372,
    repository: KNOWN.repository, source: 'github-goal-estate-mirror',
    mirrorSchema: 'stephanos.github-goal-mirror.v1', githubAdmissionState: 'ADMISSION_PROVEN',
    mirrorIssueNumber: 1372, mirrorRepository: KNOWN.repository, mirrorBuildPickupAllowed: true,
    mirrorObservedAtUtc: BEFORE, state: 'READY', route: 'OPENCLAW_LOCAL', resourceIds: [], ...permissions };
  const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: 1372,
    repository: KNOWN.repository, state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [],
    resourceIds: [CODE], requiredTests: [VERIFY, ORACLE], sourceImplementationAllowed: true, ...permissions };
  const issue = { issueNumber: 1372, repository: KNOWN.repository, state: 'open', labels: ['goal'],
    retrievedAt: NOW, updatedAt: BEFORE, admissionProofSource: 'OWNER_AUTHENTICATED_COMMENT',
    admissionState: 'ADMISSION_PROVEN', schedulerEligible: true, admission };
  return { mission, mirror, estate: { ok: true, issues: [issue] } };
}
const select = ({ mission, mirror, estate }, now = NOW) => project(mission, mirror, estate, now);

test('fresh scoped owner plan narrows the exact unscoped failure without rewriting retained truth', () => {
  const input = fixture(), before = structuredClone(input);
  const plan = select(input);
  assert.deepEqual(plan, { valid: true, supplied: true, commands: [VERIFY, ORACLE],
    resourceIds: [CODE], updatedAtUtc: BEFORE });
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.commands), true);
  assert.equal(Object.isFrozen(plan.resourceIds), true);
});

test('identity, actual original failure and retained mirror are all required', () => {
  for (const change of [
    f => { f.mission.missionId = 'critical-1373-elastic-goal'; },
    f => { f.mission.blockers = ['PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:another']; },
    f => { f.mission.dispatch.resultId += '-other'; },
    f => { f.mission.allowedFiles = ['shared/agents/**']; },
    f => { f.mission.cancelled = true; },
    f => { f.mission.activeWriter = 'foundry-forge'; },
    f => { f.mirror.resourceIds = [CODE]; },
    ...['schemaVersion', 'kind', 'goalId', 'issueNumber', 'repository', 'source', 'mirrorSchema',
      'githubAdmissionState', 'mirrorIssueNumber', 'mirrorRepository', 'mirrorBuildPickupAllowed']
      .map(key => f => { f.mirror[key] = null; }),
    f => { f.estate.issues[0].issueNumber = 1373; },
    f => { f.estate.issues[0].repository = 'other/repo'; },
    f => { f.estate.issues[0].admission.issueNumber = 1373; },
    f => { f.estate.issues[0].admission.repository = 'other/repo'; },
    f => { f.estate.issues.push(structuredClone(f.estate.issues[0])); },
    f => { f.estate.ok = false; },
  ]) { const f = fixture(); change(f); assert.equal(select(f).valid, false, String(change)); }
  assert.equal(project(null, null, null, NOW).valid, false);
});

test('stale, future, unordered and invalid observations cannot renew owner intent', () => {
  for (const [key, value] of [
    ['retrievedAt', '2026-11-05T11:54:59.999Z'], ['retrievedAt', '2026-11-05T12:00:00.001Z'],
    ['retrievedAt', '2026-11-05T11:58:59.999Z'], ['updatedAt', '2026-11-05T12:00:00.001Z'],
    ['updatedAt', 'invalid'], ['retrievedAt', 'invalid'],
  ]) { const f = fixture(); f.estate.issues[0][key] = value; assert.equal(select(f).valid, false); }
  assert.equal(select(fixture(), 'invalid').valid, false);
  const f = fixture(); f.mirror.mirrorObservedAtUtc = 'invalid'; assert.equal(select(f).valid, false);
});

test('canonical route, owner comment, containment and zero extra authorities remain mandatory', () => {
  for (const [target, key, value] of [
    ['issue', 'admissionProofSource', 'PRIOR_MIRROR_ADMISSION_REVALIDATED'],
    ['issue', 'admissionProofSource', 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT'],
    ['issue', 'admissionState', 'OPERATOR_CONTAINED'], ['issue', 'schedulerEligible', false],
    ['issue', 'state', 'closed'], ['issue', 'labels', []],
    ['issue', 'operatorLaneContainment', { active: true }],
    ['mirror', 'operatorLaneContainment', { active: true }],
    ['admission', 'sourceImplementationAllowed', false], ['admission', 'prerequisites', [1]],
    ['mirror', 'prerequisites', [1]],
    ...['mirror', 'admission'].flatMap(target => [['state', 'BLOCKED'], ['route', 'GITHUB'],
      ...Object.keys(permissions).map(key => [key, true])].map(([key, value]) => [target, key, value])),
  ]) {
    const f = fixture(), issue = f.estate.issues[0];
    (target === 'mirror' ? f.mirror : target === 'issue' ? issue : issue.admission)[key] = value;
    assert.equal(select(f).valid, false, `${target}.${key}`);
  }
});

test('empty, duplicate, broad, escaping and protected resource scopes refuse', () => {
  for (const resources of [[], [CODE, CODE], [CODE, CODE.toUpperCase()], ['repo:cheekyfellastef/stephan-os'],
    [PREFIX + '**'], [PREFIX + 'shared/**'], [PREFIX + '../outside.mjs'], [PREFIX + 'shared/../outside.mjs'],
    [PREFIX + '.'], [PREFIX + 'shared//a.mjs'], [PREFIX + 'shared/con.mjs'],
    [PREFIX + '.git/config'], [PREFIX + 'node_modules/a.mjs'], [PREFIX + 'stephanos-server/data/a.json'],
    [PREFIX + '.env'], [PREFIX + 'shared/token.mjs'], [PREFIX + 'shared/a.key'],
    ['repo:other/repo:path:shared/a.mjs'], [CODE + ' '], ['lane:forge'], null,
  ]) { const f = fixture(); f.estate.issues[0].admission.resourceIds = resources; assert.equal(select(f).valid, false, JSON.stringify(resources)); }
});

test('unchanged or weakened plans and acceptance inside writable descendants refuse', () => {
  for (const tests of [undefined, [], [VERIFY], [ORACLE], [VERIFY, 'npm install'], [VERIFY, ORACLE, ORACLE]]) {
    const f = fixture(); f.estate.issues[0].admission.requiredTests = tests; assert.equal(select(f).valid, false);
  }
  for (const scope of [PREFIX + 'shared/agents', PREFIX + 'shared/agents/sharedAgentWorkspaceStore.test.mjs']) {
    const f = fixture(); f.estate.issues[0].admission.resourceIds = [scope]; assert.equal(select(f).valid, false);
  }
  const f = fixture(); f.mission.requiredTests.push('node --test scripts/previous.test.mjs');
  assert.equal(select(f).valid, false);
});

test('actual native reader rejects wrong comment author or association before owner-plan selection', async () => {
  for (const [login, association, expected] of [
    ['Cheekyfellastef', 'OWNER', true], ['other-user', 'OWNER', false],
    ['Cheekyfellastef', 'CONTRIBUTOR', false],
  ]) {
    const f = fixture();
    const comment = { user: { login }, author_association: association,
      body: '```stephanos-goal-admission-v1\n' + JSON.stringify(f.estate.issues[0].admission) + '\n```' };
    const issue = { number: 1372, title: 'Goal: Shared Lessons Memory V1', state: 'open', comments: 1,
      user: { login: 'contributor' }, author_association: 'CONTRIBUTOR', labels: [{ name: 'goal' }],
      updated_at: BEFORE, created_at: BEFORE, body: '', html_url: `https://github.com/${KNOWN.repository}/issues/1372` };
    const result = await fetchGithubGoalIssues({ owner: 'Cheekyfellastef', repo: 'stephan-os',
      auth: { configured: true, token: 'test-only', authority: 'test-only' }, maxPages: 1,
      cacheEnabled: false, nowMs: () => Date.parse(NOW), fetchImpl: async url => ({
        ok: true, status: 200, headers: { get: () => '' },
        json: async () => url.includes('/comments?') ? [comment] : url.includes('/events?') ? [] : [issue],
      }) });
    f.estate = { ok: result.status === 'fetched', issues: result.issues };
    assert.equal(select(f).valid, expected, `${login}/${association}`);
  }
});
