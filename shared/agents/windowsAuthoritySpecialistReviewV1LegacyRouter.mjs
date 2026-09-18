import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const STARFIELD_VR_SPLASH_PATH = './windowsAuthorityStarfieldVrSplashReviewV1.mjs';
const MAILBOX_CADENCE_PATH = './windowsAuthorityMailboxCadenceReviewV1.mjs';
const IGNITION_CONVERGENCE_PATH = './windowsAuthorityIgnitionConvergenceReviewV1.mjs';
const MISSION_WORKER_CLEANUP_PATH = './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';
const BASE_BLOB_SHA = '5eba00c94e495d8256952055cbe571e14d046439';
const WSL2_BLOB_SHA = '9a3eec86af450cb685d3664faf6376363e0d1d74';
const STARFIELD_VR_SPLASH_BLOB_SHA = '2532106b7f2d4d75db535d8c32aa1c282f98e7e4';
const MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51';
const IGNITION_CONVERGENCE_BLOB_SHA = '8115a382c5c7b9a0bfe5611d4931fcbd969d1162';
const MISSION_WORKER_CLEANUP_BLOB_SHA = 'aba7123d16a26aa736ccd52be8e04ef2ecc4534e';

const EXPECTED_IGNITION_CONVERGENCE_PATHS = Object.freeze(['scripts/windows/probe-battle-bridge-recovery-mesh.ps1','scripts/windows/repair-stephanos-battle-bridge.ps1','scripts/windows/restart-approved-stephanos-runtime.ps1','scripts/windows/start-stephanos-backend.ps1']);
const EXPECTED_MISSION_WORKER_CLEANUP_PATHS = Object.freeze(['scripts/windows/restart-approved-stephanos-runtime.ps1']);
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

const MAILBOX_ROLLOVER_SCHEMA = 'stephanos.windows-authority-mailbox-rollover-review.v1';
const WINDOWS_AUTHORITY_SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const WINDOWS_AUTHORITY_LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const MAILBOX_ROLLOVER_PR_NUMBER = 2164;
const MAILBOX_ROLLOVER_BRANCH = 'fix/canonical-mailbox-rollover-2158-v1';
export const WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
]);
const MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1': '91a1ee081465236dc2bf509c4ccff1836eab5cd4',
  'scripts/windows/request-battle-bridge-recovery.ps1': '4a9318654405855cba5b1e15aaf2e4a587530f7f',
});
const SHA40 = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;

function text(value) { return String(value ?? '').trim(); }
function gitBlobSha(content) { const bytes = Buffer.from(content, 'utf8'); return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex'); }
function provePinnedModule(path, expectedBlobSha) { const url = new URL(path, import.meta.url); const content = readFileSync(url, 'utf8'); const observedBlobSha = gitBlobSha(content); if (observedBlobSha !== expectedBlobSha) throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH:${path}:${observedBlobSha}`); return Object.freeze({ url, content }); }

// Legacy router content beyond this pin is intentionally preserved by the owner branch; this repair only refreshes the exact WSL2 specialist blob pin.
export { provePinnedModule };
