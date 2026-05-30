import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenClawWebResearchIntakeProjection, judgeOpenClawWebResearchResult, OPENCLAW_VR_RESEARCH_PROMPT } from './openClawWebResearchIntake.mjs';

test('projection defaults lock mutation and forbid auto-start', () => {
  const p = createOpenClawWebResearchIntakeProjection();
  assert.equal(p.mutationAuthority, 'locked');
  assert.equal(p.autoStart, 'forbidden');
  assert.equal(p.operatorApprovalRequired, 'yes');
  assert.equal(p.recommendedUse, 'research-only');
  assert.equal(p.resultTrustedForCanon, 'no');
  assert.match(OPENCLAW_VR_RESEARCH_PROMPT, /flat-to-VR conversion/i);
});

test('WEB_ACCESS_UNAVAILABLE result marks web unavailable and unverified', () => {
  const p = judgeOpenClawWebResearchResult('WEB_ACCESS_UNAVAILABLE');
  assert.equal(p.webAccessStatus, 'unavailable');
  assert.equal(p.resultTrustedForCanon, 'no');
  assert.equal(p.status, 'needs-review');
});

test('result with real URLs increments source and valid url counts', () => {
  const p = judgeOpenClawWebResearchResult('Sources:\n- https://example.com/vr\n- https://developer.example.org/starfield\nTechnique taxonomy: VR stereo depth reconstruction. Starfield VR relevance. Confidence: medium');
  assert.equal(p.sourceCount, 2);
  assert.equal(p.validUrlCount, 2);
  assert.equal(p.webAccessStatus, 'claimed-unverified');
});

test('placeholder leakage detects answer tags', () => {
  const p = judgeOpenClawWebResearchResult('<answer> generic text </answer>');
  assert.equal(p.placeholderLeakageDetected, 'yes');
  assert.equal(p.status, 'failed');
});

test('forbidden leakage detects edit commit push and command claims', () => {
  const p = judgeOpenClawWebResearchResult('I edited files, ran npm test, committed, pushed, and started a service.');
  assert.equal(p.forbiddenLeakageDetected, 'yes');
  assert.equal(p.status, 'failed');
});

test('task drift detects generic OpenClaw Stephanos boilerplate when VR research was requested', () => {
  const p = judgeOpenClawWebResearchResult('OpenClaw Control Bridge works with Stephanos OS. Builder Mesh and Operator Relief manage Command Deck packets.');
  assert.equal(p.taskFrameAdherence, 'fail');
  assert.equal(p.status, 'failed');
});
