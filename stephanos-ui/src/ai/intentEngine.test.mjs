import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOperatorIntent } from './intentEngine.js';

test('intent engine classifies build-oriented request deterministically', () => {
  const intent = classifyOperatorIntent({
    prompt: 'Implement a deterministic mission execution layer and promote to roadmap after approval',
    projectContext: { subsystemInventory: ['memory', 'runtime', 'roadmap'] },
  });

  assert.equal(intent.buildRelevant, true);
  assert.equal(intent.intentType.startsWith('build-') || intent.intentType === 'roadmap-operation', true);
  assert.equal(intent.approvalRequired, true);
});

test('intent engine degrades ambiguous prompt honestly', () => {
  const intent = classifyOperatorIntent({ prompt: 'maybe do something maybe' });
  assert.equal(intent.intentType, 'ambiguous');
  assert.equal(intent.executionEligible, false);
  assert.equal(intent.ambiguityFlags.length > 0, true);
});
