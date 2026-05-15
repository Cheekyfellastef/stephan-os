import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyOperatorProfile, extractOperatorNameCandidate, persistOperatorProfile, readOperatorProfile, updateOperatorProfileFromMessage } from './operatorProfileMemory.js';

test('extracts operator name from explicit statements', () => {
  assert.equal(extractOperatorNameCandidate('my name is Stephan').value, 'Stephan');
  assert.equal(extractOperatorNameCandidate('remember my name is Stephan').confidence, 'high');
});

test('persists and supersedes operator name without transcript storage', () => {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) || null, setItem: (k, v) => memory.set(k, v) };
  const a = updateOperatorProfileFromMessage(createEmptyOperatorProfile(), 'my name is Stephan');
  persistOperatorProfile(a, storage);
  const b = readOperatorProfile(storage);
  assert.equal(b.operatorName, 'Stephan');
  assert.equal(b.storageReadStatus, 'success');
  assert.equal(b.rehydrated, true);
  const c = updateOperatorProfileFromMessage(b, 'my name is Alex');
  assert.equal(c.operatorName, 'Alex');
  assert.equal(c.rawTranscriptStored, 'no');
});

test('corrupt profile safely falls back to unknown', () => {
  const storage = { getItem: () => '{bad json}', setItem: () => {} };
  const profile = readOperatorProfile(storage);
  assert.equal(profile.known, false);
  assert.equal(profile.operatorName, '');
  assert.equal(profile.storageReadStatus, 'corrupt');
});

test('missing name remains unknown safely', () => {
  const profile = updateOperatorProfileFromMessage(createEmptyOperatorProfile(), 'hello there');
  assert.equal(profile.known, false);
});
