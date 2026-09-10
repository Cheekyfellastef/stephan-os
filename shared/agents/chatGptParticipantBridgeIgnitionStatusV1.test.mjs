import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSanitizedSharedWorkspaceProjection } from './chatGptParticipantBridgeV1.mjs';

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'chatgpt-ignition-status-v1-'));
  await mkdir(join(root, 'status'), { recursive: true });
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Shared Workspace projection exposes only bounded canonical Ignition status fields', async () => {
  await withWorkspace(async (root) => {
    const status = {
      schema: 'stephanos.battle-bridge-ignition-supervisor.v1',
      generatedAt: '2026-08-22T21:22:17.000Z',
      currentPhase: 'backend 8787',
      trafficLight: 'red',
      blockerId: 'backend-8787-preflight-failed-before-supervisor',
      nextOperatorAction: 'Inspect the bounded backend preflight and retry Ignition.',
      logPath: 'C:\\Users\\Operator\\Documents\\Stephanos\\logs\\private',
      sourceTruthVerdict: { state: 'ready', verdict: 'healthy-synced', rawPath: 'C:\\private' },
      services: {
        backend8787: { state: 'blocked', ready: false, evidence: { path: 'C:\\private' }, commandIdentity: { commandText: 'npm run private' } },
        openClaw18789: { state: 'pending', ready: false, evidence: { token: 'secret' } },
        stephanosUi4173: { state: 'pending', ready: false },
      },
      phases: {
        'source truth': { state: 'ready', blockerId: '', nextOperatorAction: '', logPath: 'C:\\private' },
        'backend 8787': {
          state: 'blocked',
          blockerId: 'backend-8787-preflight-failed-before-supervisor',
          nextOperatorAction: 'Retry the bounded backend preflight.',
          logPath: 'C:\\private',
        },
      },
      authority: { executesArbitraryShell: false, mutatesOpenClaw: true },
    };
    await writeFile(join(root, 'status', 'battle-bridge-ignition-supervisor-current.json'), JSON.stringify(status), 'utf8');

    const projection = await createSanitizedSharedWorkspaceProjection({
      workspaceRoot: root,
      latest: {},
      timestampUtc: '2026-08-22T21:22:18.000Z',
    });

    assert.equal(projection.ignitionSupervisor.state, 'observed');
    assert.equal(projection.ignitionSupervisor.currentPhase, 'backend 8787');
    assert.equal(projection.ignitionSupervisor.trafficLight, 'red');
    assert.equal(projection.ignitionSupervisor.blockerId, 'backend-8787-preflight-failed-before-supervisor');
    assert.equal(projection.ignitionSupervisor.services.backend8787.state, 'blocked');
    assert.equal(projection.ignitionSupervisor.services.backend8787.ready, false);
    assert.equal(projection.ignitionSupervisor.phases['backend 8787'].state, 'blocked');
    assert.equal(projection.ignitionSupervisor.phases['backend 8787'].blockerId, 'backend-8787-preflight-failed-before-supervisor');

    const rendered = JSON.stringify(projection.ignitionSupervisor);
    assert.equal(rendered.includes('logPath'), false);
    assert.equal(rendered.includes('evidence'), false);
    assert.equal(rendered.includes('commandIdentity'), false);
    assert.equal(rendered.includes('authority'), false);
    assert.equal(rendered.includes('C:\\\\'), false);
    assert.equal(projection.arbitraryFilesystemAccess, false);
    assert.equal(projection.commandExecutionAccess, false);
    assert.equal(projection.sourceMutationAccess, false);
  });
});

test('missing or malformed Ignition status remains bounded and fail closed', async () => {
  await withWorkspace(async (root) => {
    const missing = await createSanitizedSharedWorkspaceProjection({ workspaceRoot: root, latest: {} });
    assert.deepEqual(missing.ignitionSupervisor, { state: 'absent', blockerId: 'IGNITION_STATUS_MISSING' });

    await writeFile(join(root, 'status', 'battle-bridge-ignition-supervisor-current.json'), '{not-json', 'utf8');
    const malformed = await createSanitizedSharedWorkspaceProjection({ workspaceRoot: root, latest: {} });
    assert.deepEqual(malformed.ignitionSupervisor, { state: 'unverifiable', blockerId: 'IGNITION_STATUS_JSON_INVALID' });
  });
});

test('oversized Ignition status is rejected without exposing its content', async () => {
  await withWorkspace(async (root) => {
    await writeFile(
      join(root, 'status', 'battle-bridge-ignition-supervisor-current.json'),
      JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
      'utf8',
    );
    const projection = await createSanitizedSharedWorkspaceProjection({ workspaceRoot: root, latest: {} });
    assert.deepEqual(projection.ignitionSupervisor, { state: 'unverifiable', blockerId: 'IGNITION_STATUS_TOO_LARGE' });
  });
});
