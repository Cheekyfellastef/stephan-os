import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_ACTION_STATUS,
  BATTLE_BRIDGE_PROBE_STATUS,
  BATTLE_BRIDGE_SERVICE_IDS,
  BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION,
  aggregateBattleBridgeSupervisorProbes,
  buildBattleBridgeSupervisorContract,
  createBattleBridgeProbe,
  createMissionWorkerSelfHealPlan,
  createBackendFreshnessReuseProbe,
} from './battleBridgeSupervisor.mjs';

test('supervisor contract exposes required Battle Bridge services and guardrails', () => {
  const contract = buildBattleBridgeSupervisorContract();

  assert.equal(contract.schemaVersion, BATTLE_BRIDGE_SUPERVISOR_SCHEMA_VERSION);
  for (const serviceId of ['backend', 'openclaw-gateway', 'stephanos-ui', 'mission-orchestrator-worker', 'shared-agent-workspace']) {
    assert.equal(contract.services.includes(serviceId), true);
    assert.equal(BATTLE_BRIDGE_SERVICE_IDS.includes(serviceId), true);
  }
  assert.equal(contract.knownPorts.backend, 8787);
  assert.equal(contract.knownPorts['openclaw-gateway'], 18789);
  assert.equal(contract.knownPorts['stephanos-ui'], 4173);
  assert.equal(contract.guardrails.visiblePowerShellWallsAllowed, false);
  assert.equal(contract.guardrails.restartRequiresExplicitServiceId, true);
  assert.equal(contract.finalVerdict, 'BATTLE_BRIDGE_SUPERVISOR_CONTRACT_READY');
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
  assert.equal(fail.sharedWorkspaceEventKind, 'operator-action-required');
  assert.equal(fail.operatorVisible, true);
});

test('worker self-heal plan becomes restart-ready only with autostart and exact start command', () => {
  const plan = createMissionWorkerSelfHealPlan({
    workerHealthy: false,
    autostartInstalled: true,
    repositoryRoot: 'C:/Users/Stephan/Documents/GitHub/stephan-os',
    startCommand: 'Start-ScheduledTask -TaskName StephanosMissionOrchestratorWorker',
    detail: 'Killed worker returned Ready and WORKER_RECOVERED=False.',
  });

  assert.equal(plan.actionStatus, BATTLE_BRIDGE_ACTION_STATUS.NEEDS_RESTART);
  assert.equal(plan.restartCommand, 'Start-ScheduledTask -TaskName StephanosMissionOrchestratorWorker');
  assert.equal(plan.statusRoute, 'shared-workspace/status/battle-bridge-supervisor.json');
  assert.equal(plan.proofRoute, 'shared-workspace/proof/battle-bridge-supervisor-worker-self-heal.json');
  assert.equal(plan.finalVerdict, 'WORKER_SELF_HEAL_READY_TO_RESTART');
});

test('worker self-heal plan blocks with exact unblock action when restart prerequisites are missing', () => {
  const plan = createMissionWorkerSelfHealPlan({
    workerHealthy: false,
    autostartInstalled: false,
  });

  assert.equal(plan.actionStatus, BATTLE_BRIDGE_ACTION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(plan.restartCommand, '');
  assert.equal(plan.exactUnblockAction.includes('Install or repair the Mission Orchestrator Worker autostart task'), true);
  assert.equal(plan.finalVerdict, 'WORKER_SELF_HEAL_BLOCKED');
});

test('aggregate passes only when every required service has a PASS probe', () => {
  const aggregate = aggregateBattleBridgeSupervisorProbes({
    probes: [
      { serviceId: 'backend', status: 'PASS', summary: 'Backend 8787 verified 200.' },
      { serviceId: 'openclaw-gateway', status: 'PASS', summary: 'OpenClaw real gateway 18789 verified 200.' },
      { serviceId: 'stephanos-ui', status: 'PASS', summary: 'Stephanos UI 4173 verified 200.' },
      { serviceId: 'mission-orchestrator-worker', status: 'PASS', summary: 'Worker healthy.' },
      { serviceId: 'shared-agent-workspace', status: 'PASS', summary: 'Shared workspace writable.' },
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
      { serviceId: 'mission-orchestrator-worker', status: 'FAIL', summary: 'Worker did not recover.' },
    ],
  });

  assert.equal(aggregate.status, BATTLE_BRIDGE_ACTION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(aggregate.failedServiceIds.includes('mission-orchestrator-worker'), true);
  assert.equal(aggregate.missingServiceIds.includes('stephanos-ui'), true);
  assert.equal(aggregate.missingServiceIds.includes('shared-agent-workspace'), true);
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
