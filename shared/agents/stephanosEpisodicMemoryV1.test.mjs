import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStephanosEpisodicMemoryV1, STEPHANOS_EPISODIC_MEMORY_SCHEMA_VERSION } from './stephanosEpisodicMemoryV1.mjs';

function episode(id, at, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_EPISODIC_MEMORY_SCHEMA_VERSION,
    episodeId: id,
    observedAtUtc: at,
    summary: `Summary ${id}`,
    whyItMatters: `Why ${id} matters`,
    outcome: `Outcome ${id}`,
    authorityClass: 'SHARED_AUTHORITY',
    freshness: 'FRESH',
    state: 'CURRENT',
    supersedes: null,
    supersededBy: null,
    participantIds: ['stephanos'],
    surfaceIds: ['shared-workspace'],
    intentRefs: ['intent://mission:alpha'],
    goalRefs: ['goal://1645'],
    prRefs: [],
    componentRefs: ['component://memory'],
    decisionRefs: [],
    correctionRefs: [],
    openThreadRefs: [],
    sourceRefs: ['memory://episode-source'],
    proofRefs: ['evidence://memory-proof'],
    causalParentEpisodeIds: [],
    ...overrides,
  };
}

test('projects chronological episodic continuity and causal lineage', () => {
  const older = episode('ep-old', '2026-08-17T10:00:00.000Z');
  const newer = episode('ep-new', '2026-08-17T11:00:00.000Z', { causalParentEpisodeIds: ['ep-old'] });
  const result = buildStephanosEpisodicMemoryV1({ episodes: [newer, older] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.chronology, ['ep-old', 'ep-new']);
  assert.deepEqual(result.causalEdges, [{ fromEpisodeId: 'ep-old', toEpisodeId: 'ep-new' }]);
});

test('keeps superseded history distinct from current truth', () => {
  const old = episode('ep-old', '2026-08-17T10:00:00.000Z', { state: 'SUPERSEDED', supersededBy: 'ep-new' });
  const current = episode('ep-new', '2026-08-17T11:00:00.000Z', { supersedes: 'ep-old' });
  const result = buildStephanosEpisodicMemoryV1({ episodes: [old, current] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.currentEpisodeIds, ['ep-new']);
  assert.deepEqual(result.supersededEpisodeIds, ['ep-old']);
});

test('does not promote unknown authority', () => {
  const result = buildStephanosEpisodicMemoryV1({ episodes: [episode('ep-u', '2026-08-17T10:00:00.000Z', { authorityClass: 'UNKNOWN', freshness: 'UNKNOWN' })] });
  assert.equal(result.valid, true);
  assert.equal(result.episodes[0].authorityClass, 'UNKNOWN');
  assert.equal(result.episodes[0].freshness, 'UNKNOWN');
});

test('fails closed on unsafe proof refs', () => {
  const result = buildStephanosEpisodicMemoryV1({ episodes: [episode('ep-bad', '2026-08-17T10:00:00.000Z', { proofRefs: ['evidence://../blocked'] })] });
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'SAFE_HOLD');
});

test('fails closed on dangling causal parents', () => {
  const result = buildStephanosEpisodicMemoryV1({ episodes: [episode('ep-child', '2026-08-17T10:00:00.000Z', { causalParentEpisodeIds: ['missing'] })] });
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /causal-parent-not-present/);
});

test('rejects disallowed raw context markers', () => {
  const result = buildStephanosEpisodicMemoryV1({ episodes: [episode('ep-sensitive', '2026-08-17T10:00:00.000Z', { summary: 'raw prompt payload' })] });
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /summary-invalid/);
});

test('rejects accessor-bearing input without invoking getters', () => {
  let called = 0;
  const malicious = {};
  Object.defineProperty(malicious, 'episodes', { enumerable: true, get() { called += 1; return []; } });
  const result = buildStephanosEpisodicMemoryV1(malicious);
  assert.equal(called, 0);
  assert.equal(result.valid, false);
});

test('remains read-only and grants no mutation authority', () => {
  const result = buildStephanosEpisodicMemoryV1({ episodes: [episode('ep-a', '2026-08-17T10:00:00.000Z')] });
  assert.equal(result.valid, true);
  assert.ok(Object.values(result.authority).every((value) => value === false));
  assert.equal(Object.isFrozen(result), true);
});
