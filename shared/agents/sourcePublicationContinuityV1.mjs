export const SOURCE_PUBLICATION_CONTINUITY_V1_SCHEMA = 'stephanos.source-publication-continuity.v1';

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
  REPOSITORY_NOT_FOUND: 'SOURCE_PUBLICATION_REPOSITORY_NOT_FOUND',
  ARTIFACT_INVALID: 'SOURCE_PUBLICATION_ARTIFACT_INVALID',
  CAPACITY_UNAVAILABLE: 'SOURCE_PUBLICATION_CAPACITY_UNAVAILABLE',
});

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const ROUTE_PRIORITY = Object.freeze([
  SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT,
  SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP,
  SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR,
  SOURCE_PUBLICATION_ROUTE.PROVIDER_NEUTRAL,
  SOURCE_PUBLICATION_ROUTE.BATTLE_BRIDGE_HANDOFF,
]);

function text(value) {
  return String(value ?? '').trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function capabilityReceipt(capability) {
  return text(capability?.receipt || capability?.capabilityReceipt || capability?.proofRef);
}

function routeReady(route, capability = {}) {
  if (capability.discovered !== true || capability.ready !== true || !capabilityReceipt(capability)) return false;
  if (route === SOURCE_PUBLICATION_ROUTE.AUTHENTICATED_GIT) {
    return capability.remoteWriteAllowed === true && capability.exactCommitPushAllowed === true;
  }
  if (route === SOURCE_PUBLICATION_ROUTE.CONNECTED_GITHUB_APP) {
    const operations = new Set(list(capability.operations));
    return capability.repositoryPushPermission === true
      && ['CREATE_BLOBS', 'CREATE_TREE', 'CREATE_COMMIT', 'CREATE_BRANCH_REF']
        .every((operation) => operations.has(operation));
  }
  if (route === SOURCE_PUBLICATION_ROUTE.FORGE_SIDECAR) {
    return capability.m2Ready === true
      && capability.m3RunnerReady === true
      && capability.sourcePublicationAllowed === true;
  }
  if (route === SOURCE_PUBLICATION_ROUTE.PROVIDER_NEUTRAL) {
    return capability.sourcePublicationAllowed === true;
  }
  if (route === SOURCE_PUBLICATION_ROUTE.BATTLE_BRIDGE_HANDOFF) {
    return capability.attached === true
      && capability.heartbeatFresh === true
      && capability.sourcePublicationAllowed === true;
  }
  return false;
}

function baseProjection(artifact = {}) {
  return {
    schemaVersion: SOURCE_PUBLICATION_CONTINUITY_V1_SCHEMA,
    repository: REPOSITORY,
    exactBase: text(artifact.exactBase).toLowerCase(),
    exactTree: text(artifact.exactTree).toLowerCase(),
    exactCommit: text(artifact.exactCommit).toLowerCase(),
    branch: text(artifact.branch),
    selectedRoute: SOURCE_PUBLICATION_ROUTE.NONE,
    routeReady: false,
    mutationAllowed: false,
    forceAllowed: false,
    duplicateBranchAllowed: false,
    duplicatePullRequestAllowed: false,
    preserveVerifiedArtifact: true,
    rebuildRequired: false,
  };
}

export function buildSourcePublicationContinuityV1(input = {}) {
  const workspace = input.workspace || {};
  const artifact = input.artifact || {};
  const base = baseProjection(artifact);
  if (workspace.discoveryCompleted !== true) {
    return Object.freeze({
      ...base,
      blocker: SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED,
      exactNextAction: 'Discover approved workspace roots, including bounded nested checkouts, then read the capability registry before denying publication capacity.',
      finalVerdict: SOURCE_PUBLICATION_BLOCKER.DISCOVERY_REQUIRED,
    });
  }
  if (workspace.repository !== REPOSITORY || workspace.checkoutFound !== true) {
    return Object.freeze({
      ...base,
      blocker: SOURCE_PUBLICATION_BLOCKER.REPOSITORY_NOT_FOUND,
      exactNextAction: 'Publish repository-not-found evidence after bounded nested-checkout discovery; do not discard or rebuild the verified artifact.',
      finalVerdict: SOURCE_PUBLICATION_BLOCKER.REPOSITORY_NOT_FOUND,
    });
  }
  const artifactValid = FULL_SHA.test(base.exactBase)
    && FULL_SHA.test(base.exactTree)
    && base.branch.startsWith('agent/')
    && (!base.exactCommit || FULL_SHA.test(base.exactCommit));
  if (!artifactValid) {
    return Object.freeze({
      ...base,
      blocker: SOURCE_PUBLICATION_BLOCKER.ARTIFACT_INVALID,
      exactNextAction: 'Preserve the current work and produce an exact base, exact tree and bounded agent branch identity before publication.',
      finalVerdict: SOURCE_PUBLICATION_BLOCKER.ARTIFACT_INVALID,
    });
  }

  const excludedRoutes = new Set(list(input.failedRoutes).map(text));
  const capabilities = input.capabilities || {};
  const selectedRoute = ROUTE_PRIORITY.find((route) => (
    !excludedRoutes.has(route) && routeReady(route, capabilities[route])
  ));
  if (!selectedRoute) {
    return Object.freeze({
      ...base,
      evaluatedRoutes: ROUTE_PRIORITY,
      failedRoutes: Object.freeze([...excludedRoutes]),
      blocker: SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE,
      exactNextAction: 'Preserve the exact commit or verified diff and publish unavailable evidence for every registered route; do not rebuild or create a duplicate lane.',
      finalVerdict: SOURCE_PUBLICATION_BLOCKER.CAPACITY_UNAVAILABLE,
    });
  }
  return Object.freeze({
    ...base,
    selectedRoute,
    routeReady: true,
    capabilityReceipt: capabilityReceipt(capabilities[selectedRoute]),
    evaluatedRoutes: ROUTE_PRIORITY,
    failedRoutes: Object.freeze([...excludedRoutes]),
    blocker: '',
    exactNextAction: `Publish the preserved exact artifact through ${selectedRoute}; retain all review and merge protections.`,
    finalVerdict: 'SOURCE_PUBLICATION_ROUTE_READY',
  });
}
