import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ingestAllowlistedCorpus } from '../services/retrieval/retrievalCorpusRegistry.js';
import { RETRIEVAL_CONFIG } from '../services/retrieval/retrievalConfig.js';
import { chunkDocument } from '../services/retrieval/retrievalChunker.js';
import { localRetrievalService } from '../services/retrieval/localRetrievalService.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('ingestion is deterministic and allowlist-bounded', () => {
  const first = ingestAllowlistedCorpus({ repoRoot, config: RETRIEVAL_CONFIG });
  const second = ingestAllowlistedCorpus({ repoRoot, config: RETRIEVAL_CONFIG });

  assert.deepEqual(first.documents.map((doc) => doc.path), second.documents.map((doc) => doc.path));
  assert.ok(first.documents.length > 0);
  assert.ok(first.documents.every((doc) => RETRIEVAL_CONFIG.allowlistedSources.some((source) => doc.path.startsWith(source.root.replace(/\/$/, '')) || doc.path === source.root)));
});

test('chunking generates stable metadata', () => {
  const chunks = chunkDocument({
    sourceId: 'test-source',
    sourceType: 'project-note',
    documentId: 'test-doc.md',
    relativePath: 'docs/notes/test-doc.md',
    title: 'Test title',
    timestamp: '2026-04-05T00:00:00.000Z',
    text: '# Test title\n\nThis is deterministic chunk text repeated. '.repeat(60),
    maxChunkChars: 220,
    chunkOverlapChars: 40,
  });

  assert.ok(chunks.length > 2);
  assert.equal(chunks[0].sourceId, 'test-source');
  assert.equal(chunks[0].sourceType, 'project-note');
  assert.equal(chunks[0].path, 'docs/notes/test-doc.md');
  assert.equal(chunks[0].chunkIndex, 0);
  assert.ok(chunks.every((chunk, index) => chunk.chunkIndex === index));
});

test('rebuild produces inspectable index state', () => {
  const index = localRetrievalService.rebuildIndex();
  assert.equal(index.schema, 'stephanos-local-rag-index');
  assert.ok(Array.isArray(index.corpusManifest.documentPaths));
  assert.ok(index.corpusManifest.documentPaths.length > 0);
  assert.ok(Array.isArray(index.chunks));
  assert.ok(index.chunks.length > 0);
  assert.ok(index.lexicalIndex && typeof index.lexicalIndex === 'object');
});

test('routing handoff query returns relevant local chunks with metadata', () => {
  localRetrievalService.rebuildIndex();
  const result = localRetrievalService.query({
    prompt: 'What did we decide about hosted low-freshness routing?',
    freshnessContext: { freshnessNeed: 'low' },
  });

  assert.equal(result.truth.retrievalEligible, true);
  assert.equal(result.truth.retrievalUsed, true);
  assert.ok(result.truth.retrievedChunkCount >= 1);
  assert.ok(result.truth.retrievedChunkCount <= RETRIEVAL_CONFIG.maxResults);
  assert.ok(result.truth.retrievedSources.some((source) => String(source.path || '').includes('freshnessRouting.test')));
});

test('mission console scroll query returns bounded chunk set and source descriptors', () => {
  localRetrievalService.rebuildIndex();
  const result = localRetrievalService.query({
    prompt: 'Find the last fix related to Mission Console scroll behavior',
    freshnessContext: { freshnessNeed: 'low' },
  });

  assert.equal(result.truth.retrievalMode, 'local-rag');
  assert.ok(result.truth.retrievedChunkCount <= RETRIEVAL_CONFIG.maxResults);
  assert.ok(result.truth.retrievedSources.every((source) => typeof source.path === 'string' && source.path.length > 0));
  assert.ok(result.truth.retrievedSources.some((source) => String(source.path || '').includes('AIConsole.render.test')));
});

test('freshness-sensitive prompt does not claim local retrieval solved current truth', () => {
  localRetrievalService.rebuildIndex();
  const result = localRetrievalService.query({
    prompt: 'What is the current UK prime minister?',
    freshnessContext: { freshnessNeed: 'high' },
  });

  assert.equal(result.truth.retrievalEligible, false);
  assert.equal(result.truth.retrievalUsed, false);
  assert.match(result.truth.retrievalReason, /Freshness-sensitive/);
});

test('trivial world-fact query is retrieval-ineligible and does not run local-rag', () => {
  localRetrievalService.rebuildIndex();
  const result = localRetrievalService.query({
    prompt: 'what is the capital of france',
    freshnessContext: { freshnessNeed: 'low' },
  });

  assert.equal(result.truth.retrievalMode, 'none');
  assert.equal(result.truth.retrievalEligible, false);
  assert.equal(result.truth.retrievalUsed, false);
  assert.match(result.truth.retrievalReason, /Trivial non-project query/);
});

test('basic arithmetic query is retrieval-ineligible', () => {
  localRetrievalService.rebuildIndex();
  const result = localRetrievalService.query({
    prompt: 'what is 2 + 2?',
    freshnessContext: { freshnessNeed: 'low' },
  });

  assert.equal(result.truth.retrievalEligible, false);
  assert.equal(result.truth.retrievalUsed, false);
});
