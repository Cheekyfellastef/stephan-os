const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FIXED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

export const FORGE_SHADOW_PARITY_SCHEMA = 'stephanos.forge-shadow-parity.v1';
export const FORGE_SHADOW_PARITY_DECISIONS = Object.freeze({
  BLOCKED: 'FORGE_SHADOW_BLOCKED',
  PARITY_REQUIRED: 'FORGE_SHADOW_PARITY_REQUIRED',
  BACKUP_REQUIRED: 'FORGE_SHADOW_BACKUP_REQUIRED',
  READY: 'FORGE_SHADOW_READ_ONLY_READY',
});

function text(value) {
  return String(value ?? '').trim();
}

function instant(value) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return EXPLICIT_TIMEZONE.test(normalized) && Number.isFinite(parsed) ? parsed : Number.NaN;
}

function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
}

function authority() {
  return Object.freeze({
    sourceMutation: false,
    githubRefWrite: false,
    forgeRefWrite: false,
    forcePush: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    runnerRegistration: false,
    credentialCreation: false,
    publicExposure: false,
    arbitraryCommand: false,
  });
}

export function evaluateForgeShadowParity(input = {}) {
  const repository = text(input.repository);
  const nowMs = instant(input.nowUtc);
  const maxObservationAgeMs = integer(input.maxObservationAgeMs ?? 10 * 60 * 1000);
  const maxBackupAgeMs = integer(input.maxBackupAgeMs ?? 24 * 60 * 60 * 1000);
  const github = input.github && typeof input.github === 'object' ? input.github : {};
  const forge = input.forge && typeof input.forge === 'object' ? input.forge : {};
  const backup = input.backup && typeof input.backup === 'object' ? input.backup : {};
  const githubHead = text(github.head).toLowerCase();
  const githubTree = text(github.tree).toLowerCase();
  const forgeHead = text(forge.head).toLowerCase();
  const forgeTree = text(forge.tree).toLowerCase();
  const observedAtMs = instant(forge.observedAtUtc);
  const backupAtMs = instant(backup.completedAtUtc);
  const blockers = [];

  if (repository !== FIXED_REPOSITORY) blockers.push('repository-not-allowlisted');
  for (const [label, value] of [
    ['github-head', githubHead],
    ['github-tree', githubTree],
    ['forge-head', forgeHead],
    ['forge-tree', forgeTree],
    ['backup-repository-head', text(backup.repositoryHead).toLowerCase()],
  ]) {
    if (!SHA40.test(value)) blockers.push(`${label}-invalid`);
  }
  for (const [label, value] of [
    ['backup-database-digest', text(backup.databaseDigest).toLowerCase()],
    ['backup-repository-digest', text(backup.repositoryDigest).toLowerCase()],
    ['backup-artifact-digest', text(backup.artifactDigest).toLowerCase()],
  ]) {
    if (!SHA256.test(value)) blockers.push(`${label}-invalid`);
  }
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');
  if (!Number.isFinite(observedAtMs)) blockers.push('forge-observation-time-invalid');
  if (!Number.isFinite(backupAtMs)) blockers.push('backup-time-invalid');
  if (!Number.isSafeInteger(maxObservationAgeMs) || maxObservationAgeMs < 1000 || maxObservationAgeMs > 60 * 60 * 1000) {
    blockers.push('observation-age-bound-invalid');
  }
  if (!Number.isSafeInteger(maxBackupAgeMs) || maxBackupAgeMs < 60 * 1000 || maxBackupAgeMs > 7 * 24 * 60 * 60 * 1000) {
    blockers.push('backup-age-bound-invalid');
  }
  if (text(forge.mirrorMode) !== 'fetch-only') blockers.push('forge-mirror-mode-not-fetch-only');
  if (forge.writeEnabled !== false) blockers.push('forge-write-authority-not-disabled');
  if (forge.publicExposure !== false) blockers.push('forge-public-exposure-not-disabled');
  if (forge.runnerRegistrationEnabled !== false) blockers.push('forge-runner-registration-not-disabled');
  if (forge.serviceHealthy !== true) blockers.push('forge-service-health-not-proved');
  if (backup.restorable !== true) blockers.push('backup-restorability-not-proved');
  if (Number.isFinite(observedAtMs) && Number.isFinite(nowMs)) {
    if (observedAtMs > nowMs) blockers.push('forge-observation-in-future');
    else if (nowMs - observedAtMs > maxObservationAgeMs) blockers.push('forge-observation-stale');
  }
  if (Number.isFinite(backupAtMs) && Number.isFinite(nowMs)) {
    if (backupAtMs > nowMs) blockers.push('backup-in-future');
  }

  const resultBase = {
    schemaVersion: FORGE_SHADOW_PARITY_SCHEMA,
    repository,
    github: Object.freeze({ head: githubHead, tree: githubTree }),
    forge: Object.freeze({ head: forgeHead, tree: forgeTree }),
    authority: authority(),
  };

  if (blockers.length) {
    return Object.freeze({
      ...resultBase,
      valid: false,
      decision: FORGE_SHADOW_PARITY_DECISIONS.BLOCKED,
      blockers: Object.freeze([...new Set(blockers)]),
      parity: false,
      backupCurrent: false,
    });
  }

  if (githubHead !== forgeHead || githubTree !== forgeTree) {
    return Object.freeze({
      ...resultBase,
      valid: true,
      decision: FORGE_SHADOW_PARITY_DECISIONS.PARITY_REQUIRED,
      blockers: Object.freeze([]),
      parity: false,
      backupCurrent: false,
    });
  }

  const backupCurrent = text(backup.repositoryHead).toLowerCase() === githubHead
    && nowMs - backupAtMs <= maxBackupAgeMs;
  if (!backupCurrent) {
    return Object.freeze({
      ...resultBase,
      valid: true,
      decision: FORGE_SHADOW_PARITY_DECISIONS.BACKUP_REQUIRED,
      blockers: Object.freeze([]),
      parity: true,
      backupCurrent: false,
    });
  }

  return Object.freeze({
    ...resultBase,
    valid: true,
    decision: FORGE_SHADOW_PARITY_DECISIONS.READY,
    blockers: Object.freeze([]),
    parity: true,
    backupCurrent: true,
    proof: Object.freeze({
      exactObjectParity: true,
      exactTreeParity: true,
      fetchOnlyMirror: true,
      isolatedReadOnly: true,
      currentRestorableBackup: true,
    }),
  });
}
