import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapperSource = readFileSync(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
const childSource = readFileSync(new URL('./windowsAuthorityStephanosNativeCapacityPublisherReviewV1.mjs', import.meta.url), 'utf8');
const legacyRouterSource = readFileSync(new URL('./windowsAuthoritySpecialistReviewV1LegacyRouter.mjs', import.meta.url), 'utf8');

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

test('canonical Windows specialist pins native publisher child and frozen legacy fallback', () => {
  assert.match(wrapperSource, new RegExp(`NATIVE_CAPACITY_PUBLISHER_BLOB_SHA = '${gitBlobSha(childSource)}'`));
  assert.match(wrapperSource, new RegExp(`LEGACY_ROUTER_BLOB_SHA = '${gitBlobSha(legacyRouterSource)}'`));
  assert.match(wrapperSource, /nativeCapacityPublisher\.analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1\(input\)/);
  assert.match(wrapperSource, /if \(nativeCapacityPublisherResult\.eligible\) return nativeCapacityPublisherResult/);
  assert.match(wrapperSource, /return base\.analyzeWindowsAuthoritySpecialistReview\(input\)/);
});

test('native publisher specialist is routed before the older WSL2 and legacy fallbacks', () => {
  const nativeRoute = wrapperSource.indexOf('nativeCapacityPublisher.analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1');
  const wsl2Route = wrapperSource.indexOf('wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview');
  const legacyRoute = wrapperSource.indexOf('base.analyzeWindowsAuthoritySpecialistReview');
  assert.ok(nativeRoute > 0);
  assert.ok(wsl2Route > nativeRoute);
  assert.ok(legacyRoute > wsl2Route);
});
