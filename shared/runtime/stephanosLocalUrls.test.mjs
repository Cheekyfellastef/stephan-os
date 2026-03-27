import test from 'node:test';
import assert from 'node:assert/strict';

import { createStephanosLocalUrls } from './stephanosLocalUrls.mjs';

test('createStephanosLocalUrls publishes launcher-root runtime-status path expected by app validator', () => {
  const urls = createStephanosLocalUrls({ port: 4173 });

  assert.equal(urls.runtimeStatusPath, '/apps/stephanos/runtime-status.json');
});
