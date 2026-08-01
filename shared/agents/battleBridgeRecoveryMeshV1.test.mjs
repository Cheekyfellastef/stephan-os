import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_RECOVERY_ACTION,
  BATTLE_BRIDGE_RECOVERY_EXECUTOR,
  BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ROUTE,
  BATTLE_BRIDGE_RECOVERY_ROUTES,
  adjudicateBattleBridgeRecoveryMesh,
  buildBattleBridgeRecoveryMeshContract,
  classifyBattleBridgeRecoveryMeshHealth,
  validateBattleBridgeRecoveryIngress,
} from './battleBridgeRecoveryMeshV1.mjs';

const NOW = Date.parse('2026-08-01T03:00:00.000Z');

function ingress(route, suffix = route.toLowerCase(), overrides = {}) {
  const evidence = {
    [BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR]: { scheduledTaskVerified: true },
    [BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX]: { ownerAuthenticated: true },
    [BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL]: { tailnetIdentityVerified: true },
    [BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP]: { operatorIdentityVerified: true },
    [BATTLE_BRIDGE_RECOVERY_ROUTE.AUTHENTICATED_BREAK_GLASS]: { nonceConfirmed: true },
  }[route];
  return {
    schemaVersion: BATTLE_BRIDGE_RECOVERY_INGRESS_SCHEMA,
    requestId: `recovery-${suffix}-0001`,
    route,
    action: BATTLE_BRIDGE_RECOVERY_ACTION,
    issuedAtUtc: '2026-08-01T02:59:00.000Z',
    expiresAtUtc: '2026-08-01T03:05:00.000Z',
    sourceReceipt: `receipt/${suffix}/0001`,
    ...evidence,
    ...overrides,
  };
}

test('contract exposes five entrances but exactly one executor', () => {
  const contract = buildBattleBridgeRecoveryMeshContract();
  assert.deepEqual(contract.routes, BATTLE_BRIDGE_RECOVERY_ROUTES);
  assert.equal(contract.routes.length, 5);
  assert.equal(contract.executor, BATTLE_BRIDGE_RECOVERY_EXECUTOR);
  assert.equal(contract.maximumConcurrentExecutors, 1);
  assert.equal(contract.guardrails.duplicateWorkerAllowed, false);
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
});

test('every route requires its own authentication evidence', () => {
  for (const route of BATTLE_BRIDGE_RECOVERY_ROUTES) {
    const candidate = ingress(route);
    const valid = validateBattleBridgeRecoveryIngress(candidate, { nowMs: NOW });
    assert.equal(valid.ok, true, route);
    const evidenceField = valid.request.authenticationEvidence;
    const invalid = validateBattleBridgeRecoveryIngress({ ...candidate, [evidenceField]: false }, { nowMs: NOW });
    assert.equal(invalid.blocker, 'RECOVERY_INGRESS_AUTHENTICATION_EVIDENCE_REQUIRED', route);
  }
});

test('unsafe free-form authority and stale requests fail closed', () => {
  assert.equal(validateBattleBridgeRecoveryIngress(ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX, 'unsafe', {
    command: 'powershell -enc unsafe',
  }), { nowMs: NOW }).blocker, 'RECOVERY_INGRESS_UNSAFE_FIELD_PRESENT');
  assert.equal(validateBattleBridgeRecoveryIngress(ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX, 'stale', {
    issuedAtUtc: '2026-08-01T02:30:00.000Z',
    expiresAtUtc: '2026-08-01T03:05:00.000Z',
  }), { nowMs: NOW }).blocker, 'RECOVERY_INGRESS_STALE');
});

test('simultaneous entrances acquire one deterministic lease and coalesce the rest', () => {
  const requests = [
    ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP, 'openclaw', { issuedAtUtc: '2026-08-01T02:59:05.000Z' }),
    ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX, 'github'),
    ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL, 'tailscale', { issuedAtUtc: '2026-08-01T02:59:05.000Z' }),
  ];
  const result = adjudicateBattleBridgeRecoveryMesh({ ingressRequests: requests, nowMs: NOW });
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selected.route, BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX);
  assert.equal(result.lease.executor, BATTLE_BRIDGE_RECOVERY_EXECUTOR);
  assert.equal(result.lease.maximumConcurrentExecutors, 1);
  assert.deepEqual(result.coalescedRoutes, [BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL, BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP]);
});

test('live lease blocks a second executor and duplicates remain rejected', () => {
  const request = ingress(BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR, 'local');
  const activeLease = {
    executor: BATTLE_BRIDGE_RECOVERY_EXECUTOR,
    requestId: 'recovery-active-0001',
    expiresAtUtc: '2026-08-01T03:01:00.000Z',
  };
  const coalesced = adjudicateBattleBridgeRecoveryMesh({ ingressRequests: [request], activeLease, nowMs: NOW });
  assert.equal(coalesced.dispatchAllowed, false);
  assert.equal(coalesced.decision, 'COALESCE_WITH_ACTIVE_RECOVERY_LEASE');
  const duplicate = adjudicateBattleBridgeRecoveryMesh({
    ingressRequests: [request, request],
    consumedIdempotencyKeys: [`${request.route}:${request.requestId}`],
    nowMs: NOW,
  });
  assert.equal(duplicate.dispatchAllowed, false);
  assert.equal(duplicate.rejected.length, 2);
  assert.ok(duplicate.rejected.every((item) => item.blocker === 'RECOVERY_INGRESS_DUPLICATE'));
});

test('bulletproof acceptance requires five independent routes plus healthy dispatcher and worker', () => {
  const domains = {
    [BATTLE_BRIDGE_RECOVERY_ROUTE.LOCAL_WINDOWS_SUPERVISOR]: 'windows-task-scheduler',
    [BATTLE_BRIDGE_RECOVERY_ROUTE.GITHUB_MAILBOX]: 'github-command-transport',
    [BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL]: 'tailscale-control-plane',
    [BATTLE_BRIDGE_RECOVERY_ROUTE.OPENCLAW_WHATSAPP]: 'openclaw-whatsapp-transport',
    [BATTLE_BRIDGE_RECOVERY_ROUTE.AUTHENTICATED_BREAK_GLASS]: 'local-break-glass',
  };
  const routes = Object.fromEntries(BATTLE_BRIDGE_RECOVERY_ROUTES.map((route) => [route, {
    healthy: true,
    independentlyProven: true,
    failureDomain: domains[route],
    proofRef: `proof/${route.toLowerCase()}/pass`,
  }]));
  const pass = classifyBattleBridgeRecoveryMeshHealth({ routes, dispatcherHealthy: true, workerHealthy: true });
  assert.equal(pass.classification, 'BATTLE_BRIDGE_RECOVERY_MESH_BULLETPROOF');
  assert.equal(pass.bulletproofAcceptancePassed, true);
  assert.equal(pass.healthyRouteCount, 5);
  const degradedRoutes = { ...routes, [BATTLE_BRIDGE_RECOVERY_ROUTE.TAILSCALE_CONTROL]: { healthy: false } };
  const degraded = classifyBattleBridgeRecoveryMeshHealth({ routes: degradedRoutes, dispatcherHealthy: true, workerHealthy: true });
  assert.equal(degraded.classification, 'BATTLE_BRIDGE_RECOVERY_MESH_DEGRADED');
  assert.equal(degraded.acceptsRuntimeWork, true);
  assert.equal(degraded.bulletproofAcceptancePassed, false);
});
