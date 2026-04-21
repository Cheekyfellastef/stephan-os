import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdeaContextPackage,
  buildIdeasKnowledgeDigest,
  transitionIdeaPromotionState,
  upsertIdeaRecord,
} from './ideas-model.js';

test('upsertIdeaRecord creates a new idea record with durable timestamps and id', () => {
  const nowIso = '2026-04-06T00:00:00.000Z';
  const records = upsertIdeaRecord([], {
    title: 'Clipboard repair postmortem',
    summary: 'Validate copy surface in merge ritual only.',
    tags: ['ideas', 'clipboard'],
    media: [],
  }, {
    nowIso,
    idFactory: () => 'ideas_test_001',
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'ideas_test_001');
  assert.equal(records[0].title, 'Clipboard repair postmortem');
  assert.equal(records[0].createdAt, nowIso);
  assert.equal(records[0].updatedAt, nowIso);
});

test('upsertIdeaRecord prepends newly created idea so render list includes the new pane immediately', () => {
  const older = {
    id: 'ideas_existing_001',
    title: 'Existing idea',
    summary: 'Already persisted idea',
    tags: ['existing'],
    media: [],
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
  };
  const nowIso = '2026-04-06T12:34:56.000Z';

  const records = upsertIdeaRecord([older], {
    title: 'Newly saved idea',
    summary: 'Should render as a new card.',
    tags: ['new'],
    media: [],
  }, {
    nowIso,
    idFactory: () => 'ideas_new_001',
  });

  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'ideas_new_001');
  assert.equal(records[1].id, 'ideas_existing_001');
});

test('buildIdeasKnowledgeDigest returns selected idea and related links', () => {
  const digest = buildIdeasKnowledgeDigest([{
    id: 'idea_1',
    title: 'Idea 1',
    summary: 'Primary',
    tags: ['retrieval', 'ideas'],
    knowledge: {
      nodeType: 'concept',
      collectionId: 'core',
      actionTarget: 'runtime',
      promotionStatus: 'promoted',
      relations: [{ targetId: 'idea_2', relationType: 'related', notes: '' }],
      evidence: [{ id: 'ev-1', type: 'note', title: 'Note', source: 'repo://note', notes: '' }],
    },
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }, {
    id: 'idea_2',
    title: 'Idea 2',
    summary: 'Related',
    tags: ['retrieval'],
    media: [],
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
  }], { selectedIdeaId: 'idea_1' });

  assert.equal(digest.selectedIdea.id, 'idea_1');
  assert.equal(digest.relatedIdeas.length, 1);
  assert.equal(digest.selectedIdea.evidence.length, 1);
  assert.equal(digest.selectedIdea.nodeType, 'concept');
  assert.equal(digest.diagnostics.included, true);
});

test('buildIdeasKnowledgeDigest projects progression metadata and related idea ids', () => {
  const digest = buildIdeasKnowledgeDigest([{
    id: 'idea_progression_1',
    title: 'Progression idea',
    summary: 'Track progression',
    status: 'linked',
    priority: 'critical',
    relatedIdeas: ['idea_progression_2'],
    collectionIds: ['stephanos-core'],
    tags: ['ideas', 'graph'],
    knowledge: {
      nodeType: 'roadmap',
      promotionState: {
        memory: 'submitted',
      },
      evidence: [{ id: 'ev-1', type: 'note', title: 'Proof', source: 'repo://proof' }],
    },
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }, {
    id: 'idea_progression_2',
    title: 'Related',
    summary: 'Related node',
    tags: ['graph'],
    media: [],
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
  }], { selectedIdeaId: 'idea_progression_1' });

  assert.equal(digest.selectedIdea.status, 'linked');
  assert.equal(digest.selectedIdea.priority, 'critical');
  assert.deepEqual(digest.selectedIdea.collectionIds, ['stephanos-core']);
  assert.deepEqual(digest.selectedIdea.relatedIdeaIds, ['idea_progression_2']);
});

test('transitionIdeaPromotionState updates traceable promotion state', () => {
  const transitioned = transitionIdeaPromotionState({
    id: 'idea_1',
    title: 'Idea',
    summary: '',
    tags: [],
    media: [],
    promotionState: {
      memory: 'not-submitted',
    },
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }, 'codex', 'seed-ready', { actor: 'operator-test', notes: 'Prepared prompt seed' });

  assert.equal(transitioned.promotionState.codex, 'seed-ready');
  assert.equal(Array.isArray(transitioned.promotionState.trace), true);
  assert.equal(transitioned.promotionState.trace.length, 1);
  assert.equal(transitioned.promotionState.trace[0].target, 'codex');
});

test('buildIdeaContextPackage returns bounded package diagnostics', () => {
  const pkg = buildIdeaContextPackage([{
    id: 'idea_pkg_1',
    title: 'Package candidate',
    summary: 'Bounded packet test',
    tags: ['ideas'],
    knowledge: {
      relations: [{ targetId: 'idea_pkg_2', relationType: 'supports' }],
      evidence: [{ id: 'e1', type: 'note', title: 'Reference', source: 'repo://ref' }],
    },
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }, {
    id: 'idea_pkg_2',
    title: 'Neighbor',
    summary: 'Related',
    tags: ['ideas'],
    media: [],
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }], {
    selectedIdeaId: 'idea_pkg_1',
    retrievalExcerpts: [{ sourceRef: 'idea:idea_pkg_1', excerpt: 'short excerpt' }],
    memoryRecords: [{ id: 'mem_1', type: 'tile.memory', summary: 'Memory summary' }],
  });

  assert.equal(pkg.included, true);
  assert.equal(pkg.relatedIdeas.length <= 3, true);
  assert.equal(pkg.memorySummaries.length, 1);
  assert.equal(pkg.retrievalExcerpts.length, 1);
  assert.equal(pkg.diagnostics.bounded, true);
  assert.equal(pkg.diagnostics.sourceTruth.retrieval, 'unavailable');
  assert.equal(pkg.diagnostics.includedFrom.selectedIdea, 'ideas-tile-state');
});

test('buildIdeaContextPackage includes bounded source truth diagnostics when explicit sources are passed', () => {
  const pkg = buildIdeaContextPackage([{
    id: 'idea_pkg_truth_1',
    title: 'Truth idea',
    summary: 'Truth labels',
    tags: ['ideas'],
    media: [],
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
  }], {
    retrievalSource: 'scaffolded-unvalidated',
    memorySource: 'shared durable',
    persistenceSource: 'shared-backend',
  });

  assert.equal(pkg.included, true);
  assert.equal(pkg.diagnostics.sourceTruth.persistence, 'shared-backend');
  assert.equal(pkg.diagnostics.sourceTruth.retrieval, 'scaffolded-unvalidated');
  assert.equal(pkg.diagnostics.sourceTruth.memory, 'shared durable');
});
