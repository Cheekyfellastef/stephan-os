import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, unlink, realpath, link, symlink } from 'node:fs/promises';
import { SELF_HOSTING_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import { createSharedWorkspaceGoalRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { createExecutionReceipt, toSharedWorkspaceExecutionReceipt } from '../../shared/agents/executionReceiptV1.mjs';
import { createSourceMutationLeaseRecord, createSourceMutationLeaseReleaseRecord } from '../../shared/agents/programmeAuthorityV1.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBattleBridgeGitExecution } from '../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { createMissionOrchestratorState } from '../../shared/agents/missionOrchestrator.mjs';
import {
  appendMissionEvent,
  createMissionRecord,
  listMissionRecords,
  readMissionRecord,
  resolveMissionOperationsSnapshotRoot,
  resolveMissionOrchestratorRoot,
  runWithMissionStatePrecondition,
  readSeedSourceCanonicalGoalCohortV1,
  assertSeedSourceContractAdmissionV1,
  reaffirmCurrentOrdinarySourcePlanV1,
  readUnadmittedSeedSourceGoalEvidenceV1,
  correctUnadmittedSeedSourceGoalV1,
  readSeedSourceGoalAdmissionEvidenceV1,
} from './missionOrchestratorStore.js';

const base = {
  missionId: 'store-test-mission',
  operatorIntent: 'Implement and promote a bounded source change.',
  intendedOutcome: 'The change is merged and safely deployed.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\repo',
  branch: 'openclaw/store-test-mission',
  worktreePath: 'C:\\worktrees\\store-test-mission',
  allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'],
  requiredTests: ['node --test focused.test.mjs'],
};

function proof(requirement, id) {
  return {
    receiptId: id,
    requirement,
    source: 'test-runner',
    evidenceType: 'command-output',
    verified: true,
    exitCode: 0,
  };
}

async function roots() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-orchestrator-store-'));
  return {
    root: join(parent, 'state'),
    snapshotRoot: join(parent, 'proof', 'mission-operations'),
  };
}

async function append(rootOptions, missionId, eventId, eventType, fields = {}) {
  return appendMissionEvent(missionId, { eventId, eventType, ...fields }, rootOptions);
}

async function ordinarySourceFixture(t) {
  const options = await roots(), workspace = join(options.root, '..', 'workspace');
  let repoRoot = join(options.root, '..', 'repo');
  await mkdir(join(workspace, 'goals'), { recursive: true });
  await mkdir(repoRoot);
  repoRoot = await realpath(repoRoot);
  const boundary = resolveBattleBridgeGitExecution();
  const git = args => {
    const result = spawnSync(boundary.executable, [...boundary.fixedConfigArgs, '-C', repoRoot, ...args], {
      encoding: 'utf8', env: boundary.environment, shell: false, windowsHide: true, timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  const missionId = 'critical-2314-elastic-goal';
  const requiredTests = ['node --test scripts/ordinary.test.mjs'];
  const allowedFiles = ['scripts/ordinary.mjs', 'scripts/ordinary.mjs/**'];
  const goal = { ...createSharedWorkspaceGoalRecord({ goalId: 'goal-2314', timestampUtc: new Date().toISOString(), status: 'READY' }),
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 2314 };
  await writeFile(join(workspace, 'goals', 'goal-2314.json'), JSON.stringify(goal));
  await createMissionRecord({ ...base, missionId, branch: 'openclaw/elastic-goal-2314',
    repositoryRoot: repoRoot, worktreePath: repoRoot, allowedFiles, requiredTests }, { ...options, sharedWorkspaceRoot: workspace, repoRoot });
  const issueUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2314';
  const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2314, resourceIds: ['repo:cheekyfellastef/stephan-os:path:scripts/ordinary.mjs'], requiredTests,
    state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], sourceImplementationAllowed: true,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false };
  const initialTimestamp = new Date(Date.now() - 120000).toISOString();
  const frame = { issueBody: 'Improve the existing bounded ordinary function.',
    updatedAt: initialTimestamp, comments: [], admission, requests: 0, hook: null };
  const fetchImpl = async url => {
    frame.requests++;
    if (frame.hook) await frame.hook(String(url));
    const comment = { id: 501, issue_url: issueUrl, user: { login: 'Cheekyfellastef' }, author_association: 'OWNER',
      created_at: initialTimestamp, updated_at: initialTimestamp,
      body: '```stephanos-goal-admission-v1\n' + JSON.stringify(frame.admission) + '\n```' };
    const payload = String(url) === issueUrl ? { number: 2314, url: issueUrl, title: 'Ordinary bounded function',
      state: 'open', body: frame.issueBody, labels: [{ name: 'goal' }], updated_at: frame.updatedAt,
      user: { login: 'Cheekyfellastef' }, author_association: 'OWNER', created_at: initialTimestamp }
      : String(url).startsWith(issueUrl + '/comments?') ? [comment, ...frame.comments]
        : String(url).startsWith(issueUrl + '/events?') ? [] : null;
    if (payload === null) throw new Error('UNEXPECTED_FIXED_ENDPOINT');
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  t.mock.method(globalThis, 'fetch', fetchImpl);
  return { ...options, sharedWorkspaceRoot: workspace, repoRoot, env: { ...process.env, GITHUB_TOKEN: 'test-only',
    STEPHANOS_SHARED_AGENT_WORKSPACE: workspace }, missionId, goal, frame, git,
    expectedSourcePlanKind: 'CURRENT_ORDINARY_SOURCE_PLAN' };
}

async function unadmittedSeedFixture(t) {
  const f = await ordinarySourceFixture(t), issueNumber = 2314;
  await unlink(join(f.root, f.missionId + '.state.json'));
  await unlink(join(f.root, f.missionId + '.events.ndjson'));
  const queue = join(f.root, 'worker-queue'); await mkdir(queue);
  f.env.STEPHANOS_MISSION_ORCHESTRATOR_DIR = f.root;
  f.env.STEPHANOS_MISSION_WORKER_QUEUE_DIR = queue;
  const work = { schemaVersion: 'stephanos.seed-growth-work.v1', seedId: 'goal-conveyor-fleet-care', ownerIssueRef: '#2972',
    contractSource: 'shared/runtime/goalConveyorFleetCareSeedV1.mjs',
    pressureKey: 'seed-2972:gap:core-loop-closure-pickup-to-execution', targetRung: 'FLEET_OBSERVED',
    nextBestAction: 'Repair actual fleet source admission diagnostic transfer without hiding the typed blocker.',
    evidenceRefs: ['events/retained-real-gap-reference.json'] };
  const goal = { ...f.goal, seedGrowthWork: work, requiredTests: ['npm run stephanos:verify'],
    resourceIds: ['repo:cheekyfellastef/stephan-os:path:' + work.contractSource] };
  await writeFile(join(f.sharedWorkspaceRoot, 'goals', goal.goalId + '.json'), JSON.stringify(goal));
  const target = await readUnadmittedSeedSourceGoalEvidenceV1(issueNumber, f);
  assert.equal(target.status, 'observed', target.reasonCode);
  const at = new Date(Date.now() - 30000).toISOString(), expires = new Date(Date.parse(at) + 300000).toISOString();
  const issueUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2314';
  const identity = { issue_url: issueUrl, user: { id: 267490109, login: 'Cheekyfellastef', type: 'User' },
    author_association: 'OWNER', performed_via_github_app: null, created_at: at, updated_at: at };
  const original = { ...identity, id: 900,
    body: `CURRENT derived outcome evidence for goal-${issueNumber}; ${work.pressureKey}.\n${work.nextBestAction}\nThis fixture is not live authority or a historical human comment.` };
  const paths = ['shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.mjs',
    'shared/agents/sovereignCommanderFleetGoalSupervisorReceiptV1.test.mjs'];
  const plan = { schemaVersion: 'stephanos.seed-source-contract-correction.v1', decision: 'CORRECT',
    repository: 'Cheekyfellastef/stephan-os', expiresAtUtc: expires,
    runtimePolicyHead: target.runtimePolicyHead, runtimePolicyTree: target.executionParentTree,
    binding: { childIssueNumber: issueNumber, missionId: f.missionId, seedId: work.seedId, pressureKey: work.pressureKey,
      targetRung: work.targetRung, originalIntentCommentId: original.id, originalIntentIssueNumber: issueNumber,
      originalIntentBodySha256: createHash('sha256').update(original.body).digest('hex'), contractPreimageSha256: target.goalContractFingerprint },
    sourceContract: { allowedFiles: paths.flatMap(path => [path, path + '/**']).sort((a,b) => a.localeCompare(b)),
      requiredTests: ['npm run stephanos:verify', 'node --test ' + paths[1], 'node --test scripts/retained.test.mjs'],
      requiredEvidence: ['Actual fleet source diagnostic transfer and preserved source hold'], usefulOutcome: work.nextBestAction,
      domainAcceptanceContract: 'FLEET_SOURCE_ADMISSION_DIAGNOSTIC_TRANSFER_V1', executionRelationship: 'SELF' } };
  const owner = { ...identity, id: 901, body: '' };
  const frame = { plan, owner, original, comments: [], requests: 0, hook: null, priorPr: [], branchPresent: false,
    issueBody: `${work.pressureKey}\n${work.nextBestAction}`, updatedAt: at };
  t.mock.method(globalThis, 'fetch', async url => {
    frame.requests++;
    if (frame.hook) await frame.hook(String(url));
    const selected = { ...frame.owner, body: '```stephanos-seed-source-contract-correction-v1\n' + JSON.stringify(frame.plan) + '\n```' };
    const s = String(url);
    if (s.endsWith('/issues/comments/901')) return new Response(JSON.stringify(selected));
    if (s.endsWith('/issues/comments/900')) return new Response(JSON.stringify(frame.original));
    if (s.startsWith(issueUrl + '/comments?')) return new Response(JSON.stringify([selected, ...frame.comments]));
    if (s === issueUrl) return new Response(JSON.stringify({ number: issueNumber, url: issueUrl, state: 'open',
      title: 'Original seed goal', body: frame.issueBody, updated_at: frame.updatedAt }));
    if (s.endsWith('/git/ref/heads/main')) return frame.mainUnreadable ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({ ref: 'refs/heads/main', object: { type: 'commit', sha: target.runtimePolicyHead } }));
    if (s.includes('/git/ref/heads/openclaw/elastic-goal-2314')) return new Response('{}', { status: frame.branchPresent ? 200 : 404 });
    if (s.includes('/pulls?state=all&')) return new Response(JSON.stringify(frame.priorPr));
    throw new Error('UNEXPECTED_FIXED_SEED_ENDPOINT:' + s);
  });
  return { ...f, issueNumber, goal, work, target, seedFrame: frame, correctionCommentId: 901 };
}

test('premission observation accepts canonical generated dist and runtime memory without cleaning them', async t => {
  const f = await unadmittedSeedFixture(t);
  const dist = join(f.repoRoot, 'apps/stephanos/dist/index.html');
  const memory = join(f.repoRoot, 'stephanos-server/data/memory/durable-memory.json');
  await mkdir(join(f.repoRoot, 'apps/stephanos/dist'), { recursive: true });
  await mkdir(join(f.repoRoot, 'stephanos-server/data/memory'), { recursive: true });
  await writeFile(dist, 'baseline generated\n'); await writeFile(memory, '{}\n');
  f.git(['add', '.']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'generated baseline']);
  await writeFile(dist, 'new generated runtime\n'); await writeFile(memory, '{"runtime":true}\n');
  await mkdir(join(f.repoRoot, 'logs')); await writeFile(join(f.repoRoot, 'logs', 'runtime.txt'), 'runtime observation\n');
  const before = f.git(['status', '--porcelain=v1']);
  const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(actual.status, 'observed', actual.reasonCode);
  assert.equal(actual.originalMissionAbsent, true);
  assert.equal(f.git(['status', '--porcelain=v1']), before);
  assert.equal(await readFile(dist, 'utf8'), 'new generated runtime\n');
  assert.equal(await readFile(memory, 'utf8'), '{"runtime":true}\n');
  assert.equal(f.seedFrame.requests, 0);
});

test('canonical runtime dirt cannot mask tracked/untracked authority source or staged source-to-runtime renames', async t => {
  for (const scenario of ['untracked-source', 'tracked-source', 'authority-policy', 'other-memory', 'source-to-runtime-rename']) {
    await t.test(scenario, async child => {
      const f = await unadmittedSeedFixture(child);
      await mkdir(join(f.repoRoot, 'apps/stephanos/dist'), { recursive: true });
      await writeFile(join(f.repoRoot, 'apps/stephanos/dist/index.html'), 'generated runtime\n');
      if (scenario === 'authority-policy') await writeFile(join(f.repoRoot, '.gitattributes'), '* text eol=lf\n');
      else if (scenario === 'other-memory') {
        await mkdir(join(f.repoRoot, 'stephanos-server/data/memory'), { recursive: true });
        await writeFile(join(f.repoRoot, 'stephanos-server/data/memory/source-contract.json'), '{}\n');
      } else {
        await writeFile(join(f.repoRoot, 'actual-source.mjs'), 'export const value = 1;\n');
        if (scenario !== 'untracked-source') {
          f.git(['add', 'actual-source.mjs']);
          f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'source baseline']);
          if (scenario === 'tracked-source') await writeFile(join(f.repoRoot, 'actual-source.mjs'), 'export const value = 2;\n');
          else f.git(['mv', 'actual-source.mjs', 'apps/stephanos/dist/source-was-renamed.mjs']);
        }
      }
      const before = f.git(['status', '--porcelain=v1']);
      const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
      assert.equal(actual.status, 'held'); assert.equal(actual.reasonCode, 'SEED_GOAL_CANONICAL_SOURCE_NOT_CLEAN');
      assert.equal(f.git(['status', '--porcelain=v1']), before);
      assert.equal(f.seedFrame.requests, 0);
    });
  }
});

test('first-intake absence includes every queue phase and nested terminal, capacity and quarantine history', async t => {
  for (const phase of ['pending', 'processing', 'completed', 'failed', 'capacity-admissions/old-action/envelopes']) {
    await t.test(phase, async child => {
      const f = await unadmittedSeedFixture(child), directory = join(f.root, 'worker-queue/foundry-forge', phase);
      await mkdir(directory, { recursive: true });
      const file = join(directory, 'unrelated-filename.json');
      await writeFile(file, JSON.stringify({ schemaVersion: 'stephanos.mission-worker-queue-item.v1',
        missionId: f.missionId, actionId: f.missionId + '-old-source', adapter: 'foundry-forge',
        payload: { missionId: f.missionId }, result: { finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE' } }));
      const before = await readFile(file);
      const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
      assert.equal(actual.status, 'held'); assert.equal(actual.reasonCode, 'SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
      assert.deepEqual(await readFile(file), before); assert.equal(f.seedFrame.requests, 0);
    });
  }
});

test('orphaned original publication, escrow, receipt and mission journals prevent first-mission recreation', async t => {
  const cases = [
    ['source-artifacts/orphan.escrow.json', { schemaVersion: 'stephanos.source-artifact-escrow.v1', missionId: 'TARGET' }],
    ['publication-outbox/published/orphan.json', { schemaVersion: 'stephanos.offline-publication-outbox.v1',
      repository: 'Cheekyfellastef/stephan-os', canonicalIssue: 2314 }],
    ['receipts/execution-receipts.jsonl', { schemaVersion: 'stephanos.execution-receipt.v1',
      executionId: 'other-action', leaseKey: 'critical-2314-elastic-goal-r0-lease' }],
    ['archive/orphan.json', { schemaVersion: 'shared-agent-workspace-record.v1', relatedIssue: '2314' }],
    ['outbox/orphan.json', { schemaVersion: 'shared-agent-workspace-record.v1', body: { branch: 'openclaw/elastic-goal-2314' } }],
  ];
  for (const [relativePath, record] of cases) {
    await t.test(relativePath, async child => {
      const f = await unadmittedSeedFixture(child), path = join(f.sharedWorkspaceRoot, relativePath);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, JSON.stringify(record.missionId === 'TARGET' ? { ...record, missionId: f.missionId } : record) + '\n');
      const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
      assert.equal(actual.status, 'held'); assert.equal(actual.reasonCode, 'SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
      assert.equal(f.seedFrame.requests, 0);
    });
  }
  const f = await unadmittedSeedFixture(t);
  await writeFile(join(f.root, 'orphan.events.ndjson'), JSON.stringify({ eventType: 'MISSION_CREATED', missionId: f.missionId }) + '\n');
  assert.equal((await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f)).reasonCode, 'SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
});

test('well-formed unrelated retained histories and advisory summaries do not block the original seed', async t => {
  const f = await unadmittedSeedFixture(t), directory = join(f.root, 'worker-queue/foundry-forge/completed');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'foreign-action.json'), JSON.stringify({ schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    missionId: 'critical-8999-elastic-goal', actionId: 'foreign-action', adapter: 'foundry-forge',
    payload: { missionId: 'critical-8999-elastic-goal' }, summary: 'advisory text mentions goal-2314, without claiming ownership' }));
  await writeFile(join(f.root, 'foreign.events.ndjson'), JSON.stringify({ eventType: 'MISSION_CREATED', missionId: 'critical-8999-elastic-goal' }) + '\n');
  const receipt = createExecutionReceipt({ repository: 'Cheekyfellastef/stephan-os', issueNumber: 8999, prNumber: 0,
    branch: 'openclaw/elastic-goal-8999', sourceHead: 'a'.repeat(40), workerId: 'fixture-worker', workerType: 'openclaw',
    executionId: 'foreign-execution', leaseKey: 'foreign-lease', state: 'queued', phase: 'fixture-queued', sequence: 1,
    timestampUtc: new Date().toISOString(), proofRefs: ['proof/foreign-fixture.json'], expectedNextAction: 'Fixture only.' });
  const converted = toSharedWorkspaceExecutionReceipt(receipt); assert.equal(converted.ok, true, converted.reason);
  await mkdir(join(f.sharedWorkspaceRoot, 'receipts'));
  await writeFile(join(f.sharedWorkspaceRoot, 'receipts/execution-receipts.jsonl'), JSON.stringify(converted.record) + '\n');
  const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(actual.status, 'observed', actual.reasonCode); assert.equal(f.seedFrame.requests, 0);
});

test('unknown, malformed, truncated, linked and unbounded authority history never proves absence', async t => {
  for (const scenario of ['unknown-schema', 'malformed-quarantine', 'truncated-journal', 'oversized', 'hardlink', 'junction', 'deep']) {
    await t.test(scenario, async child => {
      const f = await unadmittedSeedFixture(child), directory = join(f.root, 'worker-queue/foundry-forge/failed');
      await mkdir(directory, { recursive: true });
      const path = join(directory, 'orphan.json');
      const foreign = JSON.stringify({ schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
        missionId: 'critical-8999-elastic-goal', actionId: 'foreign-action' });
      if (scenario === 'unknown-schema') await writeFile(path, '{"schemaVersion":"unrecognized.authority.v1"}');
      if (scenario === 'malformed-quarantine') await writeFile(join(directory, 'orphan.invalid.bin'), '{not readable JSON');
      if (scenario === 'truncated-journal') await writeFile(join(directory, 'orphan.jsonl'), foreign);
      if (scenario === 'oversized') await writeFile(path, ' '.repeat(2 * 1024 * 1024 + 1));
      if (scenario === 'hardlink') { await writeFile(path, foreign); await link(path, join(directory, 'alias.json')); }
      if (scenario === 'junction') {
        const target = join(f.root, '..', 'linked-history'); await mkdir(target); await writeFile(join(target, 'foreign.json'), foreign);
        await symlink(target, join(directory, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir');
      }
      if (scenario === 'deep') await mkdir(join(directory, ...Array(9).fill('history')), { recursive: true });
      const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
      assert.equal(actual.status, 'held'); assert.match(actual.reasonCode,
        /^SEED_GOAL_PRIOR_HISTORY_(?:SCHEMA_UNKNOWN|MALFORMED|UNBOUNDED|UNSAFE)$/);
      assert.equal(f.seedFrame.requests, 0);
    });
  }
});

test('configured queue override cannot hide the original store terminal history', async t => {
  const f = await unadmittedSeedFixture(t), configured = join(f.root, '..', 'replacement-queue');
  await mkdir(configured); f.env.STEPHANOS_MISSION_WORKER_QUEUE_DIR = configured;
  const path = join(f.root, 'worker-queue/foundry-forge/completed'); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'orphan.result.json'), JSON.stringify({ schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    missionId: f.missionId, actionId: 'old-physical-execution' }));
  const actual = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(actual.status, 'held'); assert.equal(actual.reasonCode, 'SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
});

test('empty original attempt directories retain ownership and unknown source release records cannot prove absence', async t => {
  const f = await unadmittedSeedFixture(t);
  const directory = join(f.root, 'worker-queue/foundry-forge/capacity-admissions', f.missionId + '-old-source');
  await mkdir(directory, { recursive: true });
  const retained = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(retained.reasonCode, 'SEED_GOAL_PRIOR_MISSION_HISTORY_PRESENT');
  const other = await unadmittedSeedFixture(t), status = join(other.sharedWorkspaceRoot, 'status');
  await mkdir(status, { recursive: true });
  await writeFile(join(status, 'source-lease-release-unknown.json'), '{"summary":"decoration cannot replace source release identity"}');
  const unknown = await readUnadmittedSeedSourceGoalEvidenceV1(other.issueNumber, other);
  assert.equal(unknown.status, 'held'); assert.equal(unknown.reasonCode, 'SEED_GOAL_PRIOR_HISTORY_IDENTITY_UNPROVEN');
});

test('retained source lease release history remains ownership while unrelated status decoration degrades safely', async t => {
  const f = await unadmittedSeedFixture(t), status = join(f.sharedWorkspaceRoot, 'status');
  await mkdir(status, { recursive: true });
  // Unrelated presentation damage is not a source-history failure.
  await writeFile(join(status, 'advisory-dashboard.json'), '{not valid advisory JSON');
  const releaseFor = issueNumber => createSourceMutationLeaseReleaseRecord(createSourceMutationLeaseRecord({
    laneId: `critical-${issueNumber}-elastic-goal`, repository: 'Cheekyfellastef/stephan-os', issueNumber, prNumber: 0,
    branch: `openclaw/elastic-goal-${issueNumber}`, headSha: 'a'.repeat(40), ownerId: 'fixture-owner',
    acquiredAtUtc: new Date().toISOString(), proofRefs: ['proof/fixture-release.json'] }), { timestampUtc: new Date().toISOString() });
  const foreign = releaseFor(8999);
  await writeFile(join(status, foreign.statusId + '.json'), JSON.stringify(foreign));
  const positive = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(positive.status, 'observed', positive.reasonCode);
  const original = releaseFor(f.issueNumber);
  await writeFile(join(status, original.statusId + '.json'), JSON.stringify(original));
  const negative = await readUnadmittedSeedSourceGoalEvidenceV1(f.issueNumber, f);
  assert.equal(negative.status, 'held'); assert.equal(negative.reasonCode, 'SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT');
  assert.equal(f.seedFrame.requests, 0);
});

test('terminal history appearing during owner observation prevents correction and preserves original goal bytes', async t => {
  const f = await unadmittedSeedFixture(t), goalPath = join(f.sharedWorkspaceRoot, 'goals', f.goal.goalId + '.json');
  const before = await readFile(goalPath);
  f.seedFrame.hook = async () => {
    if (f.seedFrame.requests !== 1) return;
    const directory = join(f.sharedWorkspaceRoot, 'publication-outbox/completed'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'orphan.json'), JSON.stringify({ schemaVersion: 'stephanos.offline-publication-outbox.v1', missionId: f.missionId }));
  };
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_PRIOR_EXECUTION_HISTORY_PRESENT/);
  assert.deepEqual(await readFile(goalPath), before);
});

test('store entrypoints reject raw elastic identity aliases before normalization or creation', async t => {
  for (const [missionId, branch] of [
    ['CRITICAL-2314-ELASTIC-GOAL', 'openclaw/elastic-goal-2314'],
    [' critical-2314-elastic-goal ', 'openclaw/elastic-goal-2314'],
    ['critical-2314-elastic-goal-old', 'openclaw/elastic-goal-2314'],
    ['critical-02314-elastic-goal', 'openclaw/elastic-goal-2314'],
    ['critical-2314-elastic-goal', 'OpenClaw/elastic-goal-2314'],
    ['critical-2314-elastic-goal', 'openclaw/elastic-goal-8999'],
    ['unrelated-mission', 'openclaw/elastic-goal-2314'],
  ]) {
    const options = await roots();
    await assert.rejects(createMissionRecord({ ...base, missionId, branch }, options), /NONCANONICAL_ELASTIC_MISSION_IDENTITY/);
    await assert.rejects(readFile(join(options.root, 'critical-2314-elastic-goal.state.json')), { code: 'ENOENT' });
  }
  const f = await ordinarySourceFixture(t);
  await assert.rejects(readMissionRecord(f.missionId.toUpperCase(), f), /NONCANONICAL_ELASTIC_MISSION_IDENTITY/);
  await assert.rejects(assertSeedSourceContractAdmissionV1(' ' + f.missionId, f), /NONCANONICAL_ELASTIC_MISSION_IDENTITY/);
  const path = join(f.root, f.missionId + '.state.json'), state = JSON.parse(await readFile(path, 'utf8'));
  state.git.branch = 'OpenClaw/elastic-goal-2314'; await writeFile(path, JSON.stringify(state));
  assert.equal((await readMissionRecord(f.missionId, f)).state.git.branch, state.git.branch);
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), error => error.reasonCode === 'NONCANONICAL_ELASTIC_MISSION_IDENTITY');
});

test('actual private premission correction preserves original goal and binds first original mission and real source assertion', async t => {
  const f = await unadmittedSeedFixture(t);
  const result = await correctUnadmittedSeedSourceGoalV1(f.issueNumber, { ...f,
    expectedGoalContractFingerprint: f.target.goalContractFingerprint });
  assert.equal(result.corrected, true);
  assert.equal(result.goal.goalId, f.goal.goalId);
  assert.equal(result.goal.participantId, f.goal.participantId);
  assert.deepEqual(result.goal.seedGrowthWork, f.work);
  assert.equal(result.goal.status, f.goal.status);
  assert.equal(result.goal.sourceContractRevision, 1);
  assert.equal(result.goal.pendingSeedSourceCorrectionAudit, undefined);
  const evidence = await readSeedSourceGoalAdmissionEvidenceV1(f.issueNumber, f);
  assert.equal(evidence.status, 'observed', evidence.reasonCode);
  assert.equal(evidence.sourcePlanKind, 'SEED_SELF');
  assert.equal(evidence.dispatchAllowed, false);
  assert.equal((await correctUnadmittedSeedSourceGoalV1(f.issueNumber, f)).duplicate, true);
  const input = { ...base, missionId: f.missionId, repositoryRoot: f.repoRoot, worktreePath: f.repoRoot,
    branch: evidence.descriptor.branch, operatorIntent: f.work.nextBestAction + ' ' + f.work.pressureKey,
    allowedFiles: evidence.descriptor.allowedFiles, requiredTests: evidence.descriptor.requiredTests,
    requiredEvidence: result.goal.requiredEvidence, seedGrowthWork: f.work, seedSourceWorkDescriptor: evidence.descriptor };
  await assert.rejects(createMissionRecord({ ...input, seedSourceWorkDescriptor: { ...evidence.descriptor,
    authorityPlanFingerprint: '0'.repeat(64) } }, f), /SEED_SOURCE_GOAL_INTAKE_PLAN_CHANGED/);
  const created = await createMissionRecord(input, f);
  assert.deepEqual(created.state.seedSourceWorkDescriptor, evidence.descriptor);
  assert.equal(created.state.storeMetadata.pendingSeedMissionGenesisAudit, undefined);
  const admitted = await assertSeedSourceContractAdmissionV1(f.missionId, { ...f, expectedSourcePlanKind: 'SEED_SELF',
    expectedSourcePlanFingerprint: evidence.authorityPlanFingerprint, expectedMissionRevision: created.state.revision });
  assert.equal(admitted.classification, 'CORRECTED_ORIGINAL_SEED_SOURCE_PLAN_PROVEN');
  assert.equal(admitted.sourcePlanKind, 'SEED_SELF');
});

test('unadmitted correction rejects real pressure/preimage/source/prior-work and owner mismatches without goal mutation', async t => {
  const f = await unadmittedSeedFixture(t), goalPath = join(f.sharedWorkspaceRoot, 'goals', f.goal.goalId + '.json');
  const before = await readFile(goalPath, 'utf8');
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, { ...f, expectedGoalContractFingerprint: '0'.repeat(64) }),
    /SEED_GOAL_CONTRACT_PRECONDITION_FAILED/);
  f.seedFrame.mainUnreadable = true;
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_REMOTE_READ_FAILED/);
  f.seedFrame.mainUnreadable = false;
  f.seedFrame.priorPr = [{ number: 42 }];
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_PRIOR_PR_PRESENT/);
  f.seedFrame.priorPr = []; f.seedFrame.plan.runtimePolicyHead = '0'.repeat(40);
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_CORRECTION_POLICY_SOURCE_MISMATCH/);
  f.seedFrame.plan.runtimePolicyHead = f.target.runtimePolicyHead;
  await writeFile(join(f.sharedWorkspaceRoot, 'goals', 'goal-2315.json'), JSON.stringify({ ...f.goal,
    goalId: 'goal-2315', issueNumber: 2315 }));
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_IDENTITY_CONFLICT/);
  await unlink(join(f.sharedWorkspaceRoot, 'goals', 'goal-2315.json'));
  await writeFile(join(f.root, f.missionId + '.events.ndjson'), '{}\n');
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_PRIOR_MISSION_HISTORY_PRESENT/);
  assert.equal(await readFile(goalPath, 'utf8'), before);
});

test('canonical mission absence race and stripped original seed metadata cannot become correction authority', async t => {
  const f = await unadmittedSeedFixture(t), goalPath = join(f.sharedWorkspaceRoot, 'goals', f.goal.goalId + '.json');
  const before = await readFile(goalPath, 'utf8');
  f.seedFrame.hook = async () => {
    if (f.seedFrame.requests === 8) await writeFile(join(f.root, f.missionId + '.state.json'), '{}');
  };
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_PRIOR_MISSION_HISTORY_PRESENT|SEED_GOAL_CORRECTION_AUTHORITY_CHANGED/);
  assert.equal(await readFile(goalPath, 'utf8'), before);
  await unlink(join(f.root, f.missionId + '.state.json'));
  f.seedFrame.hook = null;
  const stripped = { ...f.goal }; delete stripped.seedGrowthWork;
  await writeFile(goalPath, JSON.stringify(stripped));
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_ORIGINAL_PROVENANCE_REQUIRED/);
});

test('expired applied decision remains held without protected consumption proof', async t => {
  const f = await unadmittedSeedFixture(t);
  await correctUnadmittedSeedSourceGoalV1(f.issueNumber, f);
  const future = Date.now() + 20 * 60000;
  t.mock.method(Date, 'now', () => future);
  const expired = await readSeedSourceGoalAdmissionEvidenceV1(f.issueNumber, f);
  assert.equal(expired.status, 'held');
  assert.equal(expired.reasonCode, 'SEED_CORRECTION_PROTECTED_CONSUMPTION_PROOF_REQUIRED');
});

test('exact pending goal correction audit replays once and actual current revocation holds the retained descriptor', async t => {
  const f = await unadmittedSeedFixture(t), applied = await correctUnadmittedSeedSourceGoalV1(f.issueNumber, f);
  const goalPath = join(f.sharedWorkspaceRoot, 'goals', f.goal.goalId + '.json');
  const auditPath = join(f.sharedWorkspaceRoot, 'events', applied.goal.sourceContractCorrection.auditEventId + '.json');
  const event = JSON.parse(await readFile(auditPath, 'utf8')), pending = structuredClone(applied.goal);
  pending.pendingSeedSourceCorrectionAudit = { schemaVersion: 'stephanos.pending-seed-goal-source-audit.v1',
    eventSha256: createHash('sha256').update(JSON.stringify(event)).digest('hex'), event };
  await writeFile(goalPath, JSON.stringify(pending)); await unlink(auditPath);
  assert.equal((await readSeedSourceGoalAdmissionEvidenceV1(f.issueNumber, f)).reasonCode, 'SEED_GOAL_AUDIT_RECOVERY_REQUIRED');
  const replay = await correctUnadmittedSeedSourceGoalV1(f.issueNumber, f);
  assert.equal(replay.duplicate, true); assert.equal(replay.goal.sourceContractRevision, 1);
  assert.equal(replay.goal.pendingSeedSourceCorrectionAudit, undefined);
  assert.deepEqual(JSON.parse(await readFile(auditPath, 'utf8')), event);
  const revoke = { schemaVersion: f.seedFrame.plan.schemaVersion, decision: 'REVOKE', repository: f.seedFrame.plan.repository,
    binding: f.seedFrame.plan.binding, expiresAtUtc: f.seedFrame.plan.expiresAtUtc, correctionCommentId: 901 };
  f.seedFrame.comments.push({ ...f.seedFrame.owner, id: 902,
    body: '```stephanos-seed-source-contract-correction-v1\n' + JSON.stringify(revoke) + '\n```' });
  assert.equal((await readSeedSourceGoalAdmissionEvidenceV1(f.issueNumber, f)).reasonCode, 'SEED_CORRECTION_REVOKED');
  pending.pendingSeedSourceCorrectionAudit.eventSha256 = '0'.repeat(64);
  await writeFile(goalPath, JSON.stringify(pending));
  await assert.rejects(correctUnadmittedSeedSourceGoalV1(f.issueNumber, f), /SEED_GOAL_PENDING_AUDIT_INVALID/);
});

test('seed mission pending genesis audit recovers exact bytes before source proof without inventing another intake', async t => {
  const f = await unadmittedSeedFixture(t), applied = await correctUnadmittedSeedSourceGoalV1(f.issueNumber, f);
  const descriptor = applied.goal.seedSourceWorkDescriptor;
  const created = await createMissionRecord({ ...base, missionId: f.missionId, repositoryRoot: f.repoRoot,
    worktreePath: f.repoRoot, branch: descriptor.branch, operatorIntent: f.work.nextBestAction + ' ' + f.work.pressureKey,
    allowedFiles: descriptor.allowedFiles, requiredTests: descriptor.requiredTests, requiredEvidence: applied.goal.requiredEvidence,
    seedGrowthWork: f.work, seedSourceWorkDescriptor: descriptor }, f);
  const state = structuredClone(created.state), audit = await readFile(created.eventPath, 'utf8'), event = JSON.parse(audit.trim());
  state.storeMetadata.pendingSeedMissionGenesisAudit = { schemaVersion: 'stephanos.pending-seed-mission-genesis-audit.v1',
    eventSha256: createHash('sha256').update(JSON.stringify(event)).digest('hex'), event };
  await writeFile(created.statePath, JSON.stringify(state)); await writeFile(created.eventPath, audit.slice(0, 19));
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, { ...f, expectedSourcePlanKind: 'SEED_SELF' }),
    /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  await runWithMissionStatePrecondition(f.missionId, { expectedRevision: 0 }, async current => current.revision, f);
  assert.equal(await readFile(created.eventPath, 'utf8'), audit);
  const recovered = (await readMissionRecord(f.missionId, f)).state;
  assert.equal(recovered.revision, 0); assert.equal(recovered.repair.currentRound, 0);
  assert.equal(recovered.storeMetadata.pendingSeedMissionGenesisAudit, undefined);
  const proof = await assertSeedSourceContractAdmissionV1(f.missionId, { ...f, expectedSourcePlanKind: 'SEED_SELF',
    expectedSourcePlanFingerprint: descriptor.authorityPlanFingerprint, expectedMissionRevision: 0 });
  assert.equal(proof.sourcePlanKind, 'SEED_SELF');
});

test('ordinary repository identity is case insensitive while actual source-plan kind and foreign repository remain hard', async t => {
  const f = await ordinarySourceFixture(t), statePath = join(f.root, f.missionId + '.state.json');
  const original = (await readMissionRecord(f.missionId, f)).state;
  original.repository = 'cheekyfellastef/stephan-os';
  await writeFile(statePath, JSON.stringify(original));
  const admitted = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  assert.equal((await assertSeedSourceContractAdmissionV1(f.missionId, f)).sourcePlanKind, 'CURRENT_ORDINARY_SOURCE_PLAN');
  for (const expectedSourcePlanKind of [undefined, null, 'SEED_SELF', 'UNKNOWN']) {
    await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, { ...f, expectedSourcePlanKind }),
      error => error.reasonCode === 'SOURCE_PLAN_KIND_REQUIRED_OR_MISMATCHED');
  }
  const foreign = structuredClone(admitted.state); foreign.repository = 'foreign/stephan-os';
  await writeFile(statePath, JSON.stringify(foreign));
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
});

test('private current ordinary writer proves actual owner/cohort/Git, preserves state and replays without another revision', async t => {
  const f = await ordinarySourceFixture(t), before = (await readMissionRecord(f.missionId, f)).state;
  const first = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, { ...f, expectedMissionRevision: before.revision,
    classification: 'VERIFIED_NON_SEED', sourceAuthority: true, fetchImpl: () => { throw Error('caller callback'); } });
  assert.equal(first.reaffirmed, true);
  const plan = first.state.currentOrdinarySourcePlan;
  assert.equal(plan.schemaVersion, 'stephanos.current-ordinary-source-plan.v1');
  assert.equal(plan.purpose, 'REAFFIRM_EXISTING_ORDINARY_SOURCE_PLAN');
  assert.equal(plan.runtimePolicyHead, f.git(['rev-parse', 'HEAD']));
  assert.match(plan.authorityPlanFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.state.revision, before.revision + 1);
  for (const key of ['currentPhase', 'allowedFiles', 'requiredTests', 'requiredEvidence', 'git', 'pullRequest',
    'dispatch', 'repair', 'continuity', 'blockers', 'activeWriter', 'approval']) assert.deepEqual(first.state[key], before[key], key);
  const proven = await assertSeedSourceContractAdmissionV1(f.missionId, { ...f,
    expectedMissionRevision: first.state.revision, expectedSourcePlanFingerprint: plan.authorityPlanFingerprint,
    runtimePolicyHead: plan.runtimePolicyHead });
  assert.equal(proven.classification, 'CURRENT_ORDINARY_SOURCE_PLAN_PROVEN');
  f.frame.updatedAt = new Date(Date.now() - 60000).toISOString();
  f.frame.comments.push({ id: 502, issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/2314',
    user: { login: 'Cheekyfellastef' }, author_association: 'OWNER', body: 'Advisory progress.',
    created_at: f.frame.updatedAt, updated_at: f.frame.updatedAt });
  const repeated = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.state.revision, first.state.revision);
  assert.equal(repeated.state.currentOrdinarySourcePlan.authorityPlanFingerprint, plan.authorityPlanFingerprint);
  assert.notEqual(repeated.observations.ownerFrameFingerprint, plan.observations.ownerFrameFingerprint);
});

test('ordinary current authority cannot survive scope/test changes, seed clues, fingerprint substitution or policy movement', async t => {
  const f = await ordinarySourceFixture(t);
  const first = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  const plan = first.state.currentOrdinarySourcePlan;
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, { ...f,
    expectedSourcePlanFingerprint: '0'.repeat(64) }), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, { ...f,
    expectedMissionRevision: first.state.revision - 1 }), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  f.frame.admission.requiredTests = ['node --test scripts/changed.test.mjs'];
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  f.frame.admission.requiredTests = first.state.requiredTests;
  f.frame.issueBody = 'Seed owner #2655; seed-2655:rung:observing';
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  f.frame.issueBody = 'Improve the existing bounded ordinary function.';
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'policy moved']);
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, { ...f, runtimePolicyHead: plan.runtimePolicyHead }),
    /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
});

test('ordinary writer refuses incomplete actual cohort, retained seed genesis, running custody and authority changes during awaits', async t => {
  const f = await ordinarySourceFixture(t), statePath = join(f.root, f.missionId + '.state.json');
  const original = await readFile(statePath, 'utf8');
  await writeFile(join(f.sharedWorkspaceRoot, 'goals', 'goal-broken.json'), '{broken');
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  await unlink(join(f.sharedWorkspaceRoot, 'goals', 'goal-broken.json'));
  const state = JSON.parse(original); state.seedGrowthWork = null;
  await writeFile(statePath, JSON.stringify(state));
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  delete state.seedGrowthWork; state.dispatch.status = 'running';
  await writeFile(statePath, JSON.stringify(state));
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /CURRENT_SOURCE_PLAN_ORIGINAL_CUSTODY_HELD/);
  await writeFile(statePath, original);
  f.frame.hook = async () => {
    if (f.frame.requests === 5) f.frame.admission.resourceIds = ['repo:cheekyfellastef/stephan-os:path:scripts/other.mjs'];
  };
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED|CURRENT_SOURCE_PLAN_AUTHORITY_CHANGED/);
  assert.equal(await readFile(statePath, 'utf8'), original);
});

test('exact pending ordinary audit recovers a torn append once; corrupted authority journal holds source effects', async t => {
  const f = await ordinarySourceFixture(t);
  const first = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  const statePath = join(f.root, f.missionId + '.state.json'), auditPath = join(f.root, f.missionId + '.events.ndjson');
  const audit = await readFile(auditPath, 'utf8'), lines = audit.trimEnd().split('\n'), serial = lines.at(-1);
  const event = JSON.parse(serial), pendingState = structuredClone(first.state);
  pendingState.storeMetadata.pendingSourcePlanAuditEvent = { schemaVersion: 'stephanos.pending-source-plan-audit.v1',
    eventId: event.eventId, eventSha256: createHash('sha256').update(serial).digest('hex'), event };
  await writeFile(statePath, JSON.stringify(pendingState));
  await writeFile(auditPath, lines.slice(0, -1).join('\n') + '\n' + serial.slice(0, 17));
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  const recovered = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  assert.equal(recovered.state.revision, first.state.revision);
  assert.equal(recovered.state.storeMetadata.pendingSourcePlanAuditEvent, undefined);
  assert.equal((await readFile(auditPath, 'utf8')).split('\n').filter(line => line === serial).length, 1);
  pendingState.storeMetadata.pendingSourcePlanAuditEvent.eventSha256 = '0'.repeat(64);
  await writeFile(statePath, JSON.stringify(pendingState));
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_PLAN_AUDIT_JOURNAL_INVALID/);
});

test('a copied ordinary descriptor cannot replace its actual canonical private-commit event', async t => {
  const f = await ordinarySourceFixture(t), first = await reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f);
  const statePath = join(f.root, f.missionId + '.state.json'), moved = structuredClone(first.state);
  moved.currentOrdinarySourcePlan.reaffirmationEventId = 'forged-ordinary-plan-event';
  moved.storeMetadata.processedEventIds.push('forged-ordinary-plan-event');
  await writeFile(statePath, JSON.stringify(moved));
  await assert.rejects(assertSeedSourceContractAdmissionV1(f.missionId, f), error =>
    error.message === 'SOURCE_SCOPE_RECONCILIATION_REQUIRED' && error.reasonCode === 'CURRENT_SOURCE_PLAN_COMMIT_PROOF_REQUIRED');
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /CURRENT_SOURCE_PLAN_COMMIT_PROOF_REQUIRED/);
  assert.equal((await readMissionRecord(f.missionId, f)).state.revision, first.state.revision);
});

test('actual canonical goal source reads reject hard links and oversized files before owner-network observation', async t => {
  const f = await ordinarySourceFixture(t), goalPath = join(f.sharedWorkspaceRoot, 'goals', 'goal-2314.json');
  const alias = join(f.sharedWorkspaceRoot, 'held-goal.json');
  await link(goalPath, alias);
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  assert.equal(f.frame.requests, 0);
  await unlink(alias);
  await writeFile(goalPath, JSON.stringify({ ...f.goal, description: 'x'.repeat(128 * 1024) }));
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  assert.equal(f.frame.requests, 0);
});

test('ordinary writer detects non-contract state movement under the retained mission revision', async t => {
  const f = await ordinarySourceFixture(t), statePath = join(f.root, f.missionId + '.state.json');
  f.frame.hook = async () => {
    if (f.frame.requests === 5) {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      state.repair.currentRound = 2;
      await writeFile(statePath, JSON.stringify(state));
    }
  };
  await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /CURRENT_SOURCE_PLAN_AUTHORITY_CHANGED/);
  const held = (await readMissionRecord(f.missionId, f)).state;
  assert.equal(held.currentOrdinarySourcePlan, undefined);
  assert.equal(held.repair.currentRound, 2, 'refusal cannot overwrite the moved original state');
});

test('ordinary lifecycle maintenance cannot rewrite a terminal or cancelled original mission', async t => {
  const f = await ordinarySourceFixture(t), statePath = join(f.root, f.missionId + '.state.json');
  const original = (await readMissionRecord(f.missionId, f)).state;
  for (const fields of [{ currentPhase: 'COMPLETE' }, { currentPhase: 'CANCELLED' }, { cancelled: true }]) {
    const state = { ...original, ...fields }, bytes = JSON.stringify(state);
    await writeFile(statePath, bytes);
    await assert.rejects(reaffirmCurrentOrdinarySourcePlanV1(f.missionId, f), /CURRENT_SOURCE_PLAN_TERMINAL_MISSION_HELD/);
    assert.equal(await readFile(statePath, 'utf8'), bytes);
  }
  assert.equal(f.frame.requests, 0);
});

test('actual source-controlled non-seed contract is positive classification, not a supplied flag', async () => {
  const options = await roots();
  const contract = SELF_HOSTING_CRITICAL_BACKLOG[0].mission;
  const created = await createMissionRecord({ ...contract }, options);
  const observed = await assertSeedSourceContractAdmissionV1(created.state.missionId, options);
  assert.equal(observed.classification, 'VERIFIED_NON_SEED');
  assert.equal(observed.reason, 'SOURCE_CONTROLLED_NON_SEED_CONTRACT_MATCHED');
  await createMissionRecord({ ...base }, options);
  const unknown = await readSeedSourceCanonicalGoalCohortV1(base.missionId, {
    ...options, sharedWorkspaceRoot: join(options.root, '..', 'missing-workspace'),
    classification: 'VERIFIED_NON_SEED', trusted: true,
  });
  assert.equal(unknown.classification, 'UNKNOWN');
  await assert.rejects(assertSeedSourceContractAdmissionV1(base.missionId, {
    ...options, sharedWorkspaceRoot: join(options.root, '..', 'missing-workspace'),
    classification: 'VERIFIED_NON_SEED', trusted: true,
  }), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
});

test('actual canonical seed cohort detects unique and duplicate pressures and refuses corrupt reads', async () => {
  const options = await roots();
  const workspace = join(options.root, '..', 'workspace');
  await mkdir(join(workspace, 'goals'), { recursive: true });
  const missionId = 'critical-3031-elastic-goal';
  await mkdir(options.root, { recursive: true });
  await writeFile(join(options.root, missionId + '.state.json'), JSON.stringify(createMissionOrchestratorState({ ...base,
    missionId, branch: 'openclaw/elastic-goal-3031' })));
  const seedGrowthWork = { schemaVersion: 'stephanos.seed-growth-work.v1',
    seedId: 'goal-conveyor-fleet-care', ownerIssueRef: '#2972',
    contractSource: 'shared/runtime/goalConveyorFleetCareSeedV1.mjs',
    pressureKey: 'seed-2972:gap:core-loop-closure-pickup-to-execution',
    targetRung: 'FLEET_OBSERVED', nextBestAction: 'Repair the actual original conveyor fault.',
    evidenceRefs: ['events/actual-gap.json'] };
  const record = issueNumber => ({ ...createSharedWorkspaceGoalRecord({ goalId: `goal-${issueNumber}`,
    timestampUtc: new Date().toISOString(), status: 'READY' }),
    repository: 'Cheekyfellastef/stephan-os', issueNumber, seedGrowthWork });
  await writeFile(join(workspace, 'goals', 'goal-3031.json'), JSON.stringify(record(3031)));
  const currentOptions = { ...options, sharedWorkspaceRoot: workspace };
  const seed = await readSeedSourceCanonicalGoalCohortV1(missionId, currentOptions);
  assert.equal(seed.classification, 'SEED');
  assert.deepEqual(seed.pressureOwners, [3031]);
  await assert.rejects(assertSeedSourceContractAdmissionV1(missionId, currentOptions), /SOURCE_SCOPE_RECONCILIATION_REQUIRED/);
  await writeFile(join(workspace, 'goals', 'goal-3032.json'), JSON.stringify(record(3032)));
  const duplicate = await readSeedSourceCanonicalGoalCohortV1(missionId, currentOptions);
  assert.equal(duplicate.reason, 'SEED_GOAL_IDENTITY_CONFLICT');
  await writeFile(join(workspace, 'goals', 'goal-3032.json'), '{broken');
  const corrupt = await readSeedSourceCanonicalGoalCohortV1(missionId, currentOptions);
  assert.equal(corrupt.classification, 'UNKNOWN');
  assert.equal(corrupt.reason, 'SEED_CANONICAL_GOAL_COHORT_INCOMPLETE');
});

test('generic events cannot correct a source contract by JSON witness or caller authenticator', async () => {
  const options = await roots();
  const created = await createMissionRecord(base, options);
  const statePath = join(options.root, base.missionId + '.state.json');
  const auditPath = join(options.root, base.missionId + '.events.ndjson');
  const stateBefore = await readFile(statePath, 'utf8');
  const auditBefore = await readFile(auditPath, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  let called = false;
  for (const eventType of ['SOURCE_CONTRACT_CORRECTED', ' source_contract_corrected ',
    'ORDINARY_SOURCE_PLAN_REAFFIRMED', 'SOURCE_PLAN_SUPERSEDED']) {
    await assert.rejects(appendMissionEvent(base.missionId, { eventId: 'forged-correction-event', eventType,
      expectedRevision: created.state.revision, authenticated: true, correctionWitness: { verified: true },
      allowedFiles: ['shared/runtime/foreign.mjs'], requiredTests: ['npm run stephanos:verify'] }, {
      ...options, authorizeSourceContractCorrection: () => { called = true; return { authenticated: true }; },
    }), /SOURCE_CONTRACT_CORRECTION_AUTHENTICATOR_REQUIRED/);
  }
  assert.equal(called, false);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
  assert.equal(await readFile(auditPath, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)), auditBefore);
});

test('forged correction cannot create a mission directory and Node rejects proxy event traps', async () => {
  const options = await roots();
  await assert.rejects(appendMissionEvent(base.missionId, { eventType: 'SOURCE_CONTRACT_CORRECTED' }, options),
    /SOURCE_CONTRACT_CORRECTION_AUTHENTICATOR_REQUIRED/);
  await assert.rejects(readFile(join(options.root, base.missionId + '.state.json')), error => error.code === 'ENOENT');
  let traps = 0;
  await assert.rejects(appendMissionEvent(base.missionId, new Proxy({}, { get() { traps++; throw Error('trap'); } }), options),
    /MISSION_EVENT_DATA_REQUIRED/);
  assert.equal(traps, 0);
});

test('exhausted mission lock acquisition reports typed contention and preserves exact state and lock bytes', async () => {
  const options = await roots();
  await createMissionRecord(base, options);
  const lockPath = join(options.root, base.missionId + '.lock');
  const lockBytes = JSON.stringify({ pid: 51028, acquiredAt: '2026-10-24T19:46:38.712Z' }) + '\n';
  await writeFile(lockPath, lockBytes);
  const statePath = join(options.root, base.missionId + '.state.json');
  const stateBefore = await readFile(statePath, 'utf8');
  await assert.rejects(appendMissionEvent(base.missionId, {
    eventId: 'busy-lock-event-0001', eventType: 'MISSION_CANCELLED',
  }, options), error => error.code === 'MISSION_STATE_LOCK_BUSY'
    && error.missionId === base.missionId && error.message === 'Mission state lock is busy.');
  assert.equal(await readFile(lockPath, 'utf8'), lockBytes);
  assert.equal(await readFile(statePath, 'utf8'), stateBefore);
});

test('default roots live outside the repository under the Mission Runner directory', () => {
  const env = { USERPROFILE: 'C:\\Users\\Operator' };
  assert.match(resolveMissionOrchestratorRoot(env).replace(/\\/g, '/'), /OpenClaw-Standalone\/mission-runner\/orchestrator$/);
  assert.match(resolveMissionOperationsSnapshotRoot(env).replace(/\\/g, '/'), /OpenClaw-Standalone\/mission-runner\/proof\/mission-operations$/);
});

test('creates, lists, reads, and publishes an external mission record', async () => {
  const options = await roots();
  const created = await createMissionRecord(base, options);
  assert.equal(created.state.missionId, base.missionId);
  assert.equal(created.state.currentPhase, 'CREATE_WORKTREE');
  assert.equal(created.snapshot.published, true);
  const listed = await listMissionRecords(options);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].missionId, base.missionId);
  const read = await readMissionRecord(base.missionId, options);
  assert.equal(read.state.schemaVersion, 'stephanos.mission-orchestrator.v1');
  const snapshot = JSON.parse(await readFile(created.snapshot.path, 'utf8'));
  assert.equal(snapshot.schemaVersion, 'stephanos.mission-operations-snapshot.v1');
  assert.equal(snapshot.currentPhase, 'CREATE_WORKTREE');
});

test('event ids are single-use and duplicate delivery does not change state revision', async () => {
  const options = await roots();
  await createMissionRecord({
    ...base,
    missionId: 'runtime-store-test',
    operatorIntent: 'Inspect the live browser runtime.',
    intendedOutcome: 'Browser proof is collected.',
    missionKind: 'live-runtime-investigation',
    branch: 'openclaw/runtime-store-test',
    allowedFiles: [],
    requiredEvidence: ['browser proof'],
    requiredTests: [],
  }, options);
  const first = await append(options, 'runtime-store-test', 'dispatch-runtime-001', 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  assert.equal(first.duplicate, false);
  assert.equal(first.state.dispatch.status, 'running');
  const duplicate = await append(options, 'runtime-store-test', 'dispatch-runtime-001', 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, first.state.revision);
});

test('conditional appends fail atomically without consuming the event id', async () => {
  const options = await roots();
  const missionId = 'conditional-append-test';
  const created = await createMissionRecord({
    ...base,
    missionId,
    branch: 'openclaw/conditional-append-test',
  }, options);
  const ready = await append(options, missionId, 'conditional-worktree', 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'conditional-worktree-proof'),
  });

  const stale = await appendMissionEvent(missionId, {
    eventId: 'conditional-dispatch',
    eventType: 'AGENT_DISPATCHED',
    agentId: 'codex',
    expectedRevision: created.state.revision,
    expectedCurrentPhase: created.state.currentPhase,
  }, options);
  assert.equal(stale.preconditionFailed, true);
  assert.equal(stale.reason, 'MISSION_STATE_PRECONDITION_FAILED');
  assert.equal(stale.state.revision, ready.state.revision);
  assert.equal(stale.state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(stale.state.dispatch.status, 'pending');

  const durable = await readMissionRecord(missionId, options);
  assert.equal(durable.state.revision, ready.state.revision);
  assert.equal(durable.state.dispatch.status, 'pending');
  assert.equal(durable.state.storeMetadata.processedEventIds.includes('conditional-dispatch'), false);

  const applied = await appendMissionEvent(missionId, {
    eventId: 'conditional-dispatch',
    eventType: 'AGENT_DISPATCHED',
    agentId: 'codex',
    expectedRevision: ready.state.revision,
    expectedCurrentPhase: ready.state.currentPhase,
  }, options);
  assert.equal(applied.preconditionFailed, undefined);
  assert.equal(applied.duplicate, false);
  assert.equal(applied.state.dispatch.status, 'running');
});

test('a guarded operation holds the mission lock until exact-state publication completes', async () => {
  const options = await roots();
  const missionId = 'guarded-operation-test';
  const created = await createMissionRecord({
    ...base,
    missionId,
    branch: 'openclaw/guarded-operation-test',
  }, options);
  let enterOperation;
  const operationEntered = new Promise((resolveEntered) => {
    enterOperation = resolveEntered;
  });
  let releaseOperation;
  const operationGate = new Promise((resolveRelease) => {
    releaseOperation = resolveRelease;
  });
  const guardedPromise = runWithMissionStatePrecondition(
    missionId,
    {
      expectedRevision: created.state.revision,
      expectedCurrentPhase: created.state.currentPhase,
    },
    async (state) => {
      enterOperation();
      await operationGate;
      return { revision: state.revision, phase: state.currentPhase };
    },
    options,
  );
  await operationEntered;

  let appendSettled = false;
  const appendPromise = append(options, missionId, 'guarded-worktree-ready', 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: proof('isolated worktree', 'guarded-worktree-proof'),
  }).then((result) => {
    appendSettled = true;
    return result;
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.equal(appendSettled, false);

  releaseOperation();
  const guarded = await guardedPromise;
  assert.equal(guarded.preconditionFailed, false);
  assert.deepEqual(guarded.result, {
    revision: created.state.revision,
    phase: created.state.currentPhase,
  });
  const appended = await appendPromise;
  assert.equal(appended.state.currentPhase, 'AGENT_IMPLEMENTATION');
});

test('verified runtime evidence advances to complete and updates the Mission Operations snapshot', async () => {
  const options = await roots();
  const created = await createMissionRecord({
    ...base,
    missionId: 'runtime-complete-test',
    operatorIntent: 'Inspect the live runtime and collect browser proof.',
    intendedOutcome: 'Browser proof is deterministically recorded.',
    missionKind: 'live-runtime-investigation',
    branch: 'openclaw/runtime-complete-test',
    allowedFiles: [],
    requiredEvidence: ['browser proof'],
    requiredTests: [],
  }, options);
  await append(options, 'runtime-complete-test', 'dispatch-runtime-002', 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  const completed = await append(options, 'runtime-complete-test', 'result-runtime-002', 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'browser-result',
    changedFiles: [],
    receipt: proof('browser proof', 'browser-proof-receipt'),
  });
  assert.equal(completed.state.currentPhase, 'COMPLETE');
  const snapshot = JSON.parse(await readFile(created.snapshot.path, 'utf8'));
  assert.equal(snapshot.state, 'COMPLETE');
});

test('approval event log redacts the raw token while state keeps only its hash', async () => {
  const options = await roots();
  await createMissionRecord(base, options);
  await append(options, base.missionId, 'worktree-ready-001', 'WORKTREE_READY', { worktreePath: base.worktreePath, clean: true, receipt: proof('isolated worktree', 'worktree-proof') });
  await append(options, base.missionId, 'codex-dispatch-001', 'AGENT_DISPATCHED', { agentId: 'codex' });
  await append(options, base.missionId, 'codex-result-001', 'AGENT_RESULT_RECEIVED', { success: true, changedFiles: ['shared/agents/example.mjs'], receipt: proof('codex result', 'codex-proof') });
  await append(options, base.missionId, 'evidence-001', 'EVIDENCE_RECORDED', { receipts: [proof('focused test output', 'test-proof')] });
  await append(options, base.missionId, 'commit-001', 'GIT_OPERATION_COMPLETED', { operation: 'commit', commitSha: '1'.repeat(40), clean: true, receipt: proof('signed commit', 'commit-proof') });
  await append(options, base.missionId, 'push-001', 'GIT_OPERATION_COMPLETED', { operation: 'push', success: true, receipt: proof('signed push', 'push-proof') });
  await append(options, base.missionId, 'pr-open-001', 'PULL_REQUEST_OPENED', { prNumber: 1301, prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1301', headSha: '2'.repeat(40), mergeable: true, receipt: proof('open pull request', 'pr-proof') });
  await append(options, base.missionId, 'checks-001', 'PULL_REQUEST_CHECKS_UPDATED', { prNumber: 1301, headSha: '2'.repeat(40), prState: 'open', mergeable: true, checks: [{ name: 'Build', status: 'success', required: true }], receipt: proof('pull request checks', 'checks-proof') });
  const beforeApproval = await readMissionRecord(base.missionId, options);
  const approvalToken = beforeApproval.state.approval.requiredToken;
  const approved = await append(options, base.missionId, 'approval-001', 'OPERATOR_APPROVAL_RECORDED', { approvalToken });
  assert.equal(approved.state.currentPhase, 'MERGE_PULL_REQUEST');
  assert.match(approved.state.approval.suppliedTokenHash, /^[a-f0-9]{64}$/);
  const eventLog = await readFile(beforeApproval.eventPath, 'utf8');
  assert.equal(eventLog.includes(approvalToken), false);
  assert.match(eventLog, /\[REDACTED\]/);
});
