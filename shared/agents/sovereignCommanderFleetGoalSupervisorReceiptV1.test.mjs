import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLEET_SUPERVISOR_ACTION as ACTION, FLEET_SUPERVISOR_SCHEMA as SCHEMA,
  FLEET_SUPERVISOR_MARKER as MARKER, projectFleetConveyorObservationV1 as observe,
  projectFleetSupervisorReceiptV1 as project, compactFleetSupervisorReceiptV1 as compact,
} from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { readSovereignMaintenanceTerminalReceiptV1 as read,
  sovereignMaintenanceCustodyUnprovenV1 as custody,
  SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER as CUSTODY,
} from './sovereignMaintenanceAdmissionV1.mjs';
import { runSovereignCommanderFleetGoalSupervisor as runFleet,
  serializeFleetSupervisorTerminalV1 as serialize,
} from '../../scripts/sovereign-commander-fleet-goal-supervisor.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { startSovereignCommanderContinuousRepairGuardian } from '../../scripts/sovereign-commander-http.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

function receipt(overrides = {}) {
  return {
    schemaVersion: SCHEMA, ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_HELD_EXPLAINED',
    ...observe({ retryAdmission: { classification: 'SOURCE_DIFF_RETRY_REQUIRES_STRONGER_OWNER_ACCEPTANCE',
      retried: false, missionId: 'critical-2964-elastic-goal' },
    elasticAdmission: { classification: 'ELASTIC_GOAL_MISSIONS_AVAILABLE' },
    elasticIgnition: { held: [{ missionId: 'critical-2964-elastic-goal', reason: 'RESOURCE_SCOPE_CONFLICT' }] } }),
    activeMissionCount: 1, runningMissionCount: 0, runnableGoalCount: 1, availableSlotCount: 1,
    dispatchCount: 0, pickupPendingCount: 0, provenPickupCount: 0, heldGoalCount: 1,
    duplicateSchedulerAllowed: false, duplicateLeaseAllowed: false, mergeAuthority: false,
    runtimeMutationAuthority: false, arbitraryShellAllowed: false, daemonMayReportGreen: false,
    capabilityCompilerWorkCount: 0, nativeGapCandidateTotalCount: 0, nativeGapSourceHealth: 'CURRENT',
    blocker: '', ...overrides,
  };
}

test('actual retry and held observations expose only canonical issue and closed codes', () => {
  const projected = project(receipt(), 0);
  assert.deepEqual(projected.retryAdmission, { present: true,
    classification: 'SOURCE_DIFF_RETRY_REQUIRES_STRONGER_OWNER_ACCEPTANCE', retried: false, issueNumber: 2964 });
  assert.deepEqual(projected.held, { count: 1,
    reasons: [{ issueNumber: 2964, reasonCode: 'RESOURCE_SCOPE_CONFLICT' }], truncated: false });
  assert.equal(projected.dispatchCount, 0);
  assert.equal(projected.provenPickupCount, 0);
  assert.equal(projected.diagnosticOnly, true);
  assert.deepEqual(project(projected, 0), projected);
});

test('missing observations remain absent and unknown rather than successful empty admission', () => {
  assert.deepEqual(observe(), {
    retryAdmission: { present: false, classification: 'UNKNOWN', retried: null, issueNumber: null },
    admission: { present: false, classification: 'UNKNOWN', reasonCode: 'UNKNOWN' },
    held: { count: null, reasons: [], truncated: false },
  });
});

test('code-shaped secrets, dynamic exceptions, paths and contradictory identities do not escape', () => {
  const secret = 'GITHUB_PAT_PRIVATE_CODE_SHAPED_TOKEN';
  const result = observe({
    retryAdmission: { classification: secret, retried: false, missionId: 'C:\\private\\2964', requiredTests: secret },
    elasticAdmission: { classification: secret, reason: secret, held: [
      { issueNumber: 2964, missionId: 'critical-2955-elastic-goal', reason: 'MISSION_CREATE_FAILED:C:\\private' },
    ] },
    elasticIgnition: { held: [{ missionId: 'not-critical-2964', reason: secret, command: secret }] },
  });
  assert.equal(result.retryAdmission.classification, 'UNKNOWN');
  assert.equal(result.retryAdmission.issueNumber, null);
  assert.equal(result.admission.reasonCode, 'UNKNOWN');
  assert.deepEqual(result.held.reasons, [
    { issueNumber: null, reasonCode: 'UNKNOWN' }, { issueNumber: null, reasonCode: 'UNKNOWN' },
  ]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('held rows and secondary compaction preserve count and explicit omission', () => {
  const observed = observe({ elasticIgnition: { held: Array.from({ length: 50 }, (_, index) => ({
    missionId: `critical-${2964 + index}-elastic-goal`, reason: 'EXACT_EXTERNAL_ACTION_GRANT_UNAVAILABLE',
  })) } });
  const value = receipt(observed);
  assert.equal(value.held.count, 50);
  assert.equal(value.held.reasons.length, 8);
  assert.equal(value.held.truncated, true);
  const reduced = compact(value, 0);
  assert.deepEqual(reduced.held, { count: 50, reasons: [], truncated: true });
  assert.equal(reduced.dispatchCount, 0);
  assert.deepEqual(project(reduced), reduced);
});

test('malformed numbers, authority, outcome and inferred retry or pickup proof fail closed', () => {
  for (const value of [undefined, '', '0', NaN, -1, Infinity, 1.5]) {
    assert.equal(project(receipt({ dispatchCount: value }), 0), null);
  }
  assert.notEqual(project(receipt({ dispatchCount: null }), 0), null);
  for (const overrides of [
    { mergeAuthority: true }, { ok: 'true' }, { finalVerdict: 'UNKNOWN' },
    { finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED' },
    { provenPickupCount: 1 }, { dispatchCount: 1, pickupPendingCount: 0 },
    { retryAdmission: { present: true, classification: 'UNKNOWN', retried: true, issueNumber: 2964 } },
  ]) assert.equal(project(receipt(overrides), 0), null);
  assert.equal(project(receipt(), 2), null);
});

test('the terminal protocol requires one canonical final fleet marker and matching exit', () => {
  const wire = MARKER + JSON.stringify(receipt());
  for (const stdout of ['', '{}', 'OTHER=' + JSON.stringify(receipt()), wire + '\nlog-after-terminal',
    wire + '\n' + wire, wire.replace('"ok":true', '"ok":false,"ok":true'),
    wire.replace('"ok":true', '"ok" : true'),
    MARKER + JSON.stringify(receipt({ schemaVersion: 'unknown' })),
    'x'.repeat(65537),
  ]) assert.equal(custody({ status: 0 }, read(stdout, ACTION), ACTION), true);
  assert.equal(custody({ status: 0 }, read(wire, ACTION), ACTION), false);
  assert.equal(custody({ status: 2 }, read(wire, ACTION), ACTION), true);
  const failed = receipt({ ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED' });
  assert.equal(custody({ status: 2 }, read(MARKER + JSON.stringify(failed), ACTION), ACTION), false);
});

test('compact terminal preserves every traversed custody-negative branch and actual held exit', () => {
  const variants = [];
  for (const field of ['errorCode', 'blocker', 'controlPlaneResidualBlocker']) {
    for (const value of ['ETIMEDOUT', 'prefix ABORT_ERR suffix', CUSTODY]) {
      variants.push({ [field]: value }, { repair: { tasks: [{ [field]: value }] } });
    }
  }
  for (const field of ['steps', 'tasks', 'executionEvidence']) {
    variants.push({ [field]: {} }, { [field]: [null] }, { [field]: [[]] },
      { [field]: Array.from({ length: 129 }, () => ({})) });
  }
  for (const status of [null, undefined, '0', NaN]) variants.push({ status }, { repair: { status } });
  variants.push({ signal: 'SIGTERM' }, { repair: { signal: 'SIGTERM' } }, { repair: null }, { repair: [] });
  const shared = {};
  variants.push({ steps: [shared, shared] });
  const cycle = {}; cycle.repair = cycle; variants.push({ repair: cycle });
  let deep = {};
  for (let i = 0; i < 260; i++) deep = { repair: deep };
  variants.push({ repair: deep }, { schemaVersion: 'unknown' }, { ok: 'true' });
  for (const variant of variants) {
    const raw = receipt({ daemonMayReportGreen: true, ...variant });
    const rawStatus = raw.ok === true ? 0 : 2;
    assert.equal(custody({ status: rawStatus }, raw, ACTION), true);
    const terminal = serialize(raw), compacted = read(terminal.stdout, ACTION);
    assert.equal(terminal.exitCode, 2);
    assert.equal(compacted.ok, false);
    assert.equal(compacted.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED');
    assert.equal(compacted.daemonMayReportGreen, false);
    assert.equal(compacted.blocker, CUSTODY);
    assert.equal(custody({ status: terminal.exitCode }, compacted, ACTION), true);
    assert.ok(Buffer.byteLength(terminal.stdout) < 16 * 1024);
  }
});

test('ordinary holds, optional unknowns and mandatory-invalid action failures do not invent custody', () => {
  const controls = [
    receipt(), receipt({ ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED',
      blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING' }),
    receipt({ dispatchCount: 'UNKNOWN' }), receipt({ retryAdmission: null }),
    receipt({ finalVerdict: 'UNRECOGNIZED_OUTCOME' }), receipt({ mergeAuthority: true }),
    receipt({ blocker: 'x'.repeat(151) + 'ETIMEDOUTX' }),
    receipt({ commanderParity: { privateInventory: 'secret'.repeat(20_000) } }),
  ];
  for (const raw of controls) {
    assert.equal(custody({ status: raw.ok ? 0 : 2 }, raw, ACTION), false);
    const terminal = serialize(raw), compacted = read(terminal.stdout, ACTION);
    assert.equal(custody({ status: terminal.exitCode }, compacted, ACTION), false);
    if (raw.finalVerdict === 'UNRECOGNIZED_OUTCOME' || raw.mergeAuthority) {
      assert.equal(terminal.exitCode, 2);
      assert.equal(project(compacted, terminal.exitCode), null);
    }
  }
  const valid = serialize(receipt());
  for (const execution of [{ status: null }, { status: 0, signal: 'SIGTERM' }]) {
    assert.equal(custody(execution, read(valid.stdout, ACTION), ACTION), true);
  }
});

test('large actual fleet result fits real Commander capture and preserves private consumer guards', async () => {
  const parity = { ok: true, buildableGapCount: 0, capabilityCompiler: { buildableCapabilityCount: 3 },
    nativeGapIntake: { candidateTotalCount: 500 }, nativeGapSourceHealth: 'DEGRADED',
    privateInventory: 'C:\\PRIVATE\\TOKEN'.repeat(10_000) };
  const raw = await runFleet({ reconcileCommanderParity: async () => parity,
    conveyor: async () => ({ ok: true, classification: 'ELASTIC_GOAL_MISSION_SELECTED', programmeStatus: 'READY',
      elasticAdmission: { activeMissions: [], runnableMissions: [] },
      elasticIgnition: { availableSlots: 1, dispatchCount: 0, held: [] } }) });
  assert.equal(raw.commanderParity, parity);
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > 16 * 1024);
  const terminal = serialize(raw);
  assert.ok(Buffer.byteLength(terminal.stdout) < 16 * 1024);
  assert.equal(terminal.stdout.includes('PRIVATE'), false);
  const root = '/tmp/stephanos-fleet-receipt-test';
  const command = buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'fleet-receipt-test', missionId: 'same-owner-mission', operation: 'MAINTENANCE_ACTION',
    payload: { actionId: ACTION },
  });
  const guardian = startSovereignCommanderContinuousRepairGuardian({
    setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl() {},
    spawnImpl() { assert.fail('no real process or runtime cycle'); },
  });
  try {
    let starts = 0;
    const result = await executeSovereignCommanderCommandV1(command, {
      repoRoot: root, withMaintenanceOwner: (request, run) => guardian.withMaintenanceOwner(request, run),
      spawnSyncFn: (_exe, args) => {
        starts++; assert.match(args[0], /sovereign-commander-fleet-goal-supervisor\.mjs$/);
        return { status: terminal.exitCode, stdout: terminal.stdout, stderr: '' };
      },
    });
    assert.equal(starts, 1);
    assert.equal(result.ok, true);
    assert.equal(result.structuredContent.stdout, terminal.stdout);
    const parsed = read(result.structuredContent.stdout, ACTION);
    assert.equal(parsed.capabilityCompilerWorkCount, 3);
    assert.equal(parsed.nativeGapCandidateTotalCount, 500);
    assert.equal(parsed.nativeGapSourceHealth, 'DEGRADED');
    assert.equal(parsed.daemonMayReportGreen, false);
    assert.equal(project(parsed, 0).provenPickupCount, 0);
    assert.equal(guardian.status().timeoutCustodyHeld, false);
    const next = await guardian.withMaintenanceOwner({}, async () => ({ ok: true, structuredContent: { status: 0 } }));
    assert.equal(next.ok, true, 'fresh terminal permits the next normal owner action');
  } finally { guardian.stop(); }
});
