import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectStephanosAiResponseForWorkspaceV1,
} from './stephanosSharedParticipantLiveQaResponseProjectionV1.mjs';

test('AI response projection ignores bulky unrelated provider envelope material', () => {
  const providerRaw = Object.fromEntries(
    Array.from({ length: 3000 }, (_, index) => [`provider-field-${index}`, { nested: ['unused', index] }]),
  );
  const result = projectStephanosAiResponseForWorkspaceV1({
    success: true,
    output_text: 'A safe answer survives projection.',
    data: {
      execution_metadata: {
        retrieval_used: true,
        retrieved_sources: ['goal:#1308'],
        freshness_integrity_preserved: true,
      },
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        generatedAt: '2026-08-23T12:00:00.000Z',
        projectionSource: 'live-goal-projection-service',
        sourceTruth: 'live',
        backendStatus: { ok: true, status: 'live', unrelated: providerRaw },
        heartbeat: {
          generatedAt: '2026-08-23T12:00:00.000Z',
          projectionSource: 'live-goal-projection-service',
          backendLive: true,
          unrelated: providerRaw,
        },
        missionOperationsStatus: { status: 'ready', unrelated: providerRaw },
        proofTruth: { github: 'adapter-provided', local: 'unknown', browser: 'unknown', unrelated: providerRaw },
        unrelated: providerRaw,
      },
      request_trace: { requestId: 'request-1308', unrelated: providerRaw },
      unrelated: providerRaw,
    },
    debug: { request_id: 'request-1308', unrelated: providerRaw },
    memory_hits: [],
    provider_raw: providerRaw,
    provider_diagnostics: providerRaw,
    assistant_context: providerRaw,
  });

  assert.equal(result.valid, true, result.errors?.join(','));
  assert.equal(result.response.output_text, 'A safe answer survives projection.');
  assert.equal(Object.hasOwn(result.response, 'provider_raw'), false);
  assert.deepEqual(result.response.data.execution_metadata.retrieved_sources, ['goal:#1308']);
  assert.equal(result.response.data.liveGoalProjection.proofTruth.github, 'adapter-provided');
  assert.equal(result.response.data.liveGoalProjection.proofTruth.local, 'unknown');
  assert.equal(result.response.data.liveGoalProjection.proofTruth.browser, 'unknown');
  assert.deepEqual(Object.keys(result.response.data.liveGoalProjection.proofTruth), ['browser', 'github', 'local']);
});

test('AI response projection never invokes consumed-field accessors', () => {
  let accessorCalls = 0;
  const rawResponse = { success: true };
  Object.defineProperty(rawResponse, 'output_text', {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return 'must not execute';
    },
  });

  const result = projectStephanosAiResponseForWorkspaceV1(rawResponse);
  assert.equal(result.valid, false);
  assert.equal(accessorCalls, 0);
  assert.deepEqual(result.errors, ['ai-response.output_text-must-be-own-enumerable-data']);
});

test('AI response projection bounds consumed arrays while ignoring unrelated oversized arrays', () => {
  const result = projectStephanosAiResponseForWorkspaceV1({
    success: true,
    output_text: 'Bounded answer.',
    data: {
      execution_metadata: {
        retrieval_used: true,
        retrieved_sources: Array.from({ length: 1000 }, (_, index) => `source-${index}`),
      },
    },
    memory_hits: [],
    provider_raw: Array.from({ length: 10000 }, (_, index) => index),
  });

  assert.equal(result.valid, true, result.errors?.join(','));
  assert.equal(result.response.data.execution_metadata.retrieved_sources.length, 8);
  assert.equal(Object.hasOwn(result.response, 'provider_raw'), false);
});
