import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateVrAtlasStatusPillsObservation } from '../scripts/sovereign-commander-ui-runtime-proof.mjs';

const observation = Object.freeze({
  pageTitleMatches: true,
  methodsGridVisible: true,
  evidencePanelVisible: true,
  evidenceState: 'ready',
  corpusCount: 26,
  evidenceTitlePresent: true,
  pills: ['ACTIVE', 'NEW-SOURCE-EXTRACTION', 'REFERENCE-PROVEN', 'DESIGN-ACTIVE']
    .map((label) => ({label, compact: true, centered: true, textCentered: true, wrapContract: true, overflowFree: true})),
});

for (const action of ['UNKNOWN', 'UNAVAILABLE', 'PENDING', 'NONE', 'N/A', 'NOT_READY', 'NO_ACTION', 'NOT_AVAILABLE', 'UNSET']) {
  test(`VR Atlas evidence rejects non-action placeholder ${action}`, () => {
    const result = evaluateVrAtlasStatusPillsObservation({ ...observation, agentAction: action });
    assert.equal(result.accepted, false);
    assert.ok(result.blockers.includes('VR_ATLAS_RESEARCH_AGENT_ACTION_MISSING'));
  });
}

test('VR Atlas evidence normalizes padded mixed-case placeholder', () => {
  const result = evaluateVrAtlasStatusPillsObservation({ ...observation, agentAction: '  no_action  ' });
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('VR_ATLAS_RESEARCH_AGENT_ACTION_MISSING'));
});

test('VR Atlas evidence preserves a meaningful real research action', () => {
  const result = evaluateVrAtlasStatusPillsObservation({ ...observation, agentAction: 'COLLECT_VERIFIED_REFERENCE' });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.blockers, []);
});
