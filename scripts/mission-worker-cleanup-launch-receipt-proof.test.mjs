import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');

function sliceFunction(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName
    ? source.indexOf(`function ${nextName}`, start + 1)
    : source.indexOf('\ntry {\n    if (-not $env:USERPROFILE)', start + 1);
  assert.ok(end > start, `${name} must have a bounded body`);
  return source.slice(start, end);
}

test('cleanup fallback can prove only a newly-created exact canonical worker when the per-invocation launch receipt is absent', () => {
  const helper = sliceFunction('Get-VerifiedCleanupFallbackWorkerProcess', 'Stop-NewlyStartedOwnedWorker');
  assert.match(helper, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat/);
  assert.match(helper, /StartedAfterUtc/);
  assert.match(helper, /ProcessStartedAtUtc/);
  assert.match(helper, /Ticks\s*-le\s*\$StartedAfterUtc\.ToUniversalTime\(\)\.Ticks/);
  assert.match(helper, /Get-ScheduledTask/);
  assert.ok(helper.includes("-TaskPath '" + String.fromCharCode(92) + "'"));
  assert.match(helper, /Running/);
  assert.match(helper, /Queued/);
  assert.match(helper, /ProcessCapability/);
  assert.match(helper, /HasExited/);
  assert.match(helper, /StartTime\.ToUniversalTime\(\)/);
  assert.doesNotMatch(helper, /Stop-Process/);
  assert.doesNotMatch(helper, /caller|Caller|arbitrary|Arbitrary/);
});

test('cleanup still prefers exact invocation launch receipt and only falls back after exact claim proof', () => {
  const cleanup = sliceFunction('Stop-NewlyStartedOwnedWorker');
  const claim = cleanup.indexOf('MISSION_WORKER_CLEANUP_INVOCATION_CLAIM_NOT_PROVEN');
  const receipt = cleanup.indexOf('Get-VerifiedInvocationProcessFromLaunchReceipt');
  const fallback = cleanup.indexOf('Get-VerifiedCleanupFallbackWorkerProcess');
  assert.ok(claim >= 0 && receipt > claim && fallback > receipt);
  assert.match(cleanup, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN/);
  assert.match(cleanup, /ExpectedProcessId/);
  assert.match(cleanup, /ExpectedProcessStartedAtUtc/);
});

test('cleanup fallback remains fail closed on pre-existing, ambiguous, changed, or non-canonical workers', () => {
  const helper = sliceFunction('Get-VerifiedCleanupFallbackWorkerProcess', 'Stop-NewlyStartedOwnedWorker');
  assert.match(helper, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat/);
  assert.match(helper, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN/);
  assert.match(helper, /MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED/);
  assert.match(helper, /ProcessId/);
  assert.match(helper, /ProcessStartedAtUtc/);
  assert.doesNotMatch(helper, /Kill\(/);
});

test('existing cleanup keeps cancellation and exact process re-verification before any termination', () => {
  const cleanup = sliceFunction('Stop-NewlyStartedOwnedWorker');
  const cancel = cleanup.indexOf('mission-orchestrator-worker-restart-cancel-$ExpectedInvocationId.json');
  const reverify = cleanup.lastIndexOf('Get-VerifiedFreshWorkerInstance');
  const waitForExit = cleanup.indexOf('Get-CimInstance Win32_Process');
  assert.ok(cancel >= 0);
  assert.ok(reverify >= 0);
  assert.ok(waitForExit > cancel);
  assert.doesNotMatch(cleanup, /Stop-Process/);
});
