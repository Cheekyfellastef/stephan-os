import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSovereignCommanderRepairReport,
  classifySovereignCommanderRepairOutcome,
  publishSovereignCommanderRepairReport,
} from './sovereignCommanderRepairReportV1.mjs';

const HEAD = 'a'.repeat(40);

test('repair reporting classifies verified green cycles as HEALTHY', () => {
  const repair = {
    ok: true,
    sourceHead: HEAD,
    steps: [
      { actionId: 'caretaker', ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY', blocker: '' },
      { actionId: 'core-proof', ok: true, finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS', blocker: '' },
    ],
    core: {
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      heartbeatFresh: true,
      heartbeatAgeSeconds: 2,
    },
  };

  assert.equal(classifySovereignCommanderRepairOutcome(repair), 'HEALTHY');
  const report = buildSovereignCommanderRepairReport({
    repair,
    cycleId: 'cycle-1',
    startedAtUtc: '2026-10-05T22:00:00.000Z',
    completedAtUtc: '2026-10-05T22:00:02.000Z',
  });
  assert.equal(report.outcome, 'HEALTHY');
  assert.equal(report.status.status, 'READY');
  assert.equal(report.status.verification.awake, true);
  assert.deepEqual(report.status.detectedFaults, []);
});

test('repair reporting distinguishes applied repair from an already healthy cycle', () => {
  const repaired = {
    ok: true,
    sourceHead: HEAD,
    steps: [
      { actionId: 'caretaker', ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_RESTARTED', blocker: '' },
    ],
    core: { readiness: 'READY', wakeState: 'AWAKE', awake: true, repairRequired: false },
  };
  assert.equal(classifySovereignCommanderRepairOutcome(repaired), 'REPAIRED');
});

test('repair reporting publishes blocked truth to current status and event stream', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-repair-report-'));
  try {
    const result = await publishSovereignCommanderRepairReport({
      workspaceRoot,
      repoRoot: process.cwd(),
      cycleId: 'cycle-blocked',
      startedAtUtc: '2026-10-05T22:10:00.000Z',
      completedAtUtc: '2026-10-05T22:10:03.000Z',
      repair: {
        ok: false,
        blocker: 'BACKEND_8787_UNHEALTHY_AFTER_REPAIR',
        sourceHead: HEAD,
        steps: [
          {
            actionId: 'status-stephanos-core-daemon',
            ok: false,
            finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_BLOCKED',
            blocker: 'BACKEND_8787_UNHEALTHY_AFTER_REPAIR',
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'BLOCKED');

    const current = JSON.parse(await readFile(
      join(workspaceRoot, 'status', 'sovereign-commander-repair-current.json'),
      'utf8',
    ));
    assert.equal(current.outcome, 'BLOCKED');
    assert.equal(current.status, 'ATTENTION_REQUIRED');
    assert.deepEqual(current.detectedFaults, ['BACKEND_8787_UNHEALTHY_AFTER_REPAIR']);

    const events = (await readFile(
      join(workspaceRoot, 'events', 'sovereign-commander-repair-cycles.ndjson'),
      'utf8',
    )).trim().split(/\r?\n/);
    assert.equal(events.length, 1);
    assert.equal(JSON.parse(events[0]).cycleId, 'cycle-blocked');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
