import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveMissionState, createEmptyActiveMissionState, persistActiveMissionState, readActiveMissionState } from './activeMissionState.js';

test('persist + rehydrate active mission compact state', () => {
  const storage = new Map();
  const localStorage = { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k) };
  const state = buildActiveMissionState({ missionId: 'm1', title: 'Close the human-AI-Codex repair loop', rawTranscriptStored: 'yes' });
  persistActiveMissionState(state, localStorage);
  const loaded = readActiveMissionState(localStorage);
  assert.equal(loaded.missionId, 'm1');
  assert.equal(loaded.title, 'Close the human-AI-Codex repair loop');
  assert.equal(loaded.rehydrated, true);
  assert.equal(loaded.rawTranscriptStored, 'no');
});

test('missing/corrupt storage is safe', () => {
  const missing = readActiveMissionState({ getItem: () => null });
  assert.equal(missing.storageReadStatus, 'missing');
  const corrupt = readActiveMissionState({ getItem: () => '{x', setItem: () => {} });
  assert.equal(corrupt.storageReadStatus, 'corrupt');
  assert.deepEqual(Object.keys(createEmptyActiveMissionState()).sort(), Object.keys(corrupt).sort());
});
