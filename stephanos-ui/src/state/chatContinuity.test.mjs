import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContinuitySummary, createEmptyChatContinuity, persistChatContinuity, readChatContinuity } from './chatContinuity.js';

test('persists and rehydrates compact continuity summary', () => {
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) || null };
  const built = buildChatContinuitySummary({ operatorMessage: 'do i merge this pr', responseMode: 'merge-decision', sourceCommandId: 'req_1', chatContextPack: { affectedSubsystems: ['merge'] }, responsePlanner: { warnings: [], recommendedNextAction: 'collect proof', mergeDecision: 'wait' } });
  assert.equal(built.version, 'chat-continuity.v1');
  persistChatContinuity(built, storage);
  const loaded = readChatContinuity(storage);
  assert.equal(loaded.rehydrated, true);
  assert.equal(loaded.summaries.length > 0, true);
});

test('secret-like values are redacted and empty storage is safe', () => {
  const empty = readChatContinuity({ getItem: () => null });
  assert.equal(empty.version, 'chat-continuity.v1');
  const built = buildChatContinuitySummary({ previousContinuity: createEmptyChatContinuity(), operatorMessage: 'token abc123', sourceCommandId: 'req_2', chatContextPack: {}, responsePlanner: {} });
  assert.match(built.summaries[0].summary, /redacted|token/i);
});


test('first install can seed from existing command history without storing raw transcript', async () => {
  const mod = await import('./chatContinuity.js');
  const continuity = mod.seedChatContinuityFromExistingHistory({ commandHistory: [{ id: 'c1', raw_input: 'do i merge this pr?', output_text: 'collect proof first' }] });
  assert.equal(continuity.seededFromExistingHistory, true);
  assert.equal(continuity.continuitySource, 'command-history');
  assert.equal(continuity.rawTranscriptStored, 'no');
});
