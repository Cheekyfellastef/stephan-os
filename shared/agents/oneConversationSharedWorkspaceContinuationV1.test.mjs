import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOneConversationProjectionV1,
} from './oneConversationSurfaceV1.mjs';
import {
  createOneConversationContinuationAcceptanceV1,
  createOneConversationContinuationRequestV1,
  validateOneConversationContinuationAcceptanceV1,
  validateOneConversationContinuationRequestV1,
} from './oneConversationSharedWorkspaceContinuationV1.mjs';
import {
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

process.env.NODE_TEST_CONTEXT = '1';

const NOW_MS = Date.parse('2026-08-15T03:30:00.000Z');
const NOW_UTC = new Date(NOW_MS).toISOString();

const IDENTITIES = Object.freeze({
  stephanosIdentityVersion: 'stephanos-identity-v1',
  operatorRelationshipContextRef: 'operator-context-v1',
  intentId: 'intent-one-conversation-v1',
  missionId: 'mission-one-conversation-v1',
  memoryAuthorityRef: 'memory-authority-v1',
});

function observation(surface, thread, proof, timestampUtc = NOW_UTC) {
  return {
    surface,
    surfaceThreadRef: thread,
    ...IDENTITIES,
    timestampUtc,
    evidenceRefs: [proof],
    underlyingMind: 'STEPHANOS',
    executionSurface: surface,
  };
}

function projection({ includeDestination = false, sourceTimestampUtc = NOW_UTC } = {}) {
  const surfaceObservations = [observation('CHATGPT_WEB', 'thread-chatgpt-web-v1', 'receipts/chatgpt-web-proof-v1', sourceTimestampUtc)];
  if (includeDestination) surfaceObservations.push(observation('BATTLE_BRIDGE_DESKTOP', 'thread-battle-bridge-v1', 'receipts/battle-bridge-proof-v1'));
  return buildOneConversationProjectionV1({
    ...IDENTITIES,
    timestampUtc: NOW_UTC,
    surfaceObservations,
  }, { nowMs: NOW_MS });
}

function requestInput(overrides = {}) {
  return {
    projection: projection(),
    fromSurface: 'CHATGPT_WEB',
    toSurface: 'BATTLE_BRIDGE_DESKTOP',
    timestampUtc: NOW_UTC,
    relatedIssue: '#1630',
    requestProofRefs: [],
    ...overrides,
  };
}

function buildRequest(overrides = {}) {
  return createOneConversationContinuationRequestV1(requestInput(overrides), { nowMs: NOW_MS });
}

function buildAcceptance(requestRecord, overrides = {}) {
  return createOneConversationContinuationAcceptanceV1({
    requestRecord,
    destinationThreadRef: 'thread-battle-bridge-new-v1',
    destinationObservedAtUtc: NOW_UTC,
    proofRefs: ['receipts/battle-bridge-destination-proof-v1'],
    ...overrides,
  }, { nowMs: NOW_MS });
}

test('creates one existing-kind Shared Workspace continuation request from the M1 planner', () => {
  const result = buildRequest();
  assert.equal(result.ok, true);
  assert.equal(result.plan.ok, true);
  assert.equal(result.plan.verdict, 'ONE_CONVERSATION_CONTINUATION_READY');
  assert.equal(result.record.kind, 'stephanos.shared_workspace.record.message');
  assert.equal(result.record.channel, 'one-conversation-continuation');
  assert.equal(result.record.recordSubtype, 'continuation-request');
  assert.deepEqual(result.record.proofRefs, ['receipts/chatgpt-web-proof-v1']);
  assert.equal(validateSharedWorkspaceRecord(result.record, { nowMs: NOW_MS }).valid, true);

  const body = JSON.parse(result.record.body);
  assert.equal(body.stephanosIdentityVersion, IDENTITIES.stephanosIdentityVersion);
  assert.equal(body.operatorRelationshipContextRef, IDENTITIES.operatorRelationshipContextRef);
  assert.equal(body.intentId, IDENTITIES.intentId);
  assert.equal(body.missionId, IDENTITIES.missionId);
  assert.equal(body.memoryAuthorityRef, IDENTITIES.memoryAuthorityRef);
  assert.equal(body.sourceThreadRef, 'thread-chatgpt-web-v1');
  assert.equal(body.destinationThreadCreationRequired, true);
  assert.equal(body.knownDestinationThreadRef, '');
  assert.deepEqual(body.sourceProofRefs, ['receipts/chatgpt-web-proof-v1']);
  assert.equal(body.carryOnlyBoundedContext, true);
});

test('request identity and packet are deterministic and idempotent for identical canonical content', () => {
  const first = buildRequest();
  const second = buildRequest();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.requestId, second.requestId);
  assert.equal(first.record.body, second.record.body);
  assert.deepEqual(first.record.proofRefs, second.record.proofRefs);
  assert.equal(validateOneConversationContinuationRequestV1(first.record, { nowMs: NOW_MS }).ok, true);
});

test('destination acceptance proves a new destination thread before a read-only receipt is produced', () => {
  const request = buildRequest();
  const acceptance = buildAcceptance(request.record);
  assert.equal(acceptance.ok, true);
  assert.equal(validateSharedWorkspaceRecord(acceptance.record, { nowMs: NOW_MS }).valid, true);

  const result = validateOneConversationContinuationAcceptanceV1({
    requestRecord: request.record,
    acceptanceRecord: acceptance.record,
  }, { nowMs: NOW_MS });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.state, 'CONTINUATION_ACCEPTED_READ_ONLY');
  assert.equal(result.receipt.sourceThreadRef, 'thread-chatgpt-web-v1');
  assert.equal(result.receipt.destinationThreadRef, 'thread-battle-bridge-new-v1');
  assert.deepEqual(result.receipt.sourceProofRefs, ['receipts/chatgpt-web-proof-v1']);
  assert.deepEqual(result.receipt.destinationProofRefs, ['receipts/battle-bridge-destination-proof-v1']);
  for (const value of Object.values(result.receipt.authority).filter((value) => typeof value === 'boolean')) assert.equal(value, false);
});

test('an already-known destination thread is bound exactly and retains its M1 proof lineage', () => {
  const request = createOneConversationContinuationRequestV1(requestInput({ projection: projection({ includeDestination: true }) }), { nowMs: NOW_MS });
  assert.equal(request.ok, true);
  const body = JSON.parse(request.record.body);
  assert.equal(body.destinationThreadCreationRequired, false);
  assert.equal(body.knownDestinationThreadRef, 'thread-battle-bridge-v1');
  assert.deepEqual(body.knownDestinationProofRefs, ['receipts/battle-bridge-proof-v1']);

  const mismatch = buildAcceptance(request.record);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'acceptance-known-destination-thread-mismatch');

  const acceptance = buildAcceptance(request.record, { destinationThreadRef: 'thread-battle-bridge-v1' });
  assert.equal(acceptance.ok, true);
  const validated = validateOneConversationContinuationAcceptanceV1({ requestRecord: request.record, acceptanceRecord: acceptance.record }, { nowMs: NOW_MS });
  assert.equal(validated.ok, true);
  assert.equal(validated.receipt.destinationThreadRef, 'thread-battle-bridge-v1');
});

test('conflicting replay under a retained request identity fails content-address validation', () => {
  const request = buildRequest();
  const body = JSON.parse(request.record.body);
  body.toSurface = 'TABLET';
  const conflicting = { ...request.record, body: JSON.stringify(body) };
  const checked = validateOneConversationContinuationRequestV1(conflicting, { nowMs: NOW_MS });
  assert.equal(checked.ok, false);
  assert.equal(checked.errors.includes('request-content-identity-mismatch'), true);
});

test('all five continuity identity substitutions fail acceptance lineage', () => {
  for (const key of Object.keys(IDENTITIES)) {
    const request = buildRequest();
    const acceptance = buildAcceptance(request.record);
    const body = JSON.parse(acceptance.record.body);
    body[key] = `${body[key]}-substituted`;
    const tampered = { ...acceptance.record, body: JSON.stringify(body) };
    const checked = validateOneConversationContinuationAcceptanceV1({ requestRecord: request.record, acceptanceRecord: tampered }, { nowMs: NOW_MS });
    assert.equal(checked.ok, false, key);
    assert.equal(checked.errors.some((error) => error.includes(`${key}-substitution`) || error === 'acceptance-content-identity-mismatch'), true, key);
  }
});

test('request, correlation, surface and thread mismatches fail closed', () => {
  const request = buildRequest();
  const acceptance = buildAcceptance(request.record);
  const cases = [
    { ...acceptance.record, correlationId: 'wrong-request-id' },
    { ...acceptance.record, participantId: 'other-participant' },
    { ...acceptance.record, recordSubtype: 'continuation-request' },
  ];
  for (const tampered of cases) {
    const checked = validateOneConversationContinuationAcceptanceV1({ requestRecord: request.record, acceptanceRecord: tampered }, { nowMs: NOW_MS });
    assert.equal(checked.ok, false);
  }

  const body = JSON.parse(acceptance.record.body);
  body.sourceThreadRef = 'wrong-source-thread';
  const wrongThread = { ...acceptance.record, body: JSON.stringify(body) };
  assert.equal(validateOneConversationContinuationAcceptanceV1({ requestRecord: request.record, acceptanceRecord: wrongThread }, { nowMs: NOW_MS }).ok, false);
});

test('stale and future source or destination evidence cannot produce continuation truth', () => {
  const staleUtc = new Date(NOW_MS - 2 * 60 * 60 * 1000).toISOString();
  const futureUtc = new Date(NOW_MS + 10 * 60 * 1000).toISOString();
  const staleRequest = createOneConversationContinuationRequestV1(requestInput({
    projection: projection({ sourceTimestampUtc: staleUtc }),
  }), { nowMs: NOW_MS });
  assert.equal(staleRequest.ok, false);

  const futureRequest = createOneConversationContinuationRequestV1(requestInput({ timestampUtc: futureUtc }), { nowMs: NOW_MS });
  assert.equal(futureRequest.ok, false);

  const request = buildRequest();
  assert.equal(buildAcceptance(request.record, { destinationObservedAtUtc: futureUtc }).ok, false);
  assert.equal(buildAcceptance(request.record, { destinationObservedAtUtc: staleUtc }).ok, false);
});

test('missing, unsafe and replacement proof evidence is rejected while canonical M1 source proof is retained', () => {
  const unsafe = buildRequest({ requestProofRefs: ['../../secret'] });
  assert.equal(unsafe.ok, false);

  const request = buildRequest({ requestProofRefs: ['receipts/request-extra-proof-v1'] });
  assert.equal(request.ok, true);
  assert.deepEqual(request.record.proofRefs, ['receipts/chatgpt-web-proof-v1', 'receipts/request-extra-proof-v1']);

  const missingDestination = createOneConversationContinuationAcceptanceV1({
    requestRecord: request.record,
    destinationThreadRef: 'thread-battle-bridge-new-v1',
    destinationObservedAtUtc: NOW_UTC,
    proofRefs: [],
  }, { nowMs: NOW_MS });
  assert.equal(missingDestination.ok, false);
});

test('authority smuggling is rejected at top-level and nested boundaries', () => {
  const topLevel = requestInput();
  topLevel.sourceMutationAllowed = true;
  assert.equal(createOneConversationContinuationRequestV1(topLevel, { nowMs: NOW_MS }).ok, false);

  const baseProjection = projection();
  const hostileProjection = { ...baseProjection, authority: { ...baseProjection.authority, mergeAllowed: true } };
  const nested = createOneConversationContinuationRequestV1(requestInput({ projection: hostileProjection }), { nowMs: NOW_MS });
  assert.equal(nested.ok, false);
  assert.equal(nested.reason, 'authority-widening-forbidden:mergeAllowed');
});

test('descriptor-safe capture rejects accessors and toJSON without invoking caller code', () => {
  let getterCalls = 0;
  const hostileProjection = { ...projection() };
  Object.defineProperty(hostileProjection, 'missionId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const accessorResult = createOneConversationContinuationRequestV1(requestInput({ projection: hostileProjection }), { nowMs: NOW_MS });
  assert.equal(accessorResult.ok, false);
  assert.equal(getterCalls, 0);

  const withToJson = { ...projection(), toJSON() { throw new Error('must not execute'); } };
  const toJsonResult = createOneConversationContinuationRequestV1(requestInput({ projection: withToJson }), { nowMs: NOW_MS });
  assert.equal(toJsonResult.ok, false);
});

test('symbol, cycle, sparse array, custom prototype and revoked proxy inputs fail closed', () => {
  const symbolProjection = { ...projection() };
  symbolProjection[Symbol('hidden')] = 'x';
  assert.equal(createOneConversationContinuationRequestV1(requestInput({ projection: symbolProjection }), { nowMs: NOW_MS }).ok, false);

  const cycleProjection = { ...projection() };
  cycleProjection.loop = cycleProjection;
  assert.equal(createOneConversationContinuationRequestV1(requestInput({ projection: cycleProjection }), { nowMs: NOW_MS }).ok, false);

  const sparseProofs = new Array(1);
  assert.equal(createOneConversationContinuationRequestV1(requestInput({ requestProofRefs: sparseProofs }), { nowMs: NOW_MS }).ok, false);

  const customInput = requestInput();
  Object.setPrototypeOf(customInput, { inherited: true });
  assert.equal(createOneConversationContinuationRequestV1(customInput, { nowMs: NOW_MS }).ok, false);

  const target = { ...projection() };
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  assert.doesNotThrow(() => createOneConversationContinuationRequestV1(requestInput({ projection: proxy }), { nowMs: NOW_MS }));
  assert.equal(createOneConversationContinuationRequestV1(requestInput({ projection: proxy }), { nowMs: NOW_MS }).ok, false);
});

test('packets carry bounded references only and no transcript, secret, local path, shell or provider token', () => {
  const request = buildRequest();
  const acceptance = buildAcceptance(request.record);
  assert.equal(request.ok, true);
  assert.equal(acceptance.ok, true);
  const serialized = `${JSON.stringify(request.record)}\n${JSON.stringify(acceptance.record)}`;
  assert.equal(/transcript|rawPrompt|rawResponse|password|credential|api[_-]?key|providerToken|commandLine|powershell|cmd\.exe/i.test(serialized), false);
  assert.equal(/[A-Za-z]:\\|\\\\|\/(?:Users|home|root)\//.test(serialized), false);
});
