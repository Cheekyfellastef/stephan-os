import { createHash } from 'node:crypto';
import {
  FORGE_SHADOW_M3_READY_VERDICT,
  FORGE_SHADOW_M3_REPOSITORY,
  planForgeShadowM3RunnerAdmission,
} from './forgeShadowM3RunnerAdmissionV1.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const TZ = /(?:Z|[+-]\d{2}:\d{2})$/i;
const DAY = 86_400_000;
const MAX_BYTES = 512 * 1024 * 1024;

export const FORGE_SHADOW_M3_RUNTIME_PLAN_SCHEMA = 'stephanos.forge-shadow-m3-runner-runtime-plan.v1';
export const FORGE_SHADOW_M3_RUNTIME_READY = 'FORGE_SHADOW_M3_RUNNER_RUNTIME_PLAN_READY';
export const FORGE_SHADOW_M3_RUNTIME_BLOCKED = 'FORGE_SHADOW_M3_RUNNER_RUNTIME_PLAN_BLOCKED';
export const FORGE_SHADOW_M3_RUNTIME_RECEIPT_SCHEMA = 'stephanos.forge-shadow-m3-runner-runtime-receipt.v1';

const INPUT_KEYS = ['repository', 'canonicalMainHead', 'canonicalMainTree', 'nowUtc', 'admissionInput', 'artifactResolutions'];
const ARTIFACT_KEYS = [
  'artifactId', 'runnerClass', 'sourceIdentity', 'releaseChannel', 'version', 'platform',
  'artifactLogicalId', 'artifactDigest', 'artifactBytes', 'releaseManifestDigest',
  'checksumManifestDigest', 'provenanceDigest', 'resolvedAtUtc', 'proofRefs',
  'tlsVerified', 'releaseManifestVerified', 'checksumVerified',
  'mutableReferenceAccepted', 'credentialUsed',
];
const FORBIDDEN = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'credentials', 'cookie', 'session', 'privatekey', 'publickey', 'selector',
  'javascript', 'password', 'secret', 'secrets', 'dockerhost', 'podmansocket',
  'dockersocket', 'registrationtoken', 'registrationkey',
]);
const CONTRACTS = Object.freeze({
  'linux-isolated': Object.freeze({
    artifactId: 'forge-m3-linux-runner-artifact-v1',
    logicalId: 'forgejo-runner-linux-amd64',
    platform: 'linux/amd64',
    boundary: 'forge-linux-rootless-ephemeral',
    prefix: 'stephanos-forge-linux-runner-',
    labels: Object.freeze(['self-hosted', 'linux', 'x64', 'stephanos-forge', 'ephemeral']),
  }),
  'windows-proof-isolated': Object.freeze({
    artifactId: 'forge-m3-windows-proof-runner-artifact-v1',
    logicalId: 'forgejo-runner-windows-amd64',
    platform: 'windows/amd64',
    boundary: 'battle-bridge-windows-proof-sandbox',
    prefix: 'stephanos-forge-windows-proof-runner-',
    labels: Object.freeze(['self-hosted', 'windows', 'x64', 'stephanos-forge', 'proof-only', 'ephemeral']),
  }),
});
const STEPS = Object.freeze([
  'VERIFY_CURRENT_M2_AND_M3_ADMISSION_EVIDENCE',
  'VERIFY_OFFICIAL_IMMUTABLE_RUNNER_ARTIFACTS',
  'CREATE_ISOLATED_EPHEMERAL_RUNTIME_BOUNDARIES',
  'INSTALL_FIXED_RUNNER_ARTIFACTS',
  'ISSUE_CONTAINED_ONE_TIME_LOCAL_REGISTRATION_CREDENTIALS',
  'REGISTER_FIXED_RUNNER_IDENTITIES',
  'RUN_BOUNDED_ISOLATION_CANARY',
  'PUBLISH_IMMUTABLE_CONTENT_ADDRESSED_PROOFS',
  'UNREGISTER_RUNNER_IDENTITIES',
  'DESTROY_EPHEMERAL_WORKSPACES_AND_RUNTIME_BOUNDARIES',
  'PROVE_ZERO_RESIDUAL_CREDENTIAL_OR_AUTHORITY_STATE',
]);

const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const integer = (value) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN);
function instant(value) {
  const normalized = text(value);
  const parsed = TZ.test(normalized) ? Date.parse(normalized) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function findForbidden(value, trail = []) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, nested] of Object.entries(value)) {
    const next = [...trail, key];
    if (FORBIDDEN.has(key.toLowerCase())) return next.join('.');
    if (Array.isArray(nested)) {
      for (let index = 0; index < nested.length; index += 1) {
        const found = findForbidden(nested[index], [...next, String(index)]);
        if (found) return found;
      }
    } else {
      const found = findForbidden(nested, next);
      if (found) return found;
    }
  }
  return '';
}
function safeRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  const refs = unique(value.map(text).filter(Boolean)).sort();
  return refs.length === value.length && refs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'))
    ? Object.freeze(refs) : null;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const sha256 = (value) => createHash('sha256').update(stable(value), 'utf8').digest('hex');

function validateAdmission(input, repository, head, tree, nowUtc, blockers) {
  let plan;
  try { plan = planForgeShadowM3RunnerAdmission(input); }
  catch { blockers.push('admission-planner-threw'); return null; }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    blockers.push('admission-plan-invalid'); return null;
  }
  if (plan.valid !== true || plan.decision !== FORGE_SHADOW_M3_READY_VERDICT
      || plan.finalVerdict !== FORGE_SHADOW_M3_READY_VERDICT) blockers.push('admission-not-ready');
  if (plan.repository !== repository) blockers.push('admission-repository-mismatch');
  if (text(plan.canonicalMainHead).toLowerCase() !== head) blockers.push('admission-head-mismatch');
  if (text(plan.canonicalMainTree).toLowerCase() !== tree) blockers.push('admission-tree-mismatch');
  if (text(input?.nowUtc) !== nowUtc) blockers.push('admission-now-mismatch');
  if (!Array.isArray(plan.blockers) || plan.blockers.length) blockers.push('admission-blockers-present');
  if (!plan.m2Evidence || text(plan.m2Evidence.sourceHead).toLowerCase() !== head
      || text(plan.m2Evidence.sourceTree).toLowerCase() !== tree) blockers.push('admission-m2-parity-invalid');
  const authority = plan.authority || {};
  for (const [key, value] of Object.entries(authority)) {
    if (key === 'separateRuntimeAuthorizationRequired' ? value !== true : value !== false) {
      blockers.push(`admission-authority-invalid:${key}`);
    }
  }
  if (authority.separateRuntimeAuthorizationRequired !== true) blockers.push('admission-runtime-authorization-not-required');
  if (!Array.isArray(plan.runnerPools) || plan.runnerPools.length !== 2) {
    blockers.push('admission-runner-estate-invalid'); return null;
  }
  const pools = plan.runnerPools.map((pool) => {
    const runnerClass = text(pool?.runnerClass).toLowerCase();
    const contract = CONTRACTS[runnerClass];
    if (!contract) blockers.push(`admission-runner-class-invalid:${runnerClass || 'unknown'}`);
    if (!SAFE_ID.test(text(pool?.poolId))) blockers.push(`admission-runner-id-invalid:${runnerClass || 'unknown'}`);
    if (!Number.isSafeInteger(integer(pool?.count)) || integer(pool?.count) < 1) blockers.push(`admission-runner-count-invalid:${runnerClass || 'unknown'}`);
    if (contract && pool?.runtimeBoundary !== contract.boundary) blockers.push(`admission-runner-boundary-invalid:${runnerClass}`);
    if (!DIGEST.test(text(pool?.runtimeArtifactDigest).toLowerCase())) blockers.push(`admission-runner-artifact-invalid:${runnerClass}`);
    if (pool?.executed !== false || pool?.registrationAllowed !== false
        || pool?.requiresSeparateRuntimeAuthorization !== true) blockers.push(`admission-runner-authority-invalid:${runnerClass}`);
    return Object.freeze({
      poolId: text(pool?.poolId), runnerClass, count: integer(pool?.count),
      runtimeBoundary: text(pool?.runtimeBoundary),
      runtimeArtifactDigest: text(pool?.runtimeArtifactDigest).toLowerCase(),
      workloadIds: Object.freeze(Array.isArray(pool?.workloadIds) ? [...pool.workloadIds].map(text).sort() : []),
    });
  }).sort((left, right) => left.runnerClass.localeCompare(right.runnerClass));
  const classes = pools.map((pool) => pool.runnerClass);
  if (new Set(classes).size !== 2) blockers.push('admission-runner-class-duplicate');
  for (const runnerClass of Object.keys(CONTRACTS)) {
    if (!classes.includes(runnerClass)) blockers.push(`admission-runner-class-required:${runnerClass}`);
  }
  return blockers.length ? null : Object.freeze({ m2Evidence: plan.m2Evidence, pools });
}

function validateArtifact(value, nowMs, blockers) {
  const runnerClass = text(value?.runnerClass).toLowerCase();
  const contract = CONTRACTS[runnerClass];
  const id = text(value?.artifactId) || runnerClass || 'unknown';
  const resolvedMs = instant(value?.resolvedAtUtc);
  const refs = safeRefs(value?.proofRefs);
  if (!exactKeys(value, ARTIFACT_KEYS)) blockers.push(`artifact-fields-invalid:${id}`);
  if (!contract) blockers.push(`artifact-runner-class-invalid:${id}`);
  if (!SAFE_ID.test(text(value?.artifactId))) blockers.push(`artifact-id-invalid:${id}`);
  if (contract && value?.artifactId !== contract.artifactId) blockers.push(`artifact-id-mismatch:${id}`);
  if (value?.sourceIdentity !== 'forgejo-official-runner-release') blockers.push(`artifact-source-mismatch:${id}`);
  if (value?.releaseChannel !== 'stable' || !SEMVER.test(text(value?.version))) blockers.push(`artifact-version-invalid:${id}`);
  if (contract && (value?.platform !== contract.platform || value?.artifactLogicalId !== contract.logicalId)) blockers.push(`artifact-identity-mismatch:${id}`);
  for (const key of ['artifactDigest', 'releaseManifestDigest', 'checksumManifestDigest', 'provenanceDigest']) {
    if (!DIGEST.test(text(value?.[key]).toLowerCase())) blockers.push(`artifact-digest-invalid:${key}:${id}`);
  }
  const bytes = integer(value?.artifactBytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > MAX_BYTES) blockers.push(`artifact-size-invalid:${id}`);
  if (!Number.isFinite(resolvedMs)) blockers.push(`artifact-time-invalid:${id}`);
  else if (resolvedMs > nowMs || nowMs - resolvedMs > DAY) blockers.push(`artifact-time-out-of-bounds:${id}`);
  if (!refs) blockers.push(`artifact-proof-refs-invalid:${id}`);
  if (value?.tlsVerified !== true || value?.releaseManifestVerified !== true || value?.checksumVerified !== true) blockers.push(`artifact-verification-incomplete:${id}`);
  if (value?.mutableReferenceAccepted !== false) blockers.push(`artifact-mutable-reference-forbidden:${id}`);
  if (value?.credentialUsed !== false) blockers.push(`artifact-credential-use-forbidden:${id}`);
  return Object.freeze({
    artifactId: text(value?.artifactId), runnerClass, version: text(value?.version),
    platform: text(value?.platform), artifactLogicalId: text(value?.artifactLogicalId),
    artifactDigest: text(value?.artifactDigest).toLowerCase(), artifactBytes: bytes,
    releaseManifestDigest: text(value?.releaseManifestDigest).toLowerCase(),
    checksumManifestDigest: text(value?.checksumManifestDigest).toLowerCase(),
    provenanceDigest: text(value?.provenanceDigest).toLowerCase(),
    resolvedAtUtc: Number.isFinite(resolvedMs) ? new Date(resolvedMs).toISOString() : '',
    proofRefs: refs || Object.freeze([]),
  });
}

function authority() {
  return Object.freeze({
    artifactNetworkFetch: false, runnerInstallation: false, runnerRegistration: false,
    runnerExecution: false, workflowExecution: false, sourceMutation: false,
    gitRefWrite: false, hostProcessAccess: false, canonicalCheckoutAccess: false,
    containerSocketAccess: false, githubCredentialAccess: false, secretAccess: false,
    publicExposure: false, tailscaleExposure: false, merge: false, deployment: false,
    arbitraryCommand: false, separateRuntimeAuthorizationRequired: true,
  });
}

export function planForgeShadowM3RunnerRuntime(input = {}) {
  const blockers = [];
  const unsafe = findForbidden(input);
  if (unsafe) blockers.push(`unsafe-field:${unsafe}`);
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');
  const repository = text(input.repository);
  const head = text(input.canonicalMainHead).toLowerCase();
  const tree = text(input.canonicalMainTree).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = instant(nowUtc);
  if (repository !== FORGE_SHADOW_M3_REPOSITORY) blockers.push('repository-mismatch');
  if (!SHA.test(head)) blockers.push('canonical-main-head-invalid');
  if (!SHA.test(tree)) blockers.push('canonical-main-tree-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');

  const admission = validateAdmission(input.admissionInput, repository, head, tree, nowUtc, blockers);
  const rawArtifacts = Array.isArray(input.artifactResolutions) ? input.artifactResolutions : null;
  if (!rawArtifacts || rawArtifacts.length !== 2) blockers.push('artifact-estate-must-be-exactly-two');
  const artifacts = (rawArtifacts || []).map((item) => validateArtifact(item, nowMs, blockers))
    .sort((left, right) => left.runnerClass.localeCompare(right.runnerClass));
  const classes = artifacts.map((artifact) => artifact.runnerClass);
  if (new Set(classes).size !== classes.length) blockers.push('artifact-runner-class-duplicate');
  for (const runnerClass of Object.keys(CONTRACTS)) {
    if (!classes.includes(runnerClass)) blockers.push(`artifact-runner-class-required:${runnerClass}`);
  }
  if (artifacts.length === 2 && (artifacts[0].version !== artifacts[1].version
      || artifacts[0].releaseManifestDigest !== artifacts[1].releaseManifestDigest)) {
    blockers.push('artifact-release-set-mismatch');
  }
  if (admission) for (const pool of admission.pools) {
    const artifact = artifacts.find((item) => item.runnerClass === pool.runnerClass);
    if (!artifact || artifact.artifactDigest !== pool.runtimeArtifactDigest) blockers.push(`artifact-admission-digest-mismatch:${pool.runnerClass}`);
  }

  const runners = admission ? admission.pools.flatMap((pool) => {
    const contract = CONTRACTS[pool.runnerClass];
    return Array.from({ length: pool.count }, (_, index) => Object.freeze({
      runnerId: `${contract.prefix}${String(index + 1).padStart(2, '0')}`,
      poolId: pool.poolId, runnerClass: pool.runnerClass,
      runtimeBoundary: pool.runtimeBoundary, forgeService: 'stephanos-forge-shadow',
      forgeListener: '127.0.0.1:3340', registrationMode: 'one-time-local-contained',
      labels: contract.labels, workloadIds: pool.workloadIds,
      installed: false, registered: false, connected: false, executed: false,
      requiresSeparateRuntimeAuthorization: true,
    }));
  }) : [];
  const artifactSetDigest = artifacts.length === 2 && !blockers.length ? sha256(artifacts) : '';
  const valid = blockers.length === 0;
  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_PLAN_SCHEMA, valid, repository,
    canonicalMainHead: head, canonicalMainTree: tree,
    decision: valid ? FORGE_SHADOW_M3_RUNTIME_READY : FORGE_SHADOW_M3_RUNTIME_BLOCKED,
    blockers: Object.freeze(unique(blockers)),
    admissionEvidence: valid ? admission.m2Evidence : null,
    runnerArtifacts: Object.freeze(artifacts), artifactSetDigest,
    runners: Object.freeze(runners),
    executionPlan: Object.freeze(STEPS.map((operation, index) => Object.freeze({
      sequence: index + 1, operation, executed: false, requiresSeparateRuntimeAuthorization: true,
    }))),
    teardownPolicy: Object.freeze({
      unregisterAfterCanary: true, unregisterAfterEveryJob: true,
      revokeOneTimeRegistrationMaterial: true, destroyWorkspaceAfterEveryJob: true,
      destroyRuntimeBoundaryAfterEveryJob: true, preserveOnlyImmutableProofArtifacts: true,
      maximumTeardownSeconds: 300, quarantineOnTeardownFailure: true,
      zeroResidualRegistrationRequired: true, zeroResidualCredentialRequired: true,
      zeroResidualWorkspaceRequired: true,
    }),
    proofPolicy: Object.freeze({
      receiptSchema: FORGE_SHADOW_M3_RUNTIME_RECEIPT_SCHEMA,
      exactHeadAndTreeBindingRequired: true, artifactSetDigestRequired: true,
      fixedRunnerIdentityRequired: true, teardownProofRequired: true,
      zeroResidualAuthorityProofRequired: true, credentialMaterialForbidden: true,
      immutableContentAddressedArtifactsRequired: true,
    }),
    authority: authority(),
    finalVerdict: valid ? FORGE_SHADOW_M3_RUNTIME_READY : FORGE_SHADOW_M3_RUNTIME_BLOCKED,
  });
}
