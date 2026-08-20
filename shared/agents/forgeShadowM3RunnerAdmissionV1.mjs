const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

export const FORGE_SHADOW_M3_RUNNER_ADMISSION_SCHEMA = 'stephanos.forge-shadow-m3-runner-admission.v1';
export const FORGE_SHADOW_M3_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const FORGE_SHADOW_M3_ISSUE = 1507;
export const FORGE_SHADOW_M2_OPERATION = 'INSTALL_FORGE_SHADOW_M2';
export const FORGE_SHADOW_M2_VERDICT = 'FORGE_SHADOW_M2_READY';
export const FORGE_SHADOW_M3_READY_VERDICT = 'FORGE_SHADOW_M3_RUNNER_ADMISSION_PLAN_READY';
export const FORGE_SHADOW_M3_BLOCKED_VERDICT = 'FORGE_SHADOW_M3_RUNNER_ADMISSION_BLOCKED';

const RECEIPT_SCHEMA = 'stephanos.battle-bridge-github-command-receipt.v1';
const FORGEJO_VERSION = '15.0.6';
const PODMAN_VERSION = '6.0.2';
const RUNTIME_BOUNDARY = 'podman-wsl-rootless';
const MACHINE = 'stephanos-forge-shadow';
const LISTENER = '127.0.0.1:3340';
const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

const TOP_LEVEL_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'canonicalMainTree',
  'nowUtc',
  'm2Receipt',
  'runnerPools',
]);

const RUNNER_POOL_KEYS = Object.freeze([
  'poolId',
  'runnerClass',
  'count',
  'runtimeBoundary',
  'runtimeArtifactDigest',
  'workloadIds',
  'cpuLimit',
  'memoryMiB',
  'diskMiB',
  'maxJobMinutes',
  'maxConcurrentJobs',
  'artifactRetentionDays',
  'maxArtifactBytes',
  'workspacePolicy',
  'artifactPolicy',
  'networkPolicy',
  'registrationMode',
  'ephemeralWorkspace',
  'limitedUser',
  'privileged',
  'hostNetwork',
  'hostProcessAccess',
  'canonicalCheckoutMounted',
  'containerSocketMounted',
  'githubCredentialAvailable',
  'persistentSecrets',
  'publicInbound',
  'tailscaleInbound',
  'sourceMutationAuthority',
  'mergeAuthority',
  'deploymentAuthority',
  'registrationRequested',
  'executed',
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'cookie', 'session', 'privatekey', 'publickey', 'selector', 'javascript',
  'password', 'secret', 'secrets', 'dockerhost', 'podmansocket', 'dockersocket',
]);

const RUNNER_CONTRACTS = Object.freeze({
  'linux-isolated': Object.freeze({
    runtimeBoundary: 'forge-linux-rootless-ephemeral',
    countMin: 1,
    countMax: 5,
    cpuMin: 1,
    cpuMax: 4,
    memoryMin: 1024,
    memoryMax: 8192,
    diskMin: 4096,
    diskMax: 32768,
    minutesMin: 5,
    minutesMax: 60,
    concurrencyMin: 1,
    concurrencyMax: 5,
    networkPolicy: 'forge-loopback-and-approved-readonly-egress',
    workloads: Object.freeze(new Set([
      'linux-shared-agent-tests',
      'linux-stephanos-ui-build',
      'linux-source-integrity-proof',
    ])),
  }),
  'windows-proof-isolated': Object.freeze({
    runtimeBoundary: 'battle-bridge-windows-proof-sandbox',
    countMin: 1,
    countMax: 1,
    cpuMin: 1,
    cpuMax: 4,
    memoryMin: 2048,
    memoryMax: 8192,
    diskMin: 4096,
    diskMax: 32768,
    minutesMin: 5,
    minutesMax: 90,
    concurrencyMin: 1,
    concurrencyMax: 1,
    networkPolicy: 'battle-bridge-loopback-and-approved-readonly-egress',
    workloads: Object.freeze(new Set([
      'windows-source-controlled-proof',
      'windows-edge-runtime-proof',
    ])),
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
}

function parseInstant(value) {
  const normalized = text(value);
  if (!EXPLICIT_TIMEZONE.test(normalized)) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function unique(values) {
  return [...new Set(values)];
}

function sameKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function findForbiddenField(value, trail = []) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], [...trail, String(index)]);
      if (found) return found;
    }
    return null;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase())) {
      return Object.freeze({ field: key, trail: [...trail, key].join('.') });
    }
    const found = findForbiddenField(nested, [...trail, key]);
    if (found) return found;
  }
  return null;
}

function safeProofRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const refs = unique(value.map(text).filter(Boolean)).sort();
  return refs.length === value.length && refs.every((ref) => SAFE_PROOF_REF.test(ref) && !ref.includes('..'))
    ? Object.freeze(refs)
    : null;
}

function authorityProjection() {
  return Object.freeze({
    sourceMutation: false,
    gitRefWrite: false,
    runnerRegistration: false,
    runnerExecution: false,
    workflowExecution: false,
    hostProcessAccess: false,
    canonicalCheckoutAccess: false,
    containerSocketAccess: false,
    githubCredentialAccess: false,
    secretAccess: false,
    merge: false,
    deployment: false,
    arbitraryCommand: false,
    separateRuntimeAuthorizationRequired: true,
  });
}

function normalizeM2Receipt(receipt, expectedHead, expectedTree, nowMs) {
  const blockers = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze({ valid: false, blockers: Object.freeze(['m2-receipt-invalid']), receipt: null });
  }

  const requestId = text(receipt.requestId);
  const expectedReceiptHead = text(receipt.expectedHead).toLowerCase();
  const imageDigest = text(receipt.forgejoImageDigest).toLowerCase();
  const proofRefs = safeProofRefs(receipt.proofRefs);
  const acceptedMs = parseInstant(receipt.acceptedAt);
  const heartbeatMs = parseInstant(receipt.heartbeatAt);
  const completedMs = parseInstant(receipt.completedAt);
  const execution = receipt.result;
  const result = execution?.result;
  const sourceHead = text(result?.sourceHead).toLowerCase();
  const sourceTree = text(result?.canonicalTree).toLowerCase();
  const mirrorHead = text(result?.mirrorHead).toLowerCase();
  const mirrorTree = text(result?.mirrorTree).toLowerCase();
  const installerBlob = text(result?.installerBlob).toLowerCase();
  const backupDigest = text(result?.backupDigest).toLowerCase();
  const backupVolume = text(result?.backupVolume);
  const expectedBackupVolume = SHA256.test(backupDigest)
    ? `stephanos-forge-shadow-backup-${backupDigest.slice(0, 16)}`
    : '';

  if (receipt.schemaVersion !== RECEIPT_SCHEMA) blockers.push('m2-receipt-schema-mismatch');
  if (!SAFE_ID.test(requestId)) blockers.push('m2-receipt-request-id-invalid');
  if (receipt.operation !== FORGE_SHADOW_M2_OPERATION) blockers.push('m2-receipt-operation-mismatch');
  if (receipt.repository !== FORGE_SHADOW_M3_REPOSITORY) blockers.push('m2-receipt-repository-mismatch');
  if (Number(receipt.issueNumber) !== FORGE_SHADOW_M3_ISSUE) blockers.push('m2-receipt-issue-mismatch');
  if (receipt.branch !== 'main') blockers.push('m2-receipt-branch-mismatch');
  if (expectedReceiptHead !== expectedHead) blockers.push('m2-receipt-head-mismatch');
  if (receipt.forgejoVersion !== FORGEJO_VERSION) blockers.push('m2-receipt-forgejo-version-mismatch');
  if (!DIGEST.test(imageDigest)) blockers.push('m2-receipt-image-digest-invalid');
  if (receipt.runtimeBoundary !== RUNTIME_BOUNDARY) blockers.push('m2-receipt-runtime-boundary-mismatch');
  if (receipt.m2Only !== true) blockers.push('m2-receipt-m2-only-required');
  if (receipt.state !== 'DONE') blockers.push('m2-receipt-state-not-done');
  if (text(receipt.blocker)) blockers.push('m2-receipt-blocker-present');
  if (!proofRefs) blockers.push('m2-receipt-proof-refs-invalid');
  if (receipt.arbitraryShellAllowed !== false) blockers.push('m2-receipt-arbitrary-shell-not-denied');
  if (receipt.destructiveGitAllowed !== false) blockers.push('m2-receipt-destructive-git-not-denied');
  if (receipt.credentialsMayBeReadOrExported !== false) blockers.push('m2-receipt-credential-export-not-denied');

  if (!Number.isFinite(acceptedMs) || !Number.isFinite(heartbeatMs) || !Number.isFinite(completedMs)) {
    blockers.push('m2-receipt-time-invalid');
  } else {
    if (!(acceptedMs <= heartbeatMs && heartbeatMs <= completedMs)) blockers.push('m2-receipt-time-order-invalid');
    if (completedMs > nowMs) blockers.push('m2-receipt-completed-in-future');
    if (nowMs - completedMs > MAX_RECEIPT_AGE_MS) blockers.push('m2-receipt-stale');
  }

  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
    blockers.push('m2-execution-envelope-invalid');
  } else {
    if (execution.ok !== true) blockers.push('m2-execution-not-ok');
    if (execution.verdict !== 'COMMAND_EXECUTION_COMPLETE') blockers.push('m2-execution-verdict-invalid');
    if (execution.operation !== FORGE_SHADOW_M2_OPERATION) blockers.push('m2-execution-operation-mismatch');
    if (text(execution.requestId) !== requestId) blockers.push('m2-execution-request-id-mismatch');
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    blockers.push('m2-result-invalid');
  } else {
    if (result.ok !== true) blockers.push('m2-result-not-ok');
    if (text(result.blocker)) blockers.push('m2-result-blocker-present');
    if (result.finalVerdict !== FORGE_SHADOW_M2_VERDICT) blockers.push('m2-result-verdict-invalid');
    if (result.repository !== FORGE_SHADOW_M3_REPOSITORY) blockers.push('m2-result-repository-mismatch');
    if (sourceHead !== expectedHead || mirrorHead !== expectedHead) blockers.push('m2-result-head-parity-failed');
    if (sourceTree !== expectedTree || mirrorTree !== expectedTree) blockers.push('m2-result-tree-parity-failed');
    if (!SHA40.test(installerBlob)) blockers.push('m2-result-installer-blob-invalid');
    if (result.forgejoVersion !== FORGEJO_VERSION) blockers.push('m2-result-forgejo-version-mismatch');
    if (result.podmanVersion !== PODMAN_VERSION) blockers.push('m2-result-podman-version-mismatch');
    if (text(result.forgejoImageDigest).toLowerCase() !== imageDigest) blockers.push('m2-result-image-digest-mismatch');
    if (result.runtimeBoundary !== RUNTIME_BOUNDARY) blockers.push('m2-result-runtime-boundary-mismatch');
    if (result.machine !== MACHINE || result.podmanConnection !== MACHINE || result.container !== MACHINE) {
      blockers.push('m2-result-runtime-identity-mismatch');
    }
    if (result.listener !== LISTENER) blockers.push('m2-result-listener-mismatch');
    if (!SHA256.test(backupDigest) || backupVolume !== expectedBackupVolume) blockers.push('m2-result-backup-identity-invalid');
    if (result.restoreDrillPassed !== true) blockers.push('m2-result-restore-proof-missing');
    if (result.rootFilesystemReadOnly !== true) blockers.push('m2-result-readonly-rootfs-missing');
    if (result.allCapabilitiesDropped !== true) blockers.push('m2-result-capability-seal-missing');
    if (result.noNewPrivileges !== true) blockers.push('m2-result-no-new-privileges-missing');
    if (result.githubCredentialUsed !== false) blockers.push('m2-result-github-credential-used');
    if (result.credentialPersisted !== false || result.credentialLogged !== false) blockers.push('m2-result-credential-containment-failed');
    if (result.runnerRegistration !== false) blockers.push('m2-result-runner-registration-already-enabled');
    if (result.actionsExecution !== false) blockers.push('m2-result-actions-execution-already-enabled');
    if (result.mergeAuthority !== false) blockers.push('m2-result-merge-authority-present');
    if (result.readyForM3 !== true) blockers.push('m2-result-not-ready-for-m3');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(unique(blockers)),
    receipt: blockers.length ? null : Object.freeze({
      requestId,
      completedAtUtc: new Date(completedMs).toISOString(),
      sourceHead,
      sourceTree,
      forgejoImageDigest: imageDigest,
      backupDigest,
      backupVolume,
      proofRefs,
    }),
  });
}

function normalizeRunnerPool(pool, blockers) {
  const poolId = text(pool?.poolId);
  const runnerClass = text(pool?.runnerClass).toLowerCase();
  const contract = RUNNER_CONTRACTS[runnerClass];
  const workloadIds = Array.isArray(pool?.workloadIds)
    ? unique(pool.workloadIds.map(text).filter(Boolean)).sort()
    : null;
  const prefix = poolId || runnerClass || 'unknown';

  if (!sameKeys(pool, RUNNER_POOL_KEYS)) blockers.push(`runner-pool-fields-invalid:${prefix}`);
  if (!SAFE_ID.test(poolId)) blockers.push(`runner-pool-id-invalid:${prefix}`);
  if (!contract) blockers.push(`runner-class-invalid:${prefix}`);

  if (contract) {
    if (pool.runtimeBoundary !== contract.runtimeBoundary) blockers.push(`runner-runtime-boundary-mismatch:${prefix}`);
    if (pool.networkPolicy !== contract.networkPolicy) blockers.push(`runner-network-policy-mismatch:${prefix}`);
  }
  if (!DIGEST.test(text(pool?.runtimeArtifactDigest).toLowerCase())) blockers.push(`runner-artifact-digest-invalid:${prefix}`);
  if (!workloadIds || workloadIds.length < 1 || workloadIds.length > 3) blockers.push(`runner-workloads-invalid:${prefix}`);
  else if (contract && workloadIds.some((id) => !contract.workloads.has(id))) blockers.push(`runner-workload-not-allowed:${prefix}`);

  const count = integer(pool?.count);
  const cpuLimit = integer(pool?.cpuLimit);
  const memoryMiB = integer(pool?.memoryMiB);
  const diskMiB = integer(pool?.diskMiB);
  const maxJobMinutes = integer(pool?.maxJobMinutes);
  const maxConcurrentJobs = integer(pool?.maxConcurrentJobs);
  const artifactRetentionDays = integer(pool?.artifactRetentionDays);
  const maxArtifactBytes = integer(pool?.maxArtifactBytes);

  if (contract && (!Number.isSafeInteger(count) || count < contract.countMin || count > contract.countMax)) blockers.push(`runner-count-out-of-bounds:${prefix}`);
  if (contract && (!Number.isSafeInteger(cpuLimit) || cpuLimit < contract.cpuMin || cpuLimit > contract.cpuMax)) blockers.push(`runner-cpu-out-of-bounds:${prefix}`);
  if (contract && (!Number.isSafeInteger(memoryMiB) || memoryMiB < contract.memoryMin || memoryMiB > contract.memoryMax)) blockers.push(`runner-memory-out-of-bounds:${prefix}`);
  if (contract && (!Number.isSafeInteger(diskMiB) || diskMiB < contract.diskMin || diskMiB > contract.diskMax)) blockers.push(`runner-disk-out-of-bounds:${prefix}`);
  if (contract && (!Number.isSafeInteger(maxJobMinutes) || maxJobMinutes < contract.minutesMin || maxJobMinutes > contract.minutesMax)) blockers.push(`runner-job-time-out-of-bounds:${prefix}`);
  if (contract && (!Number.isSafeInteger(maxConcurrentJobs) || maxConcurrentJobs < contract.concurrencyMin || maxConcurrentJobs > contract.concurrencyMax)) blockers.push(`runner-concurrency-out-of-bounds:${prefix}`);
  if (!Number.isSafeInteger(artifactRetentionDays) || artifactRetentionDays < 1 || artifactRetentionDays > 30) blockers.push(`runner-artifact-retention-out-of-bounds:${prefix}`);
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1024 || maxArtifactBytes > MAX_ARTIFACT_BYTES) blockers.push(`runner-artifact-size-out-of-bounds:${prefix}`);

  if (pool?.workspacePolicy !== 'ephemeral-per-job') blockers.push(`runner-workspace-policy-invalid:${prefix}`);
  if (pool?.artifactPolicy !== 'immutable-content-addressed') blockers.push(`runner-artifact-policy-invalid:${prefix}`);
  if (pool?.registrationMode !== 'disabled-pending-runtime-authorization') blockers.push(`runner-registration-mode-invalid:${prefix}`);
  if (pool?.ephemeralWorkspace !== true) blockers.push(`runner-ephemeral-workspace-required:${prefix}`);
  if (pool?.limitedUser !== true) blockers.push(`runner-limited-user-required:${prefix}`);
  if (pool?.privileged !== false) blockers.push(`runner-privilege-expansion-forbidden:${prefix}`);
  if (pool?.hostNetwork !== false) blockers.push(`runner-host-network-forbidden:${prefix}`);
  if (pool?.hostProcessAccess !== false) blockers.push(`runner-host-process-access-forbidden:${prefix}`);
  if (pool?.canonicalCheckoutMounted !== false) blockers.push(`runner-canonical-checkout-mount-forbidden:${prefix}`);
  if (pool?.containerSocketMounted !== false) blockers.push(`runner-container-socket-mount-forbidden:${prefix}`);
  if (pool?.githubCredentialAvailable !== false) blockers.push(`runner-github-credential-forbidden:${prefix}`);
  if (pool?.persistentSecrets !== false) blockers.push(`runner-persistent-secrets-forbidden:${prefix}`);
  if (pool?.publicInbound !== false) blockers.push(`runner-public-inbound-forbidden:${prefix}`);
  if (pool?.tailscaleInbound !== false) blockers.push(`runner-tailscale-inbound-forbidden:${prefix}`);
  if (pool?.sourceMutationAuthority !== false) blockers.push(`runner-source-mutation-authority-forbidden:${prefix}`);
  if (pool?.mergeAuthority !== false) blockers.push(`runner-merge-authority-forbidden:${prefix}`);
  if (pool?.deploymentAuthority !== false) blockers.push(`runner-deployment-authority-forbidden:${prefix}`);
  if (pool?.registrationRequested !== false) blockers.push(`runner-registration-request-forbidden:${prefix}`);
  if (pool?.executed !== false) blockers.push(`runner-execution-forbidden:${prefix}`);

  return Object.freeze({
    poolId,
    runnerClass,
    count,
    runtimeBoundary: text(pool?.runtimeBoundary),
    runtimeArtifactDigest: text(pool?.runtimeArtifactDigest).toLowerCase(),
    workloadIds: Object.freeze(workloadIds || []),
    resourceEnvelope: Object.freeze({
      cpuLimit,
      memoryMiB,
      diskMiB,
      maxJobMinutes,
      maxConcurrentJobs,
      artifactRetentionDays,
      maxArtifactBytes,
    }),
    workspacePolicy: text(pool?.workspacePolicy),
    artifactPolicy: text(pool?.artifactPolicy),
    networkPolicy: text(pool?.networkPolicy),
    registrationMode: text(pool?.registrationMode),
    executed: false,
    registrationAllowed: false,
    requiresSeparateRuntimeAuthorization: true,
  });
}

export function planForgeShadowM3RunnerAdmission(input = {}) {
  const blockers = [];
  const unsafe = findForbiddenField(input);
  if (unsafe) blockers.push(`unsafe-field:${unsafe.trail}`);
  if (!sameKeys(input, TOP_LEVEL_KEYS)) blockers.push('input-fields-invalid');

  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(input.canonicalMainTree).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = parseInstant(nowUtc);

  if (repository !== FORGE_SHADOW_M3_REPOSITORY) blockers.push('repository-mismatch');
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA40.test(canonicalMainTree)) blockers.push('canonical-main-tree-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');

  const m2 = normalizeM2Receipt(input.m2Receipt, canonicalMainHead, canonicalMainTree, nowMs);
  blockers.push(...m2.blockers);

  const pools = Array.isArray(input.runnerPools) ? input.runnerPools : null;
  if (!pools || pools.length !== 2) blockers.push('runner-pool-estate-must-be-exactly-two');
  const normalizedPools = (pools || []).map((pool) => normalizeRunnerPool(pool, blockers));

  const ids = normalizedPools.map((pool) => pool.poolId);
  const classes = normalizedPools.map((pool) => pool.runnerClass);
  if (new Set(ids).size !== ids.length) blockers.push('runner-pool-id-duplicate');
  if (new Set(classes).size !== classes.length) blockers.push('runner-class-duplicate');
  for (const requiredClass of Object.keys(RUNNER_CONTRACTS)) {
    if (!classes.includes(requiredClass)) blockers.push(`runner-class-required:${requiredClass}`);
  }

  normalizedPools.sort((left, right) => left.runnerClass.localeCompare(right.runnerClass));
  const authority = authorityProjection();
  const valid = blockers.length === 0;

  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_RUNNER_ADMISSION_SCHEMA,
    valid,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    decision: valid ? FORGE_SHADOW_M3_READY_VERDICT : FORGE_SHADOW_M3_BLOCKED_VERDICT,
    blockers: Object.freeze(unique(blockers)),
    m2Evidence: valid ? m2.receipt : null,
    runnerPools: Object.freeze(normalizedPools),
    authority,
    finalVerdict: valid ? FORGE_SHADOW_M3_READY_VERDICT : FORGE_SHADOW_M3_BLOCKED_VERDICT,
  });
}
