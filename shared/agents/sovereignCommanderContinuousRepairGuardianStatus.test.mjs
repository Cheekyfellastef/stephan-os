import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { projectSovereignContinuousRepairGuardianStatus } from './sovereignCommanderRemoteMailboxV1.mjs';

test('missing or malformed guardian telemetry is UNKNOWN, never fabricated green', () => {
  for (const input of [null, undefined, [], {}, { enabled: 'true' }]) {
    const result = projectSovereignContinuousRepairGuardianStatus(input);
    assert.equal(result.available, false);
    assert.equal(result.enabled, null);
    assert.equal(result.loopState, 'UNKNOWN');
    assert.equal(result.cycleCount, null);
    assert.equal(result.autonomousMaterialRepairProven, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.secretMaterialReturned, false);
  }
});

test('healthy HTTP guardian counters prove loop execution but not real material repair', () => {
  const result = projectSovereignContinuousRepairGuardianStatus({
    enabled: true,
    running: false,
    scheduled: true,
    cycleCount: 3,
    successCount: 1,
    failureCount: 2,
    lastOk: false,
    lastStartedAtUtc: '2026-10-10T13:59:00.000Z',
    lastCompletedAtUtc: '2026-10-10T14:01:00.000Z',
    lastBlocker: 'EXACT_READ_ONLY_REVIEW_PHASE_NOT_PROVEN',
    lastFinalVerdict: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED',
    token: 'should-not-escape',
    secrets: ['should-not-escape'],
  });
  assert.equal(result.loopState, 'CYCLES_OBSERVED');
  assert.equal(result.cycleCount, 3);
  assert.equal(result.failureCount, 2);
  assert.equal(result.lastOk, false);
  assert.equal(result.lastBlocker, 'EXACT_READ_ONLY_REVIEW_PHASE_NOT_PROVEN');
  assert.equal(result.autonomousMaterialRepairProven, false);
  assert.equal('token' in result, false);
  assert.equal('secrets' in result, false);
  assert.ok(Object.isFrozen(result));
});

test('disabled or stalled guardian is non-green and invalid fields fail closed', () => {
  assert.equal(projectSovereignContinuousRepairGuardianStatus({ enabled: false, running: false, scheduled: false, cycleCount: 6 }).loopState, 'DISABLED');
  assert.equal(projectSovereignContinuousRepairGuardianStatus({ enabled: true, running: false, scheduled: false, cycleCount: 6 }).loopState, 'NOT_SCHEDULED');
  assert.equal(projectSovereignContinuousRepairGuardianStatus({ enabled: true, running: false, scheduled: true, cycleCount: 0 }).loopState, 'AWAITING_FIRST_CYCLE');
  const invalid = projectSovereignContinuousRepairGuardianStatus({
    enabled: true, running: true, scheduled: false, cycleCount: -1,
    failureCount: Number.POSITIVE_INFINITY,
    lastBlocker: 'secret=leak', lastFinalVerdict: '../etc/passwd',
    lastCompletedAtUtc: 'not-a-date',
  });
  assert.equal(invalid.loopState, 'UNKNOWN');
  assert.equal(invalid.cycleCount, null);
  assert.equal(invalid.failureCount, null);
  assert.equal(invalid.lastBlocker, '');
  assert.equal(invalid.lastFinalVerdict, '');
  assert.equal(invalid.lastCompletedAtUtc, '');
  assert.equal(invalid.autonomousMaterialRepairProven, false);
});

test('existing bounded authenticated status uses live HTTP health guardian, not invented counters', async () => {
  const source = await readFile(new URL('./sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /health = exchange\.response\.ok \? parsedHealth : null/);
  assert.match(source, /continuousRepairGuardian: projectSovereignContinuousRepairGuardianStatus\(health\.continuousRepairGuardian\)/);
  assert.match(source, /if \(shape\.command\.remoteAction === 'status'\)/);
});
