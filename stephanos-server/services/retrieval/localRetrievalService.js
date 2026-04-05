import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETRIEVAL_CONFIG } from './retrievalConfig.js';
import { ingestAllowlistedCorpus } from './retrievalCorpusRegistry.js';
import { chunkDocument } from './retrievalChunker.js';
import { buildLexicalIndex, searchChunks } from './retrievalSearch.js';
import { createDefaultRetrievalTruth, determineRetrievalEligibility } from './retrievalTruthModel.js';
import { ensureRetrievalDataDir, getRetrievalIndexMtime, loadRetrievalIndex, saveRetrievalIndex } from './retrievalIndexStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

let inMemoryIndex = null;
let currentIndexStatus = 'missing';

function normalizeQuery(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildRetrievalContextBlock(results = [], maxPromptChars = RETRIEVAL_CONFIG.maxPromptChars) {
  const lines = ['Retrieved local project context (local-rag):'];
  let usedChars = lines[0].length;

  for (const result of results) {
    const chunk = result.chunk;
    const label = `${chunk.sourceType}:${chunk.path}#${chunk.chunkIndex}`;
    const snippet = String(chunk.text || '').slice(0, 500);
    const next = `- [${label}] ${snippet}`;
    if ((usedChars + next.length) > maxPromptChars) {
      break;
    }
    lines.push(next);
    usedChars += next.length;
  }

  return lines.join('\n');
}

function toSourceDescriptor(result) {
  const chunk = result.chunk;
  return {
    sourceId: chunk.sourceId,
    sourceType: chunk.sourceType,
    path: chunk.path,
    chunkIndex: chunk.chunkIndex,
    title: chunk.title || '',
    timestamp: chunk.timestamp || '',
    score: Number(result.score.toFixed(5)),
  };
}

function rebuildIndex() {
  const ingestion = ingestAllowlistedCorpus({ repoRoot, config: RETRIEVAL_CONFIG });
  const chunks = ingestion.documents.flatMap((document) => chunkDocument({
    sourceId: document.sourceId,
    sourceType: document.sourceType,
    documentId: document.documentId,
    relativePath: document.path,
    title: document.title,
    timestamp: document.timestamp,
    text: document.text,
    maxChunkChars: RETRIEVAL_CONFIG.maxChunkChars,
    chunkOverlapChars: RETRIEVAL_CONFIG.chunkOverlapChars,
  }));
  const lexicalIndex = buildLexicalIndex(chunks);
  const builtAt = new Date().toISOString();
  const payload = {
    schema: 'stephanos-local-rag-index',
    indexVersion: RETRIEVAL_CONFIG.indexVersion,
    builtAt,
    config: {
      maxChunkChars: RETRIEVAL_CONFIG.maxChunkChars,
      chunkOverlapChars: RETRIEVAL_CONFIG.chunkOverlapChars,
      maxResults: RETRIEVAL_CONFIG.maxResults,
      maxPromptChars: RETRIEVAL_CONFIG.maxPromptChars,
      allowlistedSources: RETRIEVAL_CONFIG.allowlistedSources,
    },
    corpusManifest: {
      ingestCount: ingestion.ingestCount,
      sourceIds: [...new Set(ingestion.documents.map((doc) => doc.sourceId))],
      skipped: ingestion.skipped,
      documentPaths: ingestion.documents.map((doc) => doc.path),
    },
    chunks,
    lexicalIndex,
  };

  saveRetrievalIndex({ repoRoot, payload });
  inMemoryIndex = payload;
  currentIndexStatus = 'ready';
  return payload;
}

function ensureIndexReady() {
  if (inMemoryIndex) {
    return { status: currentIndexStatus, index: inMemoryIndex };
  }

  ensureRetrievalDataDir({ repoRoot });
  const loaded = loadRetrievalIndex({ repoRoot });
  if (loaded.index && loaded.status === 'ready') {
    inMemoryIndex = loaded.index;
    currentIndexStatus = loaded.status;
    return { status: loaded.status, index: loaded.index };
  }

  currentIndexStatus = loaded.status;
  const rebuilt = rebuildIndex();
  return { status: 'ready', index: rebuilt };
}

function query({ prompt = '', freshnessContext = null } = {}) {
  const truth = createDefaultRetrievalTruth();
  const normalizedQuery = normalizeQuery(prompt);
  const eligibility = determineRetrievalEligibility({ prompt: normalizedQuery, freshnessContext });
  const indexReady = ensureIndexReady();
  truth.retrievalIndexStatus = indexReady.status;
  truth.retrievalEligible = eligibility.eligible;
  truth.retrievalReason = eligibility.reason;
  truth.retrievalQuery = normalizedQuery.slice(0, 280);

  if (!eligibility.eligible) {
    return { truth, results: [], contextBlock: '' };
  }

  if (!indexReady.index || !Array.isArray(indexReady.index.chunks) || indexReady.index.chunks.length === 0) {
    truth.retrievalReason = 'Retrieval index unavailable or empty.';
    truth.retrievalIndexStatus = 'degraded';
    return { truth, results: [], contextBlock: '' };
  }

  const results = searchChunks({
    query: normalizedQuery,
    chunks: indexReady.index.chunks,
    lexicalIndex: indexReady.index.lexicalIndex,
    maxResults: RETRIEVAL_CONFIG.maxResults,
  });

  truth.retrievalMode = 'local-rag';
  truth.retrievalUsed = results.length > 0;
  truth.retrievedChunkCount = results.length;
  truth.retrievedSources = results.map(toSourceDescriptor);
  truth.retrievalReason = results.length > 0
    ? `Retrieved ${results.length} local chunk(s).`
    : 'Eligible query but no matching local chunks were found.';

  return {
    truth,
    results,
    contextBlock: results.length > 0 ? buildRetrievalContextBlock(results) : '',
  };
}

function getStatus() {
  const status = ensureIndexReady();
  return {
    retrievalIndexStatus: status.status,
    chunkCount: Array.isArray(status.index?.chunks) ? status.index.chunks.length : 0,
    sourceCount: Array.isArray(status.index?.corpusManifest?.sourceIds) ? status.index.corpusManifest.sourceIds.length : 0,
    builtAt: status.index?.builtAt || '',
    indexMtime: getRetrievalIndexMtime({ repoRoot }),
  };
}

export const localRetrievalService = {
  rebuildIndex,
  query,
  getStatus,
};
