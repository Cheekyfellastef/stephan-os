import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { fetchGithubGoalIssues } = await import(pathToFileURL(repo + '/stephanos-server/services/githubPrEvidenceService.js'));
const { buildGithubGoalMirrorEstate, readAuthoritativeProgrammeProjection, writeGithubGoalEstateSharedSnapshot, readGithubGoalEstateSharedSnapshot } = await import(pathToFileURL(repo + '/stephanos-server/services/programmeAuthorityService.js'));
const { projectFreshOwnerGoalRetryContractV1, projectPrimaryOwnerCommentReadRequirementV1, projectRequestedPrimaryOwnerEvidenceV1 } = await import(pathToFileURL(repo + '/shared/agents/goalAdmissionRequiredTestsV1.mjs'));
const { ensureSharedWorkspaceLayout, validateSharedWorkspaceRecord } = await import(pathToFileURL(repo + '/shared/agents/sharedAgentWorkspaceStore.mjs'));
const { createMissionRecord, appendMissionEvent, readMissionRecord } = await import(pathToFileURL(repo + '/stephanos-server/services/missionOrchestratorStore.js'));
const { retrySafelyBlockedAgentFailure } = await import(pathToFileURL(repo + '/stephanos-server/services/criticalBacklogConveyorService.js'));
const HEAD = 'a'.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os', OWNER = 'Cheekyfellastef', ISSUE = 1557;
const NOW = '2026-10-28T21:20:00.000Z';
const prefix = 'repo:cheekyfellastef/stephan-os:path:';
const code = prefix + 'shared/agents/goalBuildingAgentV1.continuation.mjs';
const newTest = prefix + 'shared/agents/goalBuildingAgentV1.continuation.identity.test.mjs';
const oracle = prefix + 'shared/agents/goalBuildingAgentV1.continuation.test.mjs';
const tests = ['npm run stephanos:verify', 'node --test shared/agents/goalBuildingAgentV1.continuation.test.mjs'];
const prior = () => ({ schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
  goalId: 'goal-1557', issueNumber: ISSUE, participantId: 'programme-authority', repository: REPO,
  timestampUtc: NOW, title: 'Goal: Autonomous Build Continuity Controller V1',
  status: 'READY', state: 'READY', route: 'OPENCLAW_LOCAL', resourceIds: [code, newTest, oracle], requiredTests: tests,
  source: 'github-goal-estate-mirror', githubAdmissionState: 'ADMISSION_PROVEN',
  mirrorSchema: 'stephanos.github-goal-mirror.v1', mirrorRepository: REPO, mirrorIssueNumber: ISSUE,
  mirrorObservedAtUtc: '2026-10-28T21:19:00.000Z', mirrorLeaseExpiresAtUtc: '2026-10-29T21:19:00.000Z',
  mirrorBuildPickupAllowed: true, operatorLaneContainment: { active: false },
  mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false });
const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', issueNumber: ISSUE, repository: REPO,
  state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], resourceIds: [code, newTest], requiredTests: tests,
  sourceImplementationAllowed: true, mergeAuthority: false, deploymentAuthority: false,
  runtimeMutationAuthority: false, arbitraryShellAllowed: false };
const fence = String.fromCharCode(96).repeat(3);
async function read(records, requirement = {}, fixture = {}) {
  let commentReads = 0;
  const raw = await fetchGithubGoalIssues({ owner: OWNER, repo: 'stephan-os',
    auth: { configured: true, authority: 'test-only', token: 'fixture' }, priorGoalRecords: records,
    maxPages: 1, cacheEnabled: false, nowMs: () => fixture.clock ?? Date.parse(NOW), ...requirement,
    fetchImpl: async url => {
      let data;
      if (url.includes('/events?')) data = [{ event: 'labeled', label: { name: 'goal' }, actor: { login: OWNER } }];
      else if (url.includes('/comments?')) { commentReads++; data = fixture.comments ?? [{ id: 6479158443, user: { login: OWNER },
        author_association: 'OWNER', body: fence + 'stephanos-goal-admission-v1\n' + JSON.stringify(admission) + '\n' + fence }]; }
      else data = [{ number: ISSUE, title: 'Goal: Autonomous Build Continuity Controller V1', state: 'open',
        user: { login: OWNER }, author_association: 'OWNER', labels: [{ name: 'goal' }], comments: 44,
        updated_at: '2026-10-28T21:09:20Z', created_at: '2026-07-01T00:00:00Z',
        body: 'Keep the existing source mission and retained reservation.',
        html_url: 'https://github.com/' + REPO + '/issues/1557' }];
      return { ok: true, status: 200, headers: { get: () => '' }, json: async () => data };
    } });
  return { raw, estate: { ...raw, ok: raw.status === 'fetched', reason: 'GITHUB_GOAL_ESTATE_FETCHED' }, commentReads };
}
test('ordinary retained-mirror observation remains weaker than primary owner intent', async () => {
  const { estate, commentReads } = await read([prior()]);
  assert.equal(commentReads, 0);
  assert.equal(estate.issues[0].admissionProofSource, 'PRIOR_MIRROR_ADMISSION_REVALIDATED');
  assert.equal(estate.issues[0].admission.resourceIds.length, 3);
  assert.equal(projectFreshOwnerGoalRetryContractV1(prior(), estate, ISSUE, REPO, NOW).valid, false);
});
test('required primary evidence traverses actual reader and repeated retained mirror rounds', async () => {
  let retained = prior();
  for (let round = 0; round < 3; round++) {
    const { estate, commentReads } = await read([retained], { requiredPrimaryOwnerCommentIssueNumbers: [ISSUE] });
    assert.equal(commentReads, 1, 'A requested primary contract must actually read canonical owner comments');
    assert.equal(estate.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
    const next = buildGithubGoalMirrorEstate([retained], estate, NOW).records[0];
    assert.deepEqual([...next.resourceIds].sort(), [...retained.resourceIds].sort(), 'Stored reservations remain unchanged');
    const contract = projectFreshOwnerGoalRetryContractV1(next, estate, ISSUE, REPO, NOW);
    assert.equal(contract.valid, true);
    assert.deepEqual(contract.resourceIds, [code, newTest].sort());
    assert.equal(contract.resourceIds.includes(oracle), false);
    retained = next;
  }
});


test('stronger cache scope refreshes once and negative lookup coverage grants no primary proof', async () => {
  const clock = Date.parse(NOW) + 600_000;
  const weak = await read([prior()], { cacheEnabled: true }, { clock });
  assert.equal(weak.commentReads, 0);
  const request = { cacheEnabled: true, requiredPrimaryOwnerCommentIssueNumbers: [ISSUE] };
  const primary = await read([prior()], request, { clock });
  assert.equal(primary.commentReads, 1);
  assert.equal(primary.raw.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
  const cached = await read([prior()], request, { clock: clock + 1 });
  assert.equal(cached.commentReads, 0);
  assert.equal(cached.raw, primary.raw);
  const negative = await read([prior()], request, { clock: clock + 300_001, comments: [] });
  assert.equal(negative.commentReads, 1);
  assert.equal(negative.raw.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT');
  const negativeCached = await read([prior()], request, { clock: clock + 300_002 });
  assert.equal(negativeCached.commentReads, 0);
  assert.equal(negativeCached.raw, negative.raw);
  assert.equal(projectFreshOwnerGoalRetryContractV1(prior(), negativeCached.estate, ISSUE, REPO,
    new Date(clock + 300_002).toISOString()).valid, false);
});

test('malformed read requirements are rejected before GitHub authority reads', async () => {
  for (const ids of [null, [0], [-1], ['1557'], [1557, 1557], Array.from({ length: 1001 }, (_, i) => i + 1)]) {
    const result = await read([prior()], { requiredPrimaryOwnerCommentIssueNumbers: ids });
    assert.equal(result.raw.reasonCode, 'PRIMARY_OWNER_READ_REQUIREMENT_INVALID');
    assert.equal(result.commentReads, 0);
  }
});

async function temporary(t) {
  const base = await realpath(tmpdir());
  const directory = await mkdtemp(join(base, 'primary-owner-contract-'));
  t.after(async () => {
    const resolved = await realpath(directory);
    assert.ok(resolved.startsWith(join(base, 'primary-owner-contract-')));
    await rm(resolved, { recursive: true, force: true });
  });
  const root = join(directory, 'workspace');
  await ensureSharedWorkspaceLayout({ root, repoRoot: repo });
  return { directory, root };
}

test('the real shared snapshot honors stronger scope without promoting cached negatives', async t => {
  const { root } = await temporary(t);
  const options = { root, repoRoot: repo, nowUtc: NOW };
  const request = { ...options, requiredPrimaryOwnerCommentIssueNumbers: [ISSUE] };
  const weak = await read([prior()]);
  assert.equal(await writeGithubGoalEstateSharedSnapshot(options, weak.estate), true);
  assert.equal(await readGithubGoalEstateSharedSnapshot(request), null);
  const primary = await read([prior()], { requiredPrimaryOwnerCommentIssueNumbers: [ISSUE] });
  assert.equal(await writeGithubGoalEstateSharedSnapshot(options, primary.estate), true);
  const observed = await readGithubGoalEstateSharedSnapshot(request);
  assert.equal(observed.issues[0].admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
  const stale = await readGithubGoalEstateSharedSnapshot({ ...request, allowStale: true,
    nowUtc: new Date(Date.parse(NOW) + 300_001).toISOString() });
  assert.equal(projectFreshOwnerGoalRetryContractV1(prior(), stale, ISSUE, REPO,
    new Date(Date.parse(NOW) + 300_001).toISOString()).valid, false);
  const negative = await read([prior()], { requiredPrimaryOwnerCommentIssueNumbers: [ISSUE] }, { comments: [] });
  assert.equal(await writeGithubGoalEstateSharedSnapshot(options, negative.estate), true);
  const negativeCached = await readGithubGoalEstateSharedSnapshot(request);
  assert.notEqual(negativeCached, null);
  assert.equal(projectFreshOwnerGoalRetryContractV1(prior(), negativeCached, ISSUE, REPO, NOW).valid, false);
  const oversized = projectRequestedPrimaryOwnerEvidenceV1({ ...primary.estate,
    issues: [{ ...primary.estate.issues[0], admission: { ...admission, requiredTests: ['x'.repeat(40000)] } }] },
    projectPrimaryOwnerCommentReadRequirementV1([ISSUE]));
  assert.equal(oversized.ok, false);
  assert.equal(oversized.reason, 'PRIMARY_OWNER_EVIDENCE_OVERSIZE');
});

test('actual programme producer returns primary evidence to the real mission retry/store consumer', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const { directory, root } = await temporary(t);
  const record = prior();
  assert.equal(validateSharedWorkspaceRecord(record, { nowMs: Date.parse(NOW) }).valid, true);
  await writeFile(join(root, 'goals', 'goal-1557.json'), JSON.stringify(record));
  const paths = { workspaceRoot: root, repoRoot: repo, worktreeRoot: join(directory, 'worktrees'),
    orchestratorRoot: join(directory, 'missions'), snapshotRoot: join(directory, 'snapshots') };
  await Promise.all([paths.worktreeRoot, paths.orchestratorRoot, paths.snapshotRoot].map(path => mkdir(path, { recursive: true })));
  const store = { root: paths.orchestratorRoot, now: new Date(NOW), env: {} };
  let { state } = await createMissionRecord({ missionId: 'critical-1557-elastic-goal',
    title: 'Existing continuity mission', operatorIntent: 'Preserve original identity',
    intendedOutcome: 'Repair continuation identity', missionKind: 'implementation', repository: REPO,
    branch: 'openclaw/elastic-goal-1557', worktreePath: join(directory, 'worker'), allowedFiles: ['**'],
    requiredEvidence: ['focused source proof'], requiredTests: ['npm run stephanos:verify'] }, store);
  const proof = receiptId => ({ receiptId, requirement: 'fixture', source: 'fixture',
    evidenceType: 'command-output', verified: true, exitCode: 0 });
  for (const event of [
    { eventType: 'WORKTREE_READY', worktreePath: state.git.worktreePath, clean: true, receipt: proof('boundary-worktree') },
    { eventType: 'AGENT_DISPATCHED', agentId: 'foundry-forge' },
    { eventType: 'AGENT_RESULT_RECEIVED', success: false, resultId: 'boundary-original-result', error: 'SOURCE_ARTIFACT_DIFF_CHECK_FAILED' },
    { eventType: 'MISSION_PARKED_FOR_REPAIR', reason: 'Keep original failure', repairOwner: '#2961', receipt: proof('boundary-park') },
  ]) ({ state } = await appendMissionEvent(state.missionId, { eventId: 'boundary-' + event.eventType.toLowerCase(), ...event }, store));
  const observedProjections = [];
  const requests = [];
  const readProgrammeProjection = async options => {
    requests.push(options.requiredPrimaryOwnerCommentIssueNumbers);
    const projection = await readAuthoritativeProgrammeProjection({ ...options, home: join(directory, 'home'),
      testOnly: true, nowUtc: NOW, env: {}, dependencies: {
        resolveGithubTokenConfig: async () => ({ configured: true, token: 'fixture', authority: 'test-only' }),
        readRepositoryHead: async () => ({ ok: true, branch: 'main', headSha: HEAD, reason: 'FIXTURE_GIT_BOUNDARY' }),
        fetchGithubGoalIssues: async args => {
          // Real reader, replacing only the external GitHub response boundary.
          const result = await read(args.priorGoalRecords, {
            requiredPrimaryOwnerCommentIssueNumbers: args.requiredPrimaryOwnerCommentIssueNumbers });
          return result.raw;
        },
      } });
    observedProjections.push(projection);
    return projection;
  };
  const originalDispatch = structuredClone(state.dispatch);
  const result = await retrySafelyBlockedAgentFailure({ paths, backlog: [], env: {}, now: new Date(NOW),
    listMissions: async () => [(await readMissionRecord(state.missionId, store)).state], readProgrammeProjection,
    proveRetryOwnershipReleased: async () => ({ ok: true }),
    refreshRetryWorktree: async () => ({ ok: true, clean: true, afterHead: HEAD }) });
  assert.equal(result.retried, true, JSON.stringify(result));
  assert.deepEqual(requests, [[ISSUE], [ISSUE]]);
  assert.equal(observedProjections.length, 2);
  for (const projection of observedProjections) {
    assert.equal(projection.githubGoalEstateRead?.issues[0]?.admissionProofSource, 'OWNER_AUTHENTICATED_COMMENT');
    assert.equal(projection.goalMirrorEstate.records.find(item => item.issueNumber === ISSUE).resourceIds.length, 3);
  }
  const persisted = (await readMissionRecord(state.missionId, store)).state;
  assert.equal(persisted.repair.currentRound, 1);
  assert.deepEqual(persisted.requiredTests, tests);
  assert.equal(persisted.allowedFiles.includes(oracle.slice(prefix.length)), false);
  assert.deepEqual(persisted.repair.history[0].previousDispatch, originalDispatch);
  assert.equal(JSON.parse(await readFile(join(root, 'goals', 'goal-1557.json'), 'utf8')).resourceIds.length, 3);
});
