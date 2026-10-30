import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { readSharedWorkspaceDashboardFeed } from './shared-workspace-dashboard-feed.mjs';
import { buildSharedWorkspaceBrainStateV1 } from './sharedWorkspaceBrainStateV1.mjs';

test('Shared Workspace dashboard feed exposes the canonical brain state to all feed consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-brain-feed-'));
  await Promise.all(
    ['goals', 'status', 'proof', 'capabilities', 'events', 'lessons', 'receipts']
      .map((directory) => mkdir(join(root, directory), { recursive: true })),
  );
  const now = '2026-10-04T21:20:00.000Z';
  const record = buildSharedWorkspaceBrainStateV1({
    timestampUtc: now,
    taskRoute: 'assistant',
    participantTarget: 'everyone',
    executionMetadata: {
      provider_answered: true,
      actual_provider_used: 'ollama',
      ollama_model_default: 'qwen:14b',
      requested_model: 'qwen:14b',
      selected_model: 'qwen3.5:27b',
      executed_model: 'qwen3.5:27b',
      model_used: 'qwen3.5:27b',
      ollama_reasoning_mode: 'deep',
      ollama_escalation_active: true,
      ollama_escalation_model: 'qwen3.5:27b',
      ollama_escalation_reason: 'upliftRequired',
      ollama_load_mode: 'balanced',
      ollama_heavy_model_allowed: true,
    },
  });
  await writeFile(
    join(root, 'status', 'brain-state-current.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );

  const feed = await readSharedWorkspaceDashboardFeed({
    root,
    nowMs: Date.parse('2026-10-04T21:21:00.000Z'),
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(feed.state, 'unavailable', 'advisory brain telemetry must not prove generic workspace freshness');
  assert.equal(feed.records.statusRecords.length, 0, 'brain-state-current must stay outside generic dashboard authority');
  assert.equal(feed.brainState.state, 'CURRENT');
  assert.equal(feed.brainState.activeBrain, 'qwen3.5:27b');
  assert.equal(feed.brainState.reasoningMode, 'deep');
  assert.equal(feed.brainState.escalationActive, true);
  assert.equal(feed.brainState.heavyModelAllowed, true);
  assert.equal(feed.brainState.authority.providerSelectionAuthorityAdded, false);
});

test('dashboard feed says UNKNOWN when no brain state has been published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-brain-feed-empty-'));
  await Promise.all(
    ['goals', 'status', 'proof', 'capabilities', 'events', 'lessons', 'receipts']
      .map((directory) => mkdir(join(root, directory), { recursive: true })),
  );
  const feed = await readSharedWorkspaceDashboardFeed({
    root,
    nowMs: Date.parse('2026-10-04T21:21:00.000Z'),
  });
  assert.equal(feed.brainState.state, 'UNKNOWN');
  assert.equal(feed.brainState.activeBrain, 'UNKNOWN');
});
