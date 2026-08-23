import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_ACTION_STATUS,
  BATTLE_BRIDGE_PROBE_STATUS,
  BATTLE_BRIDGE_RECOVERY_STATE,
  BATTLE_BRIDGE_SERVICE_IDS,
  BATTLE_BRIDGE_SERVICE_STATE,
  BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
  aggregateBattleBridgeSupervisorProbes,
  buildBattleBridgeServiceRegistry,
  buildBattleBridgeSupervisorContract,
  createBackendFreshnessReuseProbe,
  createBattleBridgeHealthRecord,
  createBattleBridgeHeartbeat,
  createBattleBridgeProbe,
  createBattleBridgeRecoveryReceipt,
  createMissionWorkerSelfHealPlan,
  publishBattleBridgeSupervisorStatus,
  simulateBattleBridgeSelfHeal,
  transitionBattleBridgeWorkerState,
} from './battleBridgeSupervisor.mjs';

test('supervisor contract exposes required Battle Bridge services, states, receipts, and guardrails', () => {
  const contract = buildBattleBridgeSupervisorContract();

  assert.equal(contract.schemaVersion, BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION);
  for (const serviceId of ['backend', 'openclaw-gateway', 'stephanos-ui', 'mission-worker']) {
    assert.equal(contract.services.includes(serviceId), true);
    assert.equal(BATTLE_BRIDGE_SERVICE_IDS.includes(serviceId), true);
  }
  assert.equal(contract.services.includes('shared-agent-workspace'), false);
  assert.deepEqual(contract.serviceStates, Object.values(BATTLE_BRIDGE_SERVICE_STATE));
  assert.deepEqual(contract.recoveryStates, Object.values(BATTLE_BRIDGE_RECOVERY_STATE));
  assert.equal(contract.knownPorts.backend, 8787);
  assert.equal(contract.knownPorts['openclaw-gateway'], 18789);
  assert.equal(contract.knownPorts['stephanos-ui'], 4173);
  assert.equal(contract.guardrails.visiblePowerShellWallsAllowed, false);
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.guardrails.processKillingAllowed, false);
  assert.equal(contract.guardrails.actualRestartImplementationAllowed, false);
  assert.equal(contract.guardrails.structuredContractsOnly, true);
  assert.equal(contract.workspaceRoutes.status, 'status/battle-bridge-supervisor.json');
  assert.equal(contract.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_CONTRACT_READY');
});

test('service registry models the four supervised services without command authority', () => {
  const registry = buildBattleBridgeServiceRegistry({ timestampUtc: '2026-07-07T00:00:00Z' });

  assert.equal(registry.generatedAtUtc, '2026-07-07T00:00:00Z');
  assert.deepEqual(registry.services.map((service) => service.serviceId), [
    'stephanos-ui',
    'backend',
    'mission-worker',
    'openclaw-gateway',
  ]);
  for (const service of registry.services) {
    assert.equal(service.commandExecutionAllowed, false);
    assert.equal(service.processKillAllowed, false);
    assert.equal(service.restartImplementationAllowed, false);
    assert.equal(service.restartIntentAllowed, true);
  }
});

test('health records separate reachability, usability, and browser compatibility truth', () => {
  const health = createBattleBridgeHealthRecord({
    serviceId: 'stephanos-ui',
    state: 'DEGRADED',
    recoveryState: 'REQUESTED',
    reachable: true,
    usable: false,
    browserCompatible: false,
    checkedAtUtc: '2026-07-07T00:01:00Z',
    summary: 'Stephanos UI reachable but not usable.',
  });

  assert.equal(health.serviceId, 'stephanos-ui');
  assert.equal(health.state, 'DEGRADED');
  assert.equal(health.recoveryState, 'REQUESTED');
  assert.equal(health.health.reachable, true);
  assert.equal(health.health.usable, false);
  assert.equal(health.health.browserCompatible, false);
  assert.equal(health.failurePublished, true);
  assert.equal(health.sharedWorkspaceEventKind, 'error');
});

test('heartbeat publisher produces structured workspace-compatible heartbeat', () => {
  const heartbeat = createBattleBridgeHeartbeat({
    serviceId: 'backend',
    state: 'READY',
    sequence: 7,
    publishedAtUtc: '2026-07-07T00:02:00Z',
  });

  assert.equal(heartbeat.serviceId, 'backend');
  assert.equal(heartbeat.state, 'READY');
  assert.equal(heartbeat.sequence, 7);
  assert.equal(heartbeat.sharedWorkspaceEventKind, 'heartbeat');
});

test('worker lifecycle state machine records transitions without command execution', () => {
  const starting = transitionBattleBridgeWorkerState({ currentState: 'STOPPED', event: 'start_requested' });
  const ready = transitionBattleBridgeWorkerState({ currentState: starting.nextState, event: 'health_passed' });
  const recovering = transitionBattleBridgeWorkerState({ currentState: 'FAILED', event: 'recovery_requested' });

  assert.equal(starting.nextState, 'STARTING');
  assert.equal(ready.nextState, 'READY');
  assert.equal(recovering.nextState, 'RECOVERING');
  assert.equal(recovering.executedCommand, false);
});

test('recovery receipts publish restart intent but never execute commands or kill processes', () => {
  const receipt = createBattleBridgeRecoveryReceipt({
    serviceId: 'mission-orchestrator-worker',
    recoveryState: 'SUCCEEDED',
    restartIntentPublished: true,
    requestedAtUtc: '2026-07-07T00:03:00Z',
  });

  assert.equal(receipt.serviceId, 'mission-worker');
  assert.equal(receipt.recoveryState, 'SUCCEEDED');
  assert.equal(receipt.restartIntentPublished, true);
  assert.equal(receipt.executedCommand, false);
  assert.equal(receipt.killedProcess, false);
  assert.equal(receipt.secretOutputIncluded, false);
});

test('supervisor status publisher writes hidden structured events into shared workspace', () => {
  const publication = publishBattleBridgeSupervisorStatus({
    heartbeat: { serviceId: 'mission-worker', state: 'RECOVERING', sequence: 1, publishedAtUtc: '2026-07-07T00:04:00Z' },
    healthRecords: [
      { serviceId: 'mission-worker', state: 'FAILED', recoveryState: 'REQUESTED', summary: 'Mission Worker failed.' },
    ],
    recoveryReceipts: [
      { serviceId: 'mission-worker', recoveryState: 'REQUESTED', restartIntentPublished: true },
    ],
  });

  assert.equal(publication.visibleLogWall, false);
  assert.deepEqual(publication.failureServiceIds, ['mission-worker']);
  assert.deepEqual(publication.restartIntentServiceIds, ['mission-worker']);
  assert.equal(publication.workspaceMessage.sender, 'mission-orchestrator');
  assert.equal(publication.workspaceMessage.eventKind, 'operator-action-required');
  assert.equal(publication.workspaceMessage.validation.valid, true);
  assert.equal(publication.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_STATUS_ACTION_REQUIRED');
});

test('deterministic self-heal simulation records recovery without real restart', () => {
  const simulation = simulateBattleBridgeSelfHeal({
    serviceId: 'mission-worker',
    startState: 'FAILED',
    succeeds: true,
    requestedAtUtc: '2026-07-07T00:05:00Z',
    completedAtUtc: '2026-07-07T00:06:00Z',
  });

  assert.deepEqual(simulation.transitions.map((transition) => transition.nextState), ['RECOVERING', 'READY']);
  assert.equal(simulation.receipt.recoveryState, 'SUCCEEDED');
  assert.equal(simulation.receipt.restartIntentPublished, true);
  assert.equal(simulation.executedCommand, false);
  assert.equal(simulation.killedProcess, false);
  assert.equal(simulation.finalVerdict, 'BATTLE_BRIDGE_SELF_HEAL_SIMULATION_SUCCEEDED');
});

test('service probes normalize to operator-visible shared workspace events', () => {
  const pass = createBattleBridgeProbe({
    serviceId: 'backend',
    status: 'PASS',
    checkedAtUtc: '2026-06-28T20:00:00Z',
    summary: 'Backend 8787 verified 200.',
  });
  const fail = createBattleBridgeProbe({
    serviceId: 'mission-orchestrator-worker',
    status: 'FAIL',
    detail: 'WORKER_RECOVERED=False',
  });

  assert.equal(pass.status, BATTLE_BRIDGE_PROBE_STATUS.PASS);
  assert.equal(pass.port, 8787);
  assert.equal(pass.sharedWorkspaceEventKind, 'health-check-result');
  assert.equal(fail.serviceId, 'mission-worker');
  assert.equal(fail.sharedWorkspaceEventKind, 'operator-action-required');
  assert.equal(fail.operatorVisible, true);
});

test('worker self-heal plan is restart-intent-only and never stores commands', () => {
  const plan = createMissionWorkerSelfHealPlan({ workerHealthy: false });

  assert.equal(plan.actionStatus, BATTLE_BRIDGE_ACTION_STATUS.NEEDS_RESTART);
  assert.equal(plan.restartCommand, '');
  assert.equal(plan.restartIntentOnly, true);
  assert.equal(plan.statusRoute, 'shared-workspace/status/battle-bridge-supervisor.json');
  assert.equal(plan.proofRoute, 'shared-workspace/proof/battle-bridge-supervisor-worker-self-heal.json');
  assert.equal(plan.finalVerdict, 'WORKER_SELF_HEAL_RESTART_INTENT_ONLY');
});

test('aggregate passes only when every required service has a PASS probe', () => {
  const aggregate = aggregateBattleBridgeSupervisorProbes({
    probes: [
      { serviceId: 'backend', status: 'PASS', summary: 'Backend 8787 verified 200.' },
      { serviceId: 'openclaw-gateway', status: 'PASS', summary: 'OpenClaw real gateway 18789 verified 200.' },
      { serviceId: 'stephanos-ui', status: 'PASS', summary: 'Stephanos UI 4173 verified 200.' },
      { serviceId: 'mission-worker', status: 'PASS', summary: 'Worker healthy.' },
    ],
  });

  assert.equal(aggregate.status, BATTLE_BRIDGE_ACTION_STATUS.READY);
  assert.deepEqual(aggregate.failedServiceIds, []);
  assert.deepEqual(aggregate.missingServiceIds, []);
  assert.equal(aggregate.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_PASS');
});

test('aggregate blocks when a service failed or a required service is missing', () => {
  const aggregate = aggregateBattleBridgeSupervisorProbes({
    probes: [
      { serviceId: 'backend', status: 'PASS' },
      { serviceId: 'openclaw-gateway', status: 'PASS' },
      { serviceId: 'mission-worker', status: 'FAIL', summary: 'Worker did not recover.' },
    ],
  });

  assert.equal(aggregate.status, BATTLE_BRIDGE_ACTION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(aggregate.failedServiceIds.includes('mission-worker'), true);
  assert.equal(aggregate.missingServiceIds.includes('stephanos-ui'), true);
  assert.equal(aggregate.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_BLOCKED');
});

test('backend reuse probe consumes freshness supervisor and blocks missing mission operations route', () => {
  const probe = createBackendFreshnessReuseProbe({
    routeProofs: [
      { route: '/api/health', status: 200 },
      { route: '/api/mission-operations', status: 404 },
    ],
  });

  assert.equal(probe.status, BATTLE_BRIDGE_PROBE_STATUS.FAIL);
  assert.match(probe.summary, /BACKEND_STALE_ROUTE_MISSING/);
  assert.equal(probe.detail, 'BACKEND_STALE_ROUTE_MISSING');
});
