import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMissionOperationsProjection } from '../shared/runtime/missionOperationsProjection.mjs';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';
import {
  cancelBoundedMission,
  createBoundedMission,
} from '../stephanos-server/services/missionOrchestratorControlService.js';
import {
  MISSION_ORCHESTRATOR_CANCEL_OPERATION,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';

const now = new Date('2026-06-24T18:10:00.000Z');

async function fixtureDirectory() {
  return mkdtemp(join(tmpdir(), 'stephanos-mission-operations-'));
}

async function controlRoots() {
  const parent = await mkdtemp(join(tmpdir(), 'stephanos-mission-control-'));
  return {
    root: join(parent, 'orchestrator'),
    snapshotRoot: join(parent, 'proof', 'mission-operations'),
  };
}

test('projection exposes complete mission, agent, Git, PR, approval, receipt, repair, deployment, timestamp, and next-action truth', () => {
  const projection = buildMissionOperationsProjection({
    missionId: 'mission-dashboard',
    title: 'Mission dashboard',
    intendedOutcome: 'Expose deterministic live mission truth.',
    state: 'RUNNING',
    startedAt: '2026-06-24T18:00:00.000Z',
    updatedAt: '2026-06-24T18:09:00.000Z',
    currentPhase: 'verification',
    nextAction: 'Wait for checks.',
    activeAgent: { agentId: 'openclaw-standalone', label: 'OpenClaw Standalone', role: 'executor', status: 'active' },
    supportingAgents: [{ agentId: 'codex', label: 'Codex', role: 'reviewer', status: 'waiting' }],
    github: {
      repository: 'Cheekyfellastef/stephan-os',
      branch: 'openclaw/mission-dashboard',
      baseBranch: 'main',
      headSha: 'a'.repeat(40),
      worktreePath: 'configured-isolated-worktree',
      changedFiles: ['shared/runtime/example.mjs'],
      clean: true,
      prNumber: 1262,
      prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1262',
      prState: 'open',
      mergeable: true,
      checks: [{ name: 'Build', status: 'in_progress', required: true }],
    },
    repair: { currentRound: 2, maximumRounds: 3, history: [{ round: 1 }, { round: 2 }] },
    deployment: {
      sync: { status: 'success', completedAt: '2026-06-24T18:05:00.000Z', commitSha: 'a'.repeat(40) },
      build: { status: 'success' },
      verify: { status: 'pending' },
      restart: { status: 'pending' },
    },
    approvals: [{ approvalId: 'merge', status: 'approved' }],
    receipts: [{ receiptId: 'receipt-1', sha256: 'b'.repeat(64), status: 'RESERVED' }],
  }, { now });

  assert.equal(projection.mission.state, 'VERIFYING');
  assert.equal(projection.mission.intendedOutcome, 'Expose deterministic live mission truth.');
  assert.equal(projection.mission.startedAt, '2026-06-24T18:00:00.000Z');
  assert.equal(projection.agent.activeAgentId, 'openclaw-standalone');
  assert.equal(projection.agent.supportingAgents[0].agentId, 'codex');
  assert.equal(projection.agent.simultaneousWritersAllowed, false);
  assert.equal(projection.git.branch, 'openclaw/mission-dashboard');
  assert.equal(projection.git.baseBranch, 'main');
  assert.equal(projection.git.headSha, 'a'.repeat(40));
  assert.deepEqual(projection.git.changedFiles, ['shared/runtime/example.mjs']);
  assert.equal(projection.pullRequest.number, 1262);
  assert.equal(projection.pullRequest.url, 'https://github.com/Cheekyfellastef/stephan-os/pull/1262');
  assert.equal(projection.pullRequest.state, 'open');
  assert.equal(projection.pullRequest.mergeable, true);
  assert.equal(projection.pullRequest.requiredCheckCount, 1);
  assert.equal(projection.repair.currentRound, 2);
  assert.equal(projection.repair.maximumRounds, 3);
  assert.equal(projection.deployment.sync.status, 'success');
  assert.equal(projection.deployment.sync.commitSha, 'a'.repeat(40));
  assert.equal(projection.deployment.verify.status, 'pending');
  assert.equal(projection.receipts[0].sha256, 'b'.repeat(64));
  assert.equal(projection.mission.nextAction, 'Wait for checks.');
});

test('projection rejects non-GitHub and non-HTTPS links', () => {
  for (const prUrl of [
    'javascript:alert(1)',
    'http://github.com/Cheekyfellastef/stephan-os/pull/1262',
    'https://example.com/fake-pr',
    'not-a-url',
  ]) {
    const projection = buildMissionOperationsProjection({
      missionId: 'mission-safe-url',
      github: { prUrl },
    }, { now });
    assert.equal(projection.pullRequest.url, '', prUrl);
  }
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

test('bounded mission cancellation emits MISSION_CANCELLED, terminalizes, and is retry-safe', async () => {
  const options = await controlRoots();
  const missionId = 'mission-cancel-control';
  await createBoundedMission({
    missionId,
    operatorIntent: 'Inspect one bounded mission-control state without source mutation.',
    intendedOutcome: 'The bounded mission can be cancelled safely by the operator.',
    missionKind: 'live-runtime-investigation',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:\\repo',
    worktreePath: 'C:\\worktrees\\mission-cancel-control',
    requiredEvidence: ['bounded inspection receipt'],
  }, options);

  const command = {
    missionId,
    commandId: 'operator-cancel-mission-control-test',
    reason: 'Bounded test cancellation.',
  };
  const cancelled = await cancelBoundedMission(command, options);
  assert.equal(cancelled.state.currentPhase, 'CANCELLED');
  assert.equal(cancelled.state.cancelled, true);

  const eventText = await readFile(join(options.root, `${missionId}.events.ndjson`), 'utf8');
  const events = eventText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(events.at(-1).eventType, 'MISSION_CANCELLED');
  assert.equal(events.at(-1).summary, 'Bounded test cancellation.');

  const duplicate = await cancelBoundedMission(command, options);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(
    () => cancelBoundedMission({ ...command, commandId: 'operator-cancel-second-control-test' }, options),
    /terminal mission/i,
  );
});

test('Battle Bridge cancellation command is closed-world and dispatches only the registered cancellation handler', async () => {
  const authoredAt = new Date('2026-08-23T05:00:00.000Z');
  const command = {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'mission-cancel-mailbox-test-001',
    operation: MISSION_ORCHESTRATOR_CANCEL_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: 'c'.repeat(40),
    missionId: 'mission-cancel-control',
    commandId: 'operator-cancel-mailbox-control-test',
    reason: 'Terminalize one exact stale bounded mission.',
    expiresAt: '2026-08-23T05:30:00.000Z',
  };
  const validated = validateBattleBridgeGitHubCommand(command, {
    authorLogin: 'Cheekyfellastef',
    authoredAt,
    now: new Date('2026-08-23T05:01:00.000Z'),
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.missionId, command.missionId);
  assert.equal(validated.command.commandId, command.commandId);
  assert.equal(validated.command.reason, command.reason);

  for (const [field, value] of [
    ['eventType', 'MISSION_CANCELLED'],
    ['executable', 'cmd.exe'],
    ['path', 'C:\\temp'],
    ['leaseId', 'lease-forged'],
    ['approvalToken', 'forged'],
  ]) {
    const blocked = validateBattleBridgeGitHubCommand({ ...command, [field]: value }, {
      authorLogin: 'Cheekyfellastef',
      authoredAt,
      now: new Date('2026-08-23T05:01:00.000Z'),
    });
    assert.equal(blocked.ok, false, field);
    assert.equal(blocked.blocker, 'MISSION_CANCEL_FIELD_NOT_ALLOWED', field);
  }

  let observed = null;
  const execution = await executeBattleBridgeGitHubCommand(validated.command, {
    cancelMissionOrchestratorMission: async (candidate) => {
      observed = candidate;
      return {
        ok: true,
        finalVerdict: 'MISSION_ORCHESTRATOR_MISSION_CANCELLED',
        missionId: candidate.missionId,
        currentPhase: 'CANCELLED',
        duplicate: false,
      };
    },
  });
  assert.equal(execution.ok, true);
  assert.equal(execution.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(observed.missionId, command.missionId);
  assert.equal(observed.commandId, command.commandId);
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

test('service preserves command receipts from repeated operations in one mission', async () => {
  const directory = await fixtureDirectory();
  for (const [index, hash] of ['e', 'f'].entries()) {
    await writeFile(join(directory, `operation-${index + 1}.json`), JSON.stringify({
      schemaVersion: 'stephanos.openclaw-github-operation-result.v1',
      missionId: 'mission-repeat',
      authorizationId: `authorization-repeat-${index + 1}`,
      operation: 'inspect',
      repository: 'Cheekyfellastef/stephan-os',
      completedAt: `2026-06-24T18:0${index + 1}:00.000Z`,
      executorExitCode: 0,
      executorOutputHash: hash.repeat(64),
      receipts: [{ executable: 'git.exe', exitCode: 0, commandOutputHash: hash.repeat(64) }],
      finalVerdict: 'OPENCLAW_GITHUB_OPERATION_PASS',
    }));
  }
  const feed = await readMissionOperations({ directory, now });
  const hashes = feed.missions[0].receipts.map((receipt) => receipt.sha256);
  assert.equal(hashes.includes('e'.repeat(64)), true);
  assert.equal(hashes.includes('f'.repeat(64)), true);
});

test('service limits ingestion to the newest 500 receipt files', async () => {
  const directory = await fixtureDirectory();
  const baseTime = Date.parse('2026-06-24T00:00:00.000Z');
  await Promise.all(Array.from({ length: 501 }, async (_, index) => {
    const path = join(directory, `${String(index).padStart(3, '0')}.json`);
    await writeFile(path, JSON.stringify({
      schemaVersion: 'stephanos.mission-operations-snapshot.v1',
      missionId: `mission-${String(index).padStart(3, '0')}`,
      state: 'COMPLETE',
      updatedAt: new Date(baseTime + index * 1000).toISOString(),
      finalVerdict: 'PASS',
    }));
    const timestamp = new Date(baseTime + index * 1000);
    await utimes(path, timestamp, timestamp);
  }));

  const feed = await readMissionOperations({ directory, now });
  assert.equal(feed.receiptFileCount, 500);
  assert.equal(feed.missions.some((mission) => mission.mission.missionId === 'mission-000'), false);
  assert.equal(feed.missions.some((mission) => mission.mission.missionId === 'mission-500'), true);
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

test('Mission Operations panel visibly renders every required operational truth family and private controls', async () => {
  const source = await readFile(new URL('../stephanos-ui/src/components/MissionOperationsPanel.jsx', import.meta.url), 'utf8');
  const controlSource = await readFile(new URL('../stephanos-ui/src/components/MissionOperationsControls.jsx', import.meta.url), 'utf8');
  assert.match(source, /<CollapsiblePanel/);
  assert.match(source, /panelId="missionConsoleMissionOperationsPanel"/);
  assert.match(source, /REFRESH_INTERVAL_MS = 5000/);
  for (const label of [
    'Intended outcome:',
    'Active agent',
    'Supporting agents',
    'Base branch',
    'Head SHA',
    'Workspace update:',
    'Local SHA:',
    'Main SHA:',
    'Manual refresh required:',
    'Auto-pull attempted:',
    'UI refresh after build:',
    'Next operator action:',
    'Worktree',
    'Changed files',
    'Pull request',
    'PR state',
    'Mergeable',
    'Required checks',
    'Repair round',
    'Deployment',
    'Approvals',
    'Evidence receipts',
    'Started',
    'Updated',
    'Elapsed',
    'Next action:',
    'Blockers:',
    'Evidence warnings:',
  ]) {
    assert.equal(source.includes(label), true, `missing visible Mission Operations label: ${label}`);
  }
  assert.match(source, /receipt\.sha256/);
  assert.match(source, /receipt\.status/);
  assert.match(source, /check\.status/);
  assert.match(source, /approval\.status/);
  assert.doesNotMatch(source, /approval\.requiredToken/);
  assert.match(controlSource, /type="password"/);
  assert.match(controlSource, /Approve exact PR head/);
  assert.match(controlSource, /Cancel mission/);
  assert.doesNotMatch(controlSource, /MissionIntakeForm|createMissionOperation/);
  assert.match(source, /UPDATE_AVAILABLE|PULL_REQUIRED|REBUILD_REQUIRED|AUTO_UPDATE_NOT_ENABLED/);
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

test('server mounts bounded approve/cancel controls without exposing direct mission creation or generic event ingestion', async () => {
  const source = await readFile(new URL('../stephanos-server/server.js', import.meta.url), 'utf8');
  const route = await readFile(new URL('../stephanos-server/routes/mission-operations.js', import.meta.url), 'utf8');
  const mailbox = await readFile(new URL('../scripts/battle-bridge-github-command-mailbox.mjs', import.meta.url), 'utf8');
  const mountStart = source.indexOf("app.use('/api/mission-operations'");
  const mountEnd = source.indexOf("app.use('/api/build-concierge'", mountStart);
  assert.notEqual(mountStart, -1);
  assert.notEqual(mountEnd, -1);
  const mount = source.slice(mountStart, mountEnd);
  assert.match(mount, /backendIdentity/);
  assert.match(mount, /missionOperationsRouter/);
  assert.match(route, /router\.get\('\/', async/);
  assert.match(route, /router\.post\('\/missions\/:missionId\/approve'/);
  assert.match(route, /router\.post\('\/missions\/:missionId\/cancel'/);
  assert.match(route, /cancelBoundedMission\(\{/);
  assert.doesNotMatch(route, /router\.post\('\/missions'/);
  assert.doesNotMatch(route, /events|appendMissionEvent/);
  assert.match(mailbox, /cancelBoundedMission/);
  assert.match(mailbox, /cancelMissionOrchestratorMission/);
  assert.doesNotMatch(mailbox, /appendMissionEvent/);
});
