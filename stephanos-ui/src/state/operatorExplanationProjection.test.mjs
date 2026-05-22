import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperatorExplanationProjection, detectOperatorExplanationIntent, formatOperatorExplanation } from './operatorExplanationProjection.js';

const baseModels = {
  intentToBuildModel: { missionSpec: { repoArchitectureContext: { testsLikelyRequired: ['node --test a'] } } },
  proofOfDoneModel: { verificationJudge: { parsed: { testsRun: ['node --test a'], buildRun: true, verifyRun: true }, mergeReadyCandidate: true }, browserChecksObserved: [] },
  prEvidenceModel: { changedFiles: ['stephanos-ui/src/components/AIConsole.jsx'] },
  supportSnapshot: {},
};

test('intent detection routes explanation prompts and supports detailed mode', () => {
  assert.equal(detectOperatorExplanationIntent('what does this mean?').matched, true);
  assert.equal(detectOperatorExplanationIntent('what does that mean').matched, true);
  assert.equal(detectOperatorExplanationIntent('what does the above mean').matched, true);
  assert.equal(detectOperatorExplanationIntent('explain what just happened').matched, true);
  assert.equal(detectOperatorExplanationIntent('translate that into monkey brain').matched, true);
  assert.equal(detectOperatorExplanationIntent('show evidence and give me the detail').mode, 'detailed');
  assert.equal(detectOperatorExplanationIntent('what are the next 3 problems?').matched, true);
  assert.equal(detectOperatorExplanationIntent('write me a poem').matched, false);
  assert.equal(detectOperatorExplanationIntent('what does this repo contain').matched, false);
});

test('projection marks source-clean but proof pending when browser proof missing', () => {
  const p = buildOperatorExplanationProjection(baseModels, 'is this safe to merge');
  assert.equal(p.verdict, 'source-clean but proof-pending');
  assert.equal(p.mergeSafety, 'review-required');
  assert.equal(p.nextOperatorAction.length > 0, true);
});

test('projection blocks forbidden artifacts', () => {
  const p = buildOperatorExplanationProjection({ ...baseModels, prEvidenceModel: { changedFiles: ['apps/stephanos/dist/index.js'] } }, 'translate telemetry');
  assert.equal(p.verdict, 'blocked / do not merge');
});

test('formatter compact and detailed remain bounded and include key sections', () => {
  const p = buildOperatorExplanationProjection(baseModels, 'what does this mean');
  const compact = formatOperatorExplanation(p, { mode: 'compact' });
  const detailed = formatOperatorExplanation(p, { mode: 'detailed' });
  assert.match(compact, /Verdict:/);
  assert.match(compact, /What matters:/);
  assert.match(compact, /Risk:/);
  assert.match(compact, /Next action:/);
  assert.match(detailed, /Evidence:/);
  assert.match(detailed, /Missing proof:/);
  assert.match(detailed, /Top 3 Problems:/);
  assert.equal(detailed.length <= 2200, true);
});
