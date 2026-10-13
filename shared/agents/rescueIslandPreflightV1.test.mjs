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
  return inspect({ task: { ...task(), ...patchTask }, observations: { ...evidence(), ...patchEvidence }, nowUtc });
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
  rejects('BASE_OR_SCOPE_INVALID', { targetPaths: ['apps/stephanos/dist/index.html'] });
  rejects('AUTHORITY_POLICY_INVALID', { allowCanonicalLeaseBypass: true });
  rejects('AUTHORITY_POLICY_INVALID', { allowMerge: true });
  rejects('AUTHORITY_POLICY_INVALID', { allowArbitraryShell: true });
  rejects('AUTHORITY_POLICY_INVALID', { operatorApproval: 'auto-approved' });
  rejects('TASK_CLASS_NOT_ADMITTED', { taskClass: 'UNBOUNDED_MAINTENANCE' });
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
