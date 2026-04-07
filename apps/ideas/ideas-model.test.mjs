import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertIdeaRecord } from './ideas-model.js';

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
