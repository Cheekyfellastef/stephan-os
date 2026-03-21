import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStephanosHomeNodeCandidates,
  createStephanosHomeNodeUrls,
  normalizeStephanosHomeNode,
  resolveStephanosBackendBaseUrl,
} from '../shared/runtime/stephanosHomeNode.mjs';

test('createStephanosHomeNodeUrls builds LAN-friendly UI and backend URLs', () => {
  const urls = createStephanosHomeNodeUrls({ host: '192.168.1.42' });

  assert.equal(urls.uiUrl, 'http://192.168.1.42:5173/');
  assert.equal(urls.backendUrl, 'http://192.168.1.42:8787');
  assert.equal(urls.backendHealthUrl, 'http://192.168.1.42:8787/api/health');
});

test('buildStephanosHomeNodeCandidates prefers manual, last-known, and current-origin hints without subnet scanning', () => {
  const candidates = buildStephanosHomeNodeCandidates({
    currentOrigin: 'http://192.168.1.42:5173',
    manualNode: { host: 'stephanos-pc.local', uiPort: 5173, backendPort: 8787 },
    lastKnownNode: { host: '192.168.1.10', uiPort: 5173, backendPort: 8787 },
    recentHosts: ['192.168.1.11', '192.168.1.12'],
  });

  assert.deepEqual(
    [...new Set(candidates.map((candidate) => candidate.host))],
    ['stephanos-pc.local', '192.168.1.10', '192.168.1.42', '192.168.1.11', '192.168.1.12'],
  );
  assert.ok(candidates.length <= 8);
});

test('resolveStephanosBackendBaseUrl uses the current LAN host before falling back to localhost', () => {
  assert.equal(
    resolveStephanosBackendBaseUrl({ currentOrigin: 'http://192.168.1.42:5173' }),
    'http://192.168.1.42:8787',
  );
  assert.equal(
    resolveStephanosBackendBaseUrl({ currentOrigin: 'http://localhost:5173', manualNode: normalizeStephanosHomeNode({ host: '192.168.1.42' }) }),
    'http://192.168.1.42:8787',
  );
});
