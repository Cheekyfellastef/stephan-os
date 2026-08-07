import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CORE_PATH = './windowsAuthoritySpecialistReviewCoreV1.mjs';
const NO_FAFF_PATH = './windowsAuthorityNoFaffRescueReviewV1.mjs';
const CORE_BLOB_SHA = '4424046455d8fd7724f1ae8b7c53b7c6529668df';
const NO_FAFF_BLOB_SHA = '41aac351dfb5339889d3faee166b7fe1c61e6c4c';
const EXPECTED_NO_FAFF_PATHS = Object.freeze([
  'scripts/windows/repair-battle-bridge-control-plane-now.ps1',
  'scripts/windows/Repair-Battle-Bridge-Control-Plane-Now.cmd',
  'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs',
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

const core = await import(coreUrl.href);
const noFaff = await import(noFaffUrl.href);

if (
  JSON.stringify(noFaff.WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1)
  !== JSON.stringify(EXPECTED_NO_FAFF_PATHS)
) {
  throw new Error('WINDOWS_AUTHORITY_NO_FAFF_PATH_INVENTORY_MISMATCH');
}

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION =
  core.WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION =
  core.WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES =
  core.WINDOWS_AUTHORITY_SOURCE_MAX_BYTES;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const coreResult = core.analyzeWindowsAuthoritySpecialistReview(input);
  if (coreResult.eligible) return coreResult;

  const noFaffResult = noFaff.analyzeWindowsAuthorityNoFaffRescueReview(input);
  if (noFaffResult.eligible) return noFaffResult;

  return coreResult;
}
