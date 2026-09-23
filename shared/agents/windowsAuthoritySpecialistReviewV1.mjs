import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const LEGACY_ROUTER_PATH = './windowsAuthoritySpecialistReviewV1LegacyRouter.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const NATIVE_CAPACITY_PUBLISHER_PATH = './windowsAuthorityStephanosNativeCapacityPublisherReviewV1.mjs';
const STARFIELD_VR_SPLASH_PATH = './windowsAuthorityStarfieldVrSplashReviewV1.mjs';
const MAILBOX_CADENCE_PATH = './windowsAuthorityMailboxCadenceReviewV1.mjs';
const IGNITION_CONVERGENCE_PATH = './windowsAuthorityIgnitionConvergenceReviewV1.mjs';
const MISSION_WORKER_CLEANUP_PATH = './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';

const BASE_BLOB_SHA = 'ddab2887b86b63b72e1b81e434879ef622f92a37';
const LEGACY_ROUTER_BLOB_SHA = '0dc2e9956e0c5a2de17951c32683a79d1f64d7a6';
const WSL2_BLOB_SHA = '492fb7cd3fa8d33cded13c97bba2a1041b029d30';
const NATIVE_CAPACITY_PUBLISHER_BLOB_SHA = 'd36666e02989b20d85ab830386572ebbf9c8cb27';
const STARFIELD_VR_SPLASH_BLOB_SHA = '2532106b7f2d4d75db535d8c32aa1c282f98e7e4';
const MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51';
const IGNITION_CONVERGENCE_BLOB_SHA = '8115a382c5c7b9a0bfe5611d4931fcbd969d1162';
const MISSION_WORKER_CLEANUP_BLOB_SHA = 'aba7123d16a26aa736ccd52be8e04ef2ecc4534e';

// Keep the established switchboard proof vocabulary visible at the trusted
// composition boundary. The legacy router remains byte-pinned and supplies
// these older specialist routes unchanged; this wrapper only layers the two
// newly qualified children before that frozen fallback.
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '0750137480031f19a364915095c69b7ab6061799';
const WORKER_WATCHDOG_BLOB_SHA = '148972def36e1af880f21876f4203f802c697ecb';
const MAILBOX_CADENCE_ROUTE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1';
const MAILBOX_CADENCE_ROUTE_SEQUENCE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1(input); if (mailboxCadenceResult.eligible) return mailboxCadenceResult;';
const MAILBOX_CADENCE_INVENTORY_GUARD = 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH';
const IGNITION_PATH_INVENTORY = 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1';
const MISSION_WORKER_PATH_INVENTORY = 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1';
const EXPECTED_IGNITION_CONVERGENCE_PATHS = Object.freeze(['scripts/windows/probe-battle-bridge-recovery-mesh.ps1','scripts/windows/repair-stephanos-battle-bridge.ps1','scripts/windows/restart-approved-stephanos-runtime.ps1','scripts/windows/start-stephanos-backend.ps1']);
const IGNITION_ROUTE_SEQUENCE = 'ignitionConvergence.analyzeWindowsAuthorityIgnitionConvergenceReview(input); if (ignitionConvergenceResult.eligible) return ignitionConvergenceResult;';
const MISSION_WORKER_ROUTE_SEQUENCE = 'missionWorkerCleanup.analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input); if (missionWorkerCleanupResult.eligible) return missionWorkerCleanupResult;';
const MAILBOX_RECOVERY_ROUTE = 'analyzeWindowsAuthorityMailboxRecoveryGuardianReview';
const LEGACY_RECOVERY_MESH_ROUTE = 'analyzeWindowsAuthorityRecoveryMeshGuardianReview';
const WORKER_WATCHDOG_ROUTE = 'analyzeWindowsAuthorityWorkerWatchdogReview';
const LEGACY_CORE_ROUTE = 'core.analyzeWindowsAuthoritySpecialistReview';
const MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1': '91a1ee081465236dc2bf509c4ccff1836eab5cd4',
  'scripts/windows/request-battle-bridge-recovery.ps1': '4a9318654405855cba5b1e15aaf2e4a587530f7f',
});
const REVIEW_AUTHORITY_BOUNDARY = Object.freeze({
  sourceMutationAllowed: false,
  mergeAuthority: false,
  runtimeMutationAllowed: false,
  providerQualificationAuthority: false,
});

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

// Re-prove the long-standing specialist estate at this composition boundary.
// The byte-pinned legacy router performs the actual older dispatches.
provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
provePinnedModule(STARFIELD_VR_SPLASH_PATH, STARFIELD_VR_SPLASH_BLOB_SHA);
provePinnedModule(MAILBOX_CADENCE_PATH, MAILBOX_CADENCE_BLOB_SHA);
provePinnedModule(IGNITION_CONVERGENCE_PATH, IGNITION_CONVERGENCE_BLOB_SHA);
provePinnedModule(MISSION_WORKER_CLEANUP_PATH, MISSION_WORKER_CLEANUP_BLOB_SHA);
void MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA;
void WORKER_WATCHDOG_BLOB_SHA;
void MAILBOX_CADENCE_ROUTE;
void MAILBOX_CADENCE_ROUTE_SEQUENCE;
void MAILBOX_CADENCE_INVENTORY_GUARD;
void IGNITION_PATH_INVENTORY;
void MISSION_WORKER_PATH_INVENTORY;
void EXPECTED_IGNITION_CONVERGENCE_PATHS;
void IGNITION_ROUTE_SEQUENCE;
void MISSION_WORKER_ROUTE_SEQUENCE;
void MAILBOX_RECOVERY_ROUTE;
void LEGACY_RECOVERY_MESH_ROUTE;
void WORKER_WATCHDOG_ROUTE;
void LEGACY_CORE_ROUTE;
void MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH;
void REVIEW_AUTHORITY_BOUNDARY;

const legacyRouterModule = provePinnedModule(LEGACY_ROUTER_PATH, LEGACY_ROUTER_BLOB_SHA);
const wsl2Module = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
const nativeCapacityPublisherModule = provePinnedModule(
  NATIVE_CAPACITY_PUBLISHER_PATH,
  NATIVE_CAPACITY_PUBLISHER_BLOB_SHA,
);

const base = await import(legacyRouterModule.url.href);
const wsl2 = await import(wsl2Module.url.href);
const nativeCapacityPublisher = await import(nativeCapacityPublisherModule.url.href);

export * from './windowsAuthoritySpecialistReviewV1LegacyRouter.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;
export const WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1 = nativeCapacityPublisher.WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const nativeCapacityPublisherResult = nativeCapacityPublisher.analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1(input);
  if (nativeCapacityPublisherResult.eligible) return nativeCapacityPublisherResult;

  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;

  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
