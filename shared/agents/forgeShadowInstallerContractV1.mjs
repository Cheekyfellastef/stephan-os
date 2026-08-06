import { createHash } from 'node:crypto';

export const FORGE_SHADOW_INSTALLER_CONTRACT_SCHEMA = 'stephanos.forge-shadow-installer-contract.v1';
export const FORGE_SHADOW_INSTALLER_REQUEST_SCHEMA = 'stephanos.forge-shadow-installer-request.v1';
export const FORGE_SHADOW_INSTALLER_DECISIONS = Object.freeze({
  BLOCKED: 'FORGE_SHADOW_INSTALLER_CONTRACT_BLOCKED',
  READY: 'FORGE_SHADOW_INSTALLER_CONTRACT_READY',
});

const FIXED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FIXED_ADAPTER_ID = 'forge-shadow-wsl2-rootless-podman-v1';
const FIXED_HOST_ID = 'battle-bridge';
const FIXED_BOUNDARY_KIND = 'wsl2';
const FIXED_WSL_DISTRIBUTION_ID = 'stephanos-forge-shadow';
const FIXED_CONTAINER_ENGINE = 'podman-rootless';
const FIXED_IMAGE_REPOSITORY = 'codeberg.org/forgejo/forgejo';
const FIXED_BIND_ADDRESS = '127.0.0.1';
const FIXED_HOST_PORT = 13000;
const FIXED_CONTAINER_PORT = 3000;
const FIXED_GIT_SOURCE_URL = 'https://github.com/Cheekyfellastef/stephan-os.git';
const FIXED_DATA_VOLUME_ID = 'forge-shadow-data-v1';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

const TOP_LEVEL_KEYS = Object.freeze(['runtimeRequest', 'executionProfile']);
const RUNTIME_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'canonicalMainHead',
  'boundaryId',
  'boundaryKind',
  'imageDigest',
  'backupTargetId',
  'statusRecord',
  'proofRecord',
  'requiredParitySchema',
  'exactRuntimeAuthorizationRequired',
  'executable',
  'command',
  'environment',
  'credentials',
]);
const EXECUTION_PROFILE_KEYS = Object.freeze([
  'adapterId',
  'hostId',
  'wslDistributionId',
  'containerEngine',
  'imageRepository',
  'bindAddress',
  'hostPort',
  'containerPort',
  'sshEnabled',
  'readOnlyRootFilesystem',
  'dropAllCapabilities',
  'noNewPrivileges',
  'dataVolumeId',
  'gitSourceUrl',
  'gitAuthentication',
  'automaticSyncEnabled',
  'pushEnabled',
  'forceUpdateEnabled',
  'pruneEnabled',
  'backupTargetId',
]);

const STEP_IDS = Object.freeze([
  'verify-wsl2-isolation',
  'verify-rootless-container-engine',
  'backup-shadow-state',
  'verify-backup-restore-drill',
  'pull-immutable-forgejo-image',
  'configure-loopback-read-only-shadow',
  'fetch-canonical-main-anonymously',
  'verify-object-tree-parity',
  'publish-bounded-runtime-proof',
]);

function text(value) {
  return String(value ?? '').trim();
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length
    && actual.every((key, index) => key === required[index]);
}

function exactInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
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
    processMutation: false,
    hostMutation: false,
    runnerRegistration: false,
    credentialCreation: false,
    credentialRead: false,
    publicExposure: false,
    tailscaleExposure: false,
    schedulerCreation: false,
    arbitraryCommand: false,
    arbitraryFilesystem: false,
    requiresSeparateRuntimeAuthorization: true,
  });
}

function requestId(core) {
  const digest = createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex');
  return `forge-shadow-install-${digest.slice(0, 24)}`;
}

function fixedSteps(runtimeRequest) {
  return Object.freeze(STEP_IDS.map((stepId) => Object.freeze({
    stepId,
    adapterId: FIXED_ADAPTER_ID,
    repository: FIXED_REPOSITORY,
    canonicalMainHead: runtimeRequest.canonicalMainHead,
    imageDigest: runtimeRequest.imageDigest,
    executed: false,
    mutationAllowedByContract: false,
    requiresSeparateRuntimeAuthorization: true,
  })));
}

export function buildForgeShadowInstallerContract(input = {}) {
  const blockers = [];
  if (!sameKeys(input, TOP_LEVEL_KEYS)) blockers.push('installer-input-schema-unbounded');

  const runtimeRequest = input.runtimeRequest && typeof input.runtimeRequest === 'object'
    ? input.runtimeRequest
    : {};
  const executionProfile = input.executionProfile && typeof input.executionProfile === 'object'
    ? input.executionProfile
    : {};

  if (!sameKeys(runtimeRequest, RUNTIME_REQUEST_KEYS)) blockers.push('runtime-request-schema-unbounded');
  if (!sameKeys(executionProfile, EXECUTION_PROFILE_KEYS)) blockers.push('execution-profile-schema-unbounded');

  const repository = text(runtimeRequest.repository);
  const canonicalMainHead = text(runtimeRequest.canonicalMainHead).toLowerCase();
  const imageDigest = text(runtimeRequest.imageDigest).toLowerCase();
  const backupTargetId = text(runtimeRequest.backupTargetId);

  if (runtimeRequest.schemaVersion !== 'stephanos.forge-shadow-runtime-request.v1') {
    blockers.push('runtime-request-schema-mismatch');
  }
  if (repository !== FIXED_REPOSITORY) blockers.push('repository-not-allowlisted');
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA256_DIGEST.test(imageDigest)) blockers.push('image-digest-invalid');
  if (!SAFE_ID.test(text(runtimeRequest.boundaryId))) blockers.push('boundary-id-invalid');
  if (text(runtimeRequest.boundaryKind) !== FIXED_BOUNDARY_KIND) blockers.push('boundary-kind-not-wsl2');
  if (!SAFE_ID.test(backupTargetId)) blockers.push('backup-target-id-invalid');
  if (runtimeRequest.statusRecord !== 'status/forge-shadow-runtime.json') blockers.push('status-record-mismatch');
  if (runtimeRequest.proofRecord !== 'proofs/forge-shadow-parity.json') blockers.push('proof-record-mismatch');
  if (runtimeRequest.requiredParitySchema !== 'stephanos.forge-shadow-parity.v1') blockers.push('parity-schema-mismatch');
  if (runtimeRequest.exactRuntimeAuthorizationRequired !== true) blockers.push('runtime-authorization-not-required');
  for (const [field, value] of [
    ['executable', runtimeRequest.executable],
    ['command', runtimeRequest.command],
    ['environment', runtimeRequest.environment],
    ['credentials', runtimeRequest.credentials],
  ]) {
    if (value !== null) blockers.push(`runtime-request-${field}-must-be-null`);
  }

  if (text(executionProfile.adapterId) !== FIXED_ADAPTER_ID) blockers.push('adapter-id-mismatch');
  if (text(executionProfile.hostId) !== FIXED_HOST_ID) blockers.push('host-id-mismatch');
  if (text(executionProfile.wslDistributionId) !== FIXED_WSL_DISTRIBUTION_ID) blockers.push('wsl-distribution-id-mismatch');
  if (text(executionProfile.containerEngine) !== FIXED_CONTAINER_ENGINE) blockers.push('container-engine-not-rootless-podman');
  if (text(executionProfile.imageRepository) !== FIXED_IMAGE_REPOSITORY) blockers.push('image-repository-mismatch');
  if (text(executionProfile.bindAddress) !== FIXED_BIND_ADDRESS) blockers.push('bind-address-not-loopback');
  if (exactInteger(executionProfile.hostPort) !== FIXED_HOST_PORT) blockers.push('host-port-mismatch');
  if (exactInteger(executionProfile.containerPort) !== FIXED_CONTAINER_PORT) blockers.push('container-port-mismatch');
  if (executionProfile.sshEnabled !== false) blockers.push('ssh-not-disabled');
  if (executionProfile.readOnlyRootFilesystem !== true) blockers.push('root-filesystem-not-read-only');
  if (executionProfile.dropAllCapabilities !== true) blockers.push('capabilities-not-dropped');
  if (executionProfile.noNewPrivileges !== true) blockers.push('no-new-privileges-not-required');
  if (text(executionProfile.dataVolumeId) !== FIXED_DATA_VOLUME_ID) blockers.push('data-volume-id-mismatch');
  if (text(executionProfile.gitSourceUrl) !== FIXED_GIT_SOURCE_URL) blockers.push('git-source-url-mismatch');
  if (text(executionProfile.gitAuthentication) !== 'anonymous-public-read') blockers.push('git-authentication-not-anonymous');
  if (executionProfile.automaticSyncEnabled !== false) blockers.push('automatic-sync-not-disabled');
  if (executionProfile.pushEnabled !== false) blockers.push('push-not-disabled');
  if (executionProfile.forceUpdateEnabled !== false) blockers.push('force-update-not-disabled');
  if (executionProfile.pruneEnabled !== false) blockers.push('prune-not-disabled');
  if (text(executionProfile.backupTargetId) !== backupTargetId) blockers.push('backup-target-id-mismatch');

  const resultBase = Object.freeze({
    schemaVersion: FORGE_SHADOW_INSTALLER_CONTRACT_SCHEMA,
    repository,
    canonicalMainHead,
    authority: authority(),
  });

  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length) {
    return Object.freeze({
      ...resultBase,
      valid: false,
      decision: FORGE_SHADOW_INSTALLER_DECISIONS.BLOCKED,
      blockers: Object.freeze(uniqueBlockers),
      executionRequest: null,
    });
  }

  const core = Object.freeze({
    repository: FIXED_REPOSITORY,
    canonicalMainHead,
    adapterId: FIXED_ADAPTER_ID,
    hostId: FIXED_HOST_ID,
    boundaryId: text(runtimeRequest.boundaryId),
    boundaryKind: FIXED_BOUNDARY_KIND,
    wslDistributionId: FIXED_WSL_DISTRIBUTION_ID,
    containerEngine: FIXED_CONTAINER_ENGINE,
    imageRepository: FIXED_IMAGE_REPOSITORY,
    imageDigest,
    bindAddress: FIXED_BIND_ADDRESS,
    hostPort: FIXED_HOST_PORT,
    containerPort: FIXED_CONTAINER_PORT,
    dataVolumeId: FIXED_DATA_VOLUME_ID,
    backupTargetId,
    gitSourceUrl: FIXED_GIT_SOURCE_URL,
    statusRecord: runtimeRequest.statusRecord,
    proofRecord: runtimeRequest.proofRecord,
    requiredParitySchema: runtimeRequest.requiredParitySchema,
  });

  return Object.freeze({
    ...resultBase,
    valid: true,
    decision: FORGE_SHADOW_INSTALLER_DECISIONS.READY,
    blockers: Object.freeze([]),
    executionRequest: Object.freeze({
      schemaVersion: FORGE_SHADOW_INSTALLER_REQUEST_SCHEMA,
      requestId: requestId(core),
      ...core,
      sourceAuthentication: 'anonymous-public-read',
      automaticSyncEnabled: false,
      pushEnabled: false,
      forceUpdateEnabled: false,
      pruneEnabled: false,
      sshEnabled: false,
      readOnlyRootFilesystem: true,
      dropAllCapabilities: true,
      noNewPrivileges: true,
      exactRuntimeAuthorizationRequired: true,
      executable: null,
      command: null,
      arguments: null,
      environment: null,
      credentials: null,
      paths: null,
      steps: fixedSteps({ canonicalMainHead, imageDigest }),
    }),
  });
}
