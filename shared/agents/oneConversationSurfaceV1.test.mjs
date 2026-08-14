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
const NOW_MS = Date.parse(NOW);

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

function currentProjection(options = {}) {
  return buildOneConversationProjectionV1(baseInput(), { nowMs: NOW_MS, ...options });
}

function plan(projection, input, nowMs = NOW_MS) {
  return planCrossSurfaceContinuationV1(projection, input, { nowMs });
}

test('same intent on ChatGPT web and Battle Bridge becomes one current Stephanos projection', () => {
  const projection = currentProjection();
  assert.equal(projection.schemaVersion, ONE_CONVERSATION_SURFACE_SCHEMA_VERSION);
  assert.equal(projection.status, 'CURRENT');
  assert.deepEqual(projection.activeSurfaces, ['BATTLE_BRIDGE_DESKTOP', 'CHATGPT_WEB']);
  assert.deepEqual(projection.surfaceFreshness, {
    BATTLE_BRIDGE_DESKTOP: 'CURRENT',
    CHATGPT_WEB: 'CURRENT',
  });
  assert.equal(projection.evaluatedAtUtc, NOW);
  assert.equal(projection.operatorAction, 'NO_OPERATOR_ACTION_REQUIRED');
});

test('provider substitution remains audit detail and cannot change Stephanos identity', () => {
  const input = baseInput();
  input.surfaceObservations.push({
    ...input.surfaceObservations[0],
    surface: 'CHATGPT_WORK',
    surfaceThreadRef: 'thread-work-1776',
    timestampUtc: '2026-08-14T12:29:30.000Z',
    evidenceRefs: ['proofs/work-1776'],
    underlyingMind: 'SPECIALIST_MODEL_B',
    executionSurface: 'CHATGPT_WORK',
  });
  const projection = buildOneConversationProjectionV1(input, { nowMs: NOW_MS, includeRouteAudit: true });
  assert.equal(projection.status, 'CURRENT');
  assert.equal(projection.stephanosIdentityVersion, 'stephanos-identity-v1');
  assert.equal(projection.routeVisibility, 'AUDIT_VISIBLE');
  assert.equal(projection.routeAudit.find((route) => route.surface === 'CHATGPT_WORK').underlyingMind, 'SPECIALIST_MODEL_B');
});

test('cross-surface continuation re-proves current source evidence and preserves all continuity identities', () => {
  const projection = currentProjection();
  const continuation = plan(projection, { fromSurface: 'CHATGPT_WEB', toSurface: 'TABLET' });
  assert.equal(continuation.ok, true);
  assert.equal(continuation.verdict, 'ONE_CONVERSATION_CONTINUATION_READY');
  assert.equal(continuation.stephanosIdentityVersion, projection.stephanosIdentityVersion);
  assert.equal(continuation.operatorRelationshipContextRef, projection.operatorRelationshipContextRef);
  assert.equal(continuation.intentId, projection.intentId);
  assert.equal(continuation.missionId, projection.missionId);
  assert.equal(continuation.memoryAuthorityRef, projection.memoryAuthorityRef);
  assert.equal(continuation.destinationThreadCreationRequired, true);
  assert.equal(continuation.authority.commandExecutionAllowed, false);
});

test('voice and Quest remain presentation surfaces with zero mutation authority', () => {
  const projection = currentProjection();
  for (const toSurface of ['VOICE', 'QUEST_3']) {
    const continuation = plan(projection, { fromSurface: 'BATTLE_BRIDGE_DESKTOP', toSurface });
    assert.equal(continuation.ok, true);
    assert.equal(continuation.authority.sourceMutationAllowed, false);
    assert.equal(continuation.authority.runtimeMutationAllowed, false);
    assert.equal(continuation.authority.approvalAllowed, false);
    assert.equal(continuation.authority.mergeAllowed, false);
  }
});

test('conflicting mission evidence fails closed', () => {
  const input = baseInput();
  input.surfaceObservations[1] = { ...input.surfaceObservations[1], missionId: 'different-mission' };
  const validation = validateOneConversationInputV1(input);
  const projection = buildOneConversationProjectionV1(input, { nowMs: NOW_MS });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('mission-conflict:1'));
  assert.equal(projection.status, 'EVIDENCE_CONFLICTING');
});

test('surface observations must prove all five continuity identities', () => {
  const input = baseInput();
  for (const field of ['stephanosIdentityVersion', 'intentId', 'missionId', 'operatorRelationshipContextRef', 'memoryAuthorityRef']) {
    delete input.surfaceObservations[0][field];
  }
  const validation = validateOneConversationInputV1(input);
  assert.equal(validation.valid, false);
  assert.equal(buildOneConversationProjectionV1(input, { nowMs: NOW_MS }).status, 'UNKNOWN');
});

test('null observations and malformed proof containers fail closed without throwing', () => {
  for (const surfaceObservations of [
    [null],
    [{ ...baseInput().surfaceObservations[0], evidenceRefs: 'proofs/not-an-array' }],
    [{ ...baseInput().surfaceObservations[0], evidenceRefs: [null] }],
  ]) {
    const input = baseInput({ surfaceObservations });
    assert.doesNotThrow(() => validateOneConversationInputV1(input));
    assert.equal(validateOneConversationInputV1(input).valid, false);
    assert.equal(buildOneConversationProjectionV1(input, { nowMs: NOW_MS }).status, 'UNKNOWN');
  }
});

test('unsafe observation proof references never become continuity evidence', () => {
  const input = baseInput();
  input.surfaceObservations[0] = { ...input.surfaceObservations[0], evidenceRefs: ['../secret.json'] };
  const validation = validateOneConversationInputV1(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('observation-evidenceRefs-invalid:0'));
  assert.equal(buildOneConversationProjectionV1(input, { nowMs: NOW_MS }).status, 'UNKNOWN');
});

test('numeric continuity identities are rejected rather than stringified', () => {
  const input = baseInput({ stephanosIdentityVersion: 123 });
  assert.equal(validateOneConversationInputV1(input).valid, false);
  const projection = currentProjection();
  const tampered = { ...projection, memoryAuthorityRef: 123 };
  assert.equal(plan(tampered, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' }).verdict, 'CONTINUATION_BLOCKED_IDENTITY_INCOMPLETE');
  const publication = projectOneConversationWorkspaceMessageV1(tampered, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'numeric-identity-block',
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(publication.ok, false);
  assert.equal(publication.reason, 'ONE_CONVERSATION_PROJECTION_IDENTITY_INCOMPLETE');
});

test('authority widening in input is rejected', () => {
  const validation = validateOneConversationInputV1(baseInput({ mergeAllowed: true }));
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('authority-widening-forbidden:mergeAllowed'));
});

test('stale evidence blocks continuation', () => {
  const input = baseInput({
    timestampUtc: '2026-08-14T15:00:00.000Z',
    surfaceObservations: baseInput().surfaceObservations.map((observation) => ({ ...observation, timestampUtc: '2026-08-14T12:00:00.000Z' })),
  });
  const projection = buildOneConversationProjectionV1(input, { nowMs: Date.parse('2026-08-14T15:00:00.000Z') });
  assert.equal(projection.status, 'STALE');
  assert.equal(plan(projection, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' }, Date.parse('2026-08-14T15:00:00.000Z')).ok, false);
});

test('one fresh surface cannot make a stale source thread eligible', () => {
  const input = baseInput();
  input.surfaceObservations[1] = { ...input.surfaceObservations[1], timestampUtc: '2026-08-14T10:00:00.000Z' };
  const projection = buildOneConversationProjectionV1(input, { nowMs: NOW_MS });
  assert.equal(projection.status, 'CURRENT');
  assert.equal(plan(projection, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' }).ok, true);
  const blocked = plan(projection, { fromSurface: 'BATTLE_BRIDGE_DESKTOP', toSurface: 'PHONE' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.verdict, 'CONTINUATION_BLOCKED_SOURCE_THREAD_STALE_OR_UNKNOWN');
});

test('persisted CURRENT projections are re-evaluated before continuation', () => {
  const projection = currentProjection();
  const late = plan(projection, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' }, Date.parse('2026-08-14T15:00:00.000Z'));
  assert.equal(late.ok, false);
  assert.equal(late.verdict, 'CONTINUATION_BLOCKED_STALE_OR_UNKNOWN');
});

test('persisted projections with unsafe proof refs cannot authorize continuation', () => {
  const projection = currentProjection();
  const tampered = { ...projection, evidenceRefs: ['../secret.json'] };
  const result = plan(tampered, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'CONTINUATION_BLOCKED_PROOF_EVIDENCE_INVALID');
});

test('M1 builder freshness policy is fixed and ignores caller duration overrides', () => {
  const projection = currentProjection({ staleAfterMs: 5 * 60 * 1000, maxFutureSkewMs: 60 * 60 * 1000 });
  assert.equal(projection.staleAfterMs, 60 * 60 * 1000);
  assert.equal(projection.maxFutureSkewMs, 5 * 60 * 1000);
});

test('persisted stale-duration widening cannot revive a reconstructed projection', () => {
  const projection = currentProjection();
  const tampered = { ...projection, staleAfterMs: 24 * 60 * 60 * 1000 };
  const continuation = plan(tampered, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' });
  assert.equal(continuation.ok, false);
  assert.equal(continuation.verdict, 'CONTINUATION_BLOCKED_FRESHNESS_POLICY_INVALID');
  const publication = projectOneConversationWorkspaceMessageV1(tampered, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'widened-stale-policy',
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(publication.ok, false);
  assert.equal(publication.reason, 'ONE_CONVERSATION_PROJECTION_FRESHNESS_POLICY_INVALID');
});

test('persisted future-skew widening cannot re-admit future observations', () => {
  const projection = currentProjection();
  const tampered = { ...projection, maxFutureSkewMs: 60 * 60 * 1000 };
  const continuation = plan(tampered, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' });
  assert.equal(continuation.ok, false);
  assert.equal(continuation.verdict, 'CONTINUATION_BLOCKED_FRESHNESS_POLICY_INVALID');
  const publication = projectOneConversationWorkspaceMessageV1(tampered, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'widened-future-policy',
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(publication.ok, false);
  assert.equal(publication.reason, 'ONE_CONVERSATION_PROJECTION_FRESHNESS_POLICY_INVALID');
});

test('materially future-dated evidence fails closed', () => {
  const input = baseInput();
  input.surfaceObservations[0] = { ...input.surfaceObservations[0], timestampUtc: '2026-08-14T13:30:01.000Z' };
  const projection = buildOneConversationProjectionV1(input, { nowMs: NOW_MS });
  assert.equal(projection.status, 'UNKNOWN');
  assert.equal(projection.reason, 'FUTURE_DATED_OBSERVATION');
});

test('current projection becomes a valid read-only Shared Workspace message', () => {
  const projection = currentProjection();
  const result = projectOneConversationWorkspaceMessageV1(projection, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-intent-product-1776',
    relatedIssue: '#1630',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(result.ok, true);
  assert.equal(result.workspaceValidation.valid, true);
  const body = JSON.parse(result.record.body);
  assert.equal(body.intentId, 'intent-product-1776');
  assert.equal(body.authority.commandExecutionAllowed, false);
  assert.equal(body.authority.mergeAllowed, false);
});

test('publication rechecks retained evidence and blocks stale continuity', () => {
  const projection = currentProjection();
  const publicationNow = '2026-08-14T15:00:00.000Z';
  const result = projectOneConversationWorkspaceMessageV1(projection, {
    timestampUtc: publicationNow,
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-late-publication',
    workspaceValidationOptions: { nowMs: Date.parse(publicationNow) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_PROJECTION_EVIDENCE_STALE_AT_PUBLICATION');
});

test('future-dated Shared Workspace envelopes fail closed', () => {
  const result = projectOneConversationWorkspaceMessageV1(currentProjection(), {
    timestampUtc: '2027-08-14T12:30:00.000Z',
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-future-envelope',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_WORKSPACE_RECORD_FUTURE_DATED');
});

test('publication rejects unsafe or non-string caller and retained proof refs', () => {
  for (const proofRefs of [[null], ['../secret.json']]) {
    const caller = projectOneConversationWorkspaceMessageV1(currentProjection(), {
      timestampUtc: NOW,
      correlationId: 'intent-product-1776',
      messageId: 'invalid-caller-proof',
      proofRefs,
      workspaceValidationOptions: { nowMs: NOW_MS },
    });
    assert.equal(caller.ok, false);
    assert.equal(caller.reason, 'ONE_CONVERSATION_MESSAGE_PROOF_REFS_INVALID');
  }
  for (const evidenceRefs of [[null], ['../secret.json']]) {
    const retained = projectOneConversationWorkspaceMessageV1({ ...currentProjection(), evidenceRefs }, {
      timestampUtc: NOW,
      correlationId: 'intent-product-1776',
      messageId: 'invalid-retained-proof',
      proofRefs: ['proofs/one-conversation-m1'],
      workspaceValidationOptions: { nowMs: NOW_MS },
    });
    assert.equal(retained.ok, false);
    assert.equal(retained.reason, 'ONE_CONVERSATION_PROJECTION_PROOF_REFS_INVALID');
  }
});

test('publication and continuation reject inconsistent retained surface sets', () => {
  const projection = currentProjection();
  const tampered = {
    ...projection,
    activeSurfaces: ['CHATGPT_WEB'],
    surfaceThreadRefs: { CHATGPT_WEB: projection.surfaceThreadRefs.CHATGPT_WEB },
    surfaceObservedAt: {
      CHATGPT_WEB: '2026-08-14T10:00:00.000Z',
      PHONE: '2026-08-14T12:29:59.000Z',
    },
  };
  assert.equal(plan(tampered, { fromSurface: 'CHATGPT_WEB', toSurface: 'PHONE' }).verdict, 'CONTINUATION_BLOCKED_SURFACE_SET_INCONSISTENT');
  const result = projectOneConversationWorkspaceMessageV1(tampered, {
    timestampUtc: NOW,
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-injected-freshness',
    workspaceValidationOptions: { nowMs: NOW_MS },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_PROJECTION_SURFACE_SET_INCONSISTENT');
});

test('stale Shared Workspace envelopes are not reported ready', () => {
  const result = projectOneConversationWorkspaceMessageV1(currentProjection(), {
    timestampUtc: '2026-08-14T10:00:00.000Z',
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-stale',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: { nowMs: NOW_MS, staleAfterMs: 60 * 60 * 1000 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_WORKSPACE_RECORD_STALE');
});

test('caller cannot widen stale Shared Workspace envelope window', () => {
  const result = projectOneConversationWorkspaceMessageV1(currentProjection(), {
    timestampUtc: '2026-08-14T10:00:00.000Z',
    correlationId: 'intent-product-1776',
    messageId: 'one-conversation-stale-widened-window',
    proofRefs: ['proofs/one-conversation-m1'],
    workspaceValidationOptions: { nowMs: NOW_MS, staleAfterMs: 24 * 60 * 60 * 1000 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ONE_CONVERSATION_WORKSPACE_RECORD_STALE');
  assert.equal(result.workspaceValidation.valid, true);
  assert.equal(result.workspaceValidation.stale, true);
});

test('unsupported surfaces are rejected without inventing another front door', () => {
  const input = baseInput();
  input.surfaceObservations[0] = { ...input.surfaceObservations[0], surface: 'UNREGISTERED_CHAT' };
  const validation = validateOneConversationInputV1(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('unsupported-surface:0'));
});