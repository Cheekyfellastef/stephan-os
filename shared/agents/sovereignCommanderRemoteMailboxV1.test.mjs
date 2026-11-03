import { CANONICAL_MAILBOX_ISSUE as activeMailboxIssueForTest } from './canonicalMailboxAuthorityV1.mjs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { FLEET_SUPERVISOR_ACTION, FLEET_SUPERVISOR_SCHEMA, FLEET_SUPERVISOR_MARKER,
  projectFleetConveyorObservationV1 } from './sovereignCommanderFleetGoalSupervisorReceiptV1.mjs';
import { serializeFleetSupervisorTerminalV1 } from '../../scripts/sovereign-commander-fleet-goal-supervisor.mjs';
import { startSovereignCommanderContinuousRepairGuardian } from '../../scripts/sovereign-commander-http.mjs';
import { SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } from './sovereignMaintenanceAdmissionV1.mjs';
import { buildSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { STEPHANOS_EXECUTION_SURFACE, buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1 } from './stephanosExecutionCommandFabricV1.mjs';
import { checkpointTerminalMailboxReceipt, createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson } from '../../scripts/battle-bridge-github-command-mailbox.mjs';
import { projectBoundedRemoteControllerLaneStatus } from '../../scripts/sovereign-controller-lane-status.mjs';

import {
  SOVEREIGN_COMMANDER_REMOTE_OPERATION,
  SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS,
  SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS,
  SOVEREIGN_COMMANDER_REMOTE_REPAIR_NETWORK_TIMEOUT_MS,
  SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS,
  executeSovereignCommanderRemoteOnBattleBridge,
  diagnoseRescueIslandNativeReceiptInvalidV1,
  sovereignCommanderRemoteNetworkTimeoutMs,
  sovereignCommanderRemotePlanStepTimeoutMs,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'e42d31670da802cc15d4c323dd8dcff10a03033f';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'sovereign-mobile-1001',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: activeMailboxIssueForTest,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-10-01T12:00:00.000Z',
    remoteAction: 'status',
    ...overrides,
  };
}

function spawnForHead(head = HEAD) {
  return (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
}

function response(body, { status = 200, sessionId = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId : '' },
    json: async () => body,
    text: async () => body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

function mcpFetch({ maintenance = null, maintenanceByAction = {}, config = null, configReceipt = null, configIsError = false, archiveDedicatedAdvertised = true } = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) {
      return response({
        ok: true,
        service: 'stephanos-sovereign-commander',
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
      });
    }
    const message = JSON.parse(options.body || '{}');
    if (message.method === 'initialize') {
      return response({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }, { sessionId: 'session-1' });
    }
    if (message.method === 'notifications/initialized') return response(null, { status: 202, sessionId: 'session-1' });
    if (message.method === 'tools/list') {
      return response({
        jsonrpc: '2.0',
        id: 2,
        result: { tools: [{ name: 'get_config' }, { name: 'maintenance_action' }, ...(archiveDedicatedAdvertised ? [{ name: 'starfield_vr_telemetry_archive' }] : []), { name: 'search_project' }] },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'get_config') {
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          isError: configIsError,
          structuredContent: configReceipt || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'c'.repeat(64),
            structuredContent: config || {
              implementation: 'stephanos-local-node',
              vendorMeterRequired: false,
              externalSaasRelayRequired: false,
              sourceControlledMaintenanceOnly: true,
              arbitraryUnboundedCommandAllowed: false,
              mergeAuthority: false,
              pcRestartAuthority: false,
              canRunFocusedNodeTests: false,
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'search_project') {
      return response({
        jsonrpc: '2.0',
        id: 4,
        result: {
          structuredContent: {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'd'.repeat(64),
            contentText: 'PRIVATE SEARCH PREVIEW MUST NOT ESCAPE',
            structuredContent: {
              resultCount: 2,
              truncated: false,
              results: [
                { relativePath: 'shared/agents/sovereignCommanderV1.mjs', line: 42, column: 7, preview: 'PRIVATE PREVIEW' },
                { relativePath: 'scripts/sovereign-commander-mcp.mjs', line: 88, column: 3, preview: 'PRIVATE PREVIEW 2' },
              ],
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && ['maintenance_action', 'starfield_vr_telemetry_archive'].includes(message.params?.name)) {
      const actionId = message.params.arguments.actionId || 'starfield-vr-telemetry-archive';
      const selectedMaintenance = maintenanceByAction[actionId] || maintenance;
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          isError: selectedMaintenance?.ok === false,
          structuredContent: selectedMaintenance || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'a'.repeat(64),
            command: { plan: { processId: actionId } },
            contentText: 'SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE',
            structuredContent: {
              ok: true,
              status: 0,
              stdout: 'PRIVATE RAW STDOUT',
              stderr: '',
              errorCode: '',
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    return response({ error: 'unexpected' }, { status: 500 });
  };
  return { calls, fetchFn };
}

const readToken = async () => 'x'.repeat(44);

function fleetReceiptRaw(overrides = {}) {
  return {
    schemaVersion: FLEET_SUPERVISOR_SCHEMA, ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_HELD_EXPLAINED',
    ...projectFleetConveyorObservationV1({
      retryAdmission: { classification: 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN',
        retried: false, missionId: 'critical-2964-elastic-goal' },
      elasticAdmission: { classification: 'ELASTIC_GOAL_MISSIONS_HELD' },
      elasticIgnition: { held: [{ issueNumber: 2964, reason: 'EXISTING_GOAL_MISSION_BLOCKED_SIDELINED' }] },
    }),
    activeMissionCount: 0, runningMissionCount: 0, runnableGoalCount: 1, availableSlotCount: 1,
    dispatchCount: 0, pickupPendingCount: 0, provenPickupCount: 0, heldGoalCount: 1,
    duplicateSchedulerAllowed: false, duplicateLeaseAllowed: false, mergeAuthority: false,
    runtimeMutationAuthority: false, arbitraryShellAllowed: false,
    daemonMayReportGreen: false, capabilityCompilerWorkCount: 0,
    nativeGapCandidateTotalCount: 0, nativeGapSourceHealth: 'CURRENT',
    blocker: '', ...overrides,
  };
}

function fleetOwnerCommand(processId = FLEET_SUPERVISOR_ACTION) {
  const repoRoot = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
  return buildSovereignCommanderCommandV1(buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'private-command-must-not-escape', missionId: 'private-mission-must-not-escape',
    operation: 'MAINTENANCE_ACTION', payload: { actionId: processId },
  }), { repoRoot });
}

function fleetMaintenanceEnvelope({ raw = fleetReceiptRaw(), stdout, status, processId = FLEET_SUPERVISOR_ACTION } = {}) {
  const terminal = serializeFleetSupervisorTerminalV1(raw);
  const actualStatus = status ?? terminal.exitCode;
  return {
    ok: actualStatus === 0,
    finalVerdict: actualStatus === 0 ? 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' : 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    proofHash: 'f'.repeat(64), blocker: raw.blocker,
    command: fleetOwnerCommand(processId),
    contentText: 'PRIVATE_CONTENT_MUST_NOT_ESCAPE',
    structuredContent: { ok: actualStatus === 0, status: actualStatus,
      stdout: stdout ?? terminal.stdout, stderr: 'PRIVATE_STDERR_MUST_NOT_ESCAPE', errorCode: '', signal: '' },
  };
}

async function runFleetRemote(maintenance, overrides = {}) {
  const { fetchFn } = mcpFetch({ maintenance });
  return executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: FLEET_SUPERVISOR_ACTION, ...overrides }), {
    spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
    ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
  });
}

async function runFleetRemotePlan(maintenance) {
  const { calls, fetchFn } = mcpFetch({ maintenanceByAction: { [FLEET_SUPERVISOR_ACTION]: maintenance } });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '',
    remotePlan: [FLEET_SUPERVISOR_ACTION, 'battle-bridge-status'] }), {
    spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
    ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
  });
  return { calls, result };
}

test('actual guardian denials survive fleet mailbox projection without requiring an unlaunched child receipt', async () => {
  const held = startSovereignCommanderContinuousRepairGuardian({ enabled: false,
    custodyStore: { status: () => ({ held: true }), close() {} },
    spawnImpl: () => assert.fail('denied guardian must never launch a process'),
  });
  const stopped = startSovereignCommanderContinuousRepairGuardian({ enabled: false });
  stopped.stop();
  const busy = startSovereignCommanderContinuousRepairGuardian({ enabled: false });
  const ownerCommand = fleetOwnerCommand();
  let finish;
  const inFlight = busy.withMaintenanceOwner(ownerCommand, () => new Promise(resolve => { finish = resolve; }));
  try {
    for (const [guardian, expectedBlocker] of [
      [held, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER],
      [stopped, 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE'],
      [busy, 'SOVEREIGN_MAINTENANCE_OWNER_BUSY'],
    ]) {
      const denial = await guardian.withMaintenanceOwner(ownerCommand, () => assert.fail('denial ran the action'));
      assert.equal(denial.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED');
      assert.equal(Object.hasOwn(denial, 'structuredContent'), false);
      for (const depth of [0, 1, 4]) {
        let envelope = denial;
        for (let i = 0; i < depth; i++) envelope = { structuredContent: envelope };
        const single = await runFleetRemote(envelope);
        const { result: plan, calls } = await runFleetRemotePlan(envelope);
        for (const result of [single, plan]) {
          assert.equal(result.ok, false);
          assert.equal(result.executionBlocker, expectedBlocker);
          assert.equal(result.processId, FLEET_SUPERVISOR_ACTION);
          assert.equal(result.status, null);
          assert.equal(Object.hasOwn(result, 'fleetSupervisor'), false);
          assert.equal(result.publicReceiptSafe, true);
          assert.equal(result.secretMaterialReturned, false);
          assert.equal(JSON.stringify(result).includes(ownerCommand.commandId), false);
        }
        assert.equal(single.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
        assert.equal(plan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED');
        assert.equal(plan.stepCount, 0);
        assert.equal(calls.some(call => call.options?.body?.includes('"actionId":"battle-bridge-status"')), false);
      }
    }
    assert.equal(held.status().timeoutCustodyHeld, true);
  } finally {
    finish(fleetMaintenanceEnvelope());
    await inFlight;
    held.stop(); busy.stop();
  }
});

test('fleet timeout and abort remain unknown-custody failures through direct and nested envelopes', async () => {
  for (const errorCode of ['ETIMEDOUT', 'ABORT_ERR']) {
    const failure = { ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      command: fleetOwnerCommand(), blocker: 'PRIVATE_CODE_SHAPED_TOKEN',
      structuredContent: { ok: false, status: null, errorCode, stdout: 'PRIVATE STDOUT', stderr: 'PRIVATE STDERR' } };
    for (const envelope of [failure, { structuredContent: failure }]) {
      const single = await runFleetRemote(envelope);
      const { result: plan, calls } = await runFleetRemotePlan(envelope);
      for (const result of [single, plan]) {
        assert.equal(result.ok, false);
        assert.equal(result.executionBlocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
        assert.equal(result.errorCode, errorCode);
        assert.equal(result.status, null);
        assert.equal(Object.hasOwn(result, 'fleetSupervisor'), false);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
      }
      assert.equal(calls.some(call => call.options?.body?.includes('"actionId":"battle-bridge-status"')), false);
    }
  }
});

test('guardian post-execution custody hold cannot be mistaken for fleet completion', async () => {
  for (const errorCode of ['', 'ETIMEDOUT', 'ABORT_ERR']) {
    const guardian = startSovereignCommanderContinuousRepairGuardian({ enabled: false });
    try {
      const execution = fleetMaintenanceEnvelope({ stdout: 'PRIVATE MALFORMED CHILD RECEIPT' });
      if (errorCode) {
        execution.ok = false;
        execution.finalVerdict = 'SOVEREIGN_COMMANDER_EXECUTION_FAILED';
        execution.structuredContent = { ...execution.structuredContent, ok: false, status: null, errorCode };
      }
      const held = await guardian.withMaintenanceOwner(execution.command, async () => execution);
      assert.equal(held.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED');
      assert.equal(guardian.status().timeoutCustodyHeld, true);
      for (const result of [await runFleetRemote(held), (await runFleetRemotePlan(held)).result]) {
        assert.equal(result.ok, false);
        assert.equal(result.executionBlocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
        assert.equal(result.status, null);
        assert.equal(result.errorCode, errorCode);
        assert.equal(Object.hasOwn(result, 'fleetSupervisor'), false);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
      }
      assert.equal(guardian.status().timeoutCustodyHeld, true);
    } finally { guardian.stop(); }
  }
});

test('unbound, contradictory, unknown and overnested fleet denials retain receipt rejection', async () => {
  const denial = { ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
    command: fleetOwnerCommand(), blocker: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER };
  let tooDeep = denial;
  for (let i = 0; i < 5; i++) tooDeep = { structuredContent: tooDeep };
  const invalid = [
    { ...denial, ok: true }, { ...denial, ok: 'false' },
    { ...denial, command: {} },
    { ...denial, command: { ...denial.command, dispatchAllowed: false } },
    { ...denial, command: { ...denial.command, operation: 'START_PROCESS' } },
    { ...denial, command: { ...denial.command, plan: { ...denial.command.plan, kind: 'UNKNOWN' } } },
    { ...denial, command: { plan: { processId: 'battle-bridge-status' } } },
    { ...denial, status: 0 }, { ...denial, structuredContent: null },
    { ...denial, structuredContent: {} },
    { ...denial, structuredContent: { ok: true, status: null, stdout: '', stderr: '' } },
    { ...denial, structuredContent: { ok: true, status: 0, stdout: '', stderr: '', signal: {}, errorCode: '' } },
    { ...denial, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_BUSY', structuredContent: { status: 0 } },
    { ...denial, structuredContent: fleetMaintenanceEnvelope().structuredContent },
    { ...denial, blocker: 'PRIVATE_CODE_SHAPED_TOKEN' },
    { ...denial, blocker: 'private path / or token' },
    { ...denial, finalVerdict: 'UNKNOWN' },
    { ...denial, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' },
    { ...denial, command: { plan: { processId: 'battle-bridge-status' } }, structuredContent: denial },
    { ...denial, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      structuredContent: { ok: false, status: null, errorCode: 'PRIVATE_CODE_SHAPED_TOKEN', stdout: '', stderr: '' } },
    { ...denial, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      structuredContent: { ok: true, status: 0, errorCode: 'ETIMEDOUT', stdout: '', stderr: '' } },
    tooDeep,
  ];
  for (const candidate of invalid) {
    const single = await runFleetRemote(candidate);
    const { result: plan, calls } = await runFleetRemotePlan(candidate);
    assert.equal(single.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FLEET_RECEIPT_INVALID');
    assert.equal(plan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
    for (const result of [single, plan]) {
      assert.equal(result.ok, false);
      assert.equal(Object.hasOwn(result, 'fleetSupervisor'), false);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private path/);
    }
    assert.equal(calls.some(call => call.options?.body?.includes('"actionId":"battle-bridge-status"')), false);
  }
});

test('actual fleet owner denial survives terminal checkpoints and repeated bounded public receipt publication', async () => {
  const guardian = startSovereignCommanderContinuousRepairGuardian({ enabled: false,
    custodyStore: { status: () => ({ held: true }), close() {} },
  });
  try {
    const denial = await guardian.withMaintenanceOwner(fleetOwnerCommand(), () => assert.fail('denied action ran'));
    const results = [await runFleetRemote(denial), (await runFleetRemotePlan(denial)).result];
    for (const result of results) {
      const receipt = {
        schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
        requestId: 'fleet-owner-denial-roundtrip-001', operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
        repository: 'Cheekyfellastef/stephan-os', issueNumber: activeMailboxIssueForTest, branch: 'main',
        expectedHead: HEAD, processSourceHead: HEAD, state: 'BLOCKED', blocker: result.blocker,
        result: { ok: false, verdict: 'BLOCKED', result: { ...result,
          stdout: 'PRIVATE RAW OUTPUT C:\\Users\\Operator\\secret', stderr: 'PRIVATE STDERR' } },
      };
      let durableState;
      checkpointTerminalMailboxReceipt({}, receipt, {
        persist: state => { durableState = JSON.parse(JSON.stringify(state)); },
      });
      const checkpoint = durableState.lastReceipt;
      assert.deepEqual(durableState.consumedRequestIds, [receipt.requestId]);
      const published = JSON.parse(serializeBoundedReceiptJson(checkpoint));
      const repeated = JSON.parse(serializeBoundedReceiptJson(published));
      const compact = JSON.parse(serializeBoundedReceiptJson({ ...checkpoint,
        result: { ...checkpoint.result, result: { ...checkpoint.result.result,
          codexLastMessage: 'SAFE_PADDING '.repeat(1000),
          blockers: Array.from({ length: 30 }, (_, index) => `SAFE_PADDING_${index}_${'X'.repeat(120)}`),
        } },
      }, 6 * 1024));
      assert.equal(compact.githubProjectionTruncated, true);
      const compactRepeated = JSON.parse(serializeBoundedReceiptJson(compact, 6 * 1024));
      for (const packet of [checkpoint, published, repeated, compact, compactRepeated]) {
        const projected = createSanitizedMailboxReceiptProjection(packet);
        assert.equal(projected.state, 'BLOCKED');
        assert.equal(projected.processSourceHead, HEAD);
        assert.equal(projected.operationResult.sourceHead, '');
        assert.equal(projected.operationResult.ok, false);
        assert.equal(projected.operationResult.blocker, result.blocker);
        assert.equal(projected.operationResult.processId, FLEET_SUPERVISOR_ACTION);
        assert.equal(projected.operationResult.executionBlocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
        assert.equal(projected.operationResult.maintenanceStatus, null);
        assert.equal(Object.hasOwn(projected.operationResult, 'fleetSupervisor'), false);
        assert.equal(projected.operationResult.publicReceiptSafe, true);
        assert.equal(projected.operationResult.secretMaterialReturned, false);
        assert.doesNotMatch(JSON.stringify(packet), /PRIVATE|private-command-must-not-escape|private-mission-must-not-escape/);
      }
      if (result.remotePlan) {
        assert.deepEqual(compact.result.result.remotePlan, result.remotePlan);
        assert.equal(compact.result.result.stepCount, 0);
      }
    }
    assert.equal(guardian.status().timeoutCustodyHeld, true);
  } finally { guardian.stop(); }
});

test('fleet action carries actual held retry evidence without claiming pickup or exposing private fields', async () => {
  const result = await runFleetRemote(fleetMaintenanceEnvelope());
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE');
  assert.equal(result.fleetSupervisor.retryAdmission.classification, 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN');
  assert.equal(result.fleetSupervisor.retryAdmission.issueNumber, 2964);
  assert.equal(result.fleetSupervisor.retryAdmission.retried, false);
  assert.equal(result.fleetSupervisor.dispatchCount, 0);
  assert.equal(result.fleetSupervisor.provenPickupCount, 0);
  assert.equal(result.fleetSupervisor.held.reasons[0].reasonCode, 'EXISTING_GOAL_MISSION_BLOCKED_SIDELINED');
  for (const secret of ['PRIVATE_CONTENT', 'PRIVATE_STDERR', 'critical-2964', 'commanderParity', 'requiredTests']) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('fleet empty, malformed, ambiguous, mismatched and wrong-process terminal receipts cannot become DONE', async () => {
  const raw = fleetReceiptRaw(), wire = FLEET_SUPERVISOR_MARKER + JSON.stringify(raw);
  const invalid = [
    { stdout: '' }, { stdout: '{}' }, { stdout: wire + '\n' + wire },
    { stdout: wire + '\nafter-terminal' },
    { stdout: wire.replace('"ok":true', '"ok":false,"ok":true') },
    { stdout: FLEET_SUPERVISOR_MARKER + JSON.stringify({ ...raw, schemaVersion: 'unknown' }) },
    { stdout: FLEET_SUPERVISOR_MARKER + JSON.stringify({ ...raw, finalVerdict: 'UNKNOWN' }) },
    { stdout: FLEET_SUPERVISOR_MARKER + JSON.stringify({ ...raw, mergeAuthority: true }) },
    { stdout: wire, status: 2 }, { processId: 'battle-bridge-status' },
    ...[{ dispatchCount: 'UNKNOWN' }, { retryAdmission: null },
      { admission: undefined }, { held: null }, { provenPickupCount: 1 }]
      .map(variant => ({ raw: fleetReceiptRaw({ daemonMayReportGreen: true, ...variant }) })),
  ];
  for (const variant of invalid) {
    const result = await runFleetRemote(fleetMaintenanceEnvelope(variant));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FLEET_RECEIPT_INVALID');
    assert.equal(result.executionBlocker, 'FLEET_SUPERVISOR_TERMINAL_RECEIPT_INVALID');
    assert.equal(Object.hasOwn(result, 'fleetSupervisor'), false);
  }
});

test('valid fleet exit2 retains bounded reason while remaining an action failure', async () => {
  const result = await runFleetRemote(fleetMaintenanceEnvelope({ raw: fleetReceiptRaw({
    ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED',
    blocker: 'PRIVATE_CODE_SHAPED_TOKEN',
  }) }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.status, 2);
  assert.equal(result.executionBlocker, 'FLEET_SUPERVISOR_REPORTED_BLOCKED');
  assert.equal(result.fleetSupervisor.ok, false);
  assert.equal(result.fleetSupervisor.blockerCode, 'UNKNOWN');
  assert.equal(result.fleetSupervisor.retryAdmission.issueNumber, 2964);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CODE_SHAPED_TOKEN'), false);
});

test('fleet inner execution and current custody evidence are mandatory in single and plan routes', async () => {
  const raw = fleetReceiptRaw();
  for (const mutate of [
    execution => { execution.structuredContent.ok = false; },
    execution => { delete execution.structuredContent.ok; },
    execution => { execution.structuredContent.stdout = FLEET_SUPERVISOR_MARKER + JSON.stringify({ ...raw, blocker: 'ETIMEDOUT' }); },
    execution => { execution.structuredContent.signal = 'SIGTERM'; },
  ]) {
    const execution = fleetMaintenanceEnvelope(); mutate(execution);
    const single = await runFleetRemote(execution);
    assert.equal(single.ok, false);
    assert.equal(single.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FLEET_RECEIPT_INVALID');
    const { fetchFn } = mcpFetch({ maintenanceByAction: { [FLEET_SUPERVISOR_ACTION]: execution } });
    const plan = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '',
      remotePlan: [FLEET_SUPERVISOR_ACTION, 'battle-bridge-status'] }), {
      spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
      ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
  }
});

test('successful fleet plan preserves typed held evidence as command completion only', async () => {
  const { fetchFn } = mcpFetch({ maintenanceByAction: { [FLEET_SUPERVISOR_ACTION]: fleetMaintenanceEnvelope() } });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '',
    remotePlan: [FLEET_SUPERVISOR_ACTION, 'battle-bridge-status'] }), {
    spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
    ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.completedSteps.length, 2);
  assert.equal(result.completedSteps[0].fleetSupervisor.retryAdmission.retried, false);
  assert.equal(result.completedSteps[0].fleetSupervisor.provenPickupCount, 0);
  assert.equal(result.completedSteps[0].fleetSupervisor.blockerCode, '');
});

test('pre-admission original-owner blocker survives as a finite public code', async () => {
  const result = await runFleetRemote(fleetMaintenanceEnvelope({ raw: fleetReceiptRaw({
    ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED',
    ...projectFleetConveyorObservationV1(), blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
  }) }));
  assert.equal(result.ok, false);
  assert.equal(result.fleetSupervisor.blockerCode, 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING');
  assert.equal(result.fleetSupervisor.retryAdmission.present, false);
  assert.equal(result.fleetSupervisor.admission.present, false);
});

test('fleet contract is mandatory for plan steps and valid prior evidence survives a later failure', async () => {
  const plan = [FLEET_SUPERVISOR_ACTION, 'battle-bridge-status'];
  for (const maintenance of [fleetMaintenanceEnvelope({ stdout: '' }), fleetMaintenanceEnvelope({
    stdout: FLEET_SUPERVISOR_MARKER + JSON.stringify({ ...fleetReceiptRaw(), finalVerdict: 'UNKNOWN' }),
  })]) {
    const { fetchFn } = mcpFetch({ maintenanceByAction: { [FLEET_SUPERVISOR_ACTION]: maintenance } });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '', remotePlan: plan }), {
      spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
      ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
    assert.equal(result.stepCount, 0);
  }
  const laterFailure = { ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    command: { plan: { processId: 'battle-bridge-status' } }, blocker: 'STATUS_UNAVAILABLE',
    structuredContent: { status: 2, stdout: '', stderr: '', errorCode: '' } };
  const { fetchFn } = mcpFetch({ maintenanceByAction: {
    [FLEET_SUPERVISOR_ACTION]: fleetMaintenanceEnvelope(), 'battle-bridge-status': laterFailure,
  } });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '', remotePlan: plan }), {
    spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
    ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED');
  assert.equal(result.stepCount, 1);
  assert.equal(result.completedSteps[0].fleetSupervisor.retryAdmission.retried, false);
  assert.equal(result.completedSteps[0].fleetSupervisor.provenPickupCount, 0);
});

test('fleet blocked plan step retains its own typed failure and does not run the next step', async () => {
  const { calls, fetchFn } = mcpFetch({ maintenanceByAction: {
    [FLEET_SUPERVISOR_ACTION]: fleetMaintenanceEnvelope({ raw: fleetReceiptRaw({
      ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED', blocker: 'PRIVATE_TOKEN',
    }) }),
  } });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command({ remoteAction: '',
    remotePlan: [FLEET_SUPERVISOR_ACTION, 'battle-bridge-status'] }), {
    spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
    ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED');
  assert.equal(result.fleetSupervisor.ok, false);
  assert.equal(result.fleetSupervisor.retryAdmission.issueNumber, 2964);
  assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'), false);
  assert.equal(calls.some(call => call.options?.body?.includes('"actionId":"battle-bridge-status"')), false);
});

test('repair-stephanos transport envelope exceeds the bounded repair execution window', () => {
  assert.equal(SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS, 210_000);
  assert.equal(SOVEREIGN_COMMANDER_REMOTE_REPAIR_NETWORK_TIMEOUT_MS, 240_000);
  assert.equal(SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS, 480_000);
  assert.equal(sovereignCommanderRemoteNetworkTimeoutMs(command({ remoteAction: 'status' })), 210_000);
  assert.equal(sovereignCommanderRemoteNetworkTimeoutMs(command({ remoteAction: 'repair-stephanos' })), 240_000);
  assert.equal(sovereignCommanderRemoteNetworkTimeoutMs(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'repair-stephanos'],
  })), 240_000);
  assert.equal(sovereignCommanderRemoteNetworkTimeoutMs(command({ remoteAction: 'repair-stephanos' }), 45_000), 45_000);
  assert.equal(sovereignCommanderRemotePlanStepTimeoutMs({
    startedAtMs: 1_000,
    nowMs: 1_000,
    perCallTimeoutMs: 240_000,
  }), 240_000);
  assert.equal(sovereignCommanderRemotePlanStepTimeoutMs({
    startedAtMs: 1_000,
    nowMs: 400_000,
    perCallTimeoutMs: 240_000,
  }), 81_000);
  assert.equal(sovereignCommanderRemotePlanStepTimeoutMs({
    startedAtMs: 1_000,
    nowMs: 481_001,
    perCallTimeoutMs: 240_000,
  }), 0);
});

test('mobile command shape is closed-world and action allowlisted', () => {
  assert.equal(validateSovereignCommanderRemoteCommandShape(command()).ok, true);
  for (const [field, value] of [
    ['path', 'C:\\secret.txt'],
    ['content', 'secret'],
    ['token', 'secret'],
    ['args', ['whoami']],
    ['command', 'powershell.exe'],
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', field);
  }
  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: 'run-any-shell' }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED');
});


test('Stephanos AI live Commander tool proof is a fixed admitted action, not a raw chat or URL carrier', () => {
  const proven = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'prove-stephanos-ai-commander',
  }));
  assert.equal(proven.ok, true);
  assert.equal(proven.command.remoteAction, 'prove-stephanos-ai-commander');
  for (const extra of [
    { url: 'http://evil.example/steal' },
    { prompt: 'restart machine' },
    { arbitraryCommand: 'whoami' },
  ]) {
    const invalid = validateSovereignCommanderRemoteCommandShape(command({
      remoteAction: 'prove-stephanos-ai-commander', ...extra,
    }));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');
  }
});

test('a failed local AI Commander probe gives a typed public-safe blocker, never false green', async () => {
  const payload = {
    schemaVersion: 'stephanos.sovereign-ai-commander-acceptance.v1',
    ok: false, toolCalled: false, healthAvailable: false,
    guardianCycleCount: null, backendRoute: 'UNKNOWN',
    blocker: 'AI_COMMANDER_CHAT_HTTP_404',
    readOnly: true, localLoopbackOnly: true,
    remoteCommanderRequired: false, arbitraryShellAllowed: false,
    sourceMutationAllowed: false, mergeAuthority: false,
    coreAwakeProven: false, physicalWorkerPickupProven: false,
    finalVerdict: 'STEPHANOS_AI_COMMANDER_TOOL_CALL_BLOCKED',
  };
  payload.proofHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-stephanos-ai-commander' } },
    contentText: 'SECRET_PRIVATE_OUTPUT_DO_NOT_RETURN',
    structuredContent: {
      ok: true, status: 0,
      stdout: 'SOVEREIGN_COMMANDER_AI_CHAT_ACCEPTANCE_RESULT=' + JSON.stringify(payload),
      stderr: 'SECRET_PRIVATE_STDERR',
      errorCode: '',
    },
  };
  const execute = async (chosen) => executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-stephanos-ai-commander' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: chosen }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  const blocked = await execute(maintenance);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocker, 'SOVEREIGN_COMMANDER_REMOTE_AI_CHAT_ACCEPTANCE_BLOCKED');
  assert.equal(blocked.acceptanceBlocker, 'AI_COMMANDER_CHAT_HTTP_404');
  assert.equal(blocked.executionBlocker, 'AI_COMMANDER_CHAT_HTTP_404');
  assert.equal(blocked.toolCalled, false);
  assert.equal(JSON.stringify(blocked).includes('SECRET_PRIVATE'), false);
  assert.equal(JSON.stringify(blocked).includes('Users'), false);

  const forged = { ...payload, blocker: 'C:\\SECRET\\LEAK' };
  const forgedEnvelope = {
    ...maintenance,
    structuredContent: {
      ...maintenance.structuredContent,
      stdout: 'SOVEREIGN_COMMANDER_AI_CHAT_ACCEPTANCE_RESULT=' + JSON.stringify(forged),
    },
  };
  const rejected = await execute(forgedEnvelope);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.blocker, 'SOVEREIGN_COMMANDER_REMOTE_AI_CHAT_ACCEPTANCE_RECEIPT_INVALID');
  assert.equal(rejected.executionBlocker, 'AI_COMMANDER_TYPED_ACCEPTANCE_MISSING');
  assert.equal(JSON.stringify(rejected).includes('SECRET_PRIVATE'), false);

  const absentEnvelope = await execute({});
  assert.equal(absentEnvelope.ok, false);
  assert.equal(absentEnvelope.blocker, 'SOVEREIGN_COMMANDER_REMOTE_AI_CHAT_ACCEPTANCE_RECEIPT_INVALID');
  assert.equal(absentEnvelope.executionBlocker, 'AI_COMMANDER_ACTION_ENVELOPE_MISSING');
  assert.equal(JSON.stringify(absentEnvelope).includes('SECRET_PRIVATE'), false);

  const passedPayload = {
    ...payload,
    ok: true, toolCalled: true, healthAvailable: true,
    guardianCycleCount: 4, backendRoute: 'system', blocker: '',
    finalVerdict: 'STEPHANOS_AI_COMMANDER_TOOL_CALL_PROVEN',
  };
  delete passedPayload.proofHash;
  passedPayload.proofHash = createHash('sha256').update(JSON.stringify(passedPayload)).digest('hex');
  const success = await execute({
    ...maintenance,
    structuredContent: {
      ...maintenance.structuredContent,
      stdout: 'SOVEREIGN_COMMANDER_AI_CHAT_ACCEPTANCE_RESULT=' + JSON.stringify(passedPayload),
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.aiCommanderAcceptance.toolCalled, true);
  assert.equal(success.aiCommanderAcceptance.guardianCycleCount, 4);
  assert.equal(success.aiCommanderAcceptance.coreAwakeProven, false);
  assert.equal(success.aiCommanderAcceptance.sourceMutationAllowed, false);
  assert.equal(JSON.stringify(success).includes('SECRET_PRIVATE'), false);
});


test('read-only private MCP parity proof invokes real authenticated batch/metadata tools without publishing path or contents', async () => {
  const secret = 'DO_NOT_PUBLISH_PRIVATE_PATH_OR_FILE';
  const makeFetch = ({ batchAdvertised = true, metadataWorks = true, batchWorks = true } = {}) => {
    const base = mcpFetch({});
    const calls = [];
    const fetchFn = async (url, options = {}) => {
      let message = null;
      try { message = JSON.parse(options.body || '{}'); } catch {}
      if (message?.method === 'tools/list') {
        const tools = [
          { name: 'get_config' }, { name: 'maintenance_action' },
          { name: 'get_file_info',
            annotations: { readOnlyHint: true, destructiveHint: false },
            inputSchema: { required: ['path'] } },
        ];
        if (batchAdvertised) tools.push({
          name: 'read_multiple_files',
          annotations: { readOnlyHint: true, destructiveHint: false },
          inputSchema: { properties: { paths: { maxItems: 8 }, length: { maximum: 200 } } },
        });
        return response({ jsonrpc: '2.0', id: 2, result: { tools } }, { sessionId: 'session-1' });
      }
      const name = message?.params?.name;
      if (message?.method === 'tools/call' && ['get_file_info', 'read_multiple_files'].includes(name)) {
        calls.push({ name, args: message.params.arguments });
        const path = message.params.arguments.path || message.params.arguments.paths?.[0];
        const isMetadata = name === 'get_file_info';
        const valid = isMetadata ? metadataWorks : batchWorks;
        return response({ jsonrpc: '2.0', id: message.id, result: {
          isError: !valid,
          structuredContent: {
            ok: valid, finalVerdict: valid ? 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' : 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
            proofHash: 'd'.repeat(64),
            structuredContent: isMetadata
              ? { path, type: 'FILE', bytes: 150, privateFileContents: secret }
              : { totalFiles: 1, files: [{ path, content: '#!/usr/bin/env node', offset: 0, length: 1, truncated: false, privateMarker: secret }] },
          },
        } }, { sessionId: 'session-1' });
      }
      return base.fetchFn(url, options);
    };
    return { fetchFn, calls };
  };

  const healthy = makeFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'private-mcp-parity-proof' }), {
      spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn: healthy.fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_PRIVATE_MCP_PARITY_PROVEN');
  assert.equal(result.localAuthenticatedMcp, true);
  assert.equal(result.metadataCallProven, true);
  assert.equal(result.batchReadCallProven, true);
  assert.equal(result.privateFileContentReturned, false);
  assert.equal(result.privateFilePathReturned, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.deepEqual(healthy.calls.map(x => x.name), ['get_file_info', 'read_multiple_files']);
  assert.deepEqual(healthy.calls[1].args.paths, [healthy.calls[0].args.path]);
  assert.equal(healthy.calls[1].args.length, 1);
  assert.ok(JSON.stringify(result).includes('SOVEREIGN_PRIVATE_MCP_PARITY_PROVEN'));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(healthy.calls[0].args.path), false);

  for (const [fault, expected] of [
    [{ batchAdvertised: false }, 'SOVEREIGN_PRIVATE_MCP_CAPABILITIES_NOT_ADVERTISED'],
    [{ metadataWorks: false }, 'SOVEREIGN_PRIVATE_MCP_METADATA_CALL_UNPROVEN'],
    [{ batchWorks: false }, 'SOVEREIGN_PRIVATE_MCP_BATCH_READ_CALL_UNPROVEN'],
  ]) {
    const bad = makeFetch(fault);
    const failure = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'private-mcp-parity-proof' }), {
        spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn: bad.fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Operator' },
      },
    );
    assert.equal(failure.ok, false);
    assert.equal(failure.blocker, expected);
    assert.equal(JSON.stringify(failure).includes(secret), false);
  }
  assert.equal(validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'private-mcp-parity-proof',
    arbitraryPath: 'C:\\private\\secret.txt',
  })).ok, false);
});

test('remote repair delegation exposes the bounded local repair/orchestration registry without arbitrary shell', () => {
  for (const remoteAction of [
    'ignite-stephanos',
    'repair-battle-bridge',
    'repair-control-plane',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'start-mission-orchestrator-worker',
    'status-mission-orchestrator-worker',
    'start-stephanos-backend',
    'status-stephanos-backend',
    'status-openclaw-whatsapp',
    'repair-openclaw-ignite',
    'reconcile-remote-commander-parity',
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, true, remoteAction);
  }
  for (const remoteAction of ['run-any-shell', 'powershell', 'cmd', 'restart-pc', 'merge-main']) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, false, remoteAction);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', remoteAction);
  }
});

test('remote project search accepts only bounded public-safe literal queries', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'search-project',
    searchQuery: 'Sovereign Commander',
    searchMaxResults: 12,
  }));
  assert.equal(valid.ok, true);
  assert.equal(valid.command.searchQuery, 'Sovereign Commander');
  assert.equal(valid.command.searchMaxResults, 12);

  const unsafe = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'search-project',
    searchQuery: 'TOKEN=secret',
  }));
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.blocker, 'SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID');

  const stray = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'status',
    searchQuery: 'Sovereign',
  }));
  assert.equal(stray.ok, false);
  assert.equal(stray.blocker, 'SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED');
});

test('remote plan is bounded to unique admitted maintenance actions', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
  }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.command.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(valid.command.remoteAction, '');

  const conflict = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'battle-bridge-status',
    remotePlan: ['repair-control-plane'],
  }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT');

  for (const remotePlan of ['repair-control-plane', { actionId: 'repair-control-plane' }, null]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID');
  }

  for (const remotePlan of [
    [],
    Array.from({ length: SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS + 1 }, (_, index) => index % 2 ? 'repair-ui-4173' : 'battle-bridge-status'),
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID');
  }

  const statusInPlan = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['status'],
  }));
  assert.equal(statusInPlan.ok, false);
  assert.equal(statusInPlan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['repair-control-plane', 'run-any-shell'],
  }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const duplicate = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'battle-bridge-status'],
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION');
});

test('repair plan preflight is bounded before MCP setup and returns terminal deadline proof', async () => {
  const abortingFetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      reject(error);
    }, { once: true });
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['repair-stephanos', 'battle-bridge-status'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn: abortingFetch,
      networkTimeoutMs: 10,
      ensureRuntimeFn: async ({ fetchFn }) => {
        await fetchFn('http://127.0.0.1:18791/health', { method: 'GET' });
        return { ok: true };
      },
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED');
  assert.equal(result.stepCount, 0);
  assert.equal(result.publicReceiptSafe, true);
});

test('remote plan budget starts before MCP setup and can expire during configuration discovery', async () => {
  const base = mcpFetch();
  let nowMs = 1_000;
  const fetchFn = async (url, options = {}) => {
    const message = url.endsWith('/mcp') ? JSON.parse(options.body || '{}') : {};
    const response = await base.fetchFn(url, options);
    if (message.method === 'tools/list') {
      nowMs = 1_000 + SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS + 1;
    }
    return response;
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      nowFn: () => nowMs,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED');
  const maintenanceCalls = base.calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.equal(maintenanceCalls.length, 0);
});

test('remote plan containing repair-stephanos preflights Commander runtime before MCP execution', async () => {
  const { fetchFn } = mcpFetch();
  let preflightCalls = 0;
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['repair-stephanos', 'battle-bridge-status'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      ensureRuntimeFn: async () => {
        preflightCalls += 1;
        return { ok: true };
      },
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(preflightCalls, 1);
});

test('remote plan returns a terminal deadline receipt before the parent outbox guard can kill it', async () => {
  const base = mcpFetch();
  let nowMs = 1_000;
  let maintenanceCallsSeen = 0;
  const fetchFn = async (url, options = {}) => {
    const message = url.endsWith('/mcp') ? JSON.parse(options.body || '{}') : {};
    const result = await base.fetchFn(url, options);
    if (message.method === 'tools/call' && message.params?.name === 'maintenance_action') {
      maintenanceCallsSeen += 1;
      if (maintenanceCallsSeen === 1) {
        nowMs = 1_000 + SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS + 1;
      }
    }
    return result;
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      nowFn: () => nowMs,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DEADLINE_EXCEEDED');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.stepCount, 1);
  assert.equal(result.completedSteps.length, 1);
  const maintenanceCalls = base.calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), ['battle-bridge-status']);
});

test('remote plan executes admitted actions in order and returns only bounded proof', async () => {
  const { calls, fetchFn } = mcpFetch();
  const remotePlan = ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'];
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: '', remotePlan }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE');
  assert.equal(result.stepCount, 3);
  assert.match(result.planProofHash, /^[0-9a-f]{64}$/);
  assert.equal(result.result.planProofHash, result.planProofHash);
  assert.deepEqual(result.remotePlan, remotePlan);
  assert.deepEqual(result.completedSteps.map((step) => step.remoteAction), remotePlan);
  assert.equal(result.completedSteps.every((step) => step.status === 0), true);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), remotePlan);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('remote plan stops at first invalid maintenance receipt', async () => {
  const badReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    proofHash: 'b'.repeat(64),
    command: { plan: { processId: 'repair-control-plane' } },
    structuredContent: { ok: false, status: 1, errorCode: 'FAILED' },
  };
  const { calls, fetchFn } = mcpFetch({
    maintenanceByAction: { 'repair-control-plane': badReceipt },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.remoteAction, 'repair-control-plane');
  assert.equal(result.completedSteps.length, 1);
  assert.equal(result.stepCount, 1);
  assert.deepEqual(result.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), [
    'battle-bridge-status',
    'repair-control-plane',
  ]);
});

test('remote plan reports a bounded maintenance execution failure instead of a receipt defect', async () => {
  const failedReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    blocker: 'fixed-process-exit-1',
    command: { plan: { processId: 'repair-control-plane' } },
    contentText: 'PRIVATE FAILURE OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: false,
      status: 1,
      stdout: 'PRIVATE RAW STDOUT C:\\Users\\Operator\\secret-path',
      stderr: 'PRIVATE RAW STDERR',
      errorCode: '',
    },
  };
  const { calls, fetchFn } = mcpFetch({
    maintenanceByAction: { 'repair-control-plane': failedReceipt },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.remoteAction, 'repair-control-plane');
  assert.equal(result.status, 1);
  assert.equal(result.processId, 'repair-control-plane');
  assert.equal(result.executionBlocker, 'fixed-process-exit-1');
  assert.equal(result.completedSteps.length, 1);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('PRIVATE RAW STDERR'), false);
  assert.equal(serialized.includes('secret-path'), false);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), [
    'battle-bridge-status',
    'repair-control-plane',
  ]);
});

test('single maintenance action reports a bounded execution failure without leaking raw output', async () => {
  const failedReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    blocker: 'fixed-process-exit-2',
    command: { plan: { processId: 'ignite-stephanos' } },
    contentText: 'PRIVATE FAILURE OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: false,
      status: 2,
      stdout: 'PRIVATE RAW STDOUT C:\\Users\\Operator\\secret-path',
      stderr: 'PRIVATE RAW STDERR',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance: failedReceipt });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'ignite-stephanos' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.remoteAction, 'ignite-stephanos');
  assert.equal(result.status, 2);
  assert.equal(result.processId, 'ignite-stephanos');
  assert.equal(result.executionBlocker, 'fixed-process-exit-2');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('PRIVATE RAW STDERR'), false);
  assert.equal(serialized.includes('secret-path'), false);
});

test('status route proves authenticated local commander without returning secrets', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command(), {
    spawnSyncFn: spawnForHead(),
    readFileFn: readToken,
    fetchFn,
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(result.vendorMeterRequired, false);
  assert.equal(result.arbitraryUnboundedCommandAllowed, false);
  assert.equal(result.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.result.remoteAction, 'status');
  assert.equal(JSON.stringify(result).includes('x'.repeat(20)), false);
});

test('remote project search returns path and location proof without file contents', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: 'search-project',
      searchQuery: 'Sovereign Commander',
      searchMaxResults: 12,
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE');
  assert.equal(result.resultCount, 2);
  assert.match(result.queryHash, /^[0-9a-f]{64}$/);
  assert.equal(result.results[0].relativePath, 'shared/agents/sovereignCommanderV1.mjs');
  assert.equal(result.fileContentsReturned, false);
  assert.equal(result.publicReceiptSafe, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE PREVIEW'), false);
  assert.equal(serialized.includes('PRIVATE SEARCH PREVIEW'), false);
  assert.equal(serialized.includes('Sovereign Commander'), false);
  const searchCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'search_project');
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].params.arguments.query, 'Sovereign Commander');
  assert.equal(searchCalls[0].params.arguments.maxResults, 12);
});

test('maintenance route publishes only sanitised proof metadata', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.maintenance.proofHash, 'a'.repeat(64));
  assert.equal(result.maintenance.processId, 'battle-bridge-status');
  assert.equal(result.maintenance.status, 0);
  assert.equal(result.result.remoteAction, 'battle-bridge-status');
  assert.equal(result.result.proofHash, 'a'.repeat(64));
  assert.equal(result.result.processId, 'battle-bridge-status');
  assert.equal(result.result.status, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});



test('Starfield VR telemetry refresh returns bounded headline instead of generic invalid receipt', async () => {
  const telemetryPayload = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-02T20:15:00.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED',
    sessionId: 'starfield-vr-performance-test',
    headline: {
      focus: 'VRAM_PRESSURE',
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      launchSessionId: 'launch-1',
      sourceHead: HEAD,
      telemetrySessionId: 'starfield-vr-performance-test',
      signals: ['vram-pressure-high'],
      sessionOutcome: 'COMPLETED',
      partialTelemetry: false,
      crashEvidenceCount: 0,
      sampleCount: 100,
      avgGpuUtilPct: 79.4,
      maxGpuUtilPct: 100,
      maxGpuMemoryPct: 98.4,
      avgStarfieldCpuPct: 11.2,
      avgSystemCpuPct: 42.3,
      maxLlamaServerCount: 1,
      airLinkRuntimeSamplePct: 100,
      minGameDriveFreeGiB: 321.5,
      minGameDriveFreePct: 18.2,
      avgGameDriveActivePct: 14.6,
      maxGameDriveLatencyMs: 8.2,
      maxGameDriveQueueLength: 1.3,
      maxPagesPerSec: 2,
      storageTelemetryAvailable: true,
      topRecommendation: 'Lower one bounded render-scale step',
      topRecommendationSource: 'VR Research Lab',
      projectLoopState: 'READY',
      projectTelemetryGapCount: 2,
      projectNextExperiment: 'Repeat same-save lateral-motion segment',
    },
    history: { sessionCount: 5, newestSessionId: 'starfield-vr-performance-test' },
    publication: { packet: true, history: true, loop: true, event: true },
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: true,
    sharedWorkspacePublished: true,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '9'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    contentText: 'PRIVATE VERBOSE TELEMETRY MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=' + JSON.stringify(telemetryPayload) + '\n{VERY LARGE PRIVATE TELEMETRY BODY}',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_COMPLETE');
  assert.equal(result.telemetry.headline.focus, 'VRAM_PRESSURE');
  assert.equal(result.telemetry.headline.provider, 'mutar-openxr');
  assert.equal(result.telemetry.headline.sampleCount, 100);
  assert.equal(result.telemetry.headline.maxGpuMemoryPct, 98.4);
  assert.equal(result.telemetry.headline.airLinkRuntimeSamplePct, 100);
  assert.equal(result.telemetry.history.sessionCount, 5);
  assert.equal(result.telemetry.sharedWorkspacePublished, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('VERY LARGE PRIVATE TELEMETRY BODY'), false);
  assert.equal(serialized.includes('PRIVATE VERBOSE TELEMETRY'), false);
});

test('Starfield VR telemetry refresh returns honest degraded receipt when primary telemetry is published', async () => {
  const telemetryPayload = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-02T20:59:44.363Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
    sessionId: 'starfield-vr-performance-20261002-014019-238',
    headline: {
      focus: '',
      provider: 'UNKNOWN',
      providerIdentityStatus: 'UNKNOWN_PROVIDER',
      sourceHead: '',
      telemetrySessionId: 'starfield-vr-performance-20261002-014019-238',
      signals: [],
      sessionOutcome: 'CRASHED',
      partialTelemetry: true,
      crashEvidenceCount: 2,
      sampleCount: 73,
      avgGpuUtilPct: 71.4,
      maxGpuUtilPct: 100,
      maxGpuMemoryPct: 98.3,
      avgStarfieldCpuPct: 25.3,
      avgSystemCpuPct: 70.9,
      maxLlamaServerCount: 1,
      airLinkRuntimeSamplePct: 100,
      minGameDriveFreeGiB: 190.6,
      minGameDriveFreePct: 10.2,
      avgGameDriveActivePct: 1.9,
      maxGameDriveLatencyMs: 0,
      maxGameDriveQueueLength: 4,
      maxPagesPerSec: 33188,
      storageTelemetryAvailable: true,
      projectLoopState: 'UNKNOWN_PROVIDER',
      projectTelemetryGapCount: 8,
      projectNextExperiment: 'Prove exact VR run identity before tuning',
    },
    history: { sessionCount: 24, newestSessionId: 'starfield-vr-performance-20261002-014019-238' },
    publication: { packet: true, history: true, loop: false, event: true },
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: false,
    sharedWorkspacePublished: false,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '7'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=' + JSON.stringify(telemetryPayload) + '\n',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED');
  assert.equal(result.telemetry.degraded, true);
  assert.equal(result.telemetry.primaryTelemetryPublished, true);
  assert.equal(result.telemetry.auxiliaryProjectionPublished, false);
  assert.equal(result.telemetry.sharedWorkspacePublished, false);
  assert.deepEqual(result.telemetry.publication, { packet: true, history: true, loop: false, event: true });
  assert.equal(result.telemetry.headline.sampleCount, 73);
  assert.equal(result.telemetry.headline.maxGpuMemoryPct, 98.3);
});

test('Starfield VR telemetry refresh fails closed when bounded headline marker is absent', async () => {
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '8'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: '{"schemaVersion":"stephanos.starfield-vr-telemetry-report.v1","private":"raw"}',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_RECEIPT_INVALID');
  assert.equal(result.telemetryProjectionPresent, false);
});

test('parity reconciliation returns bounded zero-gap truth without raw ledger output', async () => {
  const parityPayload = {
    ok: true,
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 14,
    parityPresentCount: 12,
    buildableGapCount: 0,
    boundaryHoldCount: 2,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
    privateLedgerPath: 'C:\\private\\parity.json',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'e'.repeat(64),
    command: { plan: { processId: 'reconcile-remote-commander-parity' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT=' + JSON.stringify(parityPayload) + '\nPRIVATE RAW PARITY',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'reconcile-remote-commander-parity' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.capabilityParity, {
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 14,
    parityPresentCount: 12,
    buildableGapCount: 0,
    boundaryHoldCount: 2,
    zeroGapInvariantSatisfied: true,
    closureRequired: false,
    daemonMayReportGreen: true,
    mustContinueUntilZero: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW PARITY'), false);
  assert.equal(serialized.includes('private\\parity.json'), false);
});

test('Battle Bridge observation returns bounded services, GPU and model facts without raw output', async () => {
  const observationPayload = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T10:55:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 12345,
    memory: { totalBytes: 64000000000, freeBytes: 32000000000, usedBytes: 32000000000 },
    gpu: { available: true, name: 'NVIDIA GeForce RTX 5090', memoryTotalMiB: 32607, memoryUsedMiB: 12000, memoryFreeMiB: 20607, utilizationGpuPercent: 21 },
    ollama: {
      reachable: true,
      installedModelCount: 2,
      loadedModelCount: 1,
      installedModelsTruncated: true,
      loadedModelsTruncated: false,
      installedModels: [{ name: 'qwen:14b', sizeBytes: 1000, parameterSize: '14B', quantizationLevel: 'Q4', family: 'qwen' }],
      loadedModels: [{ name: 'llama3.2:3b', sizeBytes: 500, sizeVramBytes: 400, contextLength: 32768 }],
    },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'f'.repeat(64),
    command: { plan: { processId: 'battle-bridge-observe' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(observationPayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-observe' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_BATTLE_BRIDGE_OBSERVATION_COMPLETE');
  assert.equal(result.observation.services.ui.ready, true);
  assert.equal(result.observation.gpu.memoryTotalMiB, 32607);
  assert.equal(result.observation.ollama.installedModelCount, 2);
  assert.equal(result.observation.ollama.installedModelsTruncated, true);
  assert.equal(result.observation.ollama.loadedModels[0].name, 'llama3.2:3b');
  assert.equal(result.observation.readOnly, true);
  assert.equal(result.observation.secretMaterialIncluded, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE STDERR MUST NOT ESCAPE'), false);
});

test('VR Atlas runtime proof returns sanitised machine evidence without leaking local artifact paths', async () => {
  const privateScreenshot = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-proof.png';
  const privateReceipt = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-proof.json';
  const proofPayload = {
    ok: true,
    profile: 'vr-atlas-status-pills',
    sourceHead: HEAD,
    exactHeadProofOk: true,
    finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_PASS',
    evidenceHash: 'd'.repeat(64),
    screenshotSha256: 'e'.repeat(64),
    pillCount: 8,
    evidencePanelReady: true,
    corpusCount: 26,
    correlationCount: 3,
    agentAction: 'PROPOSE_CANONICAL_VR_CORRELATION',
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: privateScreenshot,
    receiptPath: privateReceipt,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-vr-atlas-runtime' } },
    contentText: 'SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload) + '\nPRIVATE RAW STDOUT',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-vr-atlas-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'prove-vr-atlas-runtime');
  assert.equal(result.result.runtimeProof.sourceHead, HEAD);
  assert.equal(result.result.runtimeProof.atlasEvidencePanelReady, true);
  assert.equal(result.result.runtimeProof.atlasCorpusCount, 26);
  assert.equal(result.result.runtimeProof.atlasCorrelationCount, 3);
  assert.equal(result.result.runtimeProof.atlasResearchAgentActionPresent, true);
  assert.equal(result.result.runtimeProof.screenshotCaptured, true);
  assert.equal(result.result.runtimeProof.receiptCaptured, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(privateScreenshot), false);
  assert.equal(serialized.includes(privateReceipt), false);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('Flywheel runtime proof returns sanitised connected-feed evidence without leaking local artifacts', async () => {
  const privateScreenshot = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-flywheel.png';
  const privateReceipt = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-flywheel.json';
  const proofPayload = {
    ok: true,
    profile: 'flywheel-live-feed',
    sourceHead: HEAD,
    exactHeadProofOk: true,
    finalVerdict: 'FLYWHEEL_RUNTIME_PROOF_PASS',
    evidenceHash: 'b'.repeat(64),
    screenshotSha256: 'c'.repeat(64),
    feed: {
      state: 'stale',
      responseMs: 1661,
      goalCount: 51,
      eventCount: 79,
      starfieldSeedPlanted: true,
    },
    browser: {
      liveState: 'stale',
      liveLabel: 'STALE',
      backendUnreachableVisible: false,
      seedVisible: true,
    },
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: privateScreenshot,
    receiptPath: privateReceipt,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-flywheel-runtime' } },
    contentText: 'PRIVATE FLYWHEEL OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload) + '\nPRIVATE RAW FLYWHEEL STDOUT',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-flywheel-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'prove-flywheel-runtime');
  assert.equal(result.result.runtimeProof.sourceHead, HEAD);
  assert.equal(result.result.runtimeProof.feedState, 'stale');
  assert.equal(result.result.runtimeProof.routeResponseMs, 1661);
  assert.equal(result.result.runtimeProof.goalCount, 51);
  assert.equal(result.result.runtimeProof.eventCount, 79);
  assert.equal(result.result.runtimeProof.starfieldSeedPlanted, true);
  assert.equal(result.result.runtimeProof.browserLiveState, 'stale');
  assert.equal(result.result.runtimeProof.browserLiveLabel, 'STALE');
  assert.equal(result.result.runtimeProof.backendUnreachableVisible, false);
  assert.equal(result.result.runtimeProof.seedVisible, true);
  assert.equal(result.result.runtimeProof.screenshotCaptured, true);
  assert.equal(result.result.runtimeProof.receiptCaptured, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(privateScreenshot), false);
  assert.equal(serialized.includes(privateReceipt), false);
  assert.equal(serialized.includes('PRIVATE RAW FLYWHEEL STDOUT'), false);
  assert.equal(serialized.includes('PRIVATE FLYWHEEL OUTPUT MUST NOT ESCAPE'), false);
});

test('VR Atlas runtime proof cannot report green on wrong-head evidence', async () => {
  const proofPayload = {
    ok: true,
    profile: 'vr-atlas-status-pills',
    sourceHead: 'f'.repeat(40),
    exactHeadProofOk: true,
    finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_PASS',
    evidenceHash: 'd'.repeat(64),
    screenshotSha256: 'e'.repeat(64),
    pillCount: 8,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: 'local.png',
    receiptPath: 'local.json',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-vr-atlas-runtime' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-vr-atlas-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID');
  assert.equal(result.runtimeProof.sourceHead, 'f'.repeat(40));
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
});

test('Virtual AirLink acceptance returns bounded failure evidence instead of a transport error', async () => {
  const acceptancePayload = {
    schemaVersion: 'stephanos.vr-virtual-airlink-acceptance.v1',
    ok: false,
    virtualAirLinkTestUsed: true,
    virtualAirLinkRestoredOff: true,
    launchAllowed: false,
    realHeadsetProofClaimed: false,
    governorWatchStarted: false,
    governorWatchProcessCount: 1,
    lightweightModel: 'llama3.2:3b',
    loadedModelsBefore: ['qwen:14b'],
    heavyModelsBefore: ['qwen:14b'],
    heavyModelSamplesDuringGuard: ['qwen:14b'],
    loadedModelsAfterGuard: ['qwen:14b'],
    heavyModelsAfterGuard: ['qwen:14b'],
    gpuBefore: { available: true, memoryUsedMiB: 30451, memoryTotalMiB: 32607, utilizationGpuPercent: 0 },
    gpuAfter: { available: true, memoryUsedMiB: 30451, memoryTotalMiB: 32607, utilizationGpuPercent: 0 },
    vramReleasedMiB: 0,
    observationSeconds: 12,
    blocker: 'VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED',
    finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED',
  };
  const maintenance = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    command: { plan: { processId: 'vr-virtual-airlink-acceptance' } },
    structuredContent: {
      ok: false,
      status: 2,
      stdout: JSON.stringify(acceptancePayload),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'vr-virtual-airlink-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_COMPLETE');
  assert.equal(result.acceptancePassed, false);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(result.processId, 'vr-virtual-airlink-acceptance');
  assert.equal(result.status, 2);
  assert.equal(result.acceptance.blocker, 'VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED');
  assert.deepEqual(result.acceptance.heavyModelsAfterGuard, ['qwen:14b']);
  assert.equal(result.acceptance.vramReleasedMiB, 0);
  assert.equal(result.acceptance.virtualAirLinkRestoredOff, true);
  assert.equal(result.acceptance.launchAllowed, false);
  assert.equal(result.acceptance.realHeadsetProofClaimed, false);
});

test('Virtual AirLink acceptance preserves bounded failure evidence through an extra structured-content wrapper', async () => {
  const acceptancePayload = {
    schemaVersion: 'stephanos.vr-virtual-airlink-acceptance.v1',
    ok: false,
    virtualAirLinkTestUsed: true,
    virtualAirLinkRestoredOff: true,
    launchAllowed: false,
    realHeadsetProofClaimed: false,
    governorWatchStarted: false,
    governorWatchProcessCount: 1,
    lightweightModel: 'llama3.2:3b',
    loadedModelsBefore: [],
    heavyModelsBefore: [],
    heavyModelSamplesDuringGuard: [],
    loadedModelsAfterGuard: [],
    heavyModelsAfterGuard: [],
    gpuBefore: { available: true, memoryUsedMiB: 2000, memoryTotalMiB: 32000, utilizationGpuPercent: 0 },
    gpuAfter: { available: true, memoryUsedMiB: 1800, memoryTotalMiB: 32000, utilizationGpuPercent: 0 },
    vramReleasedMiB: 200,
    observationSeconds: 12,
    blocker: 'VR_ACCEPTANCE_GOVERNOR_NOT_ACTIVE',
    finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED',
  };
  const maintenance = {
    structuredContent: {
      ok: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      command: { plan: { processId: 'vr-virtual-airlink-acceptance' } },
      structuredContent: {
        ok: false,
        status: 2,
        stdout: JSON.stringify(acceptancePayload),
        stderr: '',
        errorCode: '',
      },
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'vr-virtual-airlink-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.acceptancePassed, false);
  assert.equal(result.acceptance.blocker, 'VR_ACCEPTANCE_GOVERNOR_NOT_ACTIVE');
  assert.equal(result.status, 2);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});


test('Virtual AirLink acceptance preserves successful proof through an extra structured-content wrapper', async () => {
  const acceptancePayload = {
    schemaVersion: 'stephanos.vr-virtual-airlink-acceptance.v1',
    ok: true,
    virtualAirLinkTestUsed: true,
    virtualAirLinkRestoredOff: true,
    launchAllowed: false,
    realHeadsetProofClaimed: false,
    governorWatchStarted: false,
    governorWatchProcessCount: 1,
    lightweightModel: 'llama3.2:3b',
    loadedModelsBefore: [],
    heavyModelsBefore: [],
    heavyModelSamplesDuringGuard: [],
    loadedModelsAfterGuard: [],
    heavyModelsAfterGuard: [],
    gpuBefore: { available: true, memoryUsedMiB: 1500, memoryTotalMiB: 32607, utilizationGpuPercent: 1 },
    gpuAfter: { available: true, memoryUsedMiB: 1400, memoryTotalMiB: 32607, utilizationGpuPercent: 1 },
    vramReleasedMiB: 100,
    observationSeconds: 12,
    blocker: '',
    finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED',
  };
  const maintenance = {
    structuredContent: {
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'a'.repeat(64),
      command: { plan: { processId: 'vr-virtual-airlink-acceptance' } },
      structuredContent: {
        ok: true,
        status: 0,
        stdout: JSON.stringify(acceptancePayload),
        stderr: '',
        errorCode: '',
      },
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'vr-virtual-airlink-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.acceptancePassed, true);
  assert.equal(result.status, 0);
  assert.equal(result.acceptance.finalVerdict, 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED');
  assert.deepEqual(result.acceptance.loadedModelsAfterGuard, []);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test('failed outer config receipts are rejected before maintenance mutation', async () => {
  const safeConfig = {
    implementation: 'stephanos-local-node',
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    sourceControlledMaintenanceOnly: true,
    arbitraryUnboundedCommandAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    canRunFocusedNodeTests: false,
  };
  const baseReceipt = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'c'.repeat(64),
    structuredContent: safeConfig,
  };
  const cases = [
    { configReceipt: { ...baseReceipt, ok: false } },
    { configReceipt: { ...baseReceipt, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED' } },
    { configReceipt: { ...baseReceipt, proofHash: 'bad' } },
    { configReceipt: baseReceipt, configIsError: true },
  ];
  for (const options of cases) {
    const { calls, fetchFn } = mcpFetch(options);
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'battle-bridge-status' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
    const maintenanceCalls = calls
      .filter((entry) => entry.url.endsWith('/mcp'))
      .map((entry) => JSON.parse(entry.options.body || '{}'))
      .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
    assert.equal(maintenanceCalls.length, 0);
  }
});

test('unsafe Commander posture blocks before maintenance mutation', async () => {
  const { calls, fetchFn } = mcpFetch({
    config: {
      implementation: 'stephanos-local-node',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: true,
      pcRestartAuthority: false,
      canRunFocusedNodeTests: false,
    },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.equal(maintenanceCalls.length, 0);
});

test('maintenance receipt normalizes one extra MCP structured-content wrapper', async () => {
  const nestedReceipt = {
    structuredContent: {
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'd'.repeat(64),
      command: { plan: { processId: 'gaming-resource-acceptance' } },
      structuredContent: { ok: true, status: 0, errorCode: '' },
    },
  };
  const { fetchFn } = mcpFetch({ maintenance: nestedReceipt });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'gaming-resource-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'gaming-resource-acceptance');
  assert.equal(result.result.proofHash, 'd'.repeat(64));
  assert.equal(result.result.processId, 'gaming-resource-acceptance');
  assert.equal(result.result.status, 0);
});

test('maintenance receipt must contain exact completion proof', async () => {
  const baseline = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'battle-bridge-status' } },
    structuredContent: { ok: true, status: 0, errorCode: '' },
  };
  for (const maintenance of [
    { ...baseline, finalVerdict: 'SOMETHING_ELSE' },
    { ...baseline, proofHash: 'bad' },
    { ...baseline, command: { plan: { processId: 'other-action' } } },
    { ...baseline, structuredContent: { ok: false, status: 1, errorCode: 'FAILED' } },
  ]) {
    const { fetchFn } = mcpFetch({ maintenance });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'battle-bridge-status' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID');
  }
});

test('main-head drift blocks before authenticated MCP mutation', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'restart-stephanos-runtime' }),
    {
      spawnSyncFn: spawnForHead('b'.repeat(40)),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH');
  assert.equal(calls.length, 0);
});


test('aggregate plan proof is request-specific even with identical step receipts', async () => {
  const remotePlan = ['battle-bridge-status', 'repair-control-plane'];
  const run = async (requestId) => {
    const { fetchFn } = mcpFetch();
    return executeSovereignCommanderRemoteOnBattleBridge(
      command({ requestId, remoteAction: '', remotePlan }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
  };
  const first = await run('sovereign-plan-proof-a');
  const second = await run('sovereign-plan-proof-b');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.match(first.planProofHash, /^[0-9a-f]{64}$/);
  assert.match(second.planProofHash, /^[0-9a-f]{64}$/);
  assert.notEqual(first.planProofHash, second.planProofHash);
});


test('remote Battle Bridge observer returns sanitised machine and model facts', async () => {
  const observation = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T10:55:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 12345,
    memory: { totalBytes: 68719476736, freeBytes: 25769803776, usedBytes: 42949672960 },
    gpu: {
      available: true,
      name: 'NVIDIA GeForce RTX 5090',
      memoryTotalMiB: 32768,
      memoryUsedMiB: 8192,
      memoryFreeMiB: 24576,
      utilizationGpuPercent: 17,
    },
    ollama: {
      reachable: true,
      installedModels: [{
        name: 'qwen3.5:27b',
        sizeBytes: 17000000000,
        parameterSize: '27.8B',
        quantizationLevel: 'Q4_K_M',
        family: 'qwen3',
        privatePath: 'C:\\private\\models',
      }],
      loadedModels: [{
        name: 'qwen:14b',
        sizeBytes: 8200000000,
        sizeVramBytes: 7900000000,
        contextLength: 32768,
      }],
    },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'battle-bridge-observe' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(observation),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-observe' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.remoteAction, 'battle-bridge-observe');
  assert.equal(result.observation.schemaVersion, 'stephanos.battle-bridge-observation.v1');
  assert.equal(result.observation.gpu.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(result.observation.ollama.installedModels[0].name, 'qwen3.5:27b');
  assert.equal(result.observation.ollama.loadedModels[0].contextLength, 32768);
  assert.equal(result.observation.services.ollama.ready, true);
  assert.equal(result.observation.readOnly, true);
  assert.equal(result.observation.arbitraryShellAllowed, false);
  assert.equal(result.observation.secretMaterialIncluded, false);
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /MUST_NOT_ESCAPE|private\\\\models|PRIVATE RAW OUTPUT/);
});

test('Battle Bridge observer is intentionally single-action, not a remote plan step', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-observe'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});

test('meter-status returns a bounded public meter projection without raw output', async () => {
  const meterPayload = {
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T11:45:00.000Z',
    counts: { total: 3, green: 1, amber: 0, red: 1, grey: 1 },
    meters: [
      {
        meterId: 'codex-capacity',
        provider: 'codex',
        source: 'shared-workspace',
        observationState: 'CURRENT',
        trafficLight: 'RED',
        remainingPercent: 3,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T11:44:00.000Z',
        ageSeconds: 60,
        naturalResetAtUtc: '',
        meterTruthUsable: true,
        observableBySovereign: true,
        privatePath: 'C:\\private\\must-not-escape',
      },
      {
        meterId: 'github-core',
        provider: 'github',
        source: 'github-rate-limit-api',
        observationState: 'CURRENT',
        trafficLight: 'GREEN',
        remainingPercent: 80,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T11:45:00.000Z',
        ageSeconds: 0,
        naturalResetAtUtc: '2026-10-02T12:00:00.000Z',
        meterTruthUsable: true,
        observableBySovereign: true,
        limit: 5000,
        remaining: 4000,
      },
      {
        meterId: 'remote-desktop-commander',
        provider: 'desktop-commander',
        source: 'external-observation-required',
        observationState: 'UNKNOWN',
        trafficLight: 'GREY',
        remainingPercent: null,
        availability: 'UNKNOWN',
        truthState: 'UNKNOWN',
        observedAtUtc: '',
        ageSeconds: null,
        naturalResetAtUtc: '',
        meterTruthUsable: false,
        observableBySovereign: false,
        blocker: 'EXTERNAL_CONNECTOR_METER_NOT_PUBLISHED',
      },
    ],
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_METER_STATUS_RED_PRESENT',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'meter-status' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_METER_STATUS_RESULT=' + JSON.stringify(meterPayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'meter-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_COMPLETE');
  assert.equal(result.meterStatus.counts.red, 1);
  assert.equal(result.meterStatus.meters.find((item) => item.meterId === 'codex-capacity').remainingPercent, 3);
  assert.equal(result.meterStatus.meters.find((item) => item.meterId === 'remote-desktop-commander').trafficLight, 'GREY');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('MUST_NOT_ESCAPE'), false);
  assert.equal(serialized.includes('PRIVATE RAW OUTPUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
  assert.equal(serialized.includes('private\\\\must-not-escape'), false);
});

test('meter-status is intentionally single-action and cannot be hidden inside a remote plan', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['meter-status'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});

test('controller-lane-status returns bounded physical logical and refill truth without raw output', async () => {
  const controllerLanePayload = {
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T14:30:00.000Z',
    physical: {
      expected: 5,
      building: 4,
      amber: 1,
      red: 0,
      unknown: 0,
      allCurrent: true,
      allObservedEnabled: true,
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
      controllers: [
        {
          controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
          title: 'Stephanos Autonomous Goal Builder',
          freshness: 'CURRENT',
          activityState: 'BUILDING',
          trafficLight: 'GREEN',
          materialLaneCount: 3,
          activeLaneCount: 3,
          parkedLaneCount: 0,
          safeEligibleWorkRemaining: 0,
          blocker: '',
          privatePath: 'C:\\private\\must-not-escape',
        },
        {
          controllerId: '6aa425918c8881918c1763ee6acf3cb6',
          title: 'Stephanos Hourly Build Controller',
          freshness: 'CURRENT',
          activityState: 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK',
          trafficLight: 'AMBER',
          materialLaneCount: 0,
          activeLaneCount: 0,
          parkedLaneCount: 0,
          safeEligibleWorkRemaining: 8,
          blocker: 'SAFE_ELIGIBLE_WORK_WITHOUT_MATERIAL_ACTION',
        },
      ],
    },
    logical: {
      current: true,
      valid: true,
      observedAtUtc: '2026-10-02T14:29:00.000Z',
      physicalControllerCount: 5,
      total: 40,
      active: 11,
      tracking: 21,
      parked: 8,
      retired: 0,
      selectedForAdmission: 7,
      finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
      hostLoads: [
        {
          controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
          title: 'Stephanos Autonomous Goal Builder',
          logicalControllerCount: 8,
          activeCount: 3,
          trackingCount: 4,
          parkedCount: 1,
        },
      ],
    },
    lanes: {
      targetMaterialLanes: 15,
      activeMaterialLaneCount: 7,
      activeLaneClaimCount: 7,
      reportedMaterialLaneCountSum: 12,
      occupancyPercent: 46.67,
      freeTargetLaneSlots: 8,
      runnableBacklogCount: 8,
      parkedPhysicalLaneCount: 1,
      reportedSafeEligibleWorkMax: 8,
      reportedSafeEligibleWorkSum: 8,
      refillHealth: 'AMBER',
      refillState: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'controller-lane-status' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=' + JSON.stringify(controllerLanePayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'controller-lane-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE');
  assert.equal(result.controllerLaneStatus.physical.building, 4);
  assert.equal(result.controllerLaneStatus.logical.total, 40);
  assert.equal(result.controllerLaneStatus.lanes.targetMaterialLanes, 15);
  assert.equal(result.controllerLaneStatus.lanes.activeMaterialLaneCount, 7);
  assert.equal(result.controllerLaneStatus.lanes.freeTargetLaneSlots, 8);
  assert.equal(result.controllerLaneStatus.lanes.runnableBacklogCount, 8);
  assert.equal(result.controllerLaneStatus.lanes.refillHealth, 'AMBER');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('MUST_NOT_ESCAPE'), false);
  assert.equal(serialized.includes('PRIVATE RAW OUTPUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
  assert.equal(serialized.includes('private\\\\must-not-escape'), false);
});

test('controller-lane-status is intentionally single-action and cannot be hidden inside a remote plan', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['controller-lane-status'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});


test('controller activity publication is single-action, canonical and returns only bounded receipt truth', async () => {
  const activity = {
    schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
    controllerId: '6ac3999164b88191a1c866c70ab51bd7',
    runId: 'controller-run-telemetry-1',
    timestampUtc: '2026-10-03T21:45:00.000Z',
    observedEnabled: true,
    executionState: 'IDLE',
    materialActionsSucceeded: 0,
    safeEligibleWorkRemaining: 0,
    nextAutomaticAction: 'Reconcile live goal truth.',
  };
  const shape = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: activity,
  }));
  assert.equal(shape.ok, true);
  assert.equal(shape.command.controllerActivity.controllerId, activity.controllerId);

  const badController = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: { ...activity, controllerId: 'not-canonical' },
  }));
  assert.equal(badController.ok, false);
  assert.equal(badController.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID');

  const retiredController = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: { ...activity, controllerId: '6a9bb24c04748191ada675a686f3b3fa' },
  }));
  assert.equal(retiredController.ok, false);
  assert.equal(retiredController.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID');

  const unprovenMaterial = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: { ...activity, materialActionsSucceeded: 1 },
  }));
  assert.equal(unprovenMaterial.ok, false);
  assert.equal(unprovenMaterial.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_MATERIAL_PROOF_REQUIRED');

  const conflicting = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: activity,
    targetPrNumber: 1,
  }));
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED');

  const hiddenPlan = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['publish-controller-activity'],
    controllerActivity: activity,
  }));
  assert.equal(hiddenPlan.ok, false);
  assert.equal(hiddenPlan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const publication = {
    schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
    ok: true,
    controllerId: activity.controllerId,
    runId: activity.runId,
    statusWritten: true,
    proofWritten: false,
    statusId: `controller-${activity.controllerId}-activity`,
    proofId: '',
    executionState: 'IDLE',
    materialLaneCount: 0,
    materialActionsSucceeded: 0,
    finalVerdict: 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISHED',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'publish-controller-activity' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=' + JSON.stringify(publication),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn, calls } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'publish-controller-activity', controllerActivity: activity }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.controllerActivityPublication.controllerId, activity.controllerId);
  assert.equal(result.controllerActivityPublication.statusWritten, true);
  const maintenanceCall = calls
    .filter((call) => call.url.endsWith('/mcp'))
    .map((call) => JSON.parse(call.options.body || '{}'))
    .find((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.equal(maintenanceCall.params.arguments.actionId, 'publish-controller-activity');
  const decoded = JSON.parse(Buffer.from(
    maintenanceCall.params.arguments.controllerActivityPayloadBase64,
    'base64url',
  ).toString('utf8'));
  assert.deepEqual(decoded, activity);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW OUTPUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
});

test('controller activity rejects generic maintenance success without a real publication projection', async () => {
  const activity = {
    schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
    controllerId: '6ac3999164b88191a1c866c70ab51bd7',
    runId: 'controller-run-no-projection',
    observedEnabled: true,
    executionState: 'IDLE',
    materialActionsSucceeded: 0,
    safeEligibleWorkRemaining: 0,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'publish-controller-activity' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: '',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'publish-controller-activity', controllerActivity: activity }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RECEIPT_INVALID');
  assert.equal(result.publicationPresent, false);
});

test('controller activity failure projects the publisher blocker without leaking raw output', async () => {
  const activity = {
    schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
    controllerId: '6ac3999164b88191a1c866c70ab51bd7',
    runId: 'controller-run-inner-blocker',
    observedEnabled: true,
    executionState: 'IDLE',
    materialActionsSucceeded: 0,
    safeEligibleWorkRemaining: 0,
  };
  const maintenance = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    blocker: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    command: { plan: { processId: 'publish-controller-activity' } },
    structuredContent: {
      status: 1,
      stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=' + JSON.stringify({
        ok: false,
        blocker: 'CONTROLLER_ACTIVITY_WORKSPACE_WRITE_BLOCKED',
      }),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'publish-controller-activity', controllerActivity: activity }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.executionBlocker, 'CONTROLLER_ACTIVITY_WORKSPACE_WRITE_BLOCKED');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
});

test('stalled Sovereign maintenance transport times out fail-closed instead of remaining unresolved', async () => {
  const base = mcpFetch();
  let maintenanceStarted = false;
  const fetchFn = async (url, options = {}) => {
    if (url.endsWith('/mcp')) {
      const message = JSON.parse(options.body || '{}');
      if (message.method === 'tools/call' && message.params?.name === 'maintenance_action') {
        maintenanceStarted = true;
        return await new Promise((resolve, reject) => {
          const abort = () => {
            const error = new Error('transport deadline exceeded');
            error.name = 'AbortError';
            reject(error);
          };
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener('abort', abort, { once: true });
        });
      }
    }
    return base.fetchFn(url, options);
  };

  const startedAt = Date.now();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'fleet-goal-supervisor' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      networkTimeoutMs: 10,
      // This test isolates MCP transport timing, not the Windows boot preflight.
      ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
    },
  );

  assert.equal(maintenanceStarted, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.status, 0);
  assert.ok(Date.now() - startedAt < 1_000);
});




test('Sovereign response-body stall is covered by the same hard transport deadline', async () => {
  const base = mcpFetch();
  let maintenanceBodyStarted = false;
  const fetchFn = async (url, options = {}) => {
    if (url.endsWith('/mcp')) {
      const message = JSON.parse(options.body || '{}');
      if (message.method === 'tools/call' && message.params?.name === 'maintenance_action') {
        maintenanceBodyStarted = true;
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? 'session-1' : '' },
          text: () => new Promise((resolve, reject) => {
            const abort = () => {
              const error = new Error('response body deadline exceeded');
              error.name = 'AbortError';
              reject(error);
            };
            if (options.signal?.aborted) abort();
            else options.signal?.addEventListener('abort', abort, { once: true });
          }),
        };
      }
    }
    return base.fetchFn(url, options);
  };

  const startedAt = Date.now();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'fleet-goal-supervisor' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      networkTimeoutMs: 10,
      // This test isolates MCP transport timing, not the Windows boot preflight.
      ensureRuntimeFn: async () => ({ ok: true, bootstrapAttempted: false }),
    },
  );

  assert.equal(maintenanceBodyStarted, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.status, 0);
  assert.ok(Date.now() - startedAt < 1_000);
});

test('successful preservation convergence is projected as success instead of generic receipt-invalid', async () => {
  const targetHead = '1'.repeat(40);
  const newHead = '2'.repeat(40);
  const targetBranch = 'feature/self-repair-loop';
  const targetPrNumber = 2698;
  const preservationCore = {
    schemaVersion: 'stephanos.sovereign-preservation-convergence.v1',
    timestampUtc: '2026-10-03T20:00:00.000Z',
    canonicalOwnerGoal: '#2573',
    relatedPr: targetPrNumber,
    branch: targetBranch,
    oldHead: targetHead,
    protectedMainHead: HEAD,
    newHead,
    changed: true,
    pushed: true,
    diffCheckPassed: true,
    oldHeadAncestorPreserved: true,
    mainAncestorPreserved: true,
    exactHeadWriterGuard: true,
    nonForcePushOnly: true,
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
  };
  const preservationReceipt = {
    ok: true,
    ...preservationCore,
    proofHash: createHash('sha256').update(JSON.stringify(preservationCore)).digest('hex'),
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '8'.repeat(64),
    command: { plan: { processId: 'preservation-converge-pr-branch' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: `SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=${JSON.stringify(preservationReceipt)}\n`,
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });

  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: 'preservation-converge-pr-branch',
      targetPrNumber,
      targetBranch,
      targetHead,
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_COMPLETE');
  assert.equal(result.preservationConvergence.newHead, newHead);
  assert.equal(result.preservationConvergence.protectedMainHead, HEAD);
  assert.equal(result.preservationConvergence.forcePushAllowed, false);
  assert.equal(result.mergeAuthority, false);
});


test('tampered preservation convergence receipt is rejected even with a syntactically valid proof hash', async () => {
  const targetHead = '1'.repeat(40);
  const newHead = '2'.repeat(40);
  const targetBranch = 'feature/self-repair-loop';
  const targetPrNumber = 2698;
  const preservationCore = {
    schemaVersion: 'stephanos.sovereign-preservation-convergence.v1',
    timestampUtc: '2026-10-03T20:00:00.000Z',
    canonicalOwnerGoal: '#2573',
    relatedPr: targetPrNumber,
    branch: targetBranch,
    oldHead: targetHead,
    protectedMainHead: HEAD,
    newHead,
    changed: true,
    pushed: true,
    diffCheckPassed: true,
    oldHeadAncestorPreserved: true,
    mainAncestorPreserved: true,
    exactHeadWriterGuard: true,
    nonForcePushOnly: true,
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
  };
  const validHash = createHash('sha256').update(JSON.stringify(preservationCore)).digest('hex');
  const tamperedReceipt = {
    ok: true,
    ...preservationCore,
    newHead: '3'.repeat(40),
    proofHash: validHash,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '8'.repeat(64),
    command: { plan: { processId: 'preservation-converge-pr-branch' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: `SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=${JSON.stringify(tamperedReceipt)}\n`,
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: 'preservation-converge-pr-branch',
      targetPrNumber,
      targetBranch,
      targetHead,
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_RECEIPT_INVALID');
});


test('preservation convergence rejects semantically false changed and pushed claims even with a valid digest', async () => {
  const targetHead = '1'.repeat(40);
  const newHead = '2'.repeat(40);
  const targetBranch = 'feature/self-repair-loop';
  const targetPrNumber = 2698;
  const falseCore = {
    schemaVersion: 'stephanos.sovereign-preservation-convergence.v1',
    timestampUtc: '2026-10-03T20:00:00.000Z',
    canonicalOwnerGoal: '#2573',
    relatedPr: targetPrNumber,
    branch: targetBranch,
    oldHead: targetHead,
    protectedMainHead: HEAD,
    newHead,
    changed: false,
    pushed: false,
    diffCheckPassed: true,
    oldHeadAncestorPreserved: true,
    mainAncestorPreserved: true,
    exactHeadWriterGuard: true,
    nonForcePushOnly: true,
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
  };
  const receipt = {
    ok: true,
    ...falseCore,
    proofHash: createHash('sha256').update(JSON.stringify(falseCore)).digest('hex'),
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '8'.repeat(64),
    command: { plan: { processId: 'preservation-converge-pr-branch' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: `SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=${JSON.stringify(receipt)}\n`,
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: 'preservation-converge-pr-branch',
      targetPrNumber,
      targetBranch,
      targetHead,
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_RECEIPT_INVALID');
});


test('remote controller activity preserves scalar lane counts without inventing identities and rejects scalar material lanes', () => {
  const legacyZero = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: {
      schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
      controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
      runId: 'legacy-zero-array-test',
      observedEnabled: true,
      executionState: 'RUNNING',
      materialActionsSucceeded: 0,
      activeLanes: 0,
      parkedLanes: 0,
      materialLanes: 0,
      proofRefs: 0,
      safeEligibleWorkRemaining: 0,
    },
  }));
  assert.equal(legacyZero.ok, true);
  assert.deepEqual(legacyZero.command.controllerActivity.activeLanes, []);
  assert.deepEqual(legacyZero.command.controllerActivity.parkedLanes, []);
  assert.deepEqual(legacyZero.command.controllerActivity.materialLanes, []);
  assert.deepEqual(legacyZero.command.controllerActivity.proofRefs, []);

  const countOnly = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: {
      schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
      controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
      runId: 'count-only-lane-test',
      observedEnabled: true,
      executionState: 'BLOCKED',
      materialActionsSucceeded: 0,
      activeLanes: 2,
      parkedLanes: 1,
      safeEligibleWorkRemaining: 1,
      blocker: 'WAITING_FOR_CURRENT_OWNER',
    },
  }));
  assert.equal(countOnly.ok, true);
  assert.deepEqual(countOnly.command.controllerActivity.activeLanes, []);
  assert.deepEqual(countOnly.command.controllerActivity.parkedLanes, []);
  assert.equal(countOnly.command.controllerActivity.activeLaneCount, 2);
  assert.equal(countOnly.command.controllerActivity.parkedLaneCount, 1);

  const alreadyNormalizedCountOnly = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: {
      schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
      controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
      runId: 'already-normalized-count-only-lane-test',
      observedEnabled: true,
      executionState: 'BLOCKED',
      materialActionsSucceeded: 0,
      activeLanes: [],
      parkedLanes: [],
      activeLaneCount: 0,
      parkedLaneCount: 1,
      safeEligibleWorkRemaining: 1,
      blocker: 'WAITING_FOR_CURRENT_OWNER',
    },
  }));
  assert.equal(alreadyNormalizedCountOnly.ok, true);
  assert.deepEqual(alreadyNormalizedCountOnly.command.controllerActivity.activeLanes, []);
  assert.deepEqual(alreadyNormalizedCountOnly.command.controllerActivity.parkedLanes, []);
  assert.equal(alreadyNormalizedCountOnly.command.controllerActivity.activeLaneCount, 0);
  assert.equal(alreadyNormalizedCountOnly.command.controllerActivity.parkedLaneCount, 1);

  const malformed = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'publish-controller-activity',
    controllerActivity: {
      schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
      controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
      runId: 'scalar-material-lane-test',
      observedEnabled: true,
      executionState: 'RUNNING',
      materialActionsSucceeded: 0,
      activeLanes: [],
      parkedLanes: [],
      materialLanes: 1,
      safeEligibleWorkRemaining: 0,
    },
  }));
  assert.equal(malformed.ok, false);
  assert.equal(malformed.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ARRAY_INVALID');
});


test('Core daemon status stays observational underneath but Sovereign fails stale truth closed', async () => {
  const staleStatus = {
    schemaVersion: 'stephanos.core-daemon-status.v1',
    ok: false,
    processCount: 1,
    daemonHealthy: true,
    readiness: 'RELOAD_REQUIRED',
    wakeState: 'DEGRADED',
    awake: false,
    repairRequired: true,
    repairReason: 'SOURCE_HEAD_STALE',
    controlPlaneFinalVerdict: 'STEPHANOS_CONTROL_PLANE_DEGRADED',
    sourceHead: '4'.repeat(40),
    heartbeatAgeSeconds: 159978,
    sovereignCommanderHealthy: false,
    backendHealthy: false,
    missionWorkerHealthy: true,
    gamingActive: false,
    finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_NOT_READY',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'status-stephanos-core-daemon' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(staleStatus),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'status-stephanos-core-daemon' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CORE_DAEMON_NOT_READY');
  assert.equal(result.coreDaemonStatus.available, true);
  assert.equal(result.coreDaemonStatus.readiness, 'RELOAD_REQUIRED');
  assert.equal(result.coreDaemonStatus.sourceHead, '4'.repeat(40));
  assert.equal(result.coreDaemonStatus.heartbeatAgeSeconds, 159978);
  assert.equal(result.coreDaemonStatus.repairRequired, true);
});

test('public Core status preserves inaccessible process inventory as unknown without leaking raw evidence', async () => {
  for (const inventory of [
    { processCount: null, processInventoryComplete: false },
    { processCount: 0, processInventoryComplete: false },
    { processCount: 0 },
    { processCount: 0, processInventoryComplete: true },
  ]) {
    const maintenance = {
      ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'a'.repeat(64),
      command: { plan: { processId: 'status-stephanos-core-daemon' } },
      structuredContent: { ok: true, status: 0, stdout: JSON.stringify({
        schemaVersion: 'stephanos.core-daemon-status.v1', ok: false,
        ...inventory, processObservationBlocker: 'CORE_PROCESS_INVENTORY_UNPROVEN',
        processId: 12345, commandLine: 'PRIVATE_RAW_COMMAND_LINE', sourceHead: HEAD,
      }) },
    };
    const { fetchFn } = mcpFetch({ maintenance });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'status-stephanos-core-daemon' }),
      { spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn, env: { USERPROFILE: 'C:\\Users\\Operator' } },
    );
    assert.equal(result.coreDaemonStatus.processCount, inventory.processInventoryComplete === true ? 0 : null);
    assert.equal(result.coreDaemonStatus.processInventoryComplete, inventory.processInventoryComplete === true);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RAW_COMMAND_LINE|12345/);
  }
});

test('fresh exact-head Core daemon status remains a successful read-only Sovereign observation', async () => {
  const freshStatus = {
    schemaVersion: 'stephanos.core-daemon-status.v1',
    ok: true,
    processCount: 1,
    processInventoryComplete: true,
    daemonHealthy: true,
    singleWriterProven: true,
    writerProcessObserved: true,
    lockOwnerMatchesWriter: true,
    rescueGenerationPresent: true,
    rescueAttemptCount: 1,
    readiness: 'READY',
    wakeState: 'AWAKE',
    awake: true,
    repairRequired: false,
    repairReason: '',
    controlPlaneFinalVerdict: 'STEPHANOS_CONTROL_PLANE_AWAKE',
    sourceHead: HEAD,
    heartbeatAgeSeconds: 3,
    sovereignCommanderHealthy: true,
    backendHealthy: true,
    missionWorkerHealthy: true,
    gamingActive: false,
    finalVerdict: 'STEPHANOS_CORE_DAEMON_STATUS_PASS',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'b'.repeat(64),
    command: { plan: { processId: 'status-stephanos-core-daemon' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(freshStatus),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'status-stephanos-core-daemon' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE');
  assert.equal(result.coreDaemonStatus.available, true);
  assert.equal(result.coreDaemonStatus.awake, true);
  assert.equal(result.coreDaemonStatus.sourceHead, HEAD);
  for (const complete of [false, undefined]) {
    const contradictory = { ...maintenance, structuredContent: {
      ...maintenance.structuredContent,
      stdout: JSON.stringify({ ...freshStatus, processInventoryComplete: complete }),
    } };
    const { fetchFn: incompleteFetch } = mcpFetch({ maintenance: contradictory });
    const held = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'status-stephanos-core-daemon' }),
      { spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn: incompleteFetch, env: { USERPROFILE: 'C:\\Users\\Operator' } },
    );
    assert.equal(held.ok, false);
    assert.equal(held.coreDaemonStatus.ok, false);
    assert.equal(held.coreDaemonStatus.processCount, null);
  }
});

test('remote Core health refuses missing or false custody proofs despite fresh status', async () => {
  const good = {
    schemaVersion: 'stephanos.core-daemon-status.v1',
    ok: true,
    processCount: 1,
    daemonHealthy: true,
    singleWriterProven: true,
    writerProcessObserved: true,
    lockOwnerMatchesWriter: true,
    rescueGenerationPresent: true,
    rescueAttemptCount: 0,
    readiness: 'READY',
    sourceHead: HEAD,
    heartbeatAgeSeconds: 3,
    heartbeatFresh: true,
  };
  const variants = [
    { ...good, singleWriterProven: false },
    { ...good, writerProcessObserved: false },
    { ...good, lockOwnerMatchesWriter: false },
    { ...good, rescueGenerationPresent: false },
    { ...good, rescueAttemptCount: null },
    { ...good, rescueAttemptCount: -1 },
    { ...good, rescueAttemptCount: 0.5 },
    { ...good, singleWriterProven: undefined, writerProcessObserved: undefined,
      lockOwnerMatchesWriter: undefined, rescueGenerationPresent: undefined,
      rescueAttemptCount: undefined },
  ];
  for (const status of variants) {
    const maintenance = {
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'b'.repeat(64),
      command: { plan: { processId: 'status-stephanos-core-daemon' } },
      structuredContent: {
        ok: true, status: 0, stdout: JSON.stringify(status),
        stderr: '', errorCode: '',
      },
    };
    const { fetchFn } = mcpFetch({ maintenance });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'status-stephanos-core-daemon' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Operator' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CORE_DAEMON_NOT_READY');
  }
});

test('visibility-snapshot returns one bounded twice-sanitised Battle Bridge packet', async () => {
  const observation = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 1234,
    memory: { totalBytes: 64_000_000_000, freeBytes: 32_000_000_000, usedBytes: 32_000_000_000 },
    gpu: { available: true, name: 'NVIDIA GeForce RTX 5090', memoryTotalMiB: 32607, memoryUsedMiB: 1200, memoryFreeMiB: 31407, utilizationGpuPercent: 7 },
    ollama: { reachable: true, installedModelCount: 1, loadedModelCount: 0, installedModels: [{ name: 'qwen3.5:27b', sizeBytes: 1 }], loadedModels: [] },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    privatePath: 'C:\\private\\must-not-escape',
  };
  const controllers = {
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    physical: { expected: 5, building: 5, amber: 0, red: 0, unknown: 0, allCurrent: true, allObservedEnabled: true, finalVerdict: 'CONTROLLER_FLEET_READY', controllers: [] },
    logical: { current: true, valid: true, observedAtUtc: '2026-10-04T12:00:00.000Z', physicalControllerCount: 5, total: 20, active: 10, tracking: 10, parked: 0, retired: 0, selectedForAdmission: 10, finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY', hostLoads: [] },
    lanes: { targetMaterialLanes: 15, activeMaterialLaneCount: 15, activeLaneClaimCount: 15, reportedMaterialLaneCountSum: 15, occupancyPercent: 100, freeTargetLaneSlots: 0, runnableBacklogCount: 0, parkedPhysicalLaneCount: 0, reportedSafeEligibleWorkMax: 0, reportedSafeEligibleWorkSum: 0, refillHealth: 'GREEN', refillState: 'TARGET_MATERIAL_LANES_FILLED' },
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
  };
  const meters = {
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    counts: { total: 0, green: 0, amber: 0, red: 0, grey: 0 },
    attentionMeters: [],
    attentionMetersTruncated: false,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_METER_STATUS_READY',
  };
  const snapshot = {
    schemaVersion: 'stephanos.sovereign-visibility-snapshot.v1',
    ok: true,
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    repository: { available: true, head: HEAD, branch: 'main', dirty: false, changedEntryCount: 0, trackedChangeCount: 0, untrackedCount: 0, remoteMainAvailable: true, remoteMainHead: HEAD, rawPathsReturned: false, paths: ['C:\\secret'] },
    observation,
    core: {
      schemaVersion: 'stephanos.core-daemon-status.v1',
      available: true,
      ok: true,
      processCount: 1,
      daemonHealthy: true,
      readiness: 'READY',
      wakeState: 'AWAKE',
      awake: true,
      repairRequired: false,
      repairReason: '',
      controlPlaneFinalVerdict: 'STEPHANOS_CONTROL_PLANE_AWAKE',
      sourceHead: HEAD,
      heartbeatAgeSeconds: 5,
      sovereignCommanderHealthy: true,
      backendHealthy: true,
      missionWorkerHealthy: true,
      gamingActive: false,
      rawCommandLine: 'MUST_NOT_ESCAPE',
    },
    headSync: {
      schemaVersion: 'stephanos.sovereign-head-sync.v1',
      canonicalMainHead: HEAD,
      repositoryHead: HEAD,
      runtimeHead: HEAD,
      remoteMainAvailable: true,
      repositoryMatchesMain: true,
      runtimeMatchesRepository: true,
      runtimeMatchesMain: true,
      exactHeadChainProven: true,
      mainChangedSinceRepository: false,
      mainChangedSinceRuntime: false,
      syncState: 'CURRENT',
      trafficLight: 'GREEN',
      exactNextAction: 'NONE',
      readOnly: true,
      sourceMutationAllowed: false,
      unknownMeansGreen: false,
      finalVerdict: 'SOVEREIGN_HEAD_SYNC_CURRENT',
      privateRemote: 'MUST_NOT_ESCAPE',
    },
    selfHeal: {
      available: true,
      dependencySelfHealEnabled: true,
      dependencySelfHealLastAttemptAtUtc: '2026-10-04T11:59:00.000Z',
      dependencySelfHealAttemptCount: 2,
      dependencySelfHealLastVerdict: 'CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED',
      dependencySelfHealLastBlocker: '',
      dependencySelfHealProofHashes: ['b'.repeat(64)],
      octopusSelfHealEnabled: true,
      octopusSelfHealLastAttemptAtUtc: '2026-10-04T11:58:00.000Z',
      octopusSelfHealAttemptCount: 1,
      octopusSelfHealLastVerdict: 'OCTOPUS_SELF_HEAL_VERIFIED_RECOVERED',
      octopusSelfHealLastBlocker: '',
      octopusSelfHealLastProofHash: 'c'.repeat(64),
      flywheelCycleRunning: false,
      flywheelLastCycleFinishedAtUtc: '2026-10-04T11:59:30.000Z',
      flywheelLastStatus: 'READY',
      flywheelLastAction: 'REFILL',
      flywheelLastBlockerCount: 0,
      privateReceiptPath: 'C:\\secret\\receipt.json',
    },
    controllers,
    meters,
    relay: {
      available: true,
      daemonHealthy: true,
      carrierHealthy: true,
      deliveryState: 'FAST_ACTIVE',
      adaptivePollMode: 'HOT',
      nextPollMs: 2500,
      heartbeatAtUtc: '2026-10-04T12:00:00.000Z',
      heartbeatAgeSeconds: 1,
      carrierConsecutiveFailures: 0,
      scheduledMailboxFallbackExpected: true,
      fallbackCovered: false,
      retryIdentityPreserved: true,
      blocker: '',
      finalVerdict: 'SOVEREIGN_RELAY_DAEMON_HEALTHY',
      token: 'MUST_NOT_ESCAPE',
    },
    health: { repository: 'GREEN', core: 'GREEN', headSync: 'GREEN', services: 'GREEN', laneRefill: 'GREEN', transport: 'GREEN' },
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    remoteCommanderRequired: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_VISIBILITY_SNAPSHOT_READY',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'visibility-snapshot' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_VISIBILITY_SNAPSHOT_RESULT=' + JSON.stringify(snapshot),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'visibility-snapshot' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE');
  assert.equal(result.visibilitySnapshot.repository.head, HEAD);
  assert.equal(result.visibilitySnapshot.repository.remoteMainHead, HEAD);
  assert.equal(result.visibilitySnapshot.headSync.syncState, 'CURRENT');
  assert.equal(result.visibilitySnapshot.headSync.canonicalMainHead, HEAD);
  assert.equal(result.visibilitySnapshot.headSync.exactHeadChainProven, true);
  assert.equal(result.visibilitySnapshot.health.headSync, 'GREEN');
  assert.equal(result.visibilitySnapshot.core.wakeState, 'AWAKE');
  assert.equal(result.visibilitySnapshot.selfHeal.dependencySelfHealAttemptCount, 2);
  assert.equal(result.visibilitySnapshot.controllers.lanes.activeMaterialLaneCount, 15);
  assert.equal(result.visibilitySnapshot.relay.deliveryState, 'FAST_ACTIVE');
  assert.equal(result.visibilitySnapshot.health.core, 'GREEN');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /MUST_NOT_ESCAPE|privatePath|privateReceiptPath|privateRemote|rawCommandLine|C:\\\\secret|PRIVATE RAW OUTPUT|PRIVATE STDERR/);
});


test('repair-stephanos preflights Commander runtime before opening MCP', async () => {
  const base = mcpFetch();
  const events = [];
  const fetchFn = async (...args) => {
    events.push('fetch');
    return base.fetchFn(...args);
  };
  let preflightCalls = 0;
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'repair-stephanos' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      ensureRuntimeFn: async ({ repoRoot }) => {
        preflightCalls += 1;
        events.push('preflight');
        assert.match(repoRoot, /stephan-os$/i);
        return {
          ok: true,
          bootstrapAttempted: true,
          staleCapabilityRecycleRequested: true,
        };
      },
    },
  );

  assert.equal(preflightCalls, 1);
  assert.equal(events[0], 'preflight');
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE');
  assert.equal(result.remoteAction, 'repair-stephanos');
  assert.equal(result.processId, 'repair-stephanos');
  assert.equal(result.status, 0);
});

test('repair-stephanos fails closed when Commander runtime preflight cannot converge', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'repair-stephanos' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      ensureRuntimeFn: async () => ({
        ok: false,
        bootstrapAttempted: true,
        staleCapabilityRecycleRequested: true,
        blocker: 'SOVEREIGN_COMMANDER_HEALTH_UNAVAILABLE',
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RUNTIME_PREFLIGHT_FAILED');
  assert.equal(result.runtimeBlocker, 'SOVEREIGN_COMMANDER_HEALTH_UNAVAILABLE');
  assert.equal(result.runtimeBootstrapAttempted, true);
  assert.equal(result.staleCapabilityRecycleRequested, true);
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(calls.length, 0);
});

test('canonical goal repair actions preflight Commander health before opening MCP', async () => {
  for (const remoteAction of ['fleet-goal-supervisor', 'repair-goal-builder-flow']) {
    const base = mcpFetch();
    let runtimeReady = false;
    let preflightCalls = 0;
    let healthCalls = 0;
    const fetchFn = async (url, options) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (!runtimeReady) throw new Error('COMMANDER_UNAVAILABLE');
      }
      return base.fetchFn(url, options);
    };
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
        ensureRuntimeFn: async () => {
          preflightCalls += 1;
          runtimeReady = true;
          return { ok: true, bootstrapAttempted: true };
        },
      },
    );
    assert.equal(preflightCalls, 1, remoteAction);
    assert.ok(healthCalls >= 1, remoteAction);
    assert.notEqual(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_HEALTH_REQUIRED', remoteAction);
    assert.equal(result.publicReceiptSafe, true, remoteAction);
    assert.equal(result.secretMaterialReturned, false, remoteAction);
  }
});

test('goal repair preflight failure never opens MCP or reports success', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'fleet-goal-supervisor' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      ensureRuntimeFn: async () => ({
        ok: false,
        bootstrapAttempted: true,
        blocker: 'SOVEREIGN_COMMANDER_HEALTH_UNAVAILABLE',
      }),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RUNTIME_PREFLIGHT_FAILED');
  assert.equal(result.runtimeBlocker, 'SOVEREIGN_COMMANDER_HEALTH_UNAVAILABLE');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(calls.length, 0);
});

test('non-repair remote actions do not gain Commander runtime recycle authority', async () => {
  const { fetchFn } = mcpFetch();
  let preflightCalls = 0;
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      ensureRuntimeFn: async () => {
        preflightCalls += 1;
        return { ok: true };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(preflightCalls, 0);
});


test('single maintenance action reports a runner timeout as bounded failure instead of invalid receipt', async () => {
  const failedReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    blocker: 'ETIMEDOUT',
    command: { plan: { processId: 'repair-openclaw-stack' } },
    contentText: 'PRIVATE TIMEOUT OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
      errorCode: 'ETIMEDOUT',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance: failedReceipt });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'repair-openclaw-stack' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED');
  assert.equal(result.remoteAction, 'repair-openclaw-stack');
  assert.equal(result.status, null);
  assert.equal(result.processId, 'repair-openclaw-stack');
  assert.equal(result.errorCode, 'ETIMEDOUT');
  assert.equal(result.executionBlocker, 'ETIMEDOUT');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE TIMEOUT OUTPUT'), false);
});
test('mobile original r7 census is fixed immutable-source and remains custody HOLD', async () => {
  const invocations = [];
  const census = {
    schemaVersion: 'stephanos.original-source-custody-readonly-census.v1',
    repository: 'Cheekyfellastef/stephan-os',
    originalLeaseId: 'critical-2962-elastic-goal-r7-lease',
    inspectionMode: 'UNPRIVILEGED_READ_ONLY',
    inspectedAtUtc: new Date().toISOString(),
    checkoutPresent: true, aclReadable: true,
    candidateProcessCount: 0, stephanosScheduledTaskCount: 7,
    unknownObservations: [],
    historicalExecutionOutcome: 'UNKNOWN', originalReceiptReconstructed: false,
    independentWindowsExclusionProven: false, outOfJobWriterExclusionProven: false,
    sourceAclDenialProven: false, independentOperatorApprovalProven: false,
    leaseReleaseAuthorized: false, sourceMutationAuthorized: false,
    finalVerdict: 'INSPECTION_ONLY_CUSTODY_HOLD',
    privateSecret: 'PRIVATE_HOST_PATH_DO_NOT_RETURN',
  };
  const spawn = (_exe, args) => {
    invocations.push(args);
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: HEAD + '\n', stderr: '' };
    if (args.includes('show')) return { status: 0, stdout: '# immutable script', stderr: '' };
    if (args.includes('-EncodedCommand')) return { status: 0, stdout: JSON.stringify(census), stderr: '' };
    return { status: 1, stdout: '', stderr: 'blocked' };
  };
  const { fetchFn, calls } = mcpFetch();
  const examine = () => executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'original-source-custody-census' }),
    { spawnSyncFn: spawn, readFileFn: readToken, fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  const result = await examine();
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_CUSTODY_CENSUS_OBSERVED_HOLD');
  assert.equal(result.inspection.finalVerdict, 'ORIGINAL_SOURCE_CUSTODY_HOLD');
  assert.equal(result.inspection.leaseReleaseAuthorized, false);
  assert.equal(result.privilegedWindowsWitnessCommissioned, false);
  assert.equal(result.inspection.candidateProcessCount, 0);
  assert.match(JSON.stringify(result), /INDEPENDENT_OS_EXCLUSION_WITNESS_NOT_COMMISSIONED/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HOST_PATH_DO_NOT_RETURN/);
  assert.equal(invocations.some(args => args.includes('-File')), false);
  const encodedCommand = invocations.find(args => args.includes('-EncodedCommand'));
  assert.ok(encodedCommand);
  const decodedScript = Buffer.from(encodedCommand[encodedCommand.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  assert.match(decodedScript, /PSScriptRoot = Join-Path/);
  assert.ok(decodedScript.includes('scripts\\windows'));
  assert.ok(decodedScript.endsWith('# immutable script'));
  assert.equal(invocations.some(args => args.includes('show')
    && args.includes(HEAD + ':scripts/windows/inspect-original-source-custody-readonly.ps1')), true);
  assert.equal(calls.some(call => JSON.stringify(call).includes('maintenance_action')), false);
  census.leaseReleaseAuthorized = true;
  const forged = await examine();
  assert.equal(forged.ok, false);
  assert.equal(forged.blocker, 'SOVEREIGN_CUSTODY_CENSUS_UNTRUSTED_OR_STALE');
  census.leaseReleaseAuthorized = false;
  census.inspectedAtUtc = '2020-01-01T00:00:00.000Z';
  const stale = await examine();
  assert.equal(stale.ok, false);
  assert.equal(stale.blocker, 'SOVEREIGN_CUSTODY_CENSUS_UNTRUSTED_OR_STALE');
});
test('mobile original r7 census rejects caller supplied executable targets or authority', () => {
  for (const payload of [{pid:1},{path:'C:\\private'},{script:'evil'}, {signer:'self'}, {leaseReleaseAuthorized:true}]) {
    const verdict = validateSovereignCommanderRemoteCommandShape(command({
      remoteAction:'original-source-custody-census', ...payload,
    }));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');
  }
  assert.equal(validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '', remotePlan:['original-source-custody-census'],
  })).ok, false);
});
test('read-only single action exits when MCP request ignores AbortSignal (no 16-minute ACCEPTED hang)', async () => {
  const base = mcpFetch();
  let stalledCalls = 0;
  const fetchFn = (url, options = {}) => {
    if (url.endsWith('/mcp')) {
      stalledCalls += 1;
      return new Promise(() => {}); // Intentionally never honours options.signal.
    }
    return base.fetchFn(url, options);
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'status-stephanos-core-daemon' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      networkTimeoutMs: 12,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(stalledCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZE_FAILED');
  assert.equal(result.sourceMutationAllowed, undefined);
});

test('read-only single action exits when MCP response body never settles', async () => {
  const base = mcpFetch();
  const fetchFn = async (url, options = {}) => {
    const value = await base.fetchFn(url, options);
    if (url.endsWith('/mcp')) return { ...value, text: () => new Promise(() => {}) };
    return value;
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-observe' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      networkTimeoutMs: 12,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZE_FAILED');
});

test('single maintenance action has an overall budget across health, MCP setup and execution', async () => {
  const base = mcpFetch();
  let nowMs = 10_000;
  const fetchFn = async (url, options = {}) => {
    const message = url.endsWith('/mcp') ? JSON.parse(options.body || '{}') : {};
    const value = await base.fetchFn(url, options);
    if (message.method === 'tools/list') {
      nowMs += SOVEREIGN_COMMANDER_REMOTE_PLAN_TOTAL_TIMEOUT_MS + 1;
    }
    return value;
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'status-stephanos-core-daemon' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      nowFn: () => nowMs,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_DEADLINE_EXCEEDED');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  const actualMaintenance = base.calls.filter((call) => {
    if (!call.url.endsWith('/mcp')) return false;
    const body = JSON.parse(call.options.body || '{}');
    return body.method === 'tools/call' && body.params?.name === 'maintenance_action';
  });
  assert.equal(actualMaintenance.length, 0);
});

test('75 logical goals produce a complete remote lane receipt through the real strict mailbox parser', async () => {
  const source = {
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-16T20:47:30.459Z',
    physical: {
      expected: 5, building: 0, amber: 0, red: 5, unknown: 0,
      allCurrent: false, allObservedEnabled: false,
      finalVerdict: 'CONTROLLER_FLEET_ATTENTION_REQUIRED',
      controllers: Array.from({ length: 5 }, (_, index) => ({
        controllerId: `controller-${index}`,
        title: `Controller ${index}`,
        freshness: 'STALE', activityState: 'WAITING',
        trafficLight: 'RED', blocker: 'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
        materialLaneCount: 0, activeLaneCount: 0,
        parkedLaneCount: 0, safeEligibleWorkRemaining: 0,
        materialLanes: [{ proofRef: 'PRIVATE_PROOF_DO_NOT_EXPOSE' }],
      })),
    },
    logical: {
      current: true, valid: true, observedAtUtc: '2026-10-16T20:47:30.459Z',
      physicalControllerCount: 5, total: 75, active: 0,
      tracking: 70, parked: 5, retired: 0, selectedForAdmission: 17,
      finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
      hostLoads: [],
      controllers: Array.from({ length: 75 }, (_, index) => ({
        logicalControllerId: `logical-${index}`,
        title: `PRIVATE_GOAL_${index}_${'x'.repeat(220)}`,
        workerPath: 'PRIVATE_WORKER_PATH_DO_NOT_EXPOSE',
        selectedForAdmission: index < 17,
      })),
    },
    lanes: {
      targetMaterialLanes: 15, activeMaterialLaneCount: 0,
      selectedMaterialPickupProvenCount: 0, activeLaneClaimCount: 0,
      reportedMaterialLaneCountSum: 0, occupancyPercent: 0,
      freeTargetLaneSlots: 15, runnableBacklogCount: 0,
      parkedPhysicalLaneCount: 0, reportedSafeEligibleWorkMax: 0,
      reportedSafeEligibleWorkSum: 0,
      refillHealth: 'AMBER', refillState: 'TELEMETRY_STALE_OR_INCOMPLETE',
    },
    readOnly: true, arbitraryShellAllowed: false,
    sourceMutationAllowed: false, mergeAuthority: false,
    secretMaterialIncluded: false, unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
  };
  assert.ok(Buffer.byteLength(JSON.stringify(source)) > 16 * 1024);
  const remote = projectBoundedRemoteControllerLaneStatus(source);
  const stdout = 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT='
    + JSON.stringify(remote) + '\n';
  assert.ok(Buffer.byteLength(stdout) < 12 * 1024);
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'controller-lane-status' } },
    structuredContent: { ok: true, status: 0, stdout, stderr: '', errorCode: '' },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'controller-lane-status' }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn, env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE');
  assert.equal(result.controllerLaneStatus.logical.total, 75);
  assert.equal(result.controllerLaneStatus.logical.selectedForAdmission, 17);
  assert.equal(result.controllerLaneStatus.physical.red, 5);
  assert.equal(result.controllerLaneStatus.lanes.refillHealth, 'AMBER');
  assert.equal(result.controllerLaneStatus.unknownMeansGreen, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_GOAL_'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_WORKER_PATH'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_PROOF'), false);
});

test('Island boundary remote action permits only a fixed read-only probe and no caller path', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'rescue-island-readonly-boundary',
  }));
  assert.equal(valid.ok, true);
  assert.equal(valid.command.remoteAction, 'rescue-island-readonly-boundary');
  for (const field of [{ targetPath: 'C:\\\\private' }, { args: ['--write'] },
    { workerId: 'rescue-island-01' }, { command: 'git add .' }]) {
    const value = validateSovereignCommanderRemoteCommandShape(command({
      remoteAction: 'rescue-island-readonly-boundary', ...field,
    }));
    assert.equal(value.ok, false);
    assert.equal(value.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');
  }
});

test('live Island scope needs an exact machine marker before public DONE', async () => {
  const clean = {
    schemaVersion: 'stephanos.rescue-island-boundary-probe.v1',
    ok: true, blocker: '', observedPathCount: 3,
    physicalScopeReadback: 'LOCAL_OS_SCOPE_OBSERVED',
    finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED',
    sourceMutationAllowed: false, workerStartAllowed: false,
    independentOwnershipAuthenticated: false, gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false, seedForgeQueueAccessAllowed: false,
    mergeAllowed: false, publicReceiptSafe: true,
  };
  const run = async output => executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'rescue-island-readonly-boundary' }),
    {
      spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: {
        ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
        proofHash: 'a'.repeat(64),
        command: { plan: { processId: 'rescue-island-readonly-boundary' } },
        contentText: 'RAW PRIVATE NATIVE DATA',
        structuredContent: {
          ok: true, status: 0,
          stdout: output, stderr: 'PRIVATE CENSUS STDERR', errorCode: '',
        },
      } }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  const safe = await run('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=' + JSON.stringify(clean) + '\n');
  assert.equal(safe.ok, true);
  assert.equal(safe.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_OBSERVED');
  assert.equal(safe.rescueIslandBoundary?.readOnly, true);
  assert.equal(safe.rescueIslandBoundary?.sourceMutationAllowed, false);
  assert.equal(safe.rescueIslandBoundary?.workerStartAllowed, false);
  assert.equal(safe.rescueIslandBoundary?.originalSourceLeaseReleaseAllowed, false);
  assert.doesNotMatch(JSON.stringify(safe), /RAW PRIVATE|PRIVATE CENSUS/);

  for (const output of [
    'private success without child proof',
    'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=' + JSON.stringify({ ...clean, workerStartAllowed: true }),
    'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=' + JSON.stringify(clean) + '\nPRIVATE FILE',
  ]) {
    const denied = await run(output);
    assert.equal(denied.ok, false);
    assert.equal(denied.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_RECEIPT_INVALID');
    assert.equal(denied.sourceMutationAllowed, undefined);
    assert.doesNotMatch(JSON.stringify(denied), /RAW PRIVATE|PRIVATE CENSUS/);
  }
});


test('failed fixed Island probe supplies only a typed hold, not source authority', async () => {
  const denied = {
    schemaVersion: 'stephanos.rescue-island-boundary-probe.v1',
    ok: false, blocker: 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED',
    observedPathCount: 0, physicalScopeReadback: 'HELD',
    finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_BLOCKED',
    sourceMutationAllowed: false, workerStartAllowed: false,
    independentOwnershipAuthenticated: false, gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false, seedForgeQueueAccessAllowed: false,
    mergeAllowed: false, publicReceiptSafe: true,
  };
  const stdout = 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=' + JSON.stringify(denied) + '\n';
  const response = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'rescue-island-readonly-boundary' }),
    {
      spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: {
        ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        command: { plan: { processId: 'rescue-island-readonly-boundary' } },
        structuredContent: {
          status: 1, stdout, stderr: 'PRIVATE_NATIVE_ERROR', errorCode: '',
        },
      } }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(response.ok, false);
  assert.equal(response.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_HELD');
  assert.equal(response.executionBlocker, 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED');
  assert.equal(response.rescueIslandBoundary?.readOnly, true);
  assert.equal(response.rescueIslandBoundary?.workerStartAllowed, false);
  assert.equal(response.rescueIslandBoundary?.mergeAllowed, false);
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_NATIVE_ERROR/);
});

test('Island scope readback is bound to nested native execution, not outer MCP content', async () => {
  const scope = {
    schemaVersion: 'stephanos.rescue-island-boundary-probe.v1',
    ok: true, blocker: '', observedPathCount: 3,
    physicalScopeReadback: 'LOCAL_OS_SCOPE_OBSERVED',
    finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED',
    sourceMutationAllowed: false, workerStartAllowed: false,
    independentOwnershipAuthenticated: false, gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false, seedForgeQueueAccessAllowed: false,
    mergeAllowed: false, publicReceiptSafe: true,
  };
  const inner = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'f'.repeat(64),
    command: { plan: { processId: 'rescue-island-readonly-boundary' } },
    structuredContent: {
      status: 0, errorCode: '',
      stdout: 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=' + JSON.stringify(scope) + '\n',
      stderr: 'NATIVE_PRIVATE_STDERR',
    },
  };
  const outer = {
    ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'f'.repeat(64),
    structuredContent: inner,
    contentText: 'UNTRUSTED_PRIVATE_OUTER_TEXT',
  };
  const inspect = async payload => executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'rescue-island-readonly-boundary' }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: payload }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  const success = await inspect(outer);
  assert.equal(success.ok, true);
  assert.equal(success.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_OBSERVED');
  assert.equal(success.rescueIslandBoundary?.observedPathCount, 3);
  assert.equal(success.rescueIslandBoundary?.workerStartAllowed, false);
  assert.doesNotMatch(JSON.stringify(success), /NATIVE_PRIVATE|UNTRUSTED_PRIVATE/);
  const tampered = await inspect({
    ...outer, structuredContent: {
      ...inner,
      structuredContent: {
        ...inner.structuredContent,
        stdout: 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT='
          + JSON.stringify({ ...scope, workerStartAllowed: true }) + '\n',
      },
    },
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_RECEIPT_INVALID');
  // A forged success must carry only the safe structural diagnostic, not
  // an OS denial token, granted authority or any of the untrusted marker bytes.
  assert.equal(tampered.executionBlocker, 'ISLAND_NATIVE_MARKER_REJECTED');
  assert.doesNotMatch(JSON.stringify(tampered), /NATIVE_PRIVATE|UNTRUSTED_PRIVATE/);
});


test('native Island absent execution envelope distinguishes source denial from MCP failure without leaking secrets', () => {
  const inspect = data => diagnoseRescueIslandNativeReceiptInvalidV1({
    expectedAction: 'rescue-island-readonly-boundary',
    envelope: {}, positive: null, negative: null,
    projection: { ok: false, processId: '', status: null }, ...data,
  });
  const variants = [
    [{ rawMaintenance: { ok:false, finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
      command: { blockers: ['sovereign-commander-process-not-registered'] },
      blocker:'PRIVATE_SCRIPT_PATH_C:/Users/operator' } }, 'ISLAND_NATIVE_FIXED_ACTION_NOT_REGISTERED'],
    [{ rawMaintenance: { ok:false, finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
      command: { blockers: ['sovereign-commander-process-not-registered', 'trusted-repository-root-required'] },
      blocker:'PRIVATE_SID_AND_REPOSITORY_ROOT' } }, 'ISLAND_NATIVE_TRUSTED_REPOSITORY_ROOT_UNAVAILABLE'],
    [{ rawMaintenance: { ok:false, finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
      command: { blockers: ['PRIVATE_UNRECOGNISED_BLOCKER'] },
      blocker:'PRIVATE_HOST_PATH' } }, 'ISLAND_NATIVE_COMMAND_BLOCKED_BEFORE_RUN'],
    [{ rawMaintenance: { ok:false, finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
      blocker:'PRIVATE_SCRIPT_PATH_C:/Users/operator' } }, 'ISLAND_NATIVE_COMMAND_BLOCKED_BEFORE_RUN'],
    [{ rawMaintenance: { ok:false, finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      command:{plan:{processId:'rescue-island-readonly-boundary'}},
      blocker:'PRIVATE_SID_PROCESS', structuredContent:{ errorCode:'PRIVATE' } } },
      'ISLAND_NATIVE_RUNNER_FAILED_WITHOUT_EXIT_STATUS'],
    [{ mcpError:true, rawMaintenance:{isError:true, blocker:'PRIVATE_KEY'} },
      'ISLAND_NATIVE_MCP_REJECTED_OR_UNAVAILABLE'],
    [{ mcpError:false, rawMaintenance:{} }, 'ISLAND_NATIVE_ENVELOPE_NOT_OBSERVED'],
  ];
  for (const [input, expected] of variants) {
    const result = inspect(input);
    assert.equal(result, expected);
    assert.match(result, /^ISLAND_NATIVE_[A-Z_]+$/);
    assert.doesNotMatch(result, /PRIVATE|C:\\/);
  }
});

test('Island invalid-proof diagnostics reveal only constant categories and cannot authorize writers', () => {
  const processId = 'rescue-island-readonly-boundary';
  const baseProjection = {
    ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64), processId, status: 0,
  };
  const envelope = (stdout, status = 0, process = processId) => ({
    ok: status === 0,
    command: { plan: { processId: process } },
    structuredContent: { status, stdout, stderr: 'PRIVATE_NATIVE_ROOT_AND_KEYS' },
  });
  const inspect = args => diagnoseRescueIslandNativeReceiptInvalidV1({
    expectedAction: processId, projection: baseProjection,
    positive: null, negative: null, ...args,
  });
  const tests = [
    [{ envelope: {} }, 'ISLAND_NATIVE_ENVELOPE_NOT_OBSERVED'],
    [{ envelope: envelope('anything', 0, 'other') }, 'ISLAND_NATIVE_PROCESS_BINDING_INVALID'],
    [{ envelope: { command: { plan: { processId } }, structuredContent: { status: null, stdout: 'private' } } }, 'ISLAND_NATIVE_EXIT_STATUS_UNAVAILABLE'],
    [{ envelope: { command: { plan: { processId } }, structuredContent: { status: 0 } } }, 'ISLAND_NATIVE_STDOUT_UNAVAILABLE'],
    [{ envelope: envelope('PRIVATE_SOURCE_ROOT') }, 'ISLAND_NATIVE_MARKER_NOT_OBSERVED'],
    [{ envelope: envelope('PRIVATE_SOURCE_ROOT' + String.fromCharCode(10) + 'OTHER_DATA') }, 'ISLAND_NATIVE_STDOUT_LINES_INVALID'],
    [{ envelope: envelope('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=PRIVATE_JSON') }, 'ISLAND_NATIVE_MARKER_REJECTED'],
    [{ envelope: envelope('X'.repeat(4097)) }, 'ISLAND_NATIVE_STDOUT_TOO_LARGE'],
    [{ envelope: envelope('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT={}', 1), negative: { ok: false } }, 'ISLAND_NATIVE_DENIAL_ENVELOPE_INVALID'],
    [{ envelope: envelope('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT={}', 1), positive: { ok: true } }, 'ISLAND_NATIVE_POSITIVE_EXIT_MISMATCH'],
    [{ envelope: envelope('RESCUE_ISLAND_BOUNDARY_PROBE_RESULT={}'), positive: { ok: true },
      projection: { ...baseProjection, proofHash: '' } }, 'ISLAND_NATIVE_SUCCESS_ENVELOPE_INVALID'],
  ];
  for (const [input, expected] of tests) {
    const observed = inspect(input);
    assert.equal(observed, expected);
    assert.match(observed, /^ISLAND_NATIVE_[A-Z_]+$/);
    assert.doesNotMatch(observed, /PRIVATE|ROOT_AND_KEYS|HOST|TOKEN/);
  }
  assert.equal(diagnoseRescueIslandNativeReceiptInvalidV1({
    expectedAction: 'other', envelope: envelope('PRIVATE'),
  }), 'ISLAND_NATIVE_ACTION_NOT_ALLOWED');
});

test('native Island diagnostic remains negative on contradictory wrapper authority', () => {
  const processId = 'rescue-island-readonly-boundary';
  const marker = 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT={}';
  const envelope = (status) => ({
    ok: status === 0,
    command: { plan: { processId } },
    structuredContent: { status, stdout: marker, stderr: 'PRIVATE_SYSTEM_DETAIL' },
  });
  const projection = {
    ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64), processId, status: 0,
  };
  const diagnose = extra => diagnoseRescueIslandNativeReceiptInvalidV1({
    expectedAction: processId, envelope: envelope(0), projection,
    positive: null, negative: null, ...extra,
  });
  // Diagnostic invocation must not turn even a success-shaped outer wrapper
  // into live Island worker admission or an invented boundary success.
  assert.equal(diagnose({ positive: { ok: true } }),
    'ISLAND_NATIVE_BOUNDARY_INCONSISTENT');
  assert.equal(diagnose({ negative: { ok: false } }),
    'ISLAND_NATIVE_DENIAL_ENVELOPE_INVALID');
  assert.equal(diagnose({ envelope: envelope('0') }),
    'ISLAND_NATIVE_EXIT_STATUS_UNAVAILABLE');
  assert.equal(diagnose({ envelope: envelope(1), positive: { ok: true } }),
    'ISLAND_NATIVE_POSITIVE_EXIT_MISMATCH');
  for (const value of [
    diagnose({ positive: { ok: true } }),
    diagnose({ negative: { ok: false } }),
    diagnose({ envelope: envelope('0') }),
  ]) {
    assert.match(value, /^ISLAND_NATIVE_[A-Z_]+$/);
    assert.doesNotMatch(value, /PRIVATE|PATH|KEY|TOKEN|GRANTED/);
  }
});

test('real remote Island malformed success is BLOCKED with only a safe diagnostic token', async () => {
  const processId = 'rescue-island-readonly-boundary';
  const response = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: processId }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: {
        ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
        proofHash: 'a'.repeat(64),
        command: { plan: { processId } },
        contentText: 'PRIVATE_WINDOWS_PATH',
        structuredContent: { status: 0, stdout: 'PRIVATE_WINDOWS_PATH', stderr: 'PRIVATE_SECRET' },
      } }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );
  assert.equal(response.ok, false);
  assert.equal(response.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_RECEIPT_INVALID');
  assert.equal(response.executionBlocker, 'ISLAND_NATIVE_MARKER_NOT_OBSERVED');
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_WINDOWS_PATH|PRIVATE_SECRET/);
  assert.equal(response.rescueIslandBoundary, undefined);
  assert.equal(response.sourceMutationAllowed, undefined);
});

test('VR archive remote accepts wrapped Windows execution envelope and returns only sanitised page', async () => {
  const processId = 'starfield-vr-telemetry-archive';
  const sessionId = 'starfield-vr-performance-20261019-234600';
  const parsed = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-archive.v1',
    ok: true, generatedAtUtc: '2026-10-20T02:05:00.000Z',
    directoryAvailable: true, totalSessions: 1,
    newestSessionId: sessionId, offset: 0, limit: 4,
    nextOffset: null, hasMore: false,
    readOnly: true, sourceMutationAllowed: false,
    rawTelemetryReturned: false, hostPathsReturned: false,
    secretMaterialReturned: false, arbitraryShellAllowed: false,
    unknownMeansGreen: false,
    finalVerdict: 'STARFIELD_VR_TELEMETRY_ARCHIVE_READY',
    sessions: [{
      sessionId, provider: 'mutar-openxr',
      sourceHead: HEAD, sessionOutcome: 'COMPLETED',
      sampleCount: 36, avgApplicationFrameTimeMs: 14.25,
      partialTelemetry: false, csvPresent: true, summaryPresent: true,
      sessionReceiptPresent: true,
      rawSecret: 'PRIVATE_ARCHIVE_PAYLOAD_MUST_NOT_ESCAPE',
    }],
  };
  const inner = {
    ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64), command: { plan: { processId } },
    contentText: 'PRIVATE_RAW_STDOUT_MUST_NOT_ESCAPE',
    structuredContent: {
      status: 0,
      stdout: 'STARFIELD_VR_TELEMETRY_ARCHIVE_RESULT=' + JSON.stringify(parsed) + '\n',
      stderr: 'PRIVATE_WINDOWS_STDERR_MUST_NOT_ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn, calls } = mcpFetch({ maintenance: { structuredContent: inner } });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: processId, telemetryOffset: 0, telemetryLimit: 4 }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  assert.equal(result.ok, true, JSON.stringify({
    blocker: result.blocker, proofHashPresent: result.proofHashPresent,
    processIdMatch: result.processIdMatch, successfulStatus: result.successfulStatus,
    archivePresent: result.archivePresent,
  }));
  assert.equal(result.finalVerdict, 'STARFIELD_VR_TELEMETRY_ARCHIVE_READY');
  assert.equal(result.telemetryArchive.totalSessions, 1);
  assert.equal(result.telemetryArchive.sessions[0].sampleCount, 36);
  assert.equal(result.telemetryArchive.sessions[0].avgApplicationFrameTimeMs, 14.25);
  assert.equal(result.telemetryArchive.rawTelemetryReturned, false);
  assert.equal(result.telemetryArchive.hostPathsReturned, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ARCHIVE_PAYLOAD|PRIVATE_RAW_STDOUT|PRIVATE_WINDOWS_STDERR/);
  assert.equal(calls.some(({ options }) => {
    try {
      const message = JSON.parse(options?.body || '{}');
      return message.method === 'tools/call' && message.params?.name === 'starfield_vr_telemetry_archive'
        && message.params?.arguments?.offset === 0 && message.params?.arguments?.limit === 4;
    } catch { return false; }
  }), true);
});

test('VR archive detects stale served MCP capability and requests governed runtime refresh', async () => {
  const processId = 'starfield-vr-telemetry-archive';
  const { fetchFn, calls } = mcpFetch({ archiveDedicatedAdvertised: false });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: processId, telemetryOffset: 0, telemetryLimit: 1 }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_ARCHIVE_SERVED_TOOL_MISSING');
  assert.equal(result.runtimeRefreshRequired, true);
  assert.equal(result.dedicatedToolAdvertised, false);
  assert.equal(result.sourceMutationAllowed, false);
  const archiveCalls = calls.map(({ options }) => {
    try { return JSON.parse(options?.body || '{}'); } catch { return {}; }
  }).filter((message) => message.method === 'tools/call'
    && (message.params?.name === 'starfield_vr_telemetry_archive'
      || message.params?.arguments?.actionId === processId));
  assert.equal(archiveCalls.length, 0, 'must not fake an unreachable legacy fallback');
});

test('VR archive failure exports only a typed local Commander blocker, not private payload', async () => {
  const processId = 'starfield-vr-telemetry-archive';
  const { fetchFn } = mcpFetch({
    maintenance: {
      ok: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      blocker: 'SOVEREIGN_ARCHIVE_READER_FAILED',
      command: { plan: { processId } },
      structuredContent: { status: 1, stdout: 'PRIVATE_RAW_SESSION_CONTENT',
        stderr: 'C:\\Users\\Private\\secrets.txt', errorCode: 'ENOENT' },
    },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: processId, telemetryOffset: 0, telemetryLimit: 1 }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken, fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  assert.equal(result.ok, false);
  assert.match(result.blocker, /STARFIELD_VR_ARCHIVE_EXECUTION_ENVELOPE_INVALID/);
  assert.equal(result.mcpToolReturnedError, true);
  assert.equal(result.commanderBlocker, 'SOVEREIGN_ARCHIVE_READER_FAILED');
  assert.equal(result.executionStatus, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RAW_SESSION_CONTENT|secrets\\.txt/);
});

test('VR archive failure distinguishes a missing marker with no private output', async () => {
  const processId = 'starfield-vr-telemetry-archive';
  const inner = {
    ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64), command: { plan: { processId } },
    structuredContent: {
      status: 0,
      stdout: 'PRIVATE_INTERNAL_STDOUT_NOT_A_TELEMETRY_MARKER',
      stderr: 'PRIVATE_INTERNAL_STDERR',
      errorCode: '',
    },
  };
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: processId, telemetryOffset: 0, telemetryLimit: 4 }),
    { spawnSyncFn: spawnForHead(), readFileFn: readToken,
      fetchFn: mcpFetch({ maintenance: { structuredContent: inner } }).fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_ARCHIVE_MARKER_MISSING');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_INTERNAL_STDOUT|PRIVATE_INTERNAL_STDERR/);
});

test('fixed native Windows exam carries only a bounded candidate result through MCP',async()=>{
  const reviewIdentity = {
    schemaVersion:'stephanos.sovereign-review-exact-request.v1',
    repository:'Cheekyfellastef/stephan-os',
    issueNumber:1574,prNumber:3090,branch:'main',
    sourceHead:HEAD,baseSha:'b'.repeat(40),
    implementerProvider:'github-builder',
    implementerSessionId:'builder-3090',reviewerSessionId:'reviewer-3090',
    implementerPrincipal:'builder-principal',reviewerPrincipal:'reviewer-principal',
  };
  const missing=validateSovereignCommanderRemoteCommandShape(command({
    remoteAction:'sovereign-windows-reviewer-calibration',
  }));
  assert.equal(missing.ok,false,'unbound remote action must not run on daemon defaults');
  assert.equal(missing.blocker,'SOVEREIGN_WINDOWS_CALIBRATION_IDENTITY_UNBOUND');
  assert.equal(validateSovereignCommanderRemoteCommandShape(command({
    remoteAction:'sovereign-windows-reviewer-calibration',
    reviewIdentity:{...reviewIdentity,sourceHead:'f'.repeat(40)},
  })).ok,false,'different source must fail before MCP call');

  const { projectWindowsCalibrationForRemoteV1:project,
    WINDOWS_CALIBRATION_REMOTE_MARKER:marker } = await import('./sovereignWindowsCalibrationRemoteV1.mjs');
  const { sovereignWindowsCalibrationManifestV1:manifest }=await import('./sovereignWindowsCalibrationV1.mjs');
  const denial=Object.fromEntries(Object.entries(project()).filter(([,v])=>v===false));
  const candidate=project({status:'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED',reason:'',
    repository:'Cheekyfellastef/stephan-os',sourceHead:HEAD,baseSha:'b'.repeat(40),
    manifestSha256:manifest().manifestSha256,observationsSha256:'c'.repeat(64),
    modelDigestSha256:'d'.repeat(64),completedCases:13,passedCases:13,
    qualification:'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',...denial});
  const action='sovereign-windows-reviewer-calibration';
  for(const mode of ['pass','held','forged','wrong-head','wrong-base','wrong-request-base']) {
    const held=project({status:'WINDOWS_CALIBRATION_HELD',reason:'EXACT_LOCAL_SOURCE_UNPROVEN',...denial});
    const payload=mode==='held'?held:mode==='forged'?{...candidate,leaseReleaseAuthority:true}
      :mode==='wrong-head'?{...candidate,sourceHead:'f'.repeat(40)}
      :['wrong-base','wrong-request-base'].includes(mode)?{...candidate,baseSha:'f'.repeat(40)}:candidate;
    const native={ok:mode!=='held',
      finalVerdict:mode==='held'?'SOVEREIGN_COMMANDER_EXECUTION_FAILED':'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash:mode==='held'?undefined:'e'.repeat(64),command:{plan:{processId:action,
        reviewIdentity:mode==='wrong-request-base'?{...reviewIdentity,baseSha:'f'.repeat(40)}:reviewIdentity}},
      contentText:'PRIVATE',structuredContent:{status:mode==='held'?2:0,
        stdout:marker+JSON.stringify(payload),stderr:'PRIVATE'}};
    const mcp=mcpFetch({maintenance:native});
    const result=await executeSovereignCommanderRemoteOnBattleBridge(command({remoteAction:action,reviewIdentity}),{
      spawnSyncFn:spawnForHead(),readFileFn:readToken,fetchFn:mcp.fetchFn,
      env:{USERPROFILE:'C:\\Users\\Operator'},
    });
    assert.equal(result.ok,mode==='pass',mode);
    assert.equal(mcp.calls.some(call=>{
      try {
        const body=JSON.parse(call.options?.body||'{}');
        return body.method==='tools/call' && body.params?.name==='maintenance_action'
          && body.params?.arguments?.actionId===action
          && JSON.stringify(body.params.arguments.reviewIdentity)===JSON.stringify(reviewIdentity);
      } catch { return false; }
    }),true,'exact identity is forwarded through the authenticated MCP action');

    if(mode==='pass')assert.equal(result.calibration.qualifiedWindowsSpecialist,false);
    if(mode==='held')assert.equal(result.calibration.reason,'EXACT_LOCAL_SOURCE_UNPROVEN');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
  const plan=validateSovereignCommanderRemoteCommandShape(command({remoteAction:'',remotePlan:[action]}));
  assert.equal(plan.ok,false); // No inference-bearing compound plan/replay.
});

test('native calibration pre-execution failures expose only a bounded denial, never a pass',async()=>{
  const reviewIdentity={
    schemaVersion:'stephanos.sovereign-review-exact-request.v1',
    repository:'Cheekyfellastef/stephan-os',
    issueNumber:1574,prNumber:3191,branch:'main',
    sourceHead:HEAD,baseSha:'b'.repeat(40),
    implementerProvider:'canonical-programme-builder',
    implementerSessionId:'builder-3191',reviewerSessionId:'reviewer-3191',
    implementerPrincipal:'builder-principal',reviewerPrincipal:'reviewer-principal',
  };
  const action='sovereign-windows-reviewer-calibration';
  const attempt=async(errorCode,stderr='PRIVATE_NATIVE_STDERR')=>{
    const native={
      ok:false,finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      command:{plan:{processId:action,reviewIdentity}},
      structuredContent:{status:null,stdout:'',stderr,errorCode},
    };
    const {fetchFn}=mcpFetch({maintenance:native});
    return executeSovereignCommanderRemoteOnBattleBridge(command({remoteAction:action,reviewIdentity}),{
      spawnSyncFn:spawnForHead(),readFileFn:readToken,fetchFn,
      env:{USERPROFILE:'C:\\\\Users\\\\Operator'},
    });
  };
  const denied=await attempt('SOVEREIGN_WINDOWS_REVIEW_IDENTITY_OR_TRANSPORT_UNPROVEN');
  assert.equal(denied.ok,false);
  assert.equal(denied.blocker,'SOVEREIGN_WINDOWS_CALIBRATION_RECEIPT_INVALID');
  assert.equal(denied.errorCode,'SOVEREIGN_WINDOWS_REVIEW_IDENTITY_OR_TRANSPORT_UNPROVEN');
  assert.equal(denied.status,undefined);
  assert.equal(denied.executionBlocker,'');
  assert.equal(denied.publicReceiptSafe,true);
  assert.equal(denied.secretMaterialReturned,false);
  assert.doesNotMatch(JSON.stringify(denied),/PRIVATE_NATIVE_STDERR/);
  assert.notEqual(denied.verdict,'COMMAND_EXECUTION_COMPLETE');
  const nonzero=await (async()=>{
    const native={
      ok:false,finalVerdict:'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      command:{plan:{processId:action,reviewIdentity}},
      structuredContent:{status:2,stdout:'',stderr:'PRIVATE_FAILURE_LOG',errorCode:'REVIEWER_RUNNER_EXIT_2'},
    };
    const {fetchFn}=mcpFetch({maintenance:native});
    return executeSovereignCommanderRemoteOnBattleBridge(command({remoteAction:action,reviewIdentity}),{
      spawnSyncFn:spawnForHead(),readFileFn:readToken,fetchFn,
      env:{USERPROFILE:'C:\\\\Users\\\\Operator'},
    });
  })();
  assert.equal(nonzero.ok,false);
  assert.equal(nonzero.blocker,'SOVEREIGN_WINDOWS_CALIBRATION_RECEIPT_INVALID');
  assert.equal(nonzero.status,2);
  assert.equal(nonzero.errorCode,'REVIEWER_RUNNER_EXIT_2');
  assert.doesNotMatch(JSON.stringify(nonzero),/PRIVATE_FAILURE_LOG/);

  // Never forward arbitrary native error text, injected paths or credentials.
  const malformed=await attempt('C:\\\\PRIVATE\\\\secret-token');
  assert.equal(malformed.ok,false);
  assert.equal(malformed.blocker,'SOVEREIGN_WINDOWS_CALIBRATION_RECEIPT_INVALID');
  assert.equal(malformed.errorCode ?? '', '');
  assert.doesNotMatch(JSON.stringify(malformed),/PRIVATE|secret-token/);
});


test('remote Ignition diagnosis returns bounded live repair truth without private logs or paths', async () => {
  const diagnosis = {
    schemaVersion: 'stephanos.sovereign-commander-ignition-diagnosis.v1',
    ok: false,
    observedAtUtc: '2026-10-31T21:30:00.000Z',
    sourceHead: HEAD,
    sourceExact: true,
    readinessVerdict: 'blocked-needs-supervisor-repair',
    services: {
      backend8787: { ready: true },
      stephanosUi4173: { ready: false },
      openClaw18789: { ready: true, requiredForIgnition: false },
      sharedWorkspace: { ready: true },
    },
    supervisor: {
      observed: true,
      stale: false,
      observedAtUtc: '2026-10-31T21:29:59.000Z',
      currentPhase: 'Stephanos UI 4173',
      trafficLight: 'red',
      blockerId: 'IGNITION_UI_4173_NOT_READY',
      phases: [
        { id: 'backend 8787', state: 'ready', blockerId: '' },
        { id: 'Stephanos UI 4173', state: 'blocked', blockerId: 'IGNITION_UI_4173_NOT_READY' },
      ],
      logPath: 'C:\\private\\ignition.log',
    },
    repairRequired: true,
    autoRepairEligible: true,
    nextRepairAction: 'repair-ui-4173',
    blocker: 'IGNITION_UI_4173_NOT_READY',
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_REPAIR_READY',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'f'.repeat(64),
    command: { plan: { processId: 'diagnose-ignition' } },
    contentText: 'PRIVATE CONTENT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_RESULT=' + JSON.stringify(diagnosis) + '\nPRIVATE STDOUT',
      stderr: 'PRIVATE STDERR',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'diagnose-ignition' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_IGNITION_DIAGNOSIS_COMPLETE');
  assert.equal(result.ignitionDiagnosis.services.backend8787.ready, true);
  assert.equal(result.ignitionDiagnosis.services.stephanosUi4173.ready, false);
  assert.equal(result.ignitionDiagnosis.nextRepairAction, 'repair-ui-4173');
  assert.equal(result.ignitionDiagnosis.autoRepairEligible, true);
  assert.equal(result.ignitionDiagnosis.rawLogsReturned, false);
  assert.equal(result.ignitionDiagnosis.rawPathsReturned, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('C:\\private\\ignition.log'), false);
  assert.equal(serialized.includes('PRIVATE STDOUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
  assert.equal(serialized.includes('PRIVATE CONTENT MUST NOT ESCAPE'), false);
});
