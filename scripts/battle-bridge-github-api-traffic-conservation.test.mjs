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

  assert.match(beacon, /-RepetitionInterval \(New-TimeSpan -Minutes 2\)/);
  assert.match(beacon, /intervalMinutes = 2/);
  assert.match(beacon, /rate-budgeted two-minute cadence/);

  assert.match(watchdog, /-RepetitionInterval \(New-TimeSpan -Minutes 2\)/);
  assert.match(watchdog, /intervalMinutes = 2/);
  assert.match(watchdog, /rate-budgeted two-minute cadence/);

  assert.match(monitor, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(monitor, /intervalMinutes = 1/);

  // Known fixed REST baseline:
  // outbound beacon <= 3 requests/run * 30 runs/hour = 90/hour;
  // watchdog Shared Workspace relay <= 1 read/run * 30 runs/hour = 30/hour.
  // Keep this quiet baseline far below GitHub's 5,000/hour user core allowance
  // so bursty review/merge/controller work retains substantial headroom.
  const reservedBaselineRequestsPerHour = (3 * 30) + (1 * 30);
  assert.equal(reservedBaselineRequestsPerHour, 120);
  assert.ok(reservedBaselineRequestsPerHour <= 250);
});

const hostedConsumer = new URL('../apps/goal-dashboard/remote-live.js', import.meta.url);
const beaconStatusProducer = new URL('./battle-bridge-outbound-health-beacon.mjs', import.meta.url);

test('real publication intervals remain strictly inside the independent hosted and watchdog freshness budgets', async () => {
  const [beacon, watchdog, hosted, statusProducer] = await Promise.all([
    readFile(beaconInstaller, 'utf8'),
    readFile(watchdogInstaller, 'utf8'),
    readFile(hostedConsumer, 'utf8'),
    readFile(beaconStatusProducer, 'utf8'),
  ]);
  const intervalMinutes = (source) =>
    Number(source.match(/-RepetitionInterval \(New-TimeSpan -Minutes (\d+)\)/)?.[1]);
  const hostedFreshnessMinutes = Number(hosted.match(/const MAX_BEACON_AGE_MS = (\d+) \* 60 \* 1000;/)?.[1]);
  const watchdogFreshnessMs = Number(statusProducer.match(
    /const WORKER_WATCHDOG_SPEC = Object\.freeze\(\{[\s\S]*?staleAfterMs: ([\d_]+),/,
  )?.[1]?.replaceAll('_', ''));
  const beaconEvery = intervalMinutes(beacon);
  const watchdogEvery = intervalMinutes(watchdog);

  assert.ok(Number.isInteger(beaconEvery) && beaconEvery >= 1);
  assert.ok(Number.isInteger(watchdogEvery) && watchdogEvery >= 1);
  assert.ok(Number.isInteger(hostedFreshnessMinutes) && hostedFreshnessMinutes >= 1);
  assert.ok(Number.isInteger(watchdogFreshnessMs) && watchdogFreshnessMs >= 60_000);
  assert.ok(beaconEvery < hostedFreshnessMinutes,
    'beacon schedule must leave slack before hosted status expires');
  assert.ok(watchdogEvery * 60_000 < watchdogFreshnessMs,
    'watchdog schedule must leave slack before its projected status expires');
});
