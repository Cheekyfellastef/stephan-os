import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMissionOperationsProjection } from '../shared/runtime/missionOperationsProjection.mjs';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';

const now = new Date('2026-06-24T18:10:00.000Z');

async function fixtureDirectory() {
  return mkdtemp(join(tmpdir(), 'stephanos-mission-operations-'));
}

test('projection exposes mission, agent, branch, PR, check, approval, receipt, and next-action truth', () => {
  const projection = buildMissionOperationsProjection({
    missionId: 'mission-dashboard',
    title: 'Mission dashboard',
    state: 'RUNNING',
    startedAt: '2026-06-24T18:00:00.000Z',
    updatedAt: '2026-06-24T18:09:00.000Z',
    currentPhase: 'verification',
    nextAction: 'Wait for checks.',
    activeAgent: { agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'executor', status: 'active' },
    github: {
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'openclaw/mission-dashboard',
      baseBranch: 'main',
      prNumber: 1262,
      checks: [{ name: 'Build', status: 'in_progress', required: true }],
    },
    approvals: [{ approvalId: 'merge', status: 'approved' }],
    receipts: [{ receiptId: 'receipt-1', sha256: 'a'.repeat(64), status: 'RESERVED' }],
  }, { now });

  assert.equal(projection.mission.state, 'VERIFYING');
  assert.equal(projection.agent.activeAgentId, 'openclaw-standalone');
  assert.equal(projection.agent.simultaneousWritersAllowed, false);
  assert.equal(projection.git.branch, 'openclaw/mission-dashboard');
  assert.equal(projection.pullRequest.number, 1262);
  assert.equal(projection.pullRequest.requiredCheckCount, 1);
  assert.equal(projection.receipts[0].sha256, 'a'.repeat(64));
  assert.equal(projection.mission.nextAction, 'Wait for checks.');
});

test('pending approval and blockers override optimistic running state', () => {
  const approval = buildMissionOperationsProjection({
    missionId: 'mission-approval',
    state: 'RUNNING',
    updatedAt: now.toISOString(),
    approvals: [{ approvalId: 'merge', status: 'pending', requiredToken: 'APPROVE:1:sha' }],
  }, { now });
  assert.equal(approval.mission.state, 'AWAITING_APPROVAL');
  assert.equal(approval.operatorActionRequired, true);

  const blocked = buildMissionOperationsProjection({
    missionId: 'mission-blocked',
    state: 'RUNNING',
    updatedAt: now.toISOString(),
    blockers: ['Head SHA changed.'],
  }, { now });
  assert.equal(blocked.mission.state, 'BLOCKED');
});

test('stale active mission is visibly warned instead of presented as healthy', () => {
  const projection = buildMissionOperationsProjection({
    missionId: 'mission-stale',
    state: 'RUNNING',
    updatedAt: '2026-06-24T17:00:00.000Z',
  }, { now, staleAfterMinutes: 10 });
  assert.equal(projection.stale, true);
  assert.match(projection.warnings.join(' '), /stale/);
});

test('service returns explicit configuration state when no external receipt directory exists', async () => {
  const feed = await readMissionOperations({ env: {} });
  assert.equal(feed.status, 'needs-configuration');
  assert.deepEqual(feed.missions, []);
});

test('service adapts reservation and completion receipts for one mission', async () => {
  const directory = await fixtureDirectory();
  await writeFile(join(directory, 'authorization.json'), JSON.stringify({
    schemaVersion: 'stephanos.openclaw-github-authorization-consumption.v1',
    authorizationId: 'authorization-1234',
    claimsSha256: 'b'.repeat(64),
    operation: 'push',
    missionId: 'mission-push',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'openclaw/mission-push',
    reservedAt: '2026-06-24T18:00:00.000Z',
    finalVerdict: 'RESERVED',
  }));
  let feed = await readMissionOperations({ directory, now });
  assert.equal(feed.missions[0].mission.state, 'RUNNING');

  await writeFile(join(directory, 'operation.json'), JSON.stringify({
    schemaVersion: 'stephanos.openclaw-github-operation-result.v1',
    missionId: 'mission-push',
    authorizationId: 'authorization-1234',
    operation: 'push',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'openclaw/mission-push',
    baseBranch: 'main',
    completedAt: '2026-06-24T18:05:00.000Z',
    executorExitCode: 0,
    executorOutputHash: 'c'.repeat(64),
    receipts: [{ executable: 'git.exe', exitCode: 0, commandOutputHash: 'd'.repeat(64) }],
    blockers: [],
    finalVerdict: 'OPENCLAW_GITHUB_OPERATION_PASS',
  }));
  feed = await readMissionOperations({ directory, now });
  assert.equal(feed.missions[0].mission.state, 'COMPLETE');
  assert.equal(feed.missions[0].receipts.some((receipt) => receipt.sha256 === 'd'.repeat(64)), true);
});

test('service reports malformed evidence and does not fabricate missions', async () => {
  const directory = await fixtureDirectory();
  await writeFile(join(directory, 'broken.json'), '{no');
  await writeFile(join(directory, 'ignored.json'), JSON.stringify({ schemaVersion: 'unknown.v1' }));
  const feed = await readMissionOperations({ directory, now });
  assert.equal(feed.status, 'empty');
  assert.equal(feed.errors.length, 1);
  assert.equal(feed.ignoredReceiptCount, 1);
  assert.deepEqual(feed.missions, []);
});

test('Mission Operations panel is canonical, polled, and not a duplicate dashboard', async () => {
  const source = await readFile(new URL('../stephanos-ui/src/components/MissionOperationsPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /<CollapsiblePanel/);
  assert.match(source, /panelId="missionConsoleMissionOperationsPanel"/);
  assert.match(source, /REFRESH_INTERVAL_MS = 5000/);
  assert.match(source, /Active agent/);
  assert.match(source, /Approval required/);
  assert.match(source, /Evidence warnings/);
  assert.doesNotMatch(source, /MissionOperationsDashboard/);
});

test('Mission Operations is integrated inside the canonical Mission Command Deck', async () => {
  const source = await readFile(new URL('../stephanos-ui/src/components/MissionCommandDeck.jsx', import.meta.url), 'utf8');
  const consoleSource = await readFile(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /import MissionOperationsPanel from '\.\/MissionOperationsPanel'/);
  assert.match(source, /<MissionOperationsPanel/);
  assert.match(source, /missionConsoleMissionOperationsPanel/);
  assert.match(source, /missionId=\{missionCommandPacket\?\.missionId \|\| ''\}/);
  assert.match(consoleSource, /<MissionCommandDeck/);
  assert.doesNotMatch(consoleSource, /MissionOperationsDashboard/);
});

test('server mounts the read-only mission operations route', async () => {
  const source = await readFile(new URL('../stephanos-server/server.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../stephanos-server/routes/mission-operations.js', import.meta.url), 'utf8');
  assert.match(source, /app\.use\('\/api\/mission-operations', missionOperationsRouter\)/);
  assert.match(route, /router\.get\('\/', async/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)/);
});
