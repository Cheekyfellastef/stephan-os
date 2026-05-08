import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emitPresenceEvent,
  getPresenceState,
  acknowledgePresenceItem,
  dismissPresenceItem,
  approvePresenceAction,
} from '../shared/runtime/stephanosPresenceBridge.mjs';

test('global presence bridge receives and stores events without AI dependency', () => {
  const next = emitPresenceEvent({ kind: 'music.journey_built', summary: 'Journey built for Anyma', impact: 'Candidates ready.' });
  assert.ok(Array.isArray(next.recentEvents));
  assert.match(next.recentEvents[0].kind, /music\.journey_built/);
  const state = getPresenceState();
  const id = state.awarenessQueue?.[0]?.id;
  assert.ok(id);
  assert.equal(acknowledgePresenceItem(id).awarenessQueue[0].status, 'acknowledged');
  assert.equal(dismissPresenceItem(id).awarenessQueue[0].status, 'dismissed');
  assert.equal(approvePresenceAction(id).awarenessQueue[0].status, 'approved');
});
