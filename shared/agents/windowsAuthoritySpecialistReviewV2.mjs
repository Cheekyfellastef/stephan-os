import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const V1_PATH = './windowsAuthoritySpecialistReviewV1.mjs';
const OPENCLAW_RECOVERY_PATH = './windowsAuthorityOpenClawRecoveryReviewV1.mjs';
const V1_BLOB_SHA = '4a6062f5631d14ab8ec19ca47a4afcd473b8233e';
const OPENCLAW_RECOVERY_BLOB_SHA = 'd1a91db4fdae1ee46784133dbb42c9ec4ea99bd1';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function provePinnedModule(path, expectedBlobSha) {
  const url = new URL(path, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observedBlobSha = gitBlobSha(content);
  if (observedBlobSha !== expectedBlobSha) throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_V2_PIN_MISMATCH:${path}:${observedBlobSha}`);
  return url;
}

const v1Url = provePinnedModule(V1_PATH, V1_BLOB_SHA);
const openClawRecoveryUrl = provePinnedModule(OPENCLAW_RECOVERY_PATH, OPENCLAW_RECOVERY_BLOB_SHA);
const v1 = await import(v1Url.href);
const openClawRecovery = await import(openClawRecoveryUrl.href);

if (JSON.stringify(openClawRecovery.WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1) !== JSON.stringify([
  'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.mjs',
  'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.test.mjs',
  'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
  'scripts/windows/request-battle-bridge-recovery-openclaw.test.mjs',
])) throw new Error('WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATH_INVENTORY_MISMATCH');

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION = v1.WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION = v1.WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION;
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES = v1.WINDOWS_AUTHORITY_SOURCE_MAX_BYTES;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const openClawRecoveryResult = openClawRecovery.analyzeWindowsAuthorityOpenClawRecoveryReview(input);
  if (openClawRecoveryResult.eligible) return openClawRecoveryResult;
  return v1.analyzeWindowsAuthoritySpecialistReview(input);
}
