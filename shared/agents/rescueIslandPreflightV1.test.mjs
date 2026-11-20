import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRescueIslandCandidateV1 as inspect, RESCUE_ISLAND_PREFLIGHT_SCHEMA as SCHEMA } from './rescueIslandPreflightV1.mjs';

const HEAD = 'a'.repeat(40);
const HASH = 'b'.repeat(64);
const NOW = '2026-10-13T22:45:00.000Z';
const task = () => ({
  schemaVersion: SCHEMA,
  repository: 'Cheekyfellastef/stephan-os',
  island: 'RESCUE_ISLAND',
  inbox: 'RESCUE_ISLAND_OPERATOR_ONLY',
  workerId: 'rescue-island-01',
  taskId: 'rescue-3103-pilot-01',
  ownerIssueNumber: 3103,
  ownerIssueTitle: 'Rescue Island: two independent proof-gated builders outside Goal Conveyor',
  taskClass: 'BOUNDED_SOURCE_PROPOSAL',
  baseHead: HEAD,
  worktreeBranch: 'rescue-island/pilot-rescue-3103-pilot-01',
  worktreeIdentity: 'e'.repeat(64),
  targetPaths: ['docs/architecture/rescue-island-pilot.md'],
  operatorApproval: 'EXTERNAL_OWNER_PROOF_REQUIRED',
  reviewPolicy: 'INDEPENDENT_PROTECTED_REVIEW_REQUIRED',
  allowMerge: false, allowDeploy: false,
  allowCanonicalLeaseBypass: false, allowArbitraryShell: false,
});
const evidence = () => ({
  observedAtUtc: NOW,
  repository: 'Cheekyfellastef/stephan-os',
  mainHead: HEAD,
  worktreeHead: HEAD,
  worktreeBranch: 'rescue-island/pilot-rescue-3103-pilot-01',
  worktreeIdentity: 'e'.repeat(64),
  scopeResolutionScan: 'INDEPENDENT_READ_ONLY',
  canonicalOwnerScan: 'INDEPENDENT_READ_ONLY',
  seedOwnerScan: 'INDEPENDENT_READ_ONLY',
  islandOwnerScan: 'INDEPENDENT_READ_ONLY',
  canonicalClaims: [], seedClaims: [], islandClaims: [],
  scopeInventoryDigest: HASH,
  gamingState: 'IDLE_FRESH_VERIFIED',
  runnerResourceMode: 'CPU_ONLY',
  localGamingResourceBudgetVerified: true,
  isolatedWorktreeClean: true,
  independentRunnerQualified: true,
  firstWorkerMaterialProof: false,
});

function evaluate(patchTask = {}, patchEvidence = {}, nowUtc = NOW) {
  const t = { ...task(), ...patchTask };
  const p = { ...evidence(), ...patchEvidence };
  for (const key of ['canonicalClaims', 'seedClaims', 'islandClaims']) {
    if (Array.isArray(p[key])) p[key] = p[key].map(c => ({ ownerIssueNumber: 9999,
      worktreeBranch: 'other-system/' + c.taskId, worktreeIdentity: 'd'.repeat(64), ...c }));
  }
  if (!Object.hasOwn(patchEvidence, 'scopeResolutions')) {
    const paths = [...(t.targetPaths || []), ...['canonicalClaims', 'seedClaims', 'islandClaims']
      .flatMap(key => (p[key] || []).flatMap(c => c.targetPaths))];
    p.scopeResolutions = [...new Set(paths.map(path => path.toLowerCase()))]
      .map(path => ({ path, canonicalPath: path, repositoryContained: true }));
  }
  return inspect({ task: t, observations: p, nowUtc });
}
function rejects(code, patchTask, patchEvidence, nowUtc) {
  const r = evaluate(patchTask, patchEvidence, nowUtc);
  assert.equal(r.preflight, 'HELD');
  assert.ok(r.blockers.includes(code), code + ': ' + JSON.stringify(r.blockers));
  assert.equal(r.sourceMutationAllowed, false);
}

test('structural preflight can pass but NEVER grants source mutation, worker start, review, merge, lease or queue authority', () => {
  const r = evaluate();
  assert.equal(r.preflight, 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.deepEqual(r.blockers, []);
  for (const flag of [
    'observationIsAuthoritative','sourceMutationAllowed','workerStartAllowed',
    'canonicalLeaseAccessAllowed','seedForgeQueueAccessAllowed',
    'mergeAllowed','deployAllowed','unattendedRefillAllowed',
  ]) assert.equal(r[flag], false, flag);
  assert.equal(r.independentRuntimeAdmissionRequired, true);
  assert.equal(r.readOnly, true);
});

test('separate identities and source paths cannot drift into original conveyor or Seed Forge', () => {
  rejects('ISOLATION_IDENTITY_INVALID', { inbox: 'ORIGINAL_MISSION_WORKER_QUEUE' });
  rejects('ISOLATION_IDENTITY_INVALID', { island: 'SEED_PARALLEL' });
  rejects('WORKER_IDENTITY_UNQUALIFIED', { workerId: 'stephanos-sovereign-builder-08' });
  rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, { canonicalClaims: [
    { taskId: 'other-canonical-01', targetPaths: ['docs/architecture/rescue-island-pilot.md'] },
  ] });
  rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, { seedClaims: [
    { taskId: 'other-seed-01', targetPaths: ['docs/architecture'] },
  ] });
  rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, { islandClaims: [
    { taskId: 'rescue-3103-pilot-01', targetPaths: ['different/file.md'] },
  ] });
  rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, { seedClaims: [
    { taskId: 'other-seed-01', targetPaths: ['DOCS/architecture/RESCUE-ISLAND-PILOT.md'] },
  ] });
});

test('unknown ownership and stale evidence fail closed; the old held global lease is never touched', () => {
  rejects('CROSS_SYSTEM_OWNERSHIP_UNPROVEN', {}, { canonicalClaims: undefined });
  rejects('CROSS_SYSTEM_OWNERSHIP_UNPROVEN', {}, { seedOwnerScan: 'UNKNOWN' });
  rejects('CROSS_SYSTEM_OWNERSHIP_UNPROVEN', {}, { scopeInventoryDigest: 'self-asserted' });
  rejects('MAIN_HEAD_OR_EVIDENCE_NOT_FRESH', {}, { mainHead: 'c'.repeat(40) });
  rejects('MAIN_HEAD_OR_EVIDENCE_NOT_FRESH', {}, { observedAtUtc: '2026-10-13T22:40:00.000Z' });
  rejects('MAIN_HEAD_OR_EVIDENCE_NOT_FRESH', {}, {}, '2026-10-13T22:50:00.000Z');
});

test('invalid issue, unsafe paths, review downgrades and execution overrides are held', () => {
  rejects('EXACT_TASK_AND_ISSUE_TITLE_REQUIRED', { ownerIssueTitle: '' });
  rejects('EXACT_TASK_AND_ISSUE_TITLE_REQUIRED', { ownerIssueNumber: 0 });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['../protected/secrets.txt'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['docs/architecture/a.md', 'DOCS/ARCHITECTURE/A.md'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['docs/island', 'docs/island/pilot.md'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['DOCS/ISLAND', 'docs/island/pilot.md'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['apps/stephanos/dist/index.html'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['apps/stephanos/dist'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['apps/stephanos'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['apps'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['node_modules'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['NODE_MODULES'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['packages/foo/node_modules'] });
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['packages/foo/node_modules/index.js'] });
  rejects('AUTHORITY_POLICY_INVALID', { allowCanonicalLeaseBypass: true });
  rejects('AUTHORITY_POLICY_INVALID', { allowMerge: true });
  rejects('AUTHORITY_POLICY_INVALID', { allowMerge: 'true' });
  rejects('AUTHORITY_POLICY_INVALID', { allowDeploy: null });
  rejects('AUTHORITY_POLICY_INVALID', { allowArbitraryShell: undefined });
  rejects('AUTHORITY_POLICY_INVALID', { allowCanonicalLeaseBypass: 0 });
  rejects('AUTHORITY_POLICY_INVALID', { allowArbitraryShell: true });
  rejects('AUTHORITY_POLICY_INVALID', { operatorApproval: 'auto-approved' });
  rejects('TASK_CLASS_NOT_ADMITTED', { taskClass: 'UNBOUNDED_MAINTENANCE' });
});

test('ownership follows canonical issue and filesystem identity across all three inventories', () => {
  for (const inventory of ['canonicalClaims', 'seedClaims', 'islandClaims']) {
    rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, { [inventory]: [{
      taskId: 'another-task-01', ownerIssueNumber: 3103, targetPaths: ['different/file.md'],
    }] });
    for (const canonicalPath of ['docs/architecture/rescue-island-pilot.md', 'docs/architecture']) {
      rejects('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED', {}, {
        [inventory]: [{ taskId: 'another-task-01', targetPaths: ['alias/file.md'] }],
        scopeResolutions: [
          { path: task().targetPaths[0], canonicalPath: task().targetPaths[0], repositoryContained: true },
          { path: 'alias/file.md', canonicalPath, repositoryContained: true },
        ],
      });
    }
    rejects('CROSS_SYSTEM_OWNERSHIP_UNPROVEN', {}, { [inventory]: [{
      taskId: 'another-task-01', ownerIssueNumber: undefined, targetPaths: ['different/file.md'],
    }] });
  }
  rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {
    targetPaths: ['docs/pilot-a.md', 'docs/pilot-b.md'],
  }, {
    scopeResolutions: [
      { path: 'docs/pilot-a.md', canonicalPath: 'docs/pilot-a.md', repositoryContained: true },
      { path: 'docs/pilot-b.md', canonicalPath: 'docs/pilot-a.md', repositoryContained: true },
    ],
  });
  rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {
    targetPaths: ['docs/pilot-a.md', 'docs/pilot-b.md'],
  }, {
    scopeResolutions: [
      { path: 'docs/pilot-a.md', canonicalPath: 'docs/pilot', repositoryContained: true },
      { path: 'docs/pilot-b.md', canonicalPath: 'docs/pilot/subdir', repositoryContained: true },
    ],
  });
  rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {}, { scopeResolutions: [] });
  rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {}, { scopeResolutionScan: 'UNKNOWN' });
  for (const canonicalPath of ['../outside', 'apps/stephanos', 'apps/stephanos/dist', 'packages/foo/node_modules']) {
    rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {}, { scopeResolutions: [{
      path: task().targetPaths[0], canonicalPath, repositoryContained: true,
    }] });
  }
  rejects('CANONICAL_SOURCE_SCOPE_UNPROVEN', {}, { scopeResolutions: [{
    path: task().targetPaths[0], canonicalPath: task().targetPaths[0], repositoryContained: false,
  }] });
});

test('clean worktree observations must bind both branch and exact base head', () => {
  rejects('ISOLATED_RUNNER_NOT_PROVEN', {}, { worktreeHead: 'c'.repeat(40) });
  rejects('ISOLATED_RUNNER_NOT_PROVEN', {}, { worktreeHead: undefined });
  rejects('ISOLATED_RUNNER_NOT_PROVEN', {}, { worktreeBranch: 'rescue-island/unrelated-task' });
  rejects('ISOLATED_RUNNER_NOT_PROVEN', { worktreeBranch: 'main' });
  rejects('ISOLATED_RUNNER_NOT_PROVEN', {}, { worktreeIdentity: 'd'.repeat(64) });
  for (const inventory of ['canonicalClaims', 'seedClaims', 'islandClaims']) {
    for (const collision of [{ worktreeBranch: task().worktreeBranch },
      { worktreeIdentity: task().worktreeIdentity }]) {
      rejects('BRANCH_OR_WORKTREE_ALREADY_OWNED', {}, { [inventory]: [{
        taskId: 'another-task-01', targetPaths: ['different/file.md'], ...collision,
      }] });
    }
    rejects('CROSS_SYSTEM_OWNERSHIP_UNPROVEN', {}, { [inventory]: [{
      taskId: 'another-task-01', targetPaths: ['different/file.md'], worktreeIdentity: undefined,
    }] });
  }
});

test('mixed-case worktree digest claims cannot evade cross-conveyor ownership', () => {
  for (const inventory of ['canonicalClaims', 'seedClaims', 'islandClaims']) {
    rejects('BRANCH_OR_WORKTREE_ALREADY_OWNED', {}, {
      [inventory]: [{ taskId: 'another-task-01', targetPaths: ['different/file.md'],
        worktreeIdentity: task().worktreeIdentity.toUpperCase() }],
    });
  }
});

test('malformed candidate worktree identities never throw or grant authority with existing claims', () => {
  for (const invalid of [undefined, null, 17, {}, ['e'.repeat(64)]]) {
    const result = evaluate({ worktreeIdentity: invalid }, {
      canonicalClaims: [{ taskId: 'different-canonical-task', targetPaths: ['different/file.md'] }],
    });
    assert.equal(result.preflight, 'HELD');
    assert.ok(result.blockers.includes('ISOLATED_RUNNER_NOT_PROVEN'));
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.workerStartAllowed, false);
  }
});

test('string-coercible claim identities cannot masquerade as authenticated inventories', () => {
  for (const inventory of ['canonicalClaims', 'seedClaims', 'islandClaims']) {
    for (const invalid of [
      { worktreeIdentity: ['d'.repeat(64)] },
      { taskId: ['another-task-01'] },
    ]) {
      const result = evaluate({}, { [inventory]: [{
        taskId: 'another-task-01', targetPaths: ['different/file.md'], ...invalid,
      }] });
      assert.equal(result.preflight, 'HELD');
      assert.ok(result.blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
      assert.equal(result.sourceMutationAllowed, false);
      assert.equal(result.workerStartAllowed, false);
    }
  }
});

test('every candidate and observation identity requires a primitive string without coercion', () => {
  const cases = [
    ['taskId', task().taskId, 'EXACT_TASK_AND_ISSUE_TITLE_REQUIRED', 'task'],
    ['baseHead', HEAD, 'BASE_OR_SCOPE_INVALID', 'task'],
    ['worktreeIdentity', task().worktreeIdentity, 'ISOLATED_RUNNER_NOT_PROVEN', 'task'],
    ['worktreeBranch', task().worktreeBranch, 'ISOLATED_RUNNER_NOT_PROVEN', 'task'],
    ['mainHead', HEAD, 'MAIN_HEAD_OR_EVIDENCE_NOT_FRESH', 'observations'],
    ['scopeInventoryDigest', HASH, 'CROSS_SYSTEM_OWNERSHIP_UNPROVEN', 'observations'],
  ];
  for (const [field, valid, blocker, side] of cases) {
    for (const invalid of [undefined, null, 17, true, [valid], new String(valid),
      { toString() { throw new Error('identity coercion must never run'); } }, Symbol(field)]) {
      const t = task();
      const p = evidence();
      p.canonicalClaims = [{ taskId: 'other-canonical-task', ownerIssueNumber: 9999,
        worktreeBranch: 'other-system/task', worktreeIdentity: 'd'.repeat(64),
        targetPaths: ['different/file.md'] }];
      p.scopeResolutions = [...t.targetPaths, 'different/file.md']
        .map(path => ({ path, canonicalPath: path, repositoryContained: true }));
      if (side === 'task') t[field] = invalid;
      else p[field] = invalid;
      // Matching references must not turn non-string identities into proof.
      if (field === 'baseHead' || field === 'mainHead') {
        t.baseHead = p.mainHead = p.worktreeHead = invalid;
      }
      if (field === 'worktreeIdentity') p.worktreeIdentity = invalid;
      if (field === 'worktreeBranch') p.worktreeBranch = invalid;
      const result = inspect({ task: t, observations: p, nowUtc: NOW });
      assert.equal(result.preflight, 'HELD', `${side}.${field}`);
      assert.ok(result.blockers.includes(blocker), `${side}.${field}: ${result.blockers}`);
      assert.equal(result.workerStartAllowed, false);
      assert.equal(result.sourceMutationAllowed, false);
      if (field === 'taskId') assert.equal(result.taskId, '');
    }
  }
});

test('complete independent scope scan accepts all permitted claim inventory paths', () => {
  const canonicalClaims = Array.from({ length: 512 }, (_, i) => ({
    taskId: `canonical-task-${i}`,
    targetPaths: [0, 1, 2].map(j => `docs/unclaimed/project-${i}-${j}.md`),
  }));
  const seedClaims = [{ taskId: 'seed-task-01', targetPaths: ['docs/unclaimed/seed-extra.md'] }];
  const targetPaths = [
    'docs/architecture/rescue-island-pilot.md',
    'docs/architecture/rescue-island-pilot-tests.md',
    'docs/architecture/rescue-island-pilot-notes.md',
  ];
  const result = evaluate({ targetPaths }, { canonicalClaims, seedClaims });
  assert.equal(result.preflight, 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED',
    JSON.stringify(result.blockers));
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.workerStartAllowed, false);
});

test('gaming, GPU model custody and second clone are independently gated', () => {
  rejects('GAMING_OR_RESOURCE_CUSTODY_UNPROVEN', {}, { gamingState: 'ACTIVE' });
  rejects('GAMING_OR_RESOURCE_CUSTODY_UNPROVEN', {}, { gamingState: 'UNKNOWN' });
  rejects('GAMING_OR_RESOURCE_CUSTODY_UNPROVEN', {}, { runnerResourceMode: 'GPU' });
  rejects('GAMING_OR_RESOURCE_CUSTODY_UNPROVEN', {}, { localGamingResourceBudgetVerified: false });
  rejects('ISOLATED_RUNNER_NOT_PROVEN', {}, { isolatedWorktreeClean: false });
  rejects('SECOND_WORKER_PILOT_NOT_PROVEN', { workerId: 'rescue-island-02' });
  assert.equal(evaluate({ workerId: 'rescue-island-02' }, { firstWorkerMaterialProof: true })
    .preflight, 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
});
