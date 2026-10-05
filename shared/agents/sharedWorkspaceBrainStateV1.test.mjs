import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  SHARED_WORKSPACE_BRAIN_STATE_FILE,
  SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID,
  buildSharedWorkspaceBrainStateV1,
  projectSharedWorkspaceBrainStateV1,
  publishSharedWorkspaceBrainStateV1,
} from './sharedWorkspaceBrainStateV1.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW = '2026-10-04T21:20:00.000Z';

function metadata(overrides = {}) {
  return {
    provider_answered: true,
    actual_provider_used: 'ollama',
    ollama_model_default: 'qwen:14b',
    ollama_model_preferred: 'qwen3.5:27b',
    requested_model: 'qwen:14b',
    selected_model: 'qwen3.5:27b',
    executed_model: 'qwen3.5:27b',
    model_used: 'qwen3.5:27b',
    model_selection_reason: 'Flywheel uplift requires deep reasoning.',
    ollama_reasoning_mode: 'deep',
    ollama_escalation_model: 'qwen3.5:27b',
    ollama_escalation_active: true,
    ollama_escalation_reason: 'upliftRequired',
    fallback_used: false,
    ollama_fallback_model: 'qwen:32b',
    ollama_fallback_model_used: false,
    ollama_load_mode: 'balanced',
    ollama_load_policy_applied: true,
    ollama_load_policy_reason: 'normal-runtime',
    ollama_heavy_model_requested: true,
    ollama_heavy_model_allowed: true,
    ...overrides,
  };
}

test('builds canonical read-only shared brain state from execution truth', () => {
  const record = buildSharedWorkspaceBrainStateV1({
    executionMetadata: metadata(),
    timestampUtc: NOW,
    taskRoute: 'assistant',
    participantTarget: 'everyone',
  });

  assert.equal(record.statusId, SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID);
  assert.equal(record.executedBrain, 'qwen3.5:27b');
  assert.equal(record.defaultBrain, 'qwen:14b');
  assert.equal(record.escalationActive, true);
  assert.equal(record.escalationReason, 'upliftRequired');
  assert.equal(record.fallbackUsed, false);
  assert.equal(record.heavyModelAllowed, true);
  assert.equal(record.authority.providerSelectionAuthorityAdded, false);
  assert.equal(validateSharedWorkspaceRecord(record, { nowMs: Date.parse(NOW) }).valid, true);
});

test('projection gives every consumer the same latest current brain state', () => {
  const older = buildSharedWorkspaceBrainStateV1({
    executionMetadata: metadata({ executed_model: 'qwen:14b', model_used: 'qwen:14b', ollama_escalation_active: false }),
    timestampUtc: '2026-10-04T21:18:00.000Z',
  });
  const current = buildSharedWorkspaceBrainStateV1({
    executionMetadata: metadata(),
    timestampUtc: NOW,
  });
  const projection = projectSharedWorkspaceBrainStateV1({
    statusRecords: [older, current],
    nowMs: Date.parse('2026-10-04T21:22:00.000Z'),
  });

  assert.equal(projection.state, 'CURRENT');
  assert.equal(projection.activeBrain, 'qwen3.5:27b');
  assert.equal(projection.reasoningMode, 'deep');
  assert.equal(projection.escalationActive, true);
  assert.equal(projection.fallbackUsed, false);
});

test('stale or missing brain state fails visibly instead of pretending a model is current', () => {
  const record = buildSharedWorkspaceBrainStateV1({
    executionMetadata: metadata(),
    timestampUtc: NOW,
  });
  const stale = projectSharedWorkspaceBrainStateV1({
    statusRecords: [record],
    nowMs: Date.parse('2026-10-04T21:30:01.000Z'),
  });
  const missing = projectSharedWorkspaceBrainStateV1({ statusRecords: [], nowMs: Date.parse(NOW) });

  assert.equal(stale.state, 'STALE');
  assert.equal(stale.reason, 'BRAIN_STATE_STALE');
  assert.equal(missing.state, 'UNKNOWN');
  assert.equal(missing.activeBrain, 'UNKNOWN');
});

test('publisher atomically writes brain-state-current into the existing Shared Workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-brain-state-'));
  await mkdir(join(root, 'status'), { recursive: true });

  const result = await publishSharedWorkspaceBrainStateV1({
    executionMetadata: metadata(),
    timestampUtc: NOW,
    taskRoute: 'assistant',
    participantTarget: 'everyone',
    repoRoot: process.cwd(),
    env: { ...process.env, STEPHANOS_SHARED_AGENT_WORKSPACE: root },
  });

  assert.equal(result.ok, true);
  const persisted = JSON.parse(await readFile(join(root, 'status', SHARED_WORKSPACE_BRAIN_STATE_FILE), 'utf8'));
  assert.equal(persisted.executedBrain, 'qwen3.5:27b');
  assert.equal(persisted.escalationActive, true);
  assert.equal(persisted.readOnly, true);
});


test('publication write failures remain advisory and do not throw into completed AI work', async () => {
  const result = await publishSharedWorkspaceBrainStateV1({
    executionMetadata: metadata(),
    timestampUtc: NOW,
    repoRoot: process.cwd(),
    env: process.env,
    validateWorkspaceFn: async () => ({ ok: true, root: '/tmp/stephanos-brain-state-fixture' }),
    writeAtomicJsonFn: async () => {
      const error = new Error('disk-full');
      error.code = 'ENOSPC';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ENOSPC');
  assert.equal(result.statusId, SHARED_WORKSPACE_BRAIN_STATE_STATUS_ID);
  assert.equal(result.record.executedBrain, 'qwen3.5:27b');
});
