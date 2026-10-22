import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBattleBridgeOutboundBeaconMaterialBody } from './battle-bridge-outbound-health-beacon-core.mjs';

test('health beacon material digest ignores volatile timestamps and ages but preserves state changes', () => {
  const first = JSON.stringify({
    observedAtUtc: '2026-09-28T15:00:00.000Z',
    surfaces: [{ state: 'GREEN', ageMs: 1000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  const second = JSON.stringify({
    observedAtUtc: '2026-09-28T15:01:00.000Z',
    surfaces: [{ state: 'GREEN', ageMs: 61000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  const changed = JSON.stringify({
    observedAtUtc: '2026-09-28T15:01:00.000Z',
    surfaces: [{ state: 'BLOCKED', ageMs: 61000, heartbeatAtUtc: '2026-09-28T14:59:59.000Z' }],
  });
  assert.equal(buildBattleBridgeOutboundBeaconMaterialBody(first), buildBattleBridgeOutboundBeaconMaterialBody(second));
  assert.notEqual(buildBattleBridgeOutboundBeaconMaterialBody(first), buildBattleBridgeOutboundBeaconMaterialBody(changed));
});
