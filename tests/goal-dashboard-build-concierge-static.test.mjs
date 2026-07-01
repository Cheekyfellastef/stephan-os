import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP } from '../shared/agents/battleBridgeBuildConciergeV2.mjs';

const source = await readFile(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');

test('Goal Dashboard static page contains Build Concierge V2 truth rail', () => {
  for (const expected of [
    'Build Concierge',
    'V2 landed',
    'V3 next',
    'exact-head approval required',
    'Proof readiness',
    'blocked_or_unknown',
    'HELD_PENDING_PROOF_PACKET_AND_EXACT_HEAD_APPROVAL',
    'No fake proof',
    'Next operator action',
    'Review the V2 operator surfaces',
  ]) {
    assert.equal(source.includes(expected), true, `missing static Build Concierge text: ${expected}`);
  }
});

test('Goal Dashboard static page keeps Build Concierge live proof claims blocked', () => {
  for (const expected of [
    'GitHub proof, local proof, and browser proof are not claimed from this static page.',
    'It does not wire live GitHub state, local command proof, browser proof, or approval-token validation; unknown remains unknown.',
    'static seeded visibility only',
  ]) {
    assert.equal(source.includes(expected), true, `missing honest static proof boundary: ${expected}`);
  }
});


test('Goal Dashboard static Build Concierge copy follows canonical V2/V3 roadmap text', () => {
  const v2 = BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.find((phase) => phase.version === 'V2');
  const v3 = BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.find((phase) => phase.version === 'V3');
  assert.ok(v2, 'canonical V2 roadmap phase exists');
  assert.ok(v3, 'canonical V3 roadmap phase exists');
  for (const expected of [v2.title, v2.status, v2.intent, v3.title, v3.status]) {
    assert.equal(source.includes(expected), true, `missing canonical roadmap value: ${expected}`);
  }
});
