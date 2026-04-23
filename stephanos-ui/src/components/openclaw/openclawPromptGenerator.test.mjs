import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawCandidatePrompts } from './openclawPromptGenerator.js';

test('generated OpenClaw prompts are doctrine-safe and review-only', () => {
  const cards = buildOpenClawCandidatePrompts({
    scanType: 'runtime-truth-routing-scan',
    findings: [{
      title: 'Canonical runtime truth boundary preserved',
      diagnosis: 'Route projection remains canonical.',
      doctrineRisk: 'low',
      uncertainty: 'bounded check only',
      likelyFiles: ['stephanos-ui/src/App.jsx'],
    }],
  });

  assert.equal(cards.length, 1);
  assert.equal(cards[0].safeForReviewOnly, true);
  assert.equal(cards[0].approvalStatus, 'pending');
  assert.match(cards[0].candidatePrompt, /runtimeStatusModel \+ adjudicator truth flow/);
  assert.match(cards[0].candidatePrompt, /Dist is generated output/);
  assert.match(cards[0].candidatePrompt, /Do not bypass runtimeStatusModel/);
});
