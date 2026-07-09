import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY,
  createBattleBridgeSharedWorkspaceRecords,
  refreshBattleBridgeSharedWorkspacePublisher,
} from './battle-bridge-shared-workspace-publisher.mjs';
import { collectLauncherReadinessLiveFacts, LIVE_COLLECTOR_AUTHORITY } from './launcher-readiness-live-facts.mjs';
import { createLauncherReadinessReport } from './launcher-readiness-report.mjs';

async function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function factsFor(readyIds) {
  const services = Object.fromEntries(['backend', 'stephanos-ui', 'openclaw-gateway'].map((id) => [id, { ready: readyIds.includes(id), evidence: { probe: 'fixture' } }]));
  services['shared-workspace'] = { ready: false, evidence: { probe: 'pre-refresh-fixture' } };
  return { observedFacts: { services }, sourceFacts: { dirtyPaths: [] } };
}

const cleanGit = () => '';
const serviceProbeFor = (readyIds) => async (service) => ({ ready: readyIds.includes(service.id), evidence: { port: service.port, probe: 'fixture' } });

function readRecord(root, channel) {
  return JSON.parse(fs.readFileSync(path.join(root, channel, 'battle-bridge-current.json'), 'utf8'));
}

test('fixture writes status/proof/events records into a temp shared workspace', async () => withTempDir('bb-publisher-', async (workspaceRoot) => {
  const result = await refreshBattleBridgeSharedWorkspacePublisher({ sharedWorkspace: workspaceRoot, facts: factsFor(['backend', 'stephanos-ui', 'openclaw-gateway']) });
  assert.equal(result.ok, true);
  assert.equal(readRecord(workspaceRoot, 'status').status, 'READY');
  assert.equal(readRecord(workspaceRoot, 'proof').status, 'READY');
  assert.equal(readRecord(workspaceRoot, 'events').status, 'READY');
}));

test('fixture fresh published records are accepted by launcher-readiness-live-facts and clear STALE_WORKSPACE', async () => withTempDir('bb-publisher-workspace-', async (workspaceRoot) => withTempDir('bb-publisher-repo-', async (repoRoot) => {
  await refreshBattleBridgeSharedWorkspacePublisher({ repoRoot, sharedWorkspace: workspaceRoot, facts: factsFor(['backend', 'stephanos-ui', 'openclaw-gateway']) });
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
  const report = createLauncherReadinessReport(facts);
  assert.equal(report.status, 'READY');
  assert.deepEqual(report.staleWorkspaceRecords, []);
})));

test('fixture backend+OpenClaw ready + UI missing publishes degraded and readiness returns PARTIAL_UI_MISSING', async () => withTempDir('bb-publisher-partial-workspace-', async (workspaceRoot) => withTempDir('bb-publisher-repo-', async (repoRoot) => {
  const result = await refreshBattleBridgeSharedWorkspacePublisher({ repoRoot, sharedWorkspace: workspaceRoot, facts: factsFor(['backend', 'openclaw-gateway']) });
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.readiness, 'PARTIAL_UI_MISSING');
  const status = readRecord(workspaceRoot, 'status');
  assert.equal(status.status, 'DEGRADED');
  assert.equal(status.readiness, 'PARTIAL_UI_MISSING');
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'openclaw-gateway']), execFile: cleanGit });
  assert.equal(createLauncherReadinessReport(facts).status, 'PARTIAL_UI_MISSING');
})));

test('fixture all services ready publishes ready status and readiness returns READY', async () => withTempDir('bb-publisher-ready-workspace-', async (workspaceRoot) => withTempDir('bb-publisher-repo-', async (repoRoot) => {
  await refreshBattleBridgeSharedWorkspacePublisher({ repoRoot, sharedWorkspace: workspaceRoot, facts: factsFor(['backend', 'stephanos-ui', 'openclaw-gateway']) });
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
  assert.equal(createLauncherReadinessReport(facts).status, 'READY');
})));

test('fixture atomic write behavior leaves no temp partial JSON behind', async () => withTempDir('bb-publisher-atomic-', async (workspaceRoot) => {
  await refreshBattleBridgeSharedWorkspacePublisher({ sharedWorkspace: workspaceRoot, facts: factsFor(['backend', 'stephanos-ui', 'openclaw-gateway']) });
  const leftovers = fs.readdirSync(path.join(workspaceRoot, 'status')).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.doesNotThrow(() => readRecord(workspaceRoot, 'status'));
}));

test('fixture rejects traversal/unsafe shared workspace paths', async () => withTempDir('bb-publisher-repo-', async (repoRoot) => {
  await assert.rejects(() => refreshBattleBridgeSharedWorkspacePublisher({ repoRoot, sharedWorkspace: '../outside', facts: factsFor([]) }), /relative traversal/);
}));

test('fixture does not write outside explicit workspace', async () => withTempDir('bb-publisher-workspace-', async (workspaceRoot) => withTempDir('bb-publisher-outside-', async (outsideRoot) => {
  await refreshBattleBridgeSharedWorkspacePublisher({ sharedWorkspace: workspaceRoot, facts: factsFor(['backend']) });
  assert.equal(fs.existsSync(path.join(outsideRoot, 'status', 'battle-bridge-current.json')), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, 'status', 'battle-bridge-current.json')), true);
})));

test('fixture read-only collector authority remains unchanged', () => {
  assert.deepEqual(LIVE_COLLECTOR_AUTHORITY, {
    executesCommands: false,
    executesArbitraryShell: false,
    startsServices: false,
    killsProcesses: false,
    mergesOrPushes: false,
    mutatesRuntime: false,
    writesOutputOnlyWhenAsked: true,
  });
});

test('fixture publisher authority is explicit and limited to shared workspace records', () => {
  assert.deepEqual(BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY.allowedWriteRoutes, [
    'status/battle-bridge-current.json',
    'proof/battle-bridge-current.json',
    'events/battle-bridge-current.json',
  ]);
  assert.equal(BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY.startsServices, false);
  assert.equal(BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY.killsProcesses, false);
  assert.equal(BATTLE_BRIDGE_SHARED_WORKSPACE_PUBLISHER_AUTHORITY.mutatesRepoFiles, false);
});

test('record factory does not write UNKNOWN when live collector can determine service state', () => {
  const records = createBattleBridgeSharedWorkspaceRecords({ facts: factsFor(['backend', 'openclaw-gateway']), timestampUtc: '2026-07-09T00:00:00.000Z' });
  assert.equal(records.status.status, 'DEGRADED');
  assert.notEqual(records.status.status, 'UNKNOWN');
});
