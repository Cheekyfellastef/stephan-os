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


test('approved durable memory influences mission proposal while rejected/unsaved do not', () => {
  const missionSpec = buildMissionSpec({
    rawIntent: 'Create mission envelope for memory loop while keeping operator intent primary.',
    targetArea: 'mission-console',
    memoryContext: {
      memoryCandidates: [
        { id: 'm1', status: 'approved', promotionState: 'saved', memoryCandidateType: 'architecture_canon_candidate', summary: 'Keep launcher and mission runtime separate.', source: 'operator' },
        { id: 'm2', status: 'approved', promotionState: 'saved', memoryCandidateType: 'project_lesson', summary: 'Add verify checks in every mission handoff.', source: 'operator' },
        { id: 'm3', status: 'rejected', promotionState: 'rejected', memoryCandidateType: 'project_lesson', summary: 'This rejected lesson must never be used.' },
        { id: 'm4', status: 'approved', promotionState: 'draft', memoryCandidateType: 'durable_operator_preference', summary: 'Unsaved draft must not be used.' },
      ],
      draftMissionContext: 'Current draft: mission bridge requires explicit approval gate.',
    },
  });

  assert.equal(missionSpec.missionMemoryInfluenceCount >= 3, true);
  assert.equal(missionSpec.missionMemoryInfluence.some((entry) => /rejected lesson/.test(entry.summary.toLowerCase())), false);
  assert.equal(missionSpec.missionMemoryInfluence.some((entry) => /unsaved draft/.test(entry.summary.toLowerCase())), false);
  assert.equal(missionSpec.missionMemoryInfluence.some((entry) => /launcher and mission runtime separate/i.test(entry.summary)), true);
  assert.equal(missionSpec.missionMemoryInfluence.some((entry) => /verify checks/i.test(entry.summary)), true);
  assert.equal(missionSpec.rawIntent.includes('operator intent primary'), true);
});

test('codex handoff includes safety doctrine and memory influence section and keeps OpenClaw parked', () => {
  const missionSpec = buildMissionSpec({
    rawIntent: 'Generate handoff only; no execution.',
    targetArea: 'mission-console',
    memoryContext: {
      memoryCandidates: [
        { id: 'm1', status: 'approved', promotionState: 'saved', memoryCandidateType: 'capability_gap', summary: 'Mission memory loop needs visible influence projection.' },
      ],
    },
  });
  const prompt = buildCodexHandoffPrompt({ missionSpec });
  assert.match(prompt, /Memory Influence \(approved durable \+ relevant draft context only\):/);
  assert.match(prompt, /Safety Doctrine \(mandatory\):/);
  assert.match(prompt, /No git push\./);
  assert.match(prompt, /Operator final authority/);
  assert.match(prompt, /no autonomous execution/i);
  assert.equal(missionSpec.missionMemoryInfluenceTypes.includes('capability_gap'), true);
});
