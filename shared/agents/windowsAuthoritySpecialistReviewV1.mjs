import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const LEGACY_PATH = './windowsAuthoritySpecialistReviewLegacyV1.mjs';
const LIFEBOAT_ACTIVATION_PATH = './windowsAuthorityBattleBridgeLifeboatActivationReviewV1.mjs';
const LEGACY_BLOB_SHA = 'fc0ba9cc4cf950bc2256040a6d959038fc7199f7';
const LIFEBOAT_ACTIVATION_BLOB_SHA = '208dcb91dd188730385b6e3ed6364318bd4f3cd4';

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
  return url;
}

const legacyUrl = provePinnedModule(LEGACY_PATH, LEGACY_BLOB_SHA);
const lifeboatActivationUrl = provePinnedModule(LIFEBOAT_ACTIVATION_PATH, LIFEBOAT_ACTIVATION_BLOB_SHA);
const legacy = await import(legacyUrl.href);
const lifeboatActivation = await import(lifeboatActivationUrl.href);

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION = legacy.WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION = legacy.WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES = legacy.WINDOWS_AUTHORITY_SOURCE_MAX_BYTES;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const activation = lifeboatActivation.analyzeWindowsAuthorityBattleBridgeLifeboatActivationReview(input);
  if (activation.eligible) return activation;
  return legacy.analyzeWindowsAuthoritySpecialistReview(input);
}
