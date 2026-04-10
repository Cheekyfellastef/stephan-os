import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFrictionEvent,
  generateFrictionProposal,
  interpretSurfaceFrictionText,
} from './frictionPipeline.js';

test('friction interpretation classifies common complaints', () => {
  const clutter = interpretSurfaceFrictionText('This feels too dense on this device', { surfaceProfileId: 'field-tablet' });
  assert.equal(clutter.frictionType, 'layout-clutter');

  const drag = interpretSurfaceFrictionText('Dragging panels is awkward here', { surfaceProfileId: 'field-tablet' });
  assert.equal(drag.frictionType, 'panel-dragging');

  const inputLost = interpretSurfaceFrictionText('The input box keeps getting lost on my phone', { surfaceProfileId: 'pocket-ops-phone' });
  assert.equal(inputLost.frictionType, 'control-reachability');
});

test('friction interpreter keeps no-fake-certainty for unknown text', () => {
  const interpretation = interpretSurfaceFrictionText('Not sure what is wrong just weird vibes', { surfaceProfileId: 'generic-surface' });
  assert.equal(interpretation.frictionType, 'unknown');
  assert.equal(interpretation.confidence, 'low');
  assert.equal(interpretation.noFakeCertainty, true);
});

test('proposal generation classification and event shaping is deterministic', () => {
  const interpretation = interpretSurfaceFrictionText('Dragging panels is awkward here', { surfaceProfileId: 'field-tablet' });
  const proposal = generateFrictionProposal(interpretation, { activeProtocolIds: [] });
  assert.equal(proposal.proposalType, 'surface-override-suggestion');

  const event = createFrictionEvent({
    userText: 'This is too cluttered on iPad',
    surfaceProfileId: 'field-tablet',
    activeProtocolIds: ['touch-first-input'],
    now: { toISOString: () => '2026-04-10T00:00:00.000Z' },
  });

  assert.equal(event.source, 'operator-text');
  assert.equal(event.persistenceScope, event.proposal.persistenceScope);
  assert.equal(event.structuredInterpretation.noFakeCertainty, true);
});
