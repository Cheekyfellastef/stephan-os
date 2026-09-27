import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_LOCAL_ID,
  OPENCLAW_STANDALONE_ID,
  OPENCLAW_AGENT_PROFILES,
  projectOpenClawQualificationScoreV1,
  evaluateOpenClawScopeHandoffV1,
} from './openClawTwoAgentQualificationV1.mjs';

test('Local and Standalone are separate canonical identities with non-overlapping default scopes', () => {
  assert.notEqual(OPENCLAW_LOCAL_ID, OPENCLAW_STANDALONE_ID);
  assert.equal(OPENCLAW_AGENT_PROFILES[OPENCLAW_LOCAL_ID].scope, 'STEPHANOS_ONLY');
  assert.equal(OPENCLAW_AGENT_PROFILES[OPENCLAW_STANDALONE_ID].scope, 'GOVERNED_WHOLE_PC');
  assert.equal(OPENCLAW_AGENT_PROFILES[OPENCLAW_LOCAL_ID].handoffTarget, OPENCLAW_STANDALONE_ID);
  assert.equal(OPENCLAW_AGENT_PROFILES[OPENCLAW_STANDALONE_ID].handoffTarget, OPENCLAW_LOCAL_ID);
});

test('qualification scores remain independent per identity', () => {
  const local = projectOpenClawQualificationScoreV1({
    participantId: OPENCLAW_LOCAL_ID,
    evaluation: { valid: true, state: 'SETTLED', counts: { grounded: 10, partial: 0, buildableGaps: 0 } },
    proofRefs: ['proof/local-10q'],
  });
  const standalone = projectOpenClawQualificationScoreV1({
    participantId: OPENCLAW_STANDALONE_ID,
    evaluation: { valid: true, state: 'REPAIR_REPLAY_REQUIRED', counts: { grounded: 7, partial: 2, buildableGaps: 1 } },
    proofRefs: ['proof/standalone-10q'],
  });
  assert.equal(local.score, 10);
  assert.equal(local.independentlyQualified, true);
  assert.equal(standalone.score, 7);
  assert.equal(standalone.independentlyQualified, false);
  assert.notDeepEqual(local.proofRefs, standalone.proofRefs);
});
test('Local hands whole-PC work to Standalone', () => {
  assert.deepEqual(evaluateOpenClawScopeHandoffV1({
    fromParticipantId: OPENCLAW_LOCAL_ID,
    workScope: 'whole-pc',
  }), {
    valid: true,
    verdict: 'HANDOFF_REQUIRED',
    fromParticipantId: OPENCLAW_LOCAL_ID,
    toParticipantId: OPENCLAW_STANDALONE_ID,
    workScope: 'whole-pc',
  });
});

test('Standalone hands Stephanos ownership back to Local', () => {
  const result = evaluateOpenClawScopeHandoffV1({
    fromParticipantId: OPENCLAW_STANDALONE_ID,
    workScope: 'stephan-os',
  });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'HANDOFF_REQUIRED');
  assert.equal(result.toParticipantId, OPENCLAW_LOCAL_ID);
});

test('each agent accepts its own scope and unknown scope fails closed', () => {
  assert.equal(evaluateOpenClawScopeHandoffV1({
    fromParticipantId: OPENCLAW_LOCAL_ID,
    workScope: 'shared-workspace',
  }).verdict, 'SCOPE_OWNED');
  assert.equal(evaluateOpenClawScopeHandoffV1({
    fromParticipantId: OPENCLAW_STANDALONE_ID,
    workScope: 'desktop',
  }).verdict, 'SCOPE_OWNED');
  assert.equal(evaluateOpenClawScopeHandoffV1({
    fromParticipantId: OPENCLAW_STANDALONE_ID,
    workScope: 'mystery-surface',
  }).verdict, 'SAFE_HOLD_UNCLASSIFIED_SCOPE');
});
