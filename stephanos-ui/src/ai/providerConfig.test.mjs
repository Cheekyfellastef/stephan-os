import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultSavedProviderConfigs } from './providerConfig.js';

test('default Groq provider config is zero-cost safe with no fresh-web candidate', () => {
  const providerConfigs = createDefaultSavedProviderConfigs();
  assert.equal(providerConfigs.groq.freshWebModel, null);
  assert.deepEqual(providerConfigs.groq.freshWebModelCandidates, []);
});
