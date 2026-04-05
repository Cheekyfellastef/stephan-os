import fs from 'node:fs';
import path from 'node:path';
import { RETRIEVAL_CONFIG } from './retrievalConfig.js';

function normalizePathSlashes(value = '') {
  return String(value || '').split(path.sep).join('/');
}

function listDirectoryFiles(dirPath, includeExtensions = []) {
  const extSet = new Set((includeExtensions || []).map((item) => String(item || '').toLowerCase()));
  const results = [];

  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (extSet.size === 0 || extSet.has(extension)) {
          results.push(fullPath);
        }
      }
    }
  };

  walk(dirPath);
  return results;
}

function parseTimestampFromDocument(payload, stats) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.updatedAt === 'string' && payload.updatedAt.trim()) return payload.updatedAt;
    if (typeof payload.timestamp === 'string' && payload.timestamp.trim()) return payload.timestamp;
  }
  if (stats?.mtime instanceof Date && Number.isFinite(stats.mtime.getTime())) {
    return stats.mtime.toISOString();
  }
  return '';
}

function materializeDocumentText(content = '', extension = '.txt') {
  if (extension === '.json') {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => JSON.stringify(item)).join('\n');
      }
      if (parsed && typeof parsed === 'object') {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      return content;
    }
  }
  return content;
}

export function ingestAllowlistedCorpus({ repoRoot, config = RETRIEVAL_CONFIG } = {}) {
  const entries = [];
  const skipped = [];

  for (const source of config.allowlistedSources) {
    const rootPath = path.resolve(repoRoot, source.root);
    if (!fs.existsSync(rootPath)) {
      if (!source.optional) {
        skipped.push({ sourceId: source.sourceId, reason: 'missing-root', root: source.root });
      }
      continue;
    }

    const filePaths = source.mode === 'directory'
      ? listDirectoryFiles(rootPath, source.include)
      : [rootPath];

    filePaths
      .map((absolutePath) => path.resolve(absolutePath))
      .sort((a, b) => a.localeCompare(b))
      .forEach((absolutePath) => {
        const extension = path.extname(absolutePath).toLowerCase();
        const includeSet = new Set((source.include || []).map((item) => String(item || '').toLowerCase()));
        if (includeSet.size > 0 && !includeSet.has(extension)) {
          return;
        }

        const raw = fs.readFileSync(absolutePath, 'utf8');
        const stats = fs.statSync(absolutePath);
        const relativePath = normalizePathSlashes(path.relative(repoRoot, absolutePath));
        const payload = extension === '.json'
          ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })()
          : null;
        entries.push({
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          documentId: normalizePathSlashes(relativePath),
          path: normalizePathSlashes(relativePath),
          title: path.basename(absolutePath),
          timestamp: parseTimestampFromDocument(payload, stats),
          text: materializeDocumentText(raw, extension),
        });
      });
  }

  const ordered = entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    documents: ordered,
    skipped,
    ingestCount: ordered.length,
  };
}
