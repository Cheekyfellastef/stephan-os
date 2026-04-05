import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, readJsonFile, writeJsonAtomic } from '../storageUtils.js';
import { RETRIEVAL_CONFIG, resolveRetrievalDataPaths } from './retrievalConfig.js';

export function loadRetrievalIndex({ repoRoot } = {}) {
  const paths = resolveRetrievalDataPaths(repoRoot);
  const payload = readJsonFile(paths.indexFile, null);
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'missing',
      paths,
      index: null,
    };
  }

  return {
    status: payload.indexVersion === RETRIEVAL_CONFIG.indexVersion ? 'ready' : 'degraded',
    paths,
    index: payload,
  };
}

export function saveRetrievalIndex({ repoRoot, payload }) {
  const paths = resolveRetrievalDataPaths(repoRoot);
  ensureDir(paths.baseDir);
  writeJsonAtomic(paths.indexFile, payload);
  return paths;
}

export function getRetrievalIndexMtime({ repoRoot }) {
  const paths = resolveRetrievalDataPaths(repoRoot);
  if (!fs.existsSync(paths.indexFile)) {
    return '';
  }
  const stats = fs.statSync(paths.indexFile);
  return stats.mtime.toISOString();
}

export function ensureRetrievalDataDir({ repoRoot }) {
  const paths = resolveRetrievalDataPaths(repoRoot);
  ensureDir(paths.baseDir);
  return path.resolve(paths.baseDir);
}
