import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHARED_WORKSPACE_RECORD_KINDS,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import { UI_AGENT_ID } from './uiAgentParticipantV1.mjs';
import { buildStephanosConversationCanvasHandoffV1 } from './stephanosConversationCanvasHandoffV1.mjs';
import {
  STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION,
  buildStephanosConversationCanvasWorkspaceHandoffRecordV1,
} from './stephanosConversationCanvasWorkspaceHandoffRecordV1.mjs';
import { buildStephanosRichConversationalResponseV1 } from './stephanosRichConversationalResponseV1.mjs';

const NOW = new Date('2026-08-21T00:30:00.000Z');

function richResponse(answerText = 'Stephanos has a bounded private Conversation Canvas handoff ready for the existing UI Agent presenter.') {
  const result = buildStephanosRichConversationalResponseV1({
    question: {
      questionId: 'stephanos-round-001-q01',
      roundId: 'stephanos-round-001',
      questionClass: 'CURRENT_PROGRAMME_TRUTH',
    },
    answer: {
      answerText,
      epistemicState: 'OBSERVED_FROM_RUNTIME_OR_PROOF',
      evidenceRefs: ['receipts/live-round-source'],
      freshness: 'FRESH',
      sourcesConsulted: ['live-goal-projection'],
      cannotAnswerReason: null,
      answerVerdict: 'ANSWERED_GROUNDED',
    },
    structured: {
      goalsMissions: [{ ref: '#1308', label: 'Stephanos conversational intelligence', state: 'ACTIVE', evidenceRefs: ['receipts/live-round-source'] }],
      agentProviderContributions: [{ contributorId: 'stephanos', contributionType: 'SYSTEM_SYNTHESIS', summary: 'Synthesised live durable truth.', evidenceRefs: ['receipts/live-round-source'] }],
      unknowns: [],
      options: [],
      recommendedAction: { actionId: 'action:present-canvas', label: 'Present through the existing Conversation Canvas', rationale: 'Reuse the canonical UI Agent presenter.', requiresApproval: 'NO', evidenceRefs: ['receipts/live-round-source'] },
      approvalState: { state: 'NOT_REQUIRED', approvalRef: '', evidenceRefs: ['receipts/live-round-source'] },
      visualisationCandidates: ['SYSTEM_MAP'],
    },
  });
  assert.equal(result.valid, true, result.errors.join(','));
  return result;
}

function canvasHandoff(answerText) {
  const result = buildStephanosConversationCanvasHandoffV1({
    richResponse: richResponse(answerText),
    surface: 'ipad',
    state: 'READY',
    expandedSections: ['evidence', 'action'],
    prefersReducedMotion: true,
    statusMessage: 'Evidence-bound answer ready.',
  });
  assert.equal(result.valid, true, result.errors.join(','));
  return result;
}

function workspaceInput(handoff = canvasHandoff()) {
  return {
    canvasHandoff: handoff,
    timestampUtc: NOW.toISOString(),
    correlationId: 'stephanos-round-001',
    relatedIssue: '#1308',
    relatedPr: '#1896',
    proofRefs: ['receipts/live-round-source'],
  };
}

test('builds one canonical private Shared Workspace handoff to the existing UI Agent presenter', () => {
  const handoff = canvasHandoff();
  const result = buildStephanosConversationCanvasWorkspaceHandoffRecordV1(workspaceInput(handoff), {
    nowMs: NOW.getTime(),
  });

  assert.equal(result.valid, true, result.errors.join(','));
  assert.equal(result.schemaVersion, STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION);
  assert.equal(result.state, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_RECORD_READY');
  assert.equal(result.record.kind, SHARED_WORKSPACE_RECORD_KINDS.HANDOFF);
  assert.equal(result.record.participantId, 'stephanos');
  assert.equal(result.record.fromParticipantId, 'stephanos');
  assert.equal(result.record.toParticipantId, UI_AGENT_ID);
  assert.equal(result.record.correlationId, 'stephanos-round-001');
  assert.deepEqual(result.record.proofRefs, ['receipts/live-round-source']);
  assert.deepEqual(result.workspaceSegments, ['outbox', `${handoff.handoffId}.json`]);

  const body = JSON.parse(result.record.body);
  assert.equal(body.schemaVersion, STEPHANOS_CONVERSATION_CANVAS_WORKSPACE_HANDOFF_RECORD_SCHEMA_VERSION);
  assert.equal(body.targetPresenterSchemaVersion, 'stephanos.ui-agent.conversation-canvas-presenter.v1');
  assert.equal(body.targetPayloadField, 'conversation_canvas_view');
  assert.equal(body.surface, 'ipad');
  assert.equal(body.presenterInput.richResponse.directAnswer, richResponse().directAnswer);
  assert.equal(body.privacy.sharedWorkspacePrivateHandoffRequired, true);
  assert.equal(body.privacy.rawAnswerMayEnterPublicRelay, false);
  assert.equal(body.privacy.publicRelayProjectionAllowed, false);
  assert.equal(body.authority.commandExecutionAllowed, false);
  assert.equal(body.authority.presenterActionExecutionAllowed, false);

  const validation = validateSharedWorkspaceRecord(result.record, { nowMs: NOW.getTime() });
  assert.equal(validation.valid, true, validation.errors.join(','));
});

test('fails closed if a forged handoff widens the public relay privacy boundary', () => {
  const handoff = canvasHandoff();
  const forged = {
    ...handoff,
    privacy: {
      ...handoff.privacy,
      publicRelayProjectionAllowed: true,
    },
  };
  const result = buildStephanosConversationCanvasWorkspaceHandoffRecordV1(workspaceInput(forged), {
    nowMs: NOW.getTime(),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['canvas-privacy-boundary-mismatch']);
  assert.equal(result.record, null);
});

test('fails closed if rich-response continuity is forged after the Canvas handoff boundary', () => {
  const handoff = canvasHandoff();
  const forged = {
    ...handoff,
    presenterInput: {
      ...handoff.presenterInput,
      richResponse: {
        ...handoff.presenterInput.richResponse,
        continuity: {
          ...handoff.presenterInput.richResponse.continuity,
          questionId: 'stephanos-round-001-q99',
        },
      },
    },
  };
  const result = buildStephanosConversationCanvasWorkspaceHandoffRecordV1(workspaceInput(forged), {
    nowMs: NOW.getTime(),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['rich-response-continuity-mismatch']);
  assert.equal(result.record, null);
});

test('fails closed instead of truncating an oversized private presentation body', () => {
  const handoff = canvasHandoff('A'.repeat(15_000));
  const result = buildStephanosConversationCanvasWorkspaceHandoffRecordV1(workspaceInput(handoff), {
    nowMs: NOW.getTime(),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['private-canvas-handoff-body-too-large']);
  assert.equal(result.record, null);
});

test('requires caller-supplied proof lineage before a private Canvas handoff can enter Shared Workspace', () => {
  const result = buildStephanosConversationCanvasWorkspaceHandoffRecordV1({
    ...workspaceInput(),
    proofRefs: [],
  }, {
    nowMs: NOW.getTime(),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['workspace-proofRefs-required']);
  assert.equal(result.record, null);
});
