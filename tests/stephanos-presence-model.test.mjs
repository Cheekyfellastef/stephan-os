import test from 'node:test';
import assert from 'node:assert/strict';
import { reducePresenceState, getPresenceSummary, acknowledgePresenceItem, dismissPresenceItem, approvePresenceAction } from '../shared/runtime/stephanosPresenceModel.mjs';

test('Presence event creates voice + awareness message', () => {
  const state = reducePresenceState({}, { sourceTile: 'music', kind: 'track_rated', severity: 'info', summary: 'Track rated', suggestedAction: 'Build journey' });
  assert.equal(state.voiceMessages.length, 1);
  assert.equal(state.awarenessQueue.length, 1);
  assert.equal(getPresenceSummary(state), 'Track rated');
});

test('acknowledge/dismiss/approve updates awareness status only', () => {
  const initial = reducePresenceState({}, { id: 'x1', sourceTile: 'music', kind: 'ai_route_unavailable', severity: 'warning', summary: 'down', requiresApproval: true });
  assert.equal(acknowledgePresenceItem(initial, 'x1').awarenessQueue[0].status, 'acknowledged');
  assert.equal(dismissPresenceItem(initial, 'x1').awarenessQueue[0].status, 'dismissed');
  assert.equal(approvePresenceAction(initial, 'x1').awarenessQueue[0].status, 'approved');
});
