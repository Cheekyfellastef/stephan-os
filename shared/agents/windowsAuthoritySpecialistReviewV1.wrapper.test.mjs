import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const wrapperSource = readFileSync(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
const baseSource = readFileSync(new URL('./windowsAuthoritySpecialistReviewV1Base.mjs', import.meta.url), 'utf8');
const wsl2Source = readFileSync(new URL('./windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs', import.meta.url), 'utf8');

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

test('specialist wrapper preserves the historical reviewer behind exact blob pinning', () => {
  assert.match(wrapperSource, new RegExp(`BASE_BLOB_SHA = '${gitBlobSha(baseSource)}'`));
  assert.match(wrapperSource, /WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH/);
});

test('specialist wrapper pins and checks the dedicated Forge WSL2 reviewer', () => {
  assert.match(wrapperSource, new RegExp(`WSL2_BLOB_SHA = '${gitBlobSha(wsl2Source)}'`));
  assert.match(wrapperSource, /analyzeWindowsAuthorityForgeWsl2PrerequisiteReview/);
  assert.match(wrapperSource, /if \(wsl2Result\.eligible\) return wsl2Result/);
  assert.match(wrapperSource, /return base\.analyzeWindowsAuthoritySpecialistReview\(input\)/);
});
