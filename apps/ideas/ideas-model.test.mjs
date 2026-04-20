import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdeasKnowledgeDigest, upsertIdeaRecord } from './ideas-model.js';

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
