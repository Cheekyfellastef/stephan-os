import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const restartPath = new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url);
const probePath = new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url);

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} must have a bounded body`);
  return source.slice(start, end);
}

test('restart proof compares receipt time with the exact Process API that created it', async () => {
  const source = await readFile(restartPath, 'utf8');
  const fresh = functionBody(source, 'Get-VerifiedFreshWorkerInstance', 'Get-VerifiedInvocationProcessFromLaunchReceipt');
  const receipt = functionBody(source, 'Get-VerifiedInvocationProcessFromLaunchReceipt', 'Get-VerifiedCleanupFallbackWorkerProcess');
  const existing = functionBody(source, 'Get-VerifiedWorkerProcessFromHeartbeat', 'Get-VerifiedFreshWorkerInstance');

  for (const body of [fresh, receipt, existing]) {
    assert.match(body, /\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)/);
    assert.match(body, /\$null = \$processCapability\.Handle/);
    assert.match(body, /\$processCapability\.StartTime\.ToUniversalTime\(\)/);
    assert.doesNotMatch(body, /\$liveProcessStartedAtUtc = \(\[datetime\]\$process\.CreationDate\)|\$processStartedAtUtc = \(\[datetime\]\$process\.CreationDate\)|\$observedStartedAtUtc = \(\[datetime\]\$process\.CreationDate\)/);
  }

  assert.match(fresh, /\$processStartedAtUtc\.Ticks -ne \$receiptProcessStartedAtUtc\.Ticks/);
  assert.match(receipt, /\$observedStartedAtUtc\.Ticks -ne \$processStartedAtUtc\.Ticks/);
  assert.match(existing, /\$liveProcessStartedAtUtc\.Ticks -ne \$heartbeatProcessStartedAtUtc\.Ticks/);
});

test('watchdog probe verifies launch identity through an exact Process capability', async () => {
  const source = await readFile(probePath, 'utf8');
  const start = source.indexOf('function Get-VerifiedWorkerLaunchIdentity');
  const end = source.indexOf('$taskActionMatchesCanonicalWorker', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);

  assert.match(body, /\[System\.Diagnostics\.Process\]::GetProcessById\(\[int\]\$Process\.ProcessId\)/);
  assert.match(body, /\$null = \$processCapability\.Handle/);
  assert.match(body, /\$processStartedAtUtc = \$processCapability\.StartTime\.ToUniversalTime\(\)/);
  assert.doesNotMatch(body, /\$processStartedAtUtc = \(\[datetime\]\$Process\.CreationDate\)/);
  assert.match(body, /\$heartbeatWorkerStartedAtUtc\.Ticks -ne \$processStartedAtUtc\.Ticks/);
  assert.match(body, /\$receiptWorkerStartedAtUtc\.Ticks -ne \$processStartedAtUtc\.Ticks/);
});
