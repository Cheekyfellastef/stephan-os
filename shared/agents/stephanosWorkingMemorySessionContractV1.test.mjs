import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_WORKING_MEMORY_INPUT_SCHEMA_VERSION as INPUT_SCHEMA,
  STEPHANOS_WORKING_MEMORY_ITEM_SCHEMA_VERSION as ITEM_SCHEMA,
  STEPHANOS_WORKING_MEMORY_CONTEXT_MAX_BYTES as CONTEXT_MAX_BYTES,
  STEPHANOS_WORKING_MEMORY_MAX_SESSION_MS as MAX_SESSION_MS,
  buildStephanosWorkingMemorySessionProjectionV1 as buildProjection,
} from './stephanosWorkingMemorySessionContractV1.mjs';

const NOW_MS = Date.parse('2026-08-15T03:30:00.000Z');
const iso = (milliseconds) => new Date(milliseconds).toISOString();

function item(overrides = {}) {
  return {
    schemaVersion: ITEM_SCHEMA,
    itemId: 'item-1',
    itemType: 'TASK_STATE',
    truthClass: 'CONFIRMED',
    sourceClass: 'SYSTEM_OBSERVED',
    status: 'ACTIVE',
    summary: 'Prepare the next bounded memory product slice.',
    observedAtUtc: iso(NOW_MS - 5_000),
    validUntilUtc: null,
    sourceRefs: ['project://goal/1645'],
    relatedGoalRef: '#1645',
    relatedPrRef: null,
    confidence: 0.95,
    sensitivityClass: 'PROJECT_CONTEXT',
    retentionClass: 'WORKING_SESSION_ONLY',
    ...overrides,
  };
}

function input(items, overrides = {}) {
  return {
    schemaVersion: INPUT_SCHEMA,
    sessionId: 'session-1',
    actorId: 'stephanos',
    surfaceId: 'command-deck',
    startedAtUtc: iso(NOW_MS - 60_000),
    updatedAtUtc: iso(NOW_MS - 1_000),
    expiresAtUtc: iso(NOW_MS + 60 * 60 * 1000),
    sourceSessionMemorySchemaVersion: 1,
    items,
    ...overrides,
  };
}

const run = (items, overrides = {}, options = { evaluationNowMs: NOW_MS }) =>
  buildProjection(input(items, overrides), options);

test('builds a bounded read-only local working-memory projection', () => {
  const projection = run([item()]);
  assert.equal(projection.valid, true);
  assert.equal(projection.verdict, 'WORKING_CONTEXT_AVAILABLE');
  assert.equal(projection.contextPack.items.length, 1);
  assert.equal(projection.memoryAdequacyObservationCandidate.authorityClass, 'LOCAL_MIRROR');
  assert.equal(projection.memoryAdequacyObservationCandidate.domain, 'ephemeral-working-context');
});

test('keeps confirmed, inferred and unknown truth distinct', () => {
  const projection = run([
    item(),
    item({
      itemId: 'item-2',
      itemType: 'HYPOTHESIS',
      truthClass: 'INFERRED',
      sourceClass: 'MODEL_INFERENCE',
      summary: 'The next repair may be limited to one trust boundary.',
      confidence: 0.6,
    }),
    item({
      itemId: 'item-3',
      itemType: 'OPEN_LOOP',
      truthClass: 'UNKNOWN',
      sourceClass: 'UNKNOWN',
      summary: 'Independent runtime acceptance is not yet known.',
      sourceRefs: [],
      confidence: 0,
    }),
  ]);
  assert.deepEqual(
    [projection.counts.confirmed, projection.counts.inferred, projection.counts.unknown],
    [1, 1, 1],
  );
});

test('hypotheses cannot self-certify as confirmed', () => {
  const projection = run([item({ itemType: 'HYPOTHESIS' })]);
  assert.equal(projection.valid, false);
  assert.ok(projection.validationErrors.includes('items[0]:hypothesis-cannot-be-confirmed'));
});

test('operator preferences require explicit operator confirmation', () => {
  const inferred = run([item({
    itemType: 'OPERATOR_PREFERENCE',
    truthClass: 'INFERRED',
    sourceClass: 'MODEL_INFERENCE',
    summary: 'The operator may prefer a different route.',
    confidence: 0.5,
  })]);
  assert.equal(inferred.valid, false);
  const explicit = run([item({
    itemType: 'OPERATOR_PREFERENCE',
    truthClass: 'CONFIRMED',
    sourceClass: 'OPERATOR_SUPPLIED',
    summary: 'The operator explicitly prefers provider-neutral execution.',
    confidence: 1,
    sensitivityClass: 'OPERATOR_PREFERENCE',
    sourceRefs: ['operator://teaching/provider-neutral-execution'],
  })]);
  assert.equal(explicit.valid, true);
});

test('retention cannot be widened into durable memory', () => {
  const projection = run([item({ retentionClass: 'DURABLE' })]);
  assert.equal(projection.valid, false);
  assert.ok(projection.validationErrors.includes(
    'items[0]:retentionClass-must-be-working-session-only',
  ));
});

test('session duration is bounded', () => {
  const projection = run([item()], {
    expiresAtUtc: iso(NOW_MS - 60_000 + MAX_SESSION_MS + 1),
  });
  assert.equal(projection.valid, false);
  assert.ok(projection.validationErrors.includes('session-duration-exceeds-canonical-bound'));
});

test('source session schema must match the existing canonical session-memory schema', () => {
  const projection = run([item()], { sourceSessionMemorySchemaVersion: 2 });
  assert.equal(projection.valid, false);
  assert.ok(projection.validationErrors.includes(
    'sourceSessionMemorySchemaVersion-incompatible',
  ));
});

test('items at or after session expiry fail closed', () => {
  const expiresAtUtc = iso(NOW_MS + 5_000);
  const projection = run([item({ observedAtUtc: expiresAtUtc })], { expiresAtUtc });
  assert.equal(projection.valid, false);
  assert.ok(projection.validationErrors.includes(
    'items[0]:observed-at-or-after-session-expiry',
  ));
});

test('session and item validity expire at the exact boundary', () => {
  const expiresAtUtc = iso(NOW_MS);
  const projection = buildProjection(input([item({
    observedAtUtc: iso(NOW_MS - 10_000),
    validUntilUtc: expiresAtUtc,
  })], {
    updatedAtUtc: iso(NOW_MS - 1_000),
    expiresAtUtc,
  }), { evaluationNowMs: NOW_MS });
  assert.equal(projection.valid, true);
  assert.equal(projection.sessionState, 'EXPIRED');
  assert.equal(projection.items[0].stale, true);
  assert.equal(projection.contextPack.items.length, 0);
});

test('expired sessions emit no current context', () => {
  const projection = buildProjection(input([item()], {
    startedAtUtc: iso(NOW_MS - 2 * 60 * 60 * 1000),
    updatedAtUtc: iso(NOW_MS - 70 * 60 * 1000),
    expiresAtUtc: iso(NOW_MS - 60 * 60 * 1000),
    items: [item({ observedAtUtc: iso(NOW_MS - 90 * 60 * 1000) })],
  }), { evaluationNowMs: NOW_MS });
  assert.equal(projection.valid, true);
  assert.equal(projection.sessionState, 'EXPIRED');
  assert.equal(projection.contextPack.items.length, 0);
});

test('stale items stay visible but cannot enter the current context pack', () => {
  const projection = run([item({ observedAtUtc: iso(NOW_MS - 31 * 60 * 1000) })], {
    startedAtUtc: iso(NOW_MS - 2 * 60 * 60 * 1000),
  });
  assert.equal(projection.valid, true);
  assert.equal(projection.counts.stale, 1);
  assert.equal(projection.contextPack.items.length, 0);
});

test('exact duplicate replay is deduplicated while conflict fails closed', () => {
  const original = item();
  const replay = run([original, { ...original, sourceRefs: [...original.sourceRefs] }]);
  assert.equal(replay.valid, true);
  assert.equal(replay.items.length, 1);
  assert.equal(replay.counts.replayedDuplicates, 1);
  const conflict = run([original, item({ summary: 'Conflicting item content.' })]);
  assert.equal(conflict.valid, false);
  assert.ok(conflict.validationErrors.includes('conflicting-duplicate-itemId:item-1'));
});

test('sparse and accessor-bearing arrays fail closed without executing accessors', () => {
  const sparse = [];
  sparse.length = 1;
  assert.doesNotThrow(() => run(sparse));
  assert.equal(run(sparse).valid, false);

  let calls = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('must not execute');
    },
  });
  accessor.length = 1;
  const projection = run(accessor);
  assert.equal(projection.valid, false);
  assert.equal(calls, 0);
});

test('record-level getters and toJSON hooks are never executed before snapshot', () => {
  let getterCalls = 0;
  const hostile = item();
  Object.defineProperty(hostile, 'summary', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  assert.equal(run([hostile]).valid, false);
  assert.equal(getterCalls, 0);

  let toJsonCalls = 0;
  const withToJson = item();
  Object.defineProperty(withToJson, 'toJSON', {
    enumerable: true,
    value() {
      toJsonCalls += 1;
      return {};
    },
  });
  assert.equal(run([withToJson]).valid, false);
  assert.equal(toJsonCalls, 0);
});

test('revoked proxies fail closed without escaping', () => {
  const { proxy, revoke } = Proxy.revocable(item(), {});
  revoke();
  assert.doesNotThrow(() => run([proxy]));
  assert.equal(run([proxy]).valid, false);
});

test('sensitive text and unsafe references are rejected', () => {
  for (const candidate of [
    item({ summary: 'api_key=abcdefghijklmnopqrstuvwxyz' }),
    item({ sourceRefs: ['project://../secret'] }),
    item({ summary: 'C:\\Users\\Stephan\\private.json' }),
    item({ summary: 'Create a psychological profile of the operator.' }),
  ]) {
    assert.equal(run([candidate]).valid, false);
  }
});

test('omitted-sensitive and inactive records are excluded from provider-neutral context', () => {
  const projection = run([
    item(),
    item({
      itemId: 'item-2',
      sensitivityClass: 'OMITTED_SENSITIVE',
      truthClass: 'UNKNOWN',
      sourceClass: 'UNKNOWN',
      summary: 'Sensitive detail omitted.',
      sourceRefs: [],
      confidence: 0,
    }),
    item({ itemId: 'item-3', status: 'RESOLVED' }),
  ]);
  assert.equal(projection.valid, true);
  assert.deepEqual(projection.contextPack.items.map((entry) => entry.itemId), ['item-1']);
  assert.equal(projection.contextPack.omittedSensitiveCount, 1);
  assert.equal(projection.contextPack.omittedInactiveCount, 1);
});

test('context ordering is deterministic and prioritises task/open-loop state', () => {
  const records = [
    item({ itemId: 'fact', itemType: 'IMMEDIATE_FACT' }),
    item({ itemId: 'loop', itemType: 'OPEN_LOOP' }),
    item({ itemId: 'task', itemType: 'TASK_STATE' }),
  ];
  const first = run(records);
  const second = run([...records].reverse());
  assert.equal(first.projectionId, second.projectionId);
  assert.deepEqual(first.contextPack.items.map((entry) => entry.itemId), ['task', 'loop', 'fact']);
});

test('accepted nested arrays are detached and frozen', () => {
  const refs = ['project://goal/1645'];
  const projection = run([item({ sourceRefs: refs })]);
  refs[0] = 'project://tampered';
  assert.deepEqual(projection.items[0].sourceRefs, ['project://goal/1645']);
  assert.equal(Object.isFrozen(projection.items[0].sourceRefs), true);
  assert.throws(() => projection.items[0].sourceRefs.push('project://new'));
});

test('out-of-range evaluation clocks fail closed without throwing', () => {
  assert.doesNotThrow(() => run([item()], {}, { evaluationNowMs: Number.MAX_SAFE_INTEGER }));
  assert.equal(run([item()], {}, { evaluationNowMs: Number.MAX_SAFE_INTEGER }).valid, false);
});

test('empty working context is valid but never optimistic', () => {
  const projection = run([]);
  assert.equal(projection.valid, true);
  assert.equal(projection.verdict, 'NO_CURRENT_WORKING_CONTEXT');
  assert.ok(projection.unknowns.includes('NO_WORKING_MEMORY_ITEMS'));
});

test('context byte accounting is exact and never exceeds the canonical budget', () => {
  const items = Array.from({ length: 24 }, (_, index) => item({
    itemId: `item-${index + 1}`,
    itemType: index === 0 ? 'TASK_STATE' : 'IMMEDIATE_FACT',
    summary: `Bounded context item ${index + 1} ${'x'.repeat(440)}`,
    sourceRefs: Array.from({ length: 8 }, (_, refIndex) =>
      `project://goal/1645/context-${index + 1}-${refIndex + 1}`),
  }));
  const projection = run(items);
  assert.equal(projection.valid, true);
  assert.equal(
    projection.contextPack.budget.actualBytes,
    Buffer.byteLength(JSON.stringify(projection.contextPack.items), 'utf8'),
  );
  assert.ok(projection.contextPack.budget.actualBytes <= CONTEXT_MAX_BYTES);
});

test('every authority remains false', () => {
  const projection = run([item()]);
  assert.ok(Object.values(projection.authority).every((value) => value === false));
  assert.equal(projection.memoryAdequacyObservationCandidate.authorityClass, 'LOCAL_MIRROR');
});
