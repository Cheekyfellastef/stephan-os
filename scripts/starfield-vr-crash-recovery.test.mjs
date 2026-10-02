import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const diagnosis = await readFile(new URL('./windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url), 'utf8');
const report = await readFile(new URL('./report-starfield-vr-telemetry.mjs', import.meta.url), 'utf8');

test('Starfield VR telemetry checkpoints every sample instead of waiting for clean shutdown', () => {
  assert.match(performance, /Export-Csv -LiteralPath \$session\.telemetryPath -NoTypeInformation -Append/);
  assert.match(performance, /Set-SessionLifecycle -Session \$session -Status 'GUARDING'/);
  assert.match(performance, /lastHeartbeatAtUtc/);
  assert.match(performance, /lastSampleAtUtc/);
  assert.match(performance, /sampleCount/);
});

test('Starfield VR guard captures crash evidence and still finalises after guard errors', () => {
  assert.match(performance, /function Get-StarfieldCrashEvidence/);
  assert.match(performance, /Get-WinEvent/);
  assert.match(performance, /Starfield\\\.exe/);
  assert.match(performance, /\$guardFailure = ''/);
  assert.match(performance, /catch \{/);
  assert.match(performance, /'CRASHED'/);
  assert.match(performance, /'GUARD_FAILED'/);
  assert.match(performance, /partialTelemetry/);
  assert.match(performance, /crashEvidence = @\(\$crashEvidence\)/);
});

test('recent abandoned Starfield VR sessions are recovered without operator clicks', () => {
  assert.match(performance, /function Recover-AbandonedPerformanceSessions/);
  assert.match(performance, /AddHours\(-12\)/);
  assert.match(performance, /Select-Object -First 3/);
  assert.match(performance, /Restore-Session -Session \$candidate/);
  assert.match(performance, /recoveredAfterAbandonment = \$true/);
  assert.match(performance, /\[ValidateSet\('Enter','Guard','Restore','Recover'\)\]/);
  assert.match(performance, /Recover-AbandonedPerformanceSessions -SessionRoot \$sessionRoot/);
});

test('crash sessions become first-class diagnosis and shared telemetry signals', () => {
  assert.match(diagnosis, /starfield-vr-crash-observed/);
  assert.match(diagnosis, /partial-telemetry-session/);
  assert.match(diagnosis, /'CRASH_FORENSICS'/);
  assert.match(diagnosis, /crashEvidenceCount/);
  assert.match(report, /sessionOutcome/);
  assert.match(report, /partialTelemetry/);
  assert.match(report, /crashEvidenceCount/);
});
