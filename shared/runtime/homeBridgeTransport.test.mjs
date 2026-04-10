import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listBridgeTransportDefinitions,
  normalizeBridgeTransportPreferences,
  projectHomeBridgeTransportTruth,
} from './homeBridgeTransport.mjs';

test('bridge transport registry remains deterministic and includes planned wireguard placeholder', () => {
  const defs = listBridgeTransportDefinitions();
  assert.deepEqual(defs.map((entry) => entry.key), ['manual', 'tailscale', 'wireguard']);
  assert.equal(defs[2].status, 'planned');
});

test('selected transport truth remains distinct from configured/active/reachable/usable', () => {
  const prefs = normalizeBridgeTransportPreferences({
    selectedTransport: 'tailscale',
    transports: {
      tailscale: {
        enabled: true,
        backendUrl: 'https://100.64.0.10',
        accepted: false,
        active: false,
        reachability: 'unknown',
        usable: false,
      },
    },
  });
  const truth = projectHomeBridgeTransportTruth(prefs);
  assert.equal(truth.selectedTransport, 'tailscale');
  assert.equal(truth.activeTransport, 'none');
  assert.equal(truth.reachability, 'unknown');
  assert.equal(truth.usability, 'no');
});
