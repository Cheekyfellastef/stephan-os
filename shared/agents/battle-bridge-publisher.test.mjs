import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBattleBridgePublisherContract,
  createBackendStatusPublication,
  createBattleBridgePublisherSlice,
  createMissionWorkerHeartbeatPublication,
  createOpenClawGatewayStatusPublication,
  createSupervisorHealthPublication,
  publishBattleBridgeSliceToSharedWorkspace,
  verifyBattleBridgePublisherSlice,
} from './battleBridgePublisher.mjs';
import { readSharedWorkspaceDashboardFeed } from './shared-workspace-dashboard-feed.mjs';

const timestampUtc = '2026-07-07T12:00:00.000Z';
const nowMs = Date.parse(timestampUtc);

function readyServices() {
  return {
    backend: createBackendStatusPublication({ timestampUtc, status: 'READY', reachable: true, usable: true, browserCompatible: true, proofRefs: ['proof/backend-health.json'] }),
    'battle-bridge-supervisor': createSupervisorHealthPublication({ timestampUtc, status: 'READY', reachable: true, usable: true, browserCompatible: true, proofRefs: ['proof/supervisor-health.json'] }),
    'mission-worker': createMissionWorkerHeartbeatPublication({ timestampUtc, status: 'READY', reachable: true, usable: true, browserCompatible: true, proofRefs: ['proof/worker-heartbeat.json'] }),
    'openclaw-gateway': createOpenClawGatewayStatusPublication({ timestampUtc, status: 'READY', reachable: true, usable: true, browserCompatible: true, proofRefs: ['proof/openclaw-gateway.json'] }),
  };
}

test('Battle Bridge publisher contract preserves safety boundaries', () => {
  const contract = buildBattleBridgePublisherContract();
  assert.equal(contract.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_CONTRACT_READY');
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.guardrails.processKillingAllowed, false);
  assert.equal(contract.guardrails.restartImplementationAllowed, false);
  assert.equal(contract.guardrails.dashboardWritesAllowed, false);
  assert.equal(contract.guardrails.repoMutationAllowedFromRuntime, false);
  assert.equal(contract.guardrails.sharedWorkspaceStoreHelpersOnly, true);
});

test('publisher slice reports UNKNOWN with exact next action for unchecked services', () => {
  const slice = createBattleBridgePublisherSlice({ timestampUtc, services: { backend: { status: 'READY', reachable: true, usable: true, browserCompatible: true } } });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((item) => item.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.match(slice.exactNextAction, /proof command/);
});

test('verification harness accepts publisher workspace records deterministically', () => {
  const slice = createBattleBridgePublisherSlice({ timestampUtc, services: readyServices() });
  const verification = verifyBattleBridgePublisherSlice(slice, { nowMs, timestampUtc });
  assert.equal(verification.status, 'PASS');
  assert.equal(verification.finalVerdict, 'VERIFICATION_HARNESS_PASS');
  assert.equal(verification.checks.length, 4);
});

test('safe writer publishes records consumed by dashboard feed without dashboard writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-battle-bridge-workspace-'));
  const slice = createBattleBridgePublisherSlice({ timestampUtc, services: readyServices() });
  const result = await publishBattleBridgeSliceToSharedWorkspace(root, slice, { repoRoot: process.cwd(), nowMs, timestampUtc });

  assert.equal(result.ok, true);
  const status = JSON.parse(await readFile(join(root, 'status', 'battle-bridge-current.json'), 'utf8'));
  assert.equal(status.status, 'READY');

  const feed = await readSharedWorkspaceDashboardFeed({ root, repoRoot: process.cwd(), nowMs, staleAfterMs: 60_000 });
  assert.equal(feed.readOnly, true);
  assert.equal(feed.polling.dashboardWritesAllowed, false);
  assert.equal(feed.state, 'ready');
  assert.equal(feed.records.statusRecords[0].statusId, 'battle-bridge-current');
  assert.equal(feed.records.capabilityRecords[0].agentId, 'openclaw');
});
