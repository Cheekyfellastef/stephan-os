import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderSecretSaveFeedback } from './providerSecretFeedback.js';

test('resolveProviderSecretSaveFeedback returns explicit operator-visible error on save failure', () => {
  const feedback = resolveProviderSecretSaveFeedback({ ok: false, error: '' }, 'groq');
  assert.equal(feedback.type, 'error');
  assert.match(feedback.message, /Failed to store groq API key/i);
});
