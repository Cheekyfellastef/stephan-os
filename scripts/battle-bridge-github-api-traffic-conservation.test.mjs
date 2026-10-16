import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const beaconInstaller = new URL('./windows/install-battle-bridge-outbound-health-beacon.ps1', import.meta.url);
const watchdogInstaller = new URL('./windows/install-battle-bridge-worker-watchdog.ps1', import.meta.url);
const monitorInstaller = new URL('./windows/install-battle-bridge-monitor-multiplexer.ps1', import.meta.url);

test('GitHub REST-heavy Battle Bridge publishers use a bounded traffic budget while local monitoring stays fast', async () => {
  const [beacon, watchdog, monitor] = await Promise.all([
    readFile(beaconInstaller, 'utf8'),
    readFile(watchdogInstaller, 'utf8'),
    readFile(monitorInstaller, 'utf8'),
  ]);

  assert.match(beacon, /-RepetitionInterval \(New-TimeSpan -Minutes 10\)/);
  assert.match(beacon, /intervalMinutes = 10/);
  assert.match(beacon, /rate-budgeted ten-minute cadence/);

  assert.match(watchdog, /-RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(watchdog, /intervalMinutes = 5/);
  assert.match(watchdog, /rate-budgeted five-minute cadence/);

  assert.match(monitor, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(monitor, /intervalMinutes = 1/);

  // Known fixed REST baseline:
  // outbound beacon <= 3 requests/run * 6 runs/hour = 18/hour;
  // watchdog Shared Workspace relay <= 1 read/run * 12 runs/hour = 12/hour.
  // Keep this quiet baseline far below GitHub's 5,000/hour user core allowance
  // so bursty review/merge/controller work retains substantial headroom.
  const reservedBaselineRequestsPerHour = (3 * 6) + (1 * 12);
  assert.equal(reservedBaselineRequestsPerHour, 30);
  assert.ok(reservedBaselineRequestsPerHour <= 250);
});
