export const SOURCE_PUBLICATION_CONTINUITY_V1_SCHEMA = 'stephanos.source-publication-continuity.v1';
export const SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA = 'stephanos.source-publication-capability-receipt.v1';

export const SOURCE_PUBLICATION_ROUTE = Object.freeze({
  AUTHENTICATED_GIT: 'AUTHENTICATED_GIT',
  CONNECTED_GITHUB_APP: 'CONNECTED_GITHUB_APP',
  FORGE_SIDECAR: 'FORGE_SIDECAR',
  PROVIDER_NEUTRAL: 'PROVIDER_NEUTRAL',
  BATTLE_BRIDGE_HANDOFF: 'BATTLE_BRIDGE_HANDOFF',
  NONE: 'NONE',
});

export const SOURCE_PUBLICATION_BLOCKER = Object.freeze({
  DISCOVERY_REQUIRED: 'SOURCE_PUBLICATION_CAPABILITY_DISCOVERY_REQUIRED',
  PROBES_PENDING: 'SOURCE_PUBLICATION_CAPABILITY_PROBES_PENDING',
  REPOSITORY_NOT_FOUND: 'SOURCE_PUBLICATION_REPOSITORY_NOT_FOUND',
  ARTIFACT_INVALID: 'SOURCE_PUBLICATION_ARTIFACT_INVALID',
  CAPACITY_UNAVAILABLE: 'SOURCE_PUBLICATION_CAPACITY_UNAVAILABLE',
});

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const ROUTE_PRIORITY = Object.freeze([
  SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT,
  SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
  SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR,
  SOURCE_PUBLICATION_ROUTE.PROVIDER_NEUTRAL,
  SOURCE_PUBLICATION_ROUTE.BATTLE_BRIDGE_HANDOFF,
]);
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'route', 'repository', 'exactBase', 'exactTree', 'exactCommit',
  'branch', 'state', 'observedAtUtc', 'expiresAtUtc', 'operations',
]);

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function sameKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function safeCanonicalBranch(value) {
  const branch = text(value);
  return SAFE_BRANCH.test(branch)
    && !['main', 'master'].includes(branch)
    && !branch.startsWith('refs/')
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('..')
    && !branch.includes('//');
}

function exactArtifact(artifact = {}) {
  return Object.freeze({
    exactBase: text(artifact.exactBase).toLowerCase(),
    exactTree: text(artifact.exactTree).toLowerCase(),
    exactCommit: text(artifact.exactCommit).toLowerCase(),
    branch: text(artifact.branch),
  });
}

function receiptEvidence(route, capability, artifact, nowMs) {
  const receipt = capability?.receipt;
  if (!receipt) return Object.freeze({ state: 'missing', receipt: null, operations: new Set() });
  if (!sameKeys(receipt, RECEIPT_KEYS)) return Object.freeze({ state: 'invalid', receipt, operations: new Set() });
  const observedAtMs = Date.parse(text(receipt.observedAtUtc));
  const expiresAtMs = Date.parse(text(receipt.expiresAtUtc));
  const operations = new Set(list(receipt.operations).map(text));
  const valid = receipt.schemaVersion === SOURCE_PUBLICATION_CAPABILITY_RECEIPT_V1_SCHEMA
    && receipt.route === route
    && receipt.repository === REPOSITORY
    && text(receipt.exactBase).toLowerCase() === artifact.exactBase
    && text(receipt.exactTree).toLowerCase() === artifact.exactTree
    && text(receipt.exactCommit).toLowerCase() === artifact.exactCommit
    && text(receipt.branch) === artifact.branch
    && ['ready', 'unavailable'].includes(receipt.state)
    && EXPLICIT_TIMEZONE.test(text(receipt.observedAtUtc))
    && EXPLICIT_TIMEZONE.test(text(receipt.expiresAtUtc))
    && Number.isFinite(observedAtMs)
    && Number.isFinite(expiresAtMs)
    && observedAtMs <= nowMs + 5 * 60 * 1000
    && expiresAtMs > nowMs
    && expiresAtMs > observedAtMs
    && Array.isArray(receipt.operations)
    && receipt.operations.length === operations.size;
  return Object.freeze({ state: valid ? receipt.state : 'invalid', receipt, operations });
}

function routeCompatible(route, artifact, evidence) {
  if (evidence.state !== 'ready') return false;
  const operations = evidence.operations;
  if (route === SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT) {
    return FULL_SHA.test(artifact.exactCommit) && operations.has('PUSH_EXACT_SOURCE_COMMIT');
  }
  if (route === SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP) {
    const coreReady = ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT'].every((item) => operations.has(item));
    return coreReady && (operations.has('UPDATE_BRANCH_REF') || operations.has('CREATE_BRANCH_REF'));
  }
  if (route === SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR) {
    return ['M2_READY', 'M3_RUNNER_READY', 'PUBLISH_SOURCE_BRANCH'].every((item) => operations.has(item));
  }
  if (route === SOURCE_PUBLICATION_ROUTE.PROVIDER_NEUTRAL) return operations.has('PUBLISH_SOURCE_BRANCH');
  if (route === SOURCE_PUBLICATION_ROUTE.BATTLE_BRIDGE_HANDOFF) {
    return ['ATTACHED', 'HEARTBEAT_FRESH', 'PUBLISH_SOURCE_BRANCH'].every((item) => operations.has(item));
  }
  return false;
}

function baseProjection(artifact = {}) {
  return {
    schemaVersion: SOURCE_PUBLICATION_CONTINUITY_V1_SCHEMA,
    repository: REPOSITORY,
    ...artifact,
    selectedRoute: SOURCE_PUBLICATION_ROUTE.NONE,
    routeReady: false,
    mutationAllowed: false,
    forceAllowed: false,
    fastForwardOnly: true,
    duplicateBranchAllowed: false,
    duplicatePullRequestAllowed: false,
    preserveVerifiedArtifact: true,
    rebuildRequired: false,
  };
}

export function buildSourcePublicationContinuityV1(input = {}) {
  const workspace = input.workspace || {};
  const artifact = exactArtifact(input.artifact);
  const base = baseProjection(artifact);
  const nowMs = Date.parse(text(input.nowUtc));
  if (workspace.discoveryCompleted !== true) {
    return Object.freeze({ ...base, blocker: SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED, exactNextAction: 'Discover approved workspace roots, including bounded nested checkouts, then read the capability registry before denying publication capacity.', finalVerdict: SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED });
  }
  if (workspace.repository !== REPOSITORY || workspace.checkoutFound !== true) {
    return Object.freeze({ ...base, blocker: SOURCE_PUBLICATION_BLOCKER.REPOSITORY_NOT_FOUND, exactNextAction: 'Publish repository-not-found evidence after bounded nested-checkout discovery; do not discard or rebuild the verified artifact.', finalVerdict: SOURCE_PUBLICATION_BLOCKER.REPOSITORY_NOT_FOUND });
  }
  const artifactValid = Number.isFinite(nowMs) && FULL_SHA.test(artifact.exactBase)
    && FULL_SHA.test(artifact.exactTree) && safeCanonicalBranch(artifact.branch)
    && (!artifact.exactCommit || FULL_SHA.test(artifact.exactCommit));
  if (!artifactValid) {
    return Object.freeze({ ...base, blocker: SOURCE_PUBLICATION_BLOCKER.ARTIFACT_INVALID, exactNextAction: 'Preserve the current work and produce a current time, exact base, exact tree and bounded non-protected canonical branch identity before publication.', finalVerdict: SOURCE_PUBLICATION_BLOCKER.ARTIFACT_INVALID });
  }

  const capabilities = input.capabilities || {};
  const failedRoutes = new Set(list(input.failedRoutes).map(text));
  const evidence = Object.fromEntries(ROUTE_PRIORITY.map((route) => [route, receiptEvidence(route, capabilities[route], artifact, nowMs)]));
  const selectedRoute = ROUTE_PRIORITY.find((route) => !failedRoutes.has(route) && routeCompatible(route, artifact, evidence[route]));
  if (selectedRoute) {
    return Object.freeze({ ...base, selectedRoute, routeReady: true, capabilityReceipt: evidence[selectedRoute].receipt, evaluatedRoutes: ROUTE_PRIORITY, failedRoutes: Object.freeze([...failedRoutes]), blocker: '', exactNextAction: `Publish the preserved exact artifact through ${selectedRoute}; fast-forward the existing canonical branch only and retain all review and merge protections.`, finalVerdict: 'SOURCE_PUBLICATION_ROUTE_READY' });
  }

  const unresolvedRoutes = ROUTE_PRIORITY.filter((route) => !failedRoutes.has(route) && ['missing', 'invalid'].includes(evidence[route].state));
  if (unresolvedRoutes.length) {
    return Object.freeze({ ...base, evaluatedRoutes: ROUTE_PRIORITY, unresolvedRoutes: Object.freeze(unresolvedRoutes), failedRoutes: Object.freeze([...failedRoutes]), blocker: SOURCE_PUBLICATION_BLOCKER.PROBES_PENDING, exactNextAction: 'Complete every missing or invalid capability probe before denying global publication capacity; preserve the verified artifact while probes settle.', finalVerdict: SOURCE_PUBLICATION_BLOCKER.PROBES_PENDING });
  }
  return Object.freeze({ ...base, evaluatedRoutes: ROUTE_PRIORITY, failedRoutes: Object.freeze([...failedRoutes]), blocker: SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE, exactNextAction: 'Preserve the exact commit or verified diff and publish terminal unavailable evidence for every registered route; do not rebuild or create a duplicate lane.', finalVerdict: SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE });
}
