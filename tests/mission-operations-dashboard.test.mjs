import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMissionOperationsProjection } from '../shared/runtime/missionOperationsProjection.mjs';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';

const now = new Date('2026-06-24T18:10:00.000Z');

test('projection exposes mission, agent, Git, PR, repair, deployment, evidence, timing, and next action truth', () => {
  const projection = buildMissionOperationsProjection({
    missionId: 'mission-dashboard', title: 'Mission dashboard', intendedOutcome: 'Expose deterministic live mission truth.', state: 'RUNNING', startedAt: '2026-06-24T18:00:00.000Z', updatedAt: '2026-06-24T18:09:00.000Z', currentPhase: 'verification', nextAction: 'Wait for checks.',
    activeAgent: { agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'executor', status: 'active' }, supportingAgents: [{ agentId: 'codex', label: 'Codex', role: 'reviewer', status: 'waiting' }],
    github: { repository: 'Cheekyfellastef/stephan-os', branch: 'openclaw/mission-dashboard', baseBranch: 'main', headSha: 'a'.repeat(40), worktreePath: 'configured-isolated-worktree', changedFiles: ['shared/runtime/example.mjs'], clean: true, prNumber: 1262, prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1262', prState: 'open', mergeable: true, checks: [{ name: 'Build', status: 'in_progress', required: true }] },
    approvals: [{ approvalId: 'merge', status: 'pending' }], receipts: [{ receiptId: 'receipt-1', sha256: 'b'.repeat(64), status: 'RESERVED' }],
    repair: { currentRound: 1, maximumRounds: 3, history: [{ round: 1 }] }, deployment: { sync: { status: 'success', completedAt: now.toISOString(), commitSha: 'c'.repeat(40) }, build: { status: 'running' }, verify: { status: 'pending' }, restart: { status: 'pending' } },
  }, { now });
  assert.equal(projection.mission.state, 'AWAITING_APPROVAL');
  assert.equal(projection.agent.activeAgentId, 'openclaw-standalone');
  assert.equal(projection.agent.simultaneousWritersAllowed, false);
  assert.equal(projection.git.branch, 'openclaw/mission-dashboard');
  assert.equal(projection.pullRequest.number, 1262);
  assert.equal(projection.pullRequest.requiredCheckCount, 1);
  assert.equal(projection.repair.currentRound, 1);
  assert.equal(projection.repair.maximumRounds, 3);
  assert.equal(projection.deployment.sync.status, 'success');
  assert.equal(projection.deployment.build.status, 'running');
  assert.equal(projection.receipts[0].sha256, 'b'.repeat(64));
  assert.equal(projection.mission.nextAction, 'Wait for checks.');
});

test('projection rejects unsafe PR links and makes blockers authoritative', () => {
  for (const prUrl of ['javascript:alert(1)', 'http://github.com/o/r/pull/1', 'https://example.com/fake-pr']) assert.equal(buildMissionOperationsProjection({ missionId: 'safe-url', github: { prUrl } }, { now }).pullRequest.url, '');
  assert.equal(buildMissionOperationsProjection({ missionId: 'blocked', state: 'RUNNING', updatedAt: now.toISOString(), blockers: ['Head SHA changed.'] }, { now }).mission.state, 'BLOCKED');
});

test('service returns explicit configuration state and adapts deterministic snapshots', async () => {
  assert.equal((await readMissionOperations({ env: {} })).status, 'needs-configuration');
  const directory = await mkdtemp(join(tmpdir(), 'mission-dashboard-'));
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify({ schemaVersion: 'stephanos.mission-operations-snapshot.v1', missionId: 'mission-service', state: 'COMPLETE', updatedAt: now.toISOString(), finalVerdict: 'PASS', receipts: [{ receiptId: 'proof', sha256: 'c'.repeat(64) }] }));
  const feed = await readMissionOperations({ directory, now });
  assert.equal(feed.status, 'ready'); assert.equal(feed.missions[0].mission.missionId, 'mission-service'); assert.equal(feed.missions[0].receipts[0].sha256, 'c'.repeat(64));
});

test('Mission Operations panel renders operational truth and bounded controls in the canonical panel', async () => {
  const source = await readFile(new URL('../stephanos-ui/src/components/MissionOperationsPanel.jsx', import.meta.url), 'utf8');
  const controls = await readFile(new URL('../stephanos-ui/src/components/MissionOperationsControls.jsx', import.meta.url), 'utf8');
  assert.match(source, /panelId="missionConsoleMissionOperationsPanel"/); assert.match(source, /REFRESH_INTERVAL_MS = 5000/); assert.match(source, /<MissionIntakeForm/); assert.match(source, /<MissionActionControls/);
  for (const label of ['Intended outcome:', 'Active agent', 'Supporting agents', 'Base branch', 'Head SHA', 'Worktree', 'Changed files', 'Pull request', 'PR state', 'Mergeable', 'Required checks', 'Approvals', 'Evidence receipts', 'Repair round', 'Deployment', 'Started', 'Updated', 'Elapsed', 'Next action:', 'Blockers:', 'Evidence warnings:']) assert.equal(source.includes(label), true, label);
  for (const label of ['New mission', 'Operator intent', 'Allowed source scopes', 'Private head-bound approval token', 'Approve exact PR head', 'Cancel mission']) assert.equal(controls.includes(label), true, label);
  assert.match(controls, /type="password"/); assert.doesNotMatch(source, /requiredToken/); assert.doesNotMatch(source, /MissionOperationsDashboard/);
});

test('Mission Operations remains integrated inside the canonical Mission Command Deck', async () => {
  const source = await readFile(new URL('../stephanos-ui/src/components/MissionCommandDeck.jsx', import.meta.url), 'utf8');
  const consoleSource = await readFile(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /import MissionOperationsPanel from '\.\/MissionOperationsPanel'/); assert.match(source, /<MissionOperationsPanel/); assert.match(source, /missionConsoleMissionOperationsPanel/); assert.match(consoleSource, /<MissionCommandDeck/);
});

test('server exposes bounded create, exact approval, cancellation, and read routes without generic event ingestion', async () => {
  const server = await readFile(new URL('../stephanos-server/server.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../stephanos-server/routes/mission-operations.js', import.meta.url), 'utf8');
  assert.match(server, /app\.use\('\/api\/mission-operations', missionOperationsRouter\)/); assert.match(route, /router\.get\('\/'/); assert.match(route, /router\.post\('\/missions'/); assert.match(route, /router\.post\('\/missions\/:missionId\/approve'/); assert.match(route, /router\.post\('\/missions\/:missionId\/cancel'/); assert.doesNotMatch(route, /events|appendMissionEvent/); assert.match(route, /Cache-Control', 'no-store/);
});
