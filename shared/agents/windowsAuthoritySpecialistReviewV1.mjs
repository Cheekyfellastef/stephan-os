import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const BASE_BLOB_SHA = '85ea1cdebe4bc721ad6673db73ce0f63927a763e';
const WSL2_BLOB_SHA = 'a03ab69af51d0a39a0d43d72df515f4a5a8329c0';

// These legacy specialist pins remain top-level invariants even though their
// implementation stays inside the exact pinned base router.
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '0750137480031f19a364915095c69b7ab6061799';
const WORKER_WATCHDOG_BLOB_SHA = '148972def36e1af880f21876f4203f802c697ecb';
const LEGACY_ROUTE_ORDER = Object.freeze([
  'analyzeWindowsAuthorityMailboxRecoveryGuardianReview',
  'analyzeWindowsAuthorityRecoveryMeshGuardianReview',
  'analyzeWindowsAuthorityWorkerWatchdogReview',
  'core.analyzeWindowsAuthoritySpecialistReview',
]);

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
  if (!source.includes(`MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '${MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA}'`)) {
    throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PIN_MISMATCH');
  }
  if (!source.includes(`WORKER_WATCHDOG_BLOB_SHA = '${WORKER_WATCHDOG_BLOB_SHA}'`)) {
    throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_PIN_MISMATCH');
  }
  let previousIndex = -1;
  for (const route of LEGACY_ROUTE_ORDER) {
    const index = source.indexOf(route);
    if (index < 0 || index <= previousIndex) {
      throw new Error(`WINDOWS_AUTHORITY_LEGACY_ROUTE_ORDER_MISMATCH:${route}`);
    }
    previousIndex = index;
  }
}

const baseModule = provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
const wsl2Module = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
proveLegacyRoutingInvariants(baseModule.content);
const base = await import(baseModule.url.href);
const wsl2 = await import(wsl2Module.url.href);

export * from './windowsAuthoritySpecialistReviewV1Base.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;
  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
