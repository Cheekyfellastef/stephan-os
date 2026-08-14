import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ONE_CONVERSATION_SURFACE_SCHEMA_VERSION,
  buildOneConversationProjectionV1,
  planCrossSurfaceContinuationV1,
  projectOneConversationWorkspaceMessageV1,
  validateOneConversationInputV1,
} from './oneConversationSurfaceV1.mjs';

const NOW = '2026-08-14T12:30:00.000Z';

function baseInput(overrides = {}) {
  return {
    stephanosIdentityVersion: 'stephanos-identity-v1',
    operatorRelationshipContextRef: 'operator-context-stephan-v1',
    intentId: 'intent-product-1776',
    missionId: 'mission-product-completion-v1',
    memoryAuthorityRef: 'memory-authority-v1',
    timestampUtc: NOW,
    surfaceObservations: [
      {
        surface: 'CHATGPT_WEB',
        surfaceThreadRef: 'thread-chatgpt-web-1776',
        stephanosIdentityVersion: 'stephanos-identity-v1',
        intentId: 'intent-product-1776',
        missionId: 'mission-product-completion-v1',
        operatorRelationshipContextRef: 'operator-context-stephan-v1',
        memoryAuthorityRef: 'memory-authority-v1',
        timestampUtc: '2026-08-14T12:29:00.000Z',
        evidenceRefs: ['proofs/chatgpt-web-1776'],
        underlyingMind: 'OPENAI_PRIMARY',
        executionSurface: 'CHATGPT_WEB',
      },
      {
        surface: 'BATTLE_BRIDGE_DESKTOP',
        surfaceThreadRef: 'thread-battle-bridge-1776',
        stephanosIdentityVersion: 'stephanos-identity-v1',
        intentId: 'intent-product-1776',
        missionId: 'mission-product-completion-v1',
        operatorRelationshipContextRef: 'operator-context-stephan-v1',
        memoryAuthorityRef: 'memory-authority-v1',
        timestampUtc: '2026-08-14T12:28:00.000Z',
        evidenceRefs: ['proofs/battle-bridge-1776'],
        underlyingMind: 'LOCAL_OR_ROUTED',
        executionSurface: 'BATTLE_BRIDGE_DESKTOP',
      },
    ],
    ...overrides,
  };
}

test('same intent on ChatGPT web and Battle Bridge becomes one current Stephanos projection', () => {
  const projection = buildOneConversationProjectionV1(baseInput(), { nowMs: Date.parse(NOW) });

  assert.equal(projection.schemaVersion, ONE_CONVERSATION_SURFACE_SCHEMA_VERSION);
  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.intentId, 'intent-product-1776');
  assert.equal(projection.missionId, 'mission-product-completion-v1');
  assert.deepEqual(projection.activeSurfaces, ['BATTLE_BRIDGE_DESKTOP', 'CHATGPT_WEB']);
  assert.deepEqual(projection.surfaceFreshness, {
    BATTLE_BRIDGE_DESKTOP: 'CURRENT',
    CHATGPT_WEB: 'CURRENT',
  });
  assert.equal(projection.routeVisibility, 'HIDDEN_BY_DEFAULT');
  assert.equal('routeAudit' in projection, false);
  assert.equal(projection.operatorAction, 'NO_OPERATOR_ACTION_REQUIRED');
});

test('provider substitution remains audit detail and cannot change Stephanos identity', () => {
  const input = baseInput();
  input.surfaceObservations.push({
    surface: 'CHATGPT_WORK',
    surfaceThreadRef: 'thread-work-1776',
    stephanosIdentityVersion: 'stephanos-identity-v1',
    intentId: 'intent-product-1776',
    missionId: 'mission-product-completion-v1',
    operatorRelationshipContextRef: 'operator-context-stephan-v1',
    memoryAuthorityRef: 'memory-authority-v1',
    timestampUtc: '2026-08-14T12:29:30.000Z',
    evidenceRefs: ['proofs/work-1776'],
    underlyingMind: 'SPECIALIST_MODEL_B',
    executionSurface: 'CHATGPT_WORK',
  });

  const projection = buildOneConversationProjectionV1(input, {
    nowMs: Date.parse(NOW),
    includeRouteAudit: true,
  });

  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.stephanosIdentityVersion, 'stephanos-identity-v1');
  assert.equal(projection.routeVisibility, 'AUDIT_VISIBLE');
  assert.equal(projection.routeAudit.length, 3);
  assert.equal(projection.routeAudit.find((route) => route.surface === 'CHATGPT_WORK').underlyingMind, 'SPECIALIST_MODEL_B');
});

test('cross-surface continuation preserves mission, memory and relationship identity', () => {
  const projection = buildOneConversationProjectionV1(baseInput(), { nowMs: Date.parse(NOW) });
  const continuation = planCrossSurfaceContinuationV1(projection, {
    fromSurface: 'CHATGPT_WEB',
    toSurface: 'TABLET',
  });

  assert.equal(continuation.ok, true);
  assert.equal(continuation.verdict, 'ONE_CONVERSATION_CONTINUATION_READY');
  assert.equal(continuation.intentId, projection.intentId);
  assert.equal(continuation.missionId, projection.missionId);
  assert.equal(continuation.memoryAuthorityRef, projection.memoryAuthorityRef);
  assert.equal(continuation.operatorRelationshipContextRef, projection.operatorRelationshipContextRef);
  assert.equal(continuation.destinationThreadCreationRequired, true);
  assert.equal(continuation.carryOnlyBoundedContext, true);
  assert.equal(continuation.authority.commandExecutionAllowed, false);
});

test('voice and Quest are presentation surfaces and receive no mutation authority', () => {
  const projection = buildOneConversationProjectionV1(baseInput(), { nowMs: Date.parse(NOW) });

  for (const toSurface of ['VOICE', 'QUEST_3']) {
    const continuation = planCrossSurfaceContinuationV1(projection, {
      fromSurface: 'BATTLE_BRIDGE_DESKTOP',
      toSurface,
    });
    assert.equal(continuation.ok, true);
    assert.equal(continuation.authority.sourceMutationAllowed, false);
    assert.equal(continuation.authority.runtimeMutationAllowed, false);
    assert.equal(continuation.authority.approvalAllowed, false);
  }
});

test('conflicting mission evidence fails closed instead of merging chat-local realities', () => {
  const input = baseInput();
  input.surfaceObservations[1] = {
    ...input.surfaceObservations[1],
    missionId: 'different-mission',
  };

  const validation = validateOneConversationInputV1(input);
  const projection = buildOneConversationProjectionV1(input, { nowMs: Date.parse(NOW) });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('mission-conflict:1'));
  assert.equal(projection.status, 'EVIDENCE_CONFLICTING');
  assert.equal(projection.authority.mergeAllowed, false);
});

test('surface observations must prove all five continuity identities', () => {
  const input = baseInput();
  delete input.surfaceObservations[0].stephanosIdentityVersion;
  delete input.surfaceObservations[0].intentId;
  delete input.surfaceObservations[0].missionId;
  delete input.surfaceObservations[0].operatorRelationshipContextRef;
  delete input.surfaceObservations[0].memoryAuthorityRef;

  const validation = validateOneConversationInputV1(input);
  const projection = buildOneConversationProjectionV1(input, { nowMs: Date.parse(NOW) });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('missing-observation-stephanos-identity-version:0'));
  assert.ok(validation.errors.includes('missing-observation-intent-id:0'));
  assert.ok(validation.errors.includes('missing-observation-mission-id:0'));
  assert.ok(validation.errors.includes('missing-observation-relationship-context-ref:0'));
  assert.ok(validation.errors.includes('missing-observation-memory-authority-ref:0'));
  assert.equal(projection.status, 'UNKNOWN');
});

test('authority widening in a conversation projection is rejected', () => {
  const validation = validateOneConversationInputV1(baseInput({ mergeAllowed: true }));
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('authority-widening-forbidden:mergeAllowed'));
});

test('stale evidence blocks continuation rather than pretending continuity is current', () => {
  const input = baseInput({
    timestampUtc: '2026-08-14T15:00:00.000Z',
    surfaceObservations: baseInput().surfaceObservations.map((observation) => ({
      ...observation,
      timestampUtc: '2026-08-14T12:00:00.000Z',
    })),
  });
  const projection = buildOneConversationProjectionV1(input, {
    nowMs: Date.parse('2026-08-14T15:00:00.000Z'),
    staleAfterMs: 60 * 60 * 1000,
  });
  const continuation = planCrossSurfaceContinuationV1(projection, {
    fromSurface: 'CHATGPT_WEB',
    toSurface: 'PHONE',
  });

  assert.equal(projection.status, 'STALE');
  assert.equal(continuation.ok, false);
  assert.equal(continuation.verdict, 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN');
});

test('a fresh surface cannot make a stale source thread eligible for continuation', () => {
  const input = baseInput();
  input.surfaceObservations[1] = {
    ...input.surfaceObservations[1],
    timestampUtc: '2026-08-14T10:00:00.000Z',
  };
  const projection = buildOneConversationProjectionV1(input, {
    nowMs: Date.parse(NOW),
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.surfaceFreshness.CHATGPT_WEB, 'CURRENT');
  assert.equal(projection.surfaceFreshness.BATTLE_BRIDGE_DESKTOP, 'STALE');
  assert.equal(planCrossSurfaceContinuationV1(projection, {
    fromSurface: 'CHATGPT_WEB',
    toSurface: 'PHONE',
  }).ok, true);
  const blocked = planCrossSurfaceContinuationV1(projection, {
    fromSurface: 'BATTLE_BRIDGE_DESKTOP',
    toSurface: 'PHONE',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.verdict, 'CONTINUATION_BLOCKED_SOURCE_THREAD_STALE_OR_UNKNOWN');
});

test('omitting nowMs evaluates freshness against the current clock instead of the payload timestamp', () => {
  const old = baseInput({
    timestampUtc: '2000-01-01T00:10:00.000Z',
    surfaceObservations: baseInput().surfaceObservations.map((observation, index) => ({
      ...observation,
      timestampUtc: `2000-01-01T00:0${index + 1}:00.000Z`,
    })),
  });
  const projection = buildOneConversationProjectionV1(old, { staleAfterMs: 60 * 60 * 1000 });
  assert.equal(projection.status, 'STALE');
});

test('materially future-dated evidence fails closed instead of extending freshness', () => {
  const input = baseInput();
  input.surfaceObservations[0] = {
    ...input.surfaceObservations[0],
    timestampUtc: '2026-08-14T13:30:01.000Z',
  };
  const projection = buildOneConversationProjectionV1(input, {
    nowMs: Date.parse(NOW),
    maxFutureSkewMs: 5 * 60 * 1000,
  });

  assert.equal(projection.status, 'UNKNOWN');
  assert.equal(projection.reason, 'FUTURE_DATED_OBSERVATION');
  assert.equal(projection.surfaceFreshness.CHATGPT_WEB, 'UNKNOWN');
  assert.equal(planCrossSurfaceContinuationV1(projection, {
    fromSurface: 'BATTLE_BRIDGE_DESKTOP',
    toSurface: 'PHONE',
  }).ok, false);
});

test('current projection becomes a valid read-only Shared Workspace message', () => {
  const projection = buildOneConversationProjectionV1(baseInput(), { nowMs: Date.parse(NOW) });
  const result = projectOneConversationWorkspaceMessageV1(projection, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-intent-product-1776',
    relatedIssue: '#1630',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: { nowMs: Date.parse(NOW) },
  });

  assert.equal(result.ok, true);
  assert.equal(result.workspaceValidation.valid, true);
  assert.equal(result.workspaceValidation.stale, false);
  assert.equal(result.record.participantId, 'stephanos');
  assert.equal(result.record.channel, 'one-conversation-surface');
  const body = JSON.parse(result.record.body);
  assert.equal(body.intentId, 'intent-product-1776');
  assert.equal(body.surfaceFreshness.CHATGPT_WEB, 'CURRENT');
  assert.equal(body.authority.commandExecutionAllowed, false);
  assert.equal(body.authority.mergeAllowed, false);
  assert.equal(body.authority.runtimeMutationAllowed, false);
});

test('stale Shared Workspace continuity messages are not reported ready', () => {
  const projection = buildOneConversationProjectionV1(baseInput(), { nowMs: Date.parse(NOW) });
  const result = projectOneConversationWorkspaceMessageV1(projection, {
    timestampUtc: '2026-08-14T10:00:00.000Z',
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-stale-intent-product-1776',
    relatedIssue: '#1630',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: {
      nowMs: Date.parse(NOW),
      staleAfterMs: 60 * 60 * 1000,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_WORKSPACE_RECORD_STALE');
  assert.equal(result.workspaceValidation.valid, true);
  assert.equal(result.workspaceValidation.stale, true);
});

test('unsupported surfaces are rejected without inventing another front door', () => {
  const input = baseInput();
  input.surfaceObservations[0] = {
    ...input.surfaceObservations[0],
    surface: 'UNREGISTERED_CHAT',
  };

  const validation = validateOneConversationInputV1(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('unsupported-surface:0'));
});
