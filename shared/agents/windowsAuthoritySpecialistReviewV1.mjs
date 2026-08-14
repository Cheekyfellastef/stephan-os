import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CORE_PATH = './windowsAuthoritySpecialistReviewCoreV1.mjs';
const NO_FAFF_PATH = './windowsAuthorityNoFaffRescueReviewV2.mjs';
const MAILBOX_RECOVERY_GUARDIAN_PATH = './windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs';
const RECOVERY_GUARDIAN_PATH = './windowsAuthorityRecoveryMeshGuardianReviewV1.mjs';
const WORKER_WATCHDOG_PATH = './windowsAuthorityWorkerWatchdogReviewV1.mjs';
const CORE_BLOB_SHA = '4424046455d8fd7724f1ae8b7c53b7c6529668df';
const NO_FAFF_BLOB_SHA = 'f6c2a92f4e2ffebb57e197e72ed0279a896c9ffe';
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '9f47c49eaab30db93897e4c5fcfce910a58ed0b9';
const RECOVERY_GUARDIAN_BLOB_SHA = '60228170b62d8313bebece5e9e8655cfc45497a5';
const WORKER_WATCHDOG_BLOB_SHA = 'b69e048ea9857b713e2faa17a1bbecec62fed84d';
const EXPECTED_NO_FAFF_PATHS = Object.freeze([
  'scripts/windows/repair-battle-bridge-control-plane-now.ps1',
  'scripts/windows/Repair-Battle-Bridge-Control-Plane-Now.cmd',
  'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs',
  'scripts/windows/status-stephanos-codex-dispatch-plugin.ps1',
]);
const EXPECTED_MAILBOX_RECOVERY_GUARDIAN_PATHS = Object.freeze([
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
]);
const EXPECTED_RECOVERY_GUARDIAN_PATHS = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  'scripts/windows/uninstall-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
]);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function provePinnedModule(path, expectedBlobSha) {
  const url = new URL(path, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observedBlobSha = gitBlobSha(content);
  if (observedBlobSha !== expectedBlobSha) {
    throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH:${path}:${observedBlobSha}`);
  }
  return url;
}

const coreUrl = provePinnedModule(CORE_PATH, CORE_BLOB_SHA);
const noFaffUrl = provePinnedModule(NO_FAFF_PATH, NO_FAFF_BLOB_SHA);
const mailboxRecoveryGuardianUrl = provePinnedModule(
  MAILBOX_RECOVERY_GUARDIAN_PATH,
  MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA,
);
const recoveryGuardianUrl = provePinnedModule(RECOVERY_GUARDIAN_PATH, RECOVERY_GUARDIAN_BLOB_SHA);
const workerWatchdogUrl = provePinnedModule(WORKER_WATCHDOG_PATH, WORKER_WATCHDOG_BLOB_SHA);

const core = await import(coreUrl.href);
const noFaff = await import(noFaffUrl.href);
const mailboxRecoveryGuardian = await import(mailboxRecoveryGuardianUrl.href);
const recoveryGuardian = await import(recoveryGuardianUrl.href);
const workerWatchdog = await import(workerWatchdogUrl.href);

if (
  JSON.stringify(workerWatchdog.WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1)
  !== JSON.stringify([
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
    'scripts/windows/restart-approved-stephanos-runtime.ps1',
    'scripts/windows/start-mission-orchestrator-worker.ps1',
  ])
) {
  throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATH_INVENTORY_MISMATCH');
}

if (
  JSON.stringify(noFaff.WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1)
  !== JSON.stringify(EXPECTED_NO_FAFF_PATHS)
) {
  throw new Error('WINDOWS_AUTHORITY_NO_FAFF_PATH_INVENTORY_MISMATCH');
}
if (
  JSON.stringify(mailboxRecoveryGuardian.WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1)
  !== JSON.stringify(EXPECTED_MAILBOX_RECOVERY_GUARDIAN_PATHS)
) {
  throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATH_INVENTORY_MISMATCH');
}
if (
  JSON.stringify(recoveryGuardian.WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1)
  !== JSON.stringify(EXPECTED_RECOVERY_GUARDIAN_PATHS)
) {
  throw new Error('WINDOWS_AUTHORITY_RECOVERY_GUARDIAN_PATH_INVENTORY_MISMATCH');
}

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION =
  core.WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION =
  core.WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES =
  core.WINDOWS_AUTHORITY_SOURCE_MAX_BYTES;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const workerWatchdogResult = workerWatchdog.analyzeWindowsAuthorityWorkerWatchdogReview(input);
  if (workerWatchdogResult.eligible) return workerWatchdogResult;

  const coreResult = core.analyzeWindowsAuthoritySpecialistReview(input);
  if (coreResult.eligible) return coreResult;

  const noFaffResult = noFaff.analyzeWindowsAuthorityNoFaffRescueReview(input);
  if (noFaffResult.eligible) return noFaffResult;

  const mailboxRecoveryGuardianResult =
    mailboxRecoveryGuardian.analyzeWindowsAuthorityMailboxRecoveryGuardianReview(input);
  if (mailboxRecoveryGuardianResult.eligible) return mailboxRecoveryGuardianResult;

  const recoveryGuardianResult = recoveryGuardian.analyzeWindowsAuthorityRecoveryMeshGuardianReview(input);
  if (recoveryGuardianResult.eligible) return recoveryGuardianResult;

  return coreResult;
}
