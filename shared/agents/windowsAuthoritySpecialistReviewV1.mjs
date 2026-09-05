import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const BASE_BLOB_SHA = '85ea1cdebe4bc721ad6673db73ce0f63927a763e';
const WSL2_BLOB_SHA = 'a03ab69af51d0a39a0d43d72df515f4a5a8329c0';

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

const baseUrl = provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
const wsl2Url = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
const base = await import(baseUrl.href);
const wsl2 = await import(wsl2Url.href);

export * from './windowsAuthoritySpecialistReviewV1Base.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;
  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
