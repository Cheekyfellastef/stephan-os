import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const MAILBOX_CADENCE_PATH = './windowsAuthorityMailboxCadenceReviewV1.mjs';
const IGNITION_CONVERGENCE_PATH = './windowsAuthorityIgnitionConvergenceReviewV1.mjs';
const MISSION_WORKER_CLEANUP_PATH = './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';
const BASE_BLOB_SHA = '85ea1cdebe4bc721ad6673db73ce0f63927a763e';
const WSL2_BLOB_SHA = 'a03ab69af51d0a39a0d43d72df515f4a5a8329c0';
const MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51';
const IGNITION_CONVERGENCE_BLOB_SHA = '8115a382c5c7b9a0bfe5611d4931fcbd969d1162';
const MISSION_WORKER_CLEANUP_BLOB_SHA = '907c95a364c4b5eb5e083788b52056071d78e3a2';

const EXPECTED_IGNITION_CONVERGENCE_PATHS = Object.freeze(['scripts/windows/probe-battle-bridge-recovery-mesh.ps1','scripts/windows/repair-stephanos-battle-bridge.ps1','scripts/windows/restart-approved-stephanos-runtime.ps1','scripts/windows/start-stephanos-backend.ps1']);
const EXPECTED_MISSION_WORKER_CLEANUP_PATHS = Object.freeze(['scripts/windows/restart-approved-stephanos-runtime.ps1']);
const EXPECTED_MAILBOX_CADENCE_PATHS = Object.freeze(['scripts/windows/install-battle-bridge-github-command-mailbox.ps1']);

// These legacy specialist pins and route markers remain top-level invariants
// even though the historical implementation stays inside the exact pinned base router.
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '0750137480031f19a364915095c69b7ab6061799';
const WORKER_WATCHDOG_BLOB_SHA = '148972def36e1af880f21876f4203f802c697ecb';
const MAILBOX_CADENCE_ROUTE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1';
const MAILBOX_CADENCE_INVENTORY_GUARD = 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH';
const IGNITION_PATH_INVENTORY = 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1';
const MISSION_WORKER_PATH_INVENTORY = 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1';
const IGNITION_ROUTE_SEQUENCE = 'ignitionConvergence.analyzeWindowsAuthorityIgnitionConvergenceReview(input); if (ignitionConvergenceResult.eligible) return ignitionConvergenceResult;';
const MISSION_WORKER_ROUTE_SEQUENCE = 'missionWorkerCleanup.analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input); if (missionWorkerCleanupResult.eligible) return missionWorkerCleanupResult;';
const MAILBOX_RECOVERY_ROUTE = 'analyzeWindowsAuthorityMailboxRecoveryGuardianReview';
const LEGACY_RECOVERY_MESH_ROUTE = 'analyzeWindowsAuthorityRecoveryMeshGuardianReview';
const WORKER_WATCHDOG_ROUTE = 'analyzeWindowsAuthorityWorkerWatchdogReview';
const LEGACY_CORE_ROUTE = 'core.analyzeWindowsAuthoritySpecialistReview';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function provePinnedModule(path, expectedBlobSha) {
  const url = new URL(path, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observedBlobSha = gitBlobSha(content);
  if (observedBlobSha !== expectedBlobSha) {
    throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH:${path}:${observedBlobSha}`);
  }
  return Object.freeze({ url, content });
}
function proveLegacyRoutingInvariants(source) {
  if (!source.includes(`MAILBOX_CADENCE_PATH = '${MAILBOX_CADENCE_PATH}'`)) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_MISMATCH');
  }
  if (!source.includes(`MAILBOX_CADENCE_BLOB_SHA = '${MAILBOX_CADENCE_BLOB_SHA}'`)) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_PIN_MISMATCH');
  }
  if (!source.includes(MAILBOX_CADENCE_INVENTORY_GUARD)) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_INVENTORY_GUARD_MISSING');
  }
  if (!source.includes(`IGNITION_CONVERGENCE_PATH = '${IGNITION_CONVERGENCE_PATH}'`)
    || !source.includes(`IGNITION_CONVERGENCE_BLOB_SHA = '${IGNITION_CONVERGENCE_BLOB_SHA}'`)
    || !source.includes(IGNITION_PATH_INVENTORY)
    || !source.includes(JSON.stringify(EXPECTED_IGNITION_CONVERGENCE_PATHS).replaceAll('"', "'"))
    || !source.includes(IGNITION_ROUTE_SEQUENCE)) {
    throw new Error('WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_LEGACY_CONTRACT_MISMATCH');
  }
  if (!source.includes(`MISSION_WORKER_CLEANUP_PATH = '${MISSION_WORKER_CLEANUP_PATH}'`)
    || !source.includes(`MISSION_WORKER_CLEANUP_BLOB_SHA = '${MISSION_WORKER_CLEANUP_BLOB_SHA}'`)
    || !source.includes(MISSION_WORKER_PATH_INVENTORY)
    || !source.includes(MISSION_WORKER_ROUTE_SEQUENCE)) {
    throw new Error('WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_LEGACY_CONTRACT_MISMATCH');
  }
  if (!source.includes(`MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '${MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA}'`)) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PIN_MISMATCH');
  }
  if (!source.includes(`WORKER_WATCHDOG_BLOB_SHA = '${WORKER_WATCHDOG_BLOB_SHA}'`)) {
    throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_PIN_MISMATCH');
  }

  const cadenceIndex = source.indexOf(MAILBOX_CADENCE_ROUTE);
  const cadenceCoreIndex = source.indexOf(LEGACY_CORE_ROUTE);
  if (cadenceIndex < 0 || cadenceCoreIndex < 0 || cadenceIndex >= cadenceCoreIndex) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_ROUTE_ORDER_MISMATCH');
  }

  const mailboxIndex = source.indexOf(MAILBOX_RECOVERY_ROUTE);
  const recoveryMeshIndex = source.indexOf(LEGACY_RECOVERY_MESH_ROUTE);
  if (mailboxIndex < 0 || recoveryMeshIndex < 0 || mailboxIndex >= recoveryMeshIndex) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_ROUTE_ORDER_MISMATCH');
  }

  const watchdogIndex = source.indexOf(WORKER_WATCHDOG_ROUTE);
  const coreIndex = source.indexOf(LEGACY_CORE_ROUTE);
  if (watchdogIndex < 0 || coreIndex < 0 || watchdogIndex >= coreIndex) {
    throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_ROUTE_ORDER_MISMATCH');
  }
}

const baseModule = provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
const wsl2Module = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
const mailboxCadenceModule = provePinnedModule(MAILBOX_CADENCE_PATH, MAILBOX_CADENCE_BLOB_SHA);
provePinnedModule(IGNITION_CONVERGENCE_PATH, IGNITION_CONVERGENCE_BLOB_SHA);
provePinnedModule(MISSION_WORKER_CLEANUP_PATH, MISSION_WORKER_CLEANUP_BLOB_SHA);
proveLegacyRoutingInvariants(baseModule.content);
const base = await import(baseModule.url.href);
const wsl2 = await import(wsl2Module.url.href);
const mailboxCadence = await import(mailboxCadenceModule.url.href);
if (JSON.stringify(mailboxCadence.WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1) !== JSON.stringify(EXPECTED_MAILBOX_CADENCE_PATHS)) {
  throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH');
}

export * from './windowsAuthoritySpecialistReviewV1Base.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;
  const mailboxCadenceResult = mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1(input);
  if (mailboxCadenceResult.eligible) return mailboxCadenceResult;
  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
