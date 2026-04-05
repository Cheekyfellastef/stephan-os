import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluateMemoryEligibility } from '../services/memory/memoryPolicy.js';
import { DurableMemoryStore } from '../services/memory/memoryStore.js';
import { adjudicateMemoryCandidate } from '../services/memory/memoryAdjudicator.js';
import { normalizeMemoryExecutionTruth } from '../services/memory/memoryTruthModel.js';

test('memory eligibility marks stable system rule as durable-eligible', () => {
  const result = evaluateMemoryEligibility({
    key: 'routing.launch.order',
    value: { order: ['launchEntry', 'runtimeEntry', 'entry'] },
    sourceType: 'system',
    sourceRef: 'shared/runtime/stephanosLaws.mjs#L1',
    memoryReason: 'Canonical routing rule guardrail.',
    memoryConfidence: 'high',
  });

  assert.equal(result.eligible, true);
  assert.equal(result.memoryClass, 'durable');
});

test('memory eligibility rejects random transient logs', () => {
  const result = evaluateMemoryEligibility({
    key: 'debug.log.1234',
    value: 'one-off debug session trace from today',
    sourceType: 'snapshot',
    sourceRef: 'logs/debug.log',
    memoryReason: 'temporary debug log',
    memoryConfidence: 'low',
  });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /defaulting to no promotion|transient/i);
});

test('promotion stores eligible input with required durable schema', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-memory-adjudication-'));
  const storagePath = path.join(tempDir, 'durable-memory.json');
  const store = new DurableMemoryStore(storagePath);

  const adjudication = adjudicateMemoryCandidate({
    key: 'provider.truth.separation',
    value: 'Requested provider, selected provider, and executable provider are distinct.',
    sourceType: 'system',
    sourceRef: 'shared/runtime/stephanosLaws.mjs#provider-truth',
    memoryReason: 'Long-lived provider truth guardrail.',
    memoryConfidence: 'high',
  }, { store, persist: true });

  assert.equal(adjudication.memoryPromoted, true);
  const persisted = store.list();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].memoryClass, 'durable');
  assert.equal(typeof persisted[0].id, 'string');
  assert.equal(persisted[0].sourceType, 'system');
  assert.equal(persisted[0].sourceRef, 'shared/runtime/stephanosLaws.mjs#provider-truth');
  assert.equal(typeof persisted[0].createdAt, 'string');
  assert.equal(typeof persisted[0].updatedAt, 'string');
});

test('non-eligible input is not stored', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-memory-adjudication-'));
  const storagePath = path.join(tempDir, 'durable-memory.json');
  const store = new DurableMemoryStore(storagePath);

  const adjudication = adjudicateMemoryCandidate({
    key: 'debug.transient.random',
    value: 'latest stack trace from temporary run',
    sourceType: 'snapshot',
    sourceRef: 'logs/temp.txt',
    memoryReason: 'one-off trace',
    memoryConfidence: 'low',
  }, { store, persist: true });

  assert.equal(adjudication.memoryPromoted, false);
  assert.equal(store.list().length, 0);
});

test('same candidate returns deterministic adjudication result', () => {
  const candidate = {
    key: 'project.north-star',
    value: 'Stephanos is a persistent cross-device identity and continuity layer.',
    sourceType: 'system',
    sourceRef: 'operator:build-pass-v1',
    memoryReason: 'North star durable identity statement.',
    memoryConfidence: 'high',
  };

  const first = adjudicateMemoryCandidate(candidate, { persist: false });
  const second = adjudicateMemoryCandidate(candidate, { persist: false });

  assert.deepEqual(first, second);
});

test('memory truth model exposes execution metadata fields', () => {
  const truth = normalizeMemoryExecutionTruth({
    memoryEligible: true,
    memoryPromoted: false,
    memoryReason: 'Policy denied promotion.',
    memorySourceType: 'operator',
    memorySourceRef: 'operator:manual',
    memoryConfidence: 'medium',
    memoryClass: 'durable',
  });

  assert.equal(truth.memoryEligible, true);
  assert.equal(truth.memoryPromoted, false);
  assert.equal(truth.memorySourceType, 'operator');
  assert.equal(truth.memorySourceRef, 'operator:manual');
  assert.equal(truth.memoryConfidence, 'medium');
  assert.equal(truth.memoryClass, 'durable');
});

test('retrieval evidence is not auto-promoted', () => {
  const result = evaluateMemoryEligibility({
    key: 'retrieval.chunk.1',
    value: 'retrieved chunk text',
    sourceType: 'snapshot',
    sourceRef: 'retrieval:docs/handbook.md#3',
    memoryReason: 'retrieval evidence',
    memoryConfidence: 'medium',
  });

  assert.equal(result.eligible, false);
  assert.match(result.reason, /never auto-promoted/i);
});

test('durable memory persists across store restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-memory-adjudication-'));
  const storagePath = path.join(tempDir, 'durable-memory.json');
  const firstStore = new DurableMemoryStore(storagePath);

  adjudicateMemoryCandidate({
    key: 'guardrail.memory-vs-rag',
    value: 'Memory is canonical; RAG is evidence only.',
    sourceType: 'system',
    sourceRef: 'operator:memory-adjudication-layer-v1',
    memoryReason: 'Long-lived guardrail constraint.',
    memoryConfidence: 'high',
  }, { store: firstStore, persist: true });

  const secondStore = new DurableMemoryStore(storagePath);
  const records = secondStore.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].key, 'guardrail.memory-vs-rag');
});
