import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IGNITION_CONCIERGE_SCHEMA_VERSION,
  IGNITION_STATUS,
  aggregateIgnitionStatusRoutes,
  buildIgnitionConciergeStatusRoutingContract,
  createIgnitionStatusRoute,
  createIgnitionVerificationResult,
  validateIgnitionStatusRoute,
} from './ignitionConciergeStatusRouting.mjs';

test('contract exposes services, surfaces, and no-window guardrails', () => {
  const contract = buildIgnitionConciergeStatusRoutingContract();

  assert.equal(contract.schemaVersion, IGNITION_CONCIERGE_SCHEMA_VERSION);
  assert.equal(contract.services.includes('backend'), true);
  assert.equal(contract.services.includes('mission-orchestrator-worker'), true);
  assert.equal(contract.surfaces.includes('splash'), true);
  assert.equal(contract.surfaces.includes('dashboard'), true);
  assert.equal(contract.guardrails.visiblePowerShellWallsAllowed, false);
  assert.equal(contract.guardrails.statusMustRouteToSharedWorkspace, true);
  assert.equal(contract.finalVerdict, 'IGNITION_CONCIERGE_STATUS_ROUTING_CONTRACT_READY');
});

test('ready status route creates shared workspace message and suppresses PowerShell wall', () => {
  const route = createIgnitionStatusRoute({
    serviceId: 'backend',
    status: 'READY',
    summary: 'Backend 8787 verified 200.',
    primarySurface: 'splash',
  });

  assert.equal(route.status, IGNITION_STATUS.READY);
  assert.equal(route.visiblePowerShellWall, false);
  assert.equal(route.sharedWorkspacePath, 'status/ignition/backend.json');
  assert.equal(route.sharedWorkspaceMessage.eventKind, 'status');
  assert.equal(validateIgnitionStatusRoute(route).finalVerdict, 'IGNITION_STATUS_ROUTE_PASS');
});

test('blocked status route requires exact unblock action', () => {
  const route = createIgnitionStatusRoute({
    serviceId: 'mission-orchestrator-worker',
    status: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
    summary: 'Worker did not recover.',
    exactUnblockAction: 'Install worker supervisor and rerun self-heal proof.',
  });

  assert.equal(route.sharedWorkspaceMessage.eventKind, 'operator-action-required');
  assert.equal(route.sharedWorkspaceMessage.requiresOperator, true);
  assert.equal(route.exactUnblockAction, 'Install worker supervisor and rerun self-heal proof.');
  assert.equal(validateIgnitionStatusRoute(route).valid, true);
});

test('validator blocks unsanitized visible PowerShell wall route', () => {
  const result = validateIgnitionStatusRoute({
    schemaVersion: IGNITION_CONCIERGE_SCHEMA_VERSION,
    kind: 'stephanos.ignition_concierge.status_route',
    routeId: 'bad-route',
    serviceId: 'backend',
    status: 'READY',
    primarySurface: 'splash',
    sharedWorkspacePath: 'status/ignition/backend.json',
    summary: 'Backend ready.',
    visiblePowerShellWall: true,
    sharedWorkspaceMessage: {},
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('visible-powershell-wall'), true);
  assert.equal(result.errors.includes('invalid-shared-workspace-message'), true);
});

test('aggregate passes only when all required services are ready', () => {
  const aggregate = aggregateIgnitionStatusRoutes({
    routes: [
      { serviceId: 'backend', status: 'READY' },
      { serviceId: 'openclaw-gateway', status: 'READY' },
      { serviceId: 'stephanos-ui', status: 'READY' },
      { serviceId: 'mission-orchestrator-worker', status: 'READY' },
      { serviceId: 'shared-agent-workspace', status: 'READY' },
    ],
  });

  assert.equal(aggregate.status, IGNITION_STATUS.READY);
  assert.deepEqual(aggregate.missingServiceIds, []);
  assert.equal(aggregate.finalVerdict, 'IGNITION_CONCIERGE_STATUS_ROUTING_PASS');
});

test('verification result fails when ignition routing is incomplete', () => {
  const result = createIgnitionVerificationResult({
    routes: [
      { serviceId: 'backend', status: 'READY' },
      { serviceId: 'mission-orchestrator-worker', status: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION' },
    ],
  });

  assert.equal(result.aggregate.status, IGNITION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(result.verifierResult.status, 'FAIL');
  assert.equal(result.finalVerdict, 'IGNITION_CONCIERGE_VERIFICATION_BLOCKED');
});
