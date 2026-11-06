import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryService } from '../services/memoryService.js';

const fixtures = [
  { id: 'low-match', title: 'Calibration handbook', content: 'Optical alignment procedure', tags: ['lens'], category: 'architecture', importance: 1 },
  { id: 'high-unrelated', title: 'Garden schedule', content: 'Water basil on Tuesday', tags: ['plants'], category: 'preference', importance: 5 },
  { id: 'higher-match', title: 'Optical register', content: 'Alignment history', tags: ['lens'], category: 'architecture', importance: 4 },
  { id: 'other', title: 'Audio routing', content: 'Headset channel map', tags: ['audio'], category: 'workflow', importance: 3 },
].map(item => ({ ...item, source: 'test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }));

function isolatedMemory(t, items = fixtures) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-search-relevance-'));
  const file = path.join(root, 'memory.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, items }));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('memory-search-relevance-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { service: new MemoryService(file), file };
}
const ids = items => items.map(item => item.id);

test('unmatched queries return no records regardless of stored importance', t => {
  const { service } = isolatedMemory(t);
  for (const query of ['zzxqnv987654321zz', 'nebulazebra', '??']) assert.deepEqual(service.searchMemory(query), [], query);
});

test('matching low-importance memory survives while unrelated higher-importance memory is excluded', t => {
  const { service } = isolatedMemory(t);
  assert.deepEqual(ids(service.searchMemory('Calibration')), ['low-match']);
  assert.deepEqual(ids(service.searchMemory('calibration unknownword')), ['low-match']);
});

test('title, content, tag, category and phrase matches keep their existing case-insensitive behavior', t => {
  const { service } = isolatedMemory(t);
  for (const [query, expected] of [
    ['  CALIBRATION  ', ['low-match']], ['procedure', ['low-match']],
    ['lens', ['higher-match', 'low-match']], ['architecture', ['higher-match', 'low-match']],
    ['optical alignment', ['low-match', 'higher-match']],
  ]) assert.deepEqual(ids(service.searchMemory(query)), expected, query);
});

test('blank queries still list filtered memory with importance ordering', t => {
  const { service } = isolatedMemory(t);
  for (const query of ['', ' \t\n ']) {
    assert.deepEqual(ids(service.searchMemory(query)), ['high-unrelated', 'higher-match', 'other', 'low-match']);
    assert.deepEqual(ids(service.searchMemory(query, { category: 'architecture', tags: ['lens'] })), ['higher-match', 'low-match']);
  }
});

test('category and tag filters remain conjunctive with relevance', t => {
  const { service } = isolatedMemory(t);
  assert.deepEqual(service.searchMemory('calibration', { category: 'preference' }), []);
  assert.deepEqual(service.searchMemory('calibration', { tags: ['plants'] }), []);
  assert.deepEqual(ids(service.searchMemory('alignment', { category: 'architecture', tags: ['lens'] })), ['higher-match', 'low-match']);
  assert.deepEqual(service.searchMemory('zzxqnv987654321zz', { tags: ['lens'] }), []);
});

test('recall aliases and prompt context never fill an unmatched query with unrelated memory', t => {
  const { service } = isolatedMemory(t);
  const query = 'zzxqnv987654321zz';
  assert.deepEqual(service.findMemory(query), []);
  assert.deepEqual(service.getRelevantMemory(query, { limit: 2 }), []);
  assert.deepEqual(service.buildContextSummary(query), { relevantItems: [], summaryText: '' });
  const summary = service.buildContextSummary('alignment', { limit: 1 });
  assert.deepEqual(ids(summary.relevantItems), ['higher-match']);
  assert.match(summary.summaryText, /Optical register/);
  assert.doesNotMatch(summary.summaryText, /Garden|Headset/);
});

test('equal relevance and importance retain newest-first ordering', t => {
  const item = { ...fixtures[0], title: 'Comet guide', content: 'Observing guide', importance: 2 };
  const { service } = isolatedMemory(t, [{ ...item, id: 'old' }, { ...item, id: 'new', updatedAt: '2026-02-01T00:00:00.000Z' }, fixtures[1]]);
  assert.deepEqual(ids(service.searchMemory('Comet')), ['new', 'old']);
});

test('search and prompt construction leave the stored memory bytes unchanged', t => {
  const { service, file } = isolatedMemory(t);
  const before = fs.readFileSync(file);
  for (const query of ['', 'calibration', 'zzxqnv987654321zz']) {
    service.searchMemory(query); service.findMemory(query); service.buildContextSummary(query);
  }
  assert.deepEqual(fs.readFileSync(file), before);
});
