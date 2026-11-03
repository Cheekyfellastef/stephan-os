import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildSovereignCommanderRepairReport,
  classifySovereignCommanderRepairOutcome,
  publishSovereignCommanderRepairReport,
  SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE,
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


test('residual control-plane installer failure remains ATTENTION_REQUIRED after builder recovery', () => {
  const repair = {
    ok: false,
    blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
    sourceHead: HEAD,
    builderFlowRecovered: true,
    controlPlaneRepairComplete: false,
    controlPlaneResidualBlocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
    steps: [
      { actionId: 'repair-goal-builder-flow', ok: true, finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN', blocker: '' },
      { actionId: 'repair-control-plane', ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_BLOCKED', blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED' },
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

  const report = buildSovereignCommanderRepairReport({
    repair,
    cycleId: 'cycle-residual-control-plane',
    startedAtUtc: '2026-10-06T15:50:00.000Z',
    completedAtUtc: '2026-10-06T15:50:03.000Z',
  });

  assert.equal(report.outcome, 'BLOCKED');
  assert.equal(report.status.status, 'ATTENTION_REQUIRED');
  assert.deepEqual(report.status.detectedFaults, ['CONTROL_PLANE_FIXED_INSTALLER_FAILED']);
  assert.equal(report.status.verification.awake, true);
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

test('repair report preserves missing or invalid heartbeat age as unknown, not zero', () => {
  for (const heartbeatAgeSeconds of [undefined, null, -1, 'not-a-number']) {
    const report = buildSovereignCommanderRepairReport({
      repair: {
        ok: false, blocker: 'CORE_HEARTBEAT_UNPROVEN', sourceHead: HEAD,
        core: { heartbeatAgeSeconds, heartbeatFresh: false, busyGraceActive: false },
      },
      cycleId: 'unknown-heartbeat',
    });
    assert.equal(report.status.verification.heartbeatAgeSeconds, null);
    assert.equal(report.status.verification.heartbeatFresh, false);
    assert.equal(report.status.status, 'ATTENTION_REQUIRED');
  }
});

const qualifiedMaintenance = () => ({
  scope: SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE,
  ok: true, blocker: '', sourceHead: HEAD,
  maintenance: {
    actionId: 'repair-goal-builder-flow', profile: 'MAINTENANCE_GOAL_BUILDER_V1',
    operationOk: true, terminalProven: true,
    terminalEvidenceSha256: 'b'.repeat(64), proofHash: 'c'.repeat(64),
  },
  steps: [{ actionId: 'repair-goal-builder-flow', ok: true,
    finalVerdict: 'SOVEREIGN_QUALIFIED_MAINTENANCE_COMPLETED', blocker: '' }],
});

test('qualified maintenance completion preserves its bounded scope and never claims whole-system health', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-maintenance-report-'));
  try {
    const repair = { ...qualifiedMaintenance(),
      core: { readiness: 'READY', wakeState: 'AWAKE', awake: true, repairRequired: false } };
    const published = await publishSovereignCommanderRepairReport({
      repair, workspaceRoot, repoRoot: process.cwd(), cycleId: 'qualified-maintenance',
    });
    assert.equal(published.ok, true);
    assert.equal(published.outcome, 'MAINTENANCE_COMPLETED');
    assert.equal(published.status, 'OBSERVED');
    const current = JSON.parse(await readFile(join(workspaceRoot, 'status', 'sovereign-commander-repair-current.json'), 'utf8'));
    const event = JSON.parse((await readFile(join(workspaceRoot, 'events', 'sovereign-commander-repair-cycles.ndjson'), 'utf8')).trim());
    for (const record of [current, event]) {
      assert.equal(record.scope, SOVEREIGN_QUALIFIED_MAINTENANCE_SCOPE);
      assert.equal(record.fullStephanosRepairProven, false);
      assert.equal(record.verification.readiness, 'UNPROVEN');
      assert.equal(record.verification.operationCompleted, true);
      assert.equal(record.verification.runtimeQualificationGranted, false);
      assert.equal(record.verification.terminalEvidenceSha256, 'b'.repeat(64));
      assert.deepEqual(record.detectedFaults, []);
      assert.doesNotMatch(record.summary, /verified Stephanos healthy|repaired Stephanos/);
      assert.equal('awake' in record.verification, false);
    }
  } finally { await rm(workspaceRoot, { recursive: true, force: true }); }
});

test('unbound, malformed and broader maintenance claims remain blocked', () => {
  const variants = [
    { sourceHead: '' }, { sourceHead: 'a'.repeat(39) }, { ok: 'true' },
    { blocker: 'FIXED_RUNTIME_OPERATION_CANCELLED' },
    { scope: 'ALL_STEPHANOS_REPAIRED' },
    ...[
      { actionId: 'repair-stephanos' }, { profile: 'SOURCE_TASK_V1' },
      { operationOk: false }, { operationOk: 'true' },
      { terminalProven: false }, { terminalProven: 'true' },
      { terminalEvidenceSha256: '' }, { terminalEvidenceSha256: 'private-path' },
      { proofHash: '' }, { proofHash: 'a'.repeat(63) },
    ].map(patch => ({ maintenance: { ...qualifiedMaintenance().maintenance, ...patch } })),
  ];
  for (const patch of variants) {
    const report = buildSovereignCommanderRepairReport({ repair: { ...qualifiedMaintenance(), ...patch } });
    assert.equal(report.outcome, 'BLOCKED', JSON.stringify(patch));
    assert.equal(report.status.status, 'ATTENTION_REQUIRED');
    assert.ok(report.status.detectedFaults.length > 0);
  }
  const denied = buildSovereignCommanderRepairReport({ repair: {
    ...qualifiedMaintenance(), ok: false, sourceHead: '',
    blocker: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD', maintenance: undefined,
    steps: [{ actionId: 'repair-goal-builder-flow', ok: false,
      blocker: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD' }],
  } });
  assert.equal(denied.outcome, 'BLOCKED');
  assert.deepEqual(denied.status.detectedFaults, ['FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD']);
  assert.equal(denied.status.verification.operationCompleted, false);
  assert.equal(denied.status.verification.runtimeQualificationGranted, false);
});
