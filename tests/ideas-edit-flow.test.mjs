import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdeaActions, startIdeaEdit, upsertIdeaRecord } from '../apps/ideas/ideas-model.js';
import { sanitizeIdeasState } from '../apps/ideas/ideas-persistence.js';

test('each stored idea exposes Edit functionality', () => {
  const actions = buildIdeaActions({ id: 'idea_1', title: 'Idea' });
  assert.equal(actions.some((action) => action.type === 'edit' && action.label === 'Edit'), true);
});

test('editing an idea updates existing record rather than creating duplicate', () => {
  const existing = [{
    id: 'idea_1',
    title: 'Initial',
    summary: 'first',
    tags: ['one'],
    media: [],
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
  }];

  const updated = upsertIdeaRecord(existing, {
    id: 'idea_1',
    title: 'Initial (edited)',
    summary: 'edited',
    tags: ['one', 'edited'],
    media: [],
  }, {
    nowIso: '2026-03-29T00:05:00.000Z',
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, 'idea_1');
  assert.equal(updated[0].title, 'Initial (edited)');
  assert.equal(updated[0].updatedAt, '2026-03-29T00:05:00.000Z');
});

test('canceling edit does not mutate stored durable data', () => {
  const records = sanitizeIdeasState({
    records: [{
      id: 'idea_1',
      title: 'Immutable until save',
      summary: 'summary',
      tags: ['safe'],
      media: [],
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    }],
  }).records;

  const editDraft = startIdeaEdit(records, 'idea_1');
  assert.ok(editDraft);
  editDraft.title = 'Changed in draft only';

  assert.equal(records[0].title, 'Immutable until save');
});

test('local-only edit UI state does not pollute durable ideas data', () => {
  const records = upsertIdeaRecord([], {
    title: 'Shared durable idea',
    summary: 'content',
    tags: ['shared'],
    media: [],
  }, {
    nowIso: '2026-03-29T01:00:00.000Z',
    idFactory: () => 'idea_durable_1',
  });

  const durable = sanitizeIdeasState({ records });
  assert.deepEqual(Object.keys(durable), ['records']);
  assert.equal(durable.records[0].id, 'idea_durable_1');
  assert.equal(Object.hasOwn(durable.records[0], 'editingIdeaId'), false);
});
