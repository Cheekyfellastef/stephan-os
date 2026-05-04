import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMissionMemoryCandidate,
  INTENT_TO_BUILD_BOUNDARIES,
  buildCodexHandoffPrompt,
  classifyOperatorIntent,
  buildMissionSpec,
  createIntentToBuildState,
} from './intentToBuildModel.js';

test('mission spec generation keeps doctrine and verification boundaries', () => {
  const missionSpec = buildMissionSpec({
    rawIntent: 'Ship intent-to-build control loop in mission console',
    targetArea: 'mission-console.intent-builder',
    riskLevel: 'high',
    allowedAutomation: ['edit-source-files', 'add-tests'],
    verificationCommands: ['npm run stephanos:build', 'npm run stephanos:verify'],
    successCriteria: ['Operator can copy a codex prompt.'],
  }, { now: new Date('2026-04-24T01:02:03.000Z') });

  assert.equal(missionSpec.missionId.startsWith('intent-build-mission-console-intent-builder-'), true);
  assert.equal(missionSpec.rawIntent.includes('intent-to-build'), true);
  assert.equal(missionSpec.approvalBoundary.allowedActions.includes('edit-source-files'), true);
  assert.equal(missionSpec.approvalBoundary.allowedActions.includes('prepare-pr-text'), false);
  assert.equal(missionSpec.doctrineConstraints.some((line) => line.includes('dist is generated output')), true);
  assert.equal(missionSpec.privacyBoundary.includes('No secrets committed'), true);
  assert.equal(missionSpec.costBoundary.includes('Zero-cost defaults remain active'), true);
});

test('intent classification is deterministic and tags memory/capability requests', () => {
  const result = classifyOperatorIntent('Please remember this workflow preference and add mission memory capability.');
  assert.equal(result.categories.includes('workflow_preference'), true);
  assert.equal(result.categories.includes('memory_request'), true);
  assert.equal(result.categories.includes('capability_request'), true);
});

test('durable and canon candidates require explicit operator approval', () => {
  const candidate = buildMissionMemoryCandidate({
    operatorIntentText: 'Architecture canon: launcher and mission runtime must remain separate.',
    categories: ['architecture_rule'],
  });
  assert.equal(candidate.memoryCandidateType, 'architecture_canon_candidate');
  assert.equal(candidate.requiresOperatorApproval, true);
  assert.equal(candidate.promotionState, 'pending-operator-approval');
});

test('mission proposal retains blocked actions and codex handoff includes verification details', () => {
  const missionSpec = buildMissionSpec({ rawIntent: 'Add mission memory', targetArea: 'mission-console' });
  const prompt = buildCodexHandoffPrompt({ missionSpec });
  assert.equal(missionSpec.missionMemoryCandidate.suggestedBlockedActions.includes('openclaw execution'), true);
  assert.match(prompt, /PR Acceptance Criteria:/);
  assert.match(prompt, /Verification Commands:/);
});

test('approval boundary classification keeps risky actions gated', () => {
  const missionSpec = buildMissionSpec({
    rawIntent: 'Adjust runtime model',
    targetArea: 'runtime',
    allowedAutomation: INTENT_TO_BUILD_BOUNDARIES.autoAllowed,
    requiresApprovalFlags: {
      deploy: true,
      'enable-paid-service': true,
      'store-secrets': true,
    },
  });

  assert.equal(missionSpec.approvalBoundary.approvalRequired, true);
  assert.equal(missionSpec.approvalBoundary.blockedActions.includes('deploy'), true);
  assert.equal(missionSpec.approvalBoundary.blockedActions.includes('store-secrets'), true);
});

test('codex prompt generation includes scope, tests, and no-dist-truth doctrine', () => {
  const missionSpec = buildMissionSpec({
    rawIntent: 'Improve mission builder tile',
    targetArea: 'stephanos-ui',
    implementationScope: 'Only UI model + support snapshot wiring.',
    nonGoals: ['No deploys', 'No DNS changes'],
    successCriteria: ['Tests pass and prompt can be copied'],
  });

  const prompt = buildCodexHandoffPrompt({ missionSpec, repoPath: '/workspace/stephan-os' });
  assert.match(prompt, /Repo Context: \/workspace\/stephan-os/);
  assert.match(prompt, /Implementation Scope:/);
  assert.match(prompt, /Non-Goals:/);
  assert.match(prompt, /Verification Commands:/);
  assert.match(prompt, /dist is generated output, never source truth/);
});

test('createIntentToBuildState preserves privacy/cost doctrine and prompt availability', () => {
  const state = createIntentToBuildState({
    rawIntent: 'Do the thing',
    targetArea: 'mission-console',
  });

  assert.equal(state.generatedPromptAvailable, true);
  assert.equal(state.approvalRequired, true);
  assert.equal(state.missionSpec.privacyBoundary.includes('No secrets'), true);
  assert.equal(state.missionSpec.costBoundary.includes('Zero-cost'), true);
});
