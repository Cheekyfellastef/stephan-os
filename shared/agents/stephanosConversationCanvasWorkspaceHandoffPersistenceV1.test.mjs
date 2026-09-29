import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStephanosConversationCanvasHandoffV1 } from './stephanosConversationCanvasHandoffV1.mjs';
import {
  buildStephanosConversationCanvasWorkspaceHandoffRecordV1,
} from './stephanosConversationCanvasWorkspaceHandoffRecordV1.mjs';
import {
  persistStephanosConversationCanvasWorkspaceHandoffV1,
} from './stephanosConversationCanvasWorkspaceHandoffPersistenceV1.mjs';
import { buildStephanosRichConversationalResponseV1 } from './stephanosRichConversationalResponseV1.mjs';

const NOW = new Date('2026-08-21T04:10:00.000Z');

function workspaceHandoffRecord() {
  const richResponse = buildStephanosRichConversationalResponseV1({
    question: {
      questionId: 'stephanos-round-001-q01',
      roundId: 'stephanos-round-001',
      questionClass: 'CURRENT_PROGRAMME_TRUTH',
    },
    answer: {
      answerText: 'The bounded private Conversation Canvas handoff is ready for persistence.',
      epistemicState: 'OBSERVED_FROM_RUNTIME_OR_PROOF',
      evidenceRefs: ['receipts/live-round-source'],
      freshness: 'FRESH',
      sourcesConsulted: ['live-goal-projection'],
      cannotAnswerReason: null,
      answerVerdict: 'ANSWERED_GROUNDED',
    },
    structured: {
      goalsMissions: [{
        ref: '#1308',
        label: 'Stephanos conversational intelligence',
        state: 'ACTIVE',
        evidenceRefs: ['receipts/live-round-source'],
      }],
      agentProviderContributions: [{
        contributorId: 'stephanos',
        contributionType: 'SYSTEM_SYNTHESIS',
        summary: 'Synthesised live durable truth.',
        evidenceRefs: ['receipts/live-round-source'],
      }],
      unknowns: [],
      options: [],
      recommendedAction: {
        actionId: 'action:present-canvas',
        label: 'Present through the existing Conversation Canvas',
        rationale: 'Reuse the canonical UI Agent presenter.',
        requiresApproval: 'NO',
        evidenceRefs: ['receipts/live-round-source'],
      },
      approvalState: {
        state: 'NOT_REQUIRED',
        approvalRef: '',
        evidenceRefs: ['receipts/live-round-source'],
      },
      visualisationCandidates: ['SYSTEM_MAP'],
    },
  });
  assert.equal(richResponse.valid, true, richResponse.errors.join(','));

  const canvasHandoff = buildStephanosConversationCanvasHandoffV1({
    richResponse,
    surface: 'ipad',
    state: 'READY',
    expandedSections: ['evidence'],
    prefersReducedMotion: true,
    statusMessage: 'Private presentation ready.',
  });
  assert.equal(canvasHandoff.valid, true, canvasHandoff.errors.join(','));

  const workspace = buildStephanosConversationCanvasWorkspaceHandoffRecordV1({
    canvasHandoff,
    timestampUtc: NOW.toISOString(),
    correlationId: 'stephanos-round-001',
    relatedIssue: '#1308',
    relatedPr: '#1896',
    proofRefs: ['receipts/live-round-source'],
  }, {
    nowMs: NOW.getTime(),
  });
  assert.equal(workspace.valid, true, workspace.errors.join(','));
  return workspace;
}

test('persists one already-validated private Canvas handoff through the existing Shared Workspace store', async () => {
  const workspace = workspaceHandoffRecord();
  const writes = [];
  const result = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    workspaceHandoffRecord: workspace,
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null }),
    writeAtomicJsonFn: async (root, segments, record, options) => {
      writes.push({ root, segments, record, options });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: JSON.stringify(record).length };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_PERSISTED');
  assert.equal(result.persisted, true);
  assert.equal(result.resumed, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].record.handoffId, workspace.record.handoffId);
  assert.deepEqual(writes[0].segments, workspace.workspaceSegments);
  assert.equal(result.publicProjection.handoffId, workspace.record.handoffId);
  assert.equal(result.publicProjection.bodyIncluded, false);
  assert.equal(result.publicProjection.rawAnswerIncluded, false);
  assert.equal('body' in result.publicProjection, false);
  assert.equal(result.authority.commandExecutionAllowed, false);
  assert.equal(result.authority.publicRelayProjectionAllowed, false);
});

test('treats an identical already-persisted handoff as an idempotent resume without rewriting it', async () => {
  const workspace = workspaceHandoffRecord();
  let writes = 0;
  const result = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    workspaceHandoffRecord: workspace,
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: true, reason: 'WORKSPACE_RECORD_READ', record: workspace.record }),
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_ALREADY_PERSISTED');
  assert.equal(result.resumed, true);
  assert.equal(writes, 0);
});

test('fails closed on an existing handoff identity conflict instead of overwriting durable presentation truth', async () => {
  const workspace = workspaceHandoffRecord();
  let writes = 0;
  const result = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    workspaceHandoffRecord: workspace,
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({
      ok: true,
      reason: 'WORKSPACE_RECORD_READ',
      record: { ...workspace.record, summary: 'Conflicting durable handoff.' },
    }),
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_CONFLICT');
  assert.deepEqual(result.errors, ['existing-workspace-handoff-conflict']);
  assert.equal(writes, 0);
});

test('rejects authority widening before any workspace read or write occurs', async () => {
  const workspace = workspaceHandoffRecord();
  let reads = 0;
  let writes = 0;
  const result = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    workspaceHandoffRecord: {
      ...workspace,
      authority: {
        ...workspace.authority,
        presenterActionExecutionAllowed: true,
      },
    },
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => {
      reads += 1;
      return { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_REJECTED');
  assert.ok(result.errors.includes('workspace-handoff-authority-must-remain-zero'));
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('rejects a forged outbox path before persistence', async () => {
  const workspace = workspaceHandoffRecord();
  const result = await persistStephanosConversationCanvasWorkspaceHandoffV1({
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    workspaceHandoffRecord: {
      ...workspace,
      workspaceSegments: ['outbox', 'different-handoff.json'],
    },
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null }),
    writeAtomicJsonFn: async () => ({ ok: true, reason: 'ATOMIC_JSON_WRITTEN' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'PRIVATE_CANVAS_WORKSPACE_HANDOFF_REJECTED');
  assert.ok(result.errors.includes('workspace-handoff-path-mismatch'));
});