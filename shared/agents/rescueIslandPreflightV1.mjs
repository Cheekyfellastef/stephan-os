// Pure, read-only preflight for #3103. This is NOT a new worker or an authority grant.
// A separate independently authenticated admission/executor is required after review.
export const RESCUE_ISLAND_PREFLIGHT_SCHEMA = 'stephanos.rescue-island-preflight.v1';
export const RESCUE_ISLAND_WORKERS = Object.freeze(['rescue-island-01', 'rescue-island-02']);
const HEAD = /^[a-f0-9]{40}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const TASK_ID = /^[a-z0-9][a-z0-9._-]{5,79}$/;
const PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,219}$/;
const MAX_EVIDENCE_AGE_MS = 90_000;
const REPO = 'Cheekyfellastef/stephan-os';

// Identity validation is a typed boundary, never a string conversion. Apply the
// same invariant to candidates, inventories, observations and receipt output.
function stringMatches(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function repositoryPath(raw) {
  return typeof raw === 'string' && PATH.test(raw)
    && !raw.includes('//') && !raw.endsWith('/')
    && !raw.split('/').some((segment) => segment === '.' || segment === '..'
      || segment.toLowerCase() === '.git');
}
function validPath(raw) {
  return repositoryPath(raw)
    && !raw.split('/').some((segment) => segment.toLowerCase() === 'node_modules')
    && !overlaps(raw, 'apps/stephanos/dist');
}
function normalizedPath(value) { return typeof value === 'string' ? value.toLowerCase() : ''; }
function overlaps(left, right) {
  const a = normalizedPath(left);
  const b = normalizedPath(right);
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
function validPaths(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 3
    && value.every(validPath)
    && new Set(value.map(normalizedPath)).size === value.length
    // Reject a directory and any descendant in one task, including case aliases.
    // Independently checked source ownership must have a disjoint exact scope.
    && !value.some((path, i) => value.slice(i + 1).some(other => overlaps(path, other)));
}
function validClaims(value) {
  return Array.isArray(value) && value.length <= 512
    && value.every((item) => stringMatches(item?.taskId, TASK_ID)
      && Number.isSafeInteger(item?.ownerIssueNumber) && item.ownerIssueNumber > 0
      && typeof item?.worktreeBranch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(item.worktreeBranch)
      && stringMatches(item?.worktreeIdentity, DIGEST)
      && Array.isArray(item?.targetPaths) && item.targetPaths.length > 0
      && item.targetPaths.length <= 3 && item.targetPaths.every(repositoryPath));
}

// Structural contract only: the independent runtime verifier must resolve each
// scope on the actual filesystem (including missing leaves via real ancestors).
// A lexical path, boolean, or caller-supplied digest never authenticates this scan.
function canonicalScopes(p, paths) {
  if (p.scopeResolutionScan !== 'INDEPENDENT_READ_ONLY'
      || !Array.isArray(p.scopeResolutions) || p.scopeResolutions.length > 4611)
    return null;
  const resolved = new Map();
  for (const item of p.scopeResolutions) {
    if (!repositoryPath(item?.path) || !repositoryPath(item?.canonicalPath)
        || item.repositoryContained !== true || resolved.has(normalizedPath(item.path)))
      return null;
    resolved.set(normalizedPath(item.path), item.canonicalPath);
  }
  return paths.every((path) => resolved.has(normalizedPath(path))) ? resolved : null;
}
function recentTimestamp(observedAtUtc, nowUtc) {
  if (typeof observedAtUtc !== 'string' || !observedAtUtc.endsWith('Z')
      || typeof nowUtc !== 'string' || !nowUtc.endsWith('Z')) return false;
  const now = Date.parse(nowUtc);
  const seen = Date.parse(observedAtUtc);
  return Number.isFinite(now) && Number.isFinite(seen)
    && seen <= now && now - seen <= MAX_EVIDENCE_AGE_MS;
}

/**
 * Structural/read-only candidate classification. Every supplied observation is
 * untrusted until an external, independently reviewed verifier authenticates
 * it. In particular, a caller-provided approval, ownership flag or hash can
 * never authorize a worker, a source write or a lease. Do not turn this into
 * a privileged executor by changing the terminal authority booleans.
 */
export function inspectRescueIslandCandidateV1({ task, observations, nowUtc } = {}) {
  const blockers = [];
  const t = task && typeof task === 'object' && !Array.isArray(task) ? task : {};
  const p = observations && typeof observations === 'object' && !Array.isArray(observations)
    ? observations : {};
  if (t.schemaVersion !== RESCUE_ISLAND_PREFLIGHT_SCHEMA
      || t.repository !== REPO || t.island !== 'RESCUE_ISLAND'
      || t.inbox !== 'RESCUE_ISLAND_OPERATOR_ONLY') blockers.push('ISOLATION_IDENTITY_INVALID');
  if (!RESCUE_ISLAND_WORKERS.includes(t.workerId)) blockers.push('WORKER_IDENTITY_UNQUALIFIED');
  if (!stringMatches(t.taskId, TASK_ID)
      || !Number.isSafeInteger(t.ownerIssueNumber) || t.ownerIssueNumber <= 0
      || typeof t.ownerIssueTitle !== 'string'
      || !t.ownerIssueTitle.trim() || t.ownerIssueTitle.length > 240)
    blockers.push('EXACT_TASK_AND_ISSUE_TITLE_REQUIRED');
  if (t.taskClass !== 'BOUNDED_SOURCE_PROPOSAL') blockers.push('TASK_CLASS_NOT_ADMITTED');
  if (!stringMatches(t.baseHead, HEAD) || !validPaths(t.targetPaths))
    blockers.push('BASE_OR_SCOPE_INVALID');
  if (t.operatorApproval !== 'EXTERNAL_OWNER_PROOF_REQUIRED'
      || t.reviewPolicy !== 'INDEPENDENT_PROTECTED_REVIEW_REQUIRED'
      || t.allowMerge !== false || t.allowDeploy !== false
      || t.allowCanonicalLeaseBypass !== false || t.allowArbitraryShell !== false)
    blockers.push('AUTHORITY_POLICY_INVALID');
  if (!recentTimestamp(p.observedAtUtc, nowUtc)
      || p.repository !== REPO || !stringMatches(p.mainHead, HEAD)
      || p.mainHead !== t.baseHead)
    blockers.push('MAIN_HEAD_OR_EVIDENCE_NOT_FRESH');
  if (p.canonicalOwnerScan !== 'INDEPENDENT_READ_ONLY'
      || p.seedOwnerScan !== 'INDEPENDENT_READ_ONLY'
      || p.islandOwnerScan !== 'INDEPENDENT_READ_ONLY'
      || !validClaims(p.canonicalClaims)
      || !validClaims(p.seedClaims)
      || !validClaims(p.islandClaims)
      || !stringMatches(p.scopeInventoryDigest, DIGEST))
    blockers.push('CROSS_SYSTEM_OWNERSHIP_UNPROVEN');
  else if (validPaths(t.targetPaths)) {
    const claims = [...p.canonicalClaims, ...p.seedClaims, ...p.islandClaims];
    // Caller-controlled task data is never proof of ownership. Reject invalid
    // identities later without letting malformed input crash the read-only gate.
    const candidateWorktreeIdentity = stringMatches(t.worktreeIdentity, DIGEST)
      ? t.worktreeIdentity.toLowerCase() : null;
    if (claims.some(claim => normalizedPath(claim.worktreeBranch) === normalizedPath(t.worktreeBranch)
        || (candidateWorktreeIdentity !== null
          && claim.worktreeIdentity.toLowerCase() === candidateWorktreeIdentity)))
      blockers.push('BRANCH_OR_WORKTREE_ALREADY_OWNED');
    const scopes = canonicalScopes(p, [...t.targetPaths, ...claims.flatMap(c => c.targetPaths)]);
    if (!scopes || t.targetPaths.some(path => !validPath(scopes.get(normalizedPath(path))))
        || t.targetPaths.some((path, i) => t.targetPaths.slice(i + 1).some(other =>
          overlaps(scopes.get(normalizedPath(path)), scopes.get(normalizedPath(other))))))
      blockers.push('CANONICAL_SOURCE_SCOPE_UNPROVEN');
    if (claims.some((claim) => claim.taskId === t.taskId
      || claim.ownerIssueNumber === t.ownerIssueNumber
      || (scopes && claim.targetPaths.some((path) =>
        t.targetPaths.some((candidate) => overlaps(scopes.get(normalizedPath(path)),
          scopes.get(normalizedPath(candidate))))))))
      blockers.push('TASK_OR_SOURCE_SCOPE_ALREADY_OWNED');
  }
  if (p.gamingState !== 'IDLE_FRESH_VERIFIED'
      || p.runnerResourceMode !== 'CPU_ONLY'
      || p.localGamingResourceBudgetVerified !== true)
    blockers.push('GAMING_OR_RESOURCE_CUSTODY_UNPROVEN');
  if (p.isolatedWorktreeClean !== true || p.independentRunnerQualified !== true
      || p.worktreeHead !== t.baseHead
      || !stringMatches(t.worktreeIdentity, DIGEST) || p.worktreeIdentity !== t.worktreeIdentity
      || typeof t.worktreeBranch !== 'string'
      || !/^rescue-island\/[a-z0-9][a-z0-9._-]{5,100}$/.test(t.worktreeBranch)
      || p.worktreeBranch !== t.worktreeBranch)
    blockers.push('ISOLATED_RUNNER_NOT_PROVEN');
  if (t.workerId === 'rescue-island-02' && p.firstWorkerMaterialProof !== true)
    blockers.push('SECOND_WORKER_PILOT_NOT_PROVEN');

  const uniqueBlockers = Object.freeze([...new Set(blockers)]);
  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_PREFLIGHT_SCHEMA,
    island: 'RESCUE_ISLAND',
    workerId: RESCUE_ISLAND_WORKERS.includes(t.workerId) ? t.workerId : '',
    taskId: stringMatches(t.taskId, TASK_ID) ? t.taskId : '',
    preflight: uniqueBlockers.length === 0 ? 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED'
      : 'HELD',
    blockers: uniqueBlockers,
    observationIsAuthoritative: false,
    independentRuntimeAdmissionRequired: true,
    readOnly: true,
    sourceMutationAllowed: false,
    workerStartAllowed: false,
    canonicalLeaseAccessAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    deployAllowed: false,
    unattendedRefillAllowed: false,
  });
}
