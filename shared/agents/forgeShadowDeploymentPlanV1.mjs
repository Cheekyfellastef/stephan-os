const SHA40 = /^[a-f0-9]{40}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const BOUNDARY_KINDS = new Set(['wsl2', 'vm', 'container']);

export const FORGE_SHADOW_DEPLOYMENT_PLAN_SCHEMA = 'stephanos.forge-shadow-deployment-plan.v1';
export const FORGE_SHADOW_DEPLOYMENT_PLAN_DECISIONS = Object.freeze({
  BLOCKED: 'FORGE_SHADOW_DEPLOYMENT_PLAN_BLOCKED',
  READY: 'FORGE_SHADOW_DEPLOYMENT_PLAN_READY',
});

const TOP_LEVEL_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'image',
  'boundary',
  'network',
  'service',
  'mirror',
  'backup',
  'sharedWorkspace',
]);
const IMAGE_KEYS = Object.freeze(['component', 'digest']);
const BOUNDARY_KEYS = Object.freeze([
  'kind',
  'boundaryId',
  'rootless',
  'privilegeMode',
  'hostSourceMount',
  'hostSocketMount',
]);
const NETWORK_KEYS = Object.freeze([
  'bindAddress',
  'inboundMode',
  'outboundMode',
  'publicExposure',
  'tailscaleExposure',
]);
const SERVICE_KEYS = Object.freeze([
  'mode',
  'signupEnabled',
  'repositoryCreationEnabled',
  'pushEnabled',
  'actionsEnabled',
  'runnerRegistrationEnabled',
  'webhooksEnabled',
  'federationEnabled',
  'packageRegistryEnabled',
]);
const MIRROR_KEYS = Object.freeze([
  'mode',
  'repository',
  'sourceHead',
  'sourceAuthentication',
  'automaticSyncEnabled',
  'pushEnabled',
  'forceUpdateEnabled',
  'pruneEnabled',
]);
const BACKUP_KEYS = Object.freeze([
  'targetId',
  'beforeFirstStart',
  'restoreDrillRequired',
  'contentAddressed',
  'retentionCount',
]);
const SHARED_WORKSPACE_KEYS = Object.freeze(['publishStatus', 'publishProof']);

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

function authority() {
  return Object.freeze({
    sourceMutation: false,
    githubRefWrite: false,
    forgeRefWrite: false,
    forcePush: false,
    branchDeletion: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    runnerRegistration: false,
    credentialCreation: false,
    publicExposure: false,
    schedulerCreation: false,
    arbitraryCommand: false,
    arbitraryFilesystem: false,
    requiresSeparateRuntimeAuthorization: true,
  });
}

function fixedPhases(repository, canonicalMainHead, imageDigest, boundaryKind) {
  return Object.freeze([
    Object.freeze({
      phase: 'identity-preflight',
      requires: Object.freeze({ repository, canonicalMainHead, imageDigest }),
      mutationAllowed: false,
    }),
    Object.freeze({
      phase: 'isolated-boundary-preparation',
      requires: Object.freeze({ boundaryKind, rootless: true, hostSourceMount: 'none', hostSocketMount: 'none' }),
      mutationAllowed: false,
    }),
    Object.freeze({
      phase: 'backup-and-restore-preflight',
      requires: Object.freeze({ backupBeforeFirstStart: true, restoreDrillRequired: true }),
      mutationAllowed: false,
    }),
    Object.freeze({
      phase: 'loopback-read-only-service-configuration',
      requires: Object.freeze({ bindAddress: '127.0.0.1', publicExposure: false, runnerRegistration: false }),
      mutationAllowed: false,
    }),
    Object.freeze({
      phase: 'fetch-only-shadow-configuration',
      requires: Object.freeze({ sourceAuthentication: 'anonymous-public-read', automaticSync: false, push: false, prune: false }),
      mutationAllowed: false,
    }),
    Object.freeze({
      phase: 'separate-runtime-authorization-required',
      requires: Object.freeze({ exactPlanIdentity: true, paritySchema: 'stephanos.forge-shadow-parity.v1' }),
      mutationAllowed: false,
    }),
  ]);
}

export function planForgeShadowDeployment(input = {}) {
  const blockers = [];
  if (!sameKeys(input, TOP_LEVEL_KEYS)) blockers.push('deployment-input-schema-unbounded');

  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const image = input.image && typeof input.image === 'object' ? input.image : {};
  const boundary = input.boundary && typeof input.boundary === 'object' ? input.boundary : {};
  const network = input.network && typeof input.network === 'object' ? input.network : {};
  const service = input.service && typeof input.service === 'object' ? input.service : {};
  const mirror = input.mirror && typeof input.mirror === 'object' ? input.mirror : {};
  const backup = input.backup && typeof input.backup === 'object' ? input.backup : {};
  const sharedWorkspace = input.sharedWorkspace && typeof input.sharedWorkspace === 'object'
    ? input.sharedWorkspace
    : {};

  if (!sameKeys(image, IMAGE_KEYS)) blockers.push('image-schema-unbounded');
  if (!sameKeys(boundary, BOUNDARY_KEYS)) blockers.push('boundary-schema-unbounded');
  if (!sameKeys(network, NETWORK_KEYS)) blockers.push('network-schema-unbounded');
  if (!sameKeys(service, SERVICE_KEYS)) blockers.push('service-schema-unbounded');
  if (!sameKeys(mirror, MIRROR_KEYS)) blockers.push('mirror-schema-unbounded');
  if (!sameKeys(backup, BACKUP_KEYS)) blockers.push('backup-schema-unbounded');
  if (!sameKeys(sharedWorkspace, SHARED_WORKSPACE_KEYS)) blockers.push('shared-workspace-schema-unbounded');

  if (!REPOSITORY.test(repository)) blockers.push('repository-invalid');
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (text(image.component) !== 'forgejo') blockers.push('image-component-not-forgejo');
  if (!SHA256_DIGEST.test(text(image.digest).toLowerCase())) blockers.push('image-digest-not-immutable');

  const boundaryKind = text(boundary.kind).toLowerCase();
  if (!BOUNDARY_KINDS.has(boundaryKind)) blockers.push('boundary-kind-invalid');
  if (!SAFE_ID.test(text(boundary.boundaryId))) blockers.push('boundary-id-invalid');
  if (boundary.rootless !== true) blockers.push('boundary-not-rootless');
  if (text(boundary.privilegeMode) !== 'unprivileged') blockers.push('boundary-privilege-not-unprivileged');
  if (text(boundary.hostSourceMount) !== 'none') blockers.push('host-source-mount-not-disabled');
  if (text(boundary.hostSocketMount) !== 'none') blockers.push('host-socket-mount-not-disabled');

  if (text(network.bindAddress) !== '127.0.0.1') blockers.push('network-bind-not-loopback');
  if (text(network.inboundMode) !== 'loopback-only') blockers.push('network-inbound-not-loopback-only');
  if (text(network.outboundMode) !== 'github-fetch-only') blockers.push('network-outbound-not-github-fetch-only');
  if (network.publicExposure !== false) blockers.push('network-public-exposure-not-disabled');
  if (network.tailscaleExposure !== false) blockers.push('network-tailscale-exposure-not-disabled');

  if (text(service.mode) !== 'read-only-shadow') blockers.push('service-mode-not-read-only-shadow');
  for (const [label, value] of [
    ['signup', service.signupEnabled],
    ['repository-creation', service.repositoryCreationEnabled],
    ['push', service.pushEnabled],
    ['actions', service.actionsEnabled],
    ['runner-registration', service.runnerRegistrationEnabled],
    ['webhooks', service.webhooksEnabled],
    ['federation', service.federationEnabled],
    ['package-registry', service.packageRegistryEnabled],
  ]) {
    if (value !== false) blockers.push(`service-${label}-not-disabled`);
  }

  if (text(mirror.mode) !== 'fetch-only') blockers.push('mirror-mode-not-fetch-only');
  if (text(mirror.repository) !== repository) blockers.push('mirror-repository-mismatch');
  if (text(mirror.sourceHead).toLowerCase() !== canonicalMainHead) blockers.push('mirror-source-head-mismatch');
  if (text(mirror.sourceAuthentication) !== 'anonymous-public-read') blockers.push('mirror-source-authentication-not-anonymous-read');
  if (mirror.automaticSyncEnabled !== false) blockers.push('mirror-automatic-sync-not-disabled');
  if (mirror.pushEnabled !== false) blockers.push('mirror-push-not-disabled');
  if (mirror.forceUpdateEnabled !== false) blockers.push('mirror-force-update-not-disabled');
  if (mirror.pruneEnabled !== false) blockers.push('mirror-prune-not-disabled');

  if (!SAFE_ID.test(text(backup.targetId))) blockers.push('backup-target-id-invalid');
  if (backup.beforeFirstStart !== true) blockers.push('backup-before-first-start-not-required');
  if (backup.restoreDrillRequired !== true) blockers.push('backup-restore-drill-not-required');
  if (backup.contentAddressed !== true) blockers.push('backup-not-content-addressed');
  const retentionCount = integer(backup.retentionCount);
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 3 || retentionCount > 30) {
    blockers.push('backup-retention-count-invalid');
  }

  if (sharedWorkspace.publishStatus !== true) blockers.push('shared-workspace-status-not-required');
  if (sharedWorkspace.publishProof !== true) blockers.push('shared-workspace-proof-not-required');

  const resultBase = Object.freeze({
    schemaVersion: FORGE_SHADOW_DEPLOYMENT_PLAN_SCHEMA,
    repository,
    canonicalMainHead,
    authority: authority(),
  });

  if (blockers.length) {
    return Object.freeze({
      ...resultBase,
      valid: false,
      decision: FORGE_SHADOW_DEPLOYMENT_PLAN_DECISIONS.BLOCKED,
      blockers: Object.freeze([...new Set(blockers)]),
      phases: Object.freeze([]),
      runtimeRequest: null,
    });
  }

  const imageDigest = text(image.digest).toLowerCase();
  return Object.freeze({
    ...resultBase,
    valid: true,
    decision: FORGE_SHADOW_DEPLOYMENT_PLAN_DECISIONS.READY,
    blockers: Object.freeze([]),
    phases: fixedPhases(repository, canonicalMainHead, imageDigest, boundaryKind),
    runtimeRequest: Object.freeze({
      schemaVersion: 'stephanos.forge-shadow-runtime-request.v1',
      repository,
      canonicalMainHead,
      boundaryId: text(boundary.boundaryId),
      boundaryKind,
      imageDigest,
      backupTargetId: text(backup.targetId),
      statusRecord: 'status/forge-shadow-runtime.json',
      proofRecord: 'proofs/forge-shadow-parity.json',
      requiredParitySchema: 'stephanos.forge-shadow-parity.v1',
      exactRuntimeAuthorizationRequired: true,
      executable: null,
      command: null,
      environment: null,
      credentials: null,
    }),
  });
}
