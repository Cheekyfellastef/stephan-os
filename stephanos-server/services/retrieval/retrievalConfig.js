import path from 'node:path';

export const RETRIEVAL_INDEX_VERSION = 1;

export const RETRIEVAL_CONFIG = Object.freeze({
  indexVersion: RETRIEVAL_INDEX_VERSION,
  maxChunkChars: 900,
  chunkOverlapChars: 140,
  maxResults: 4,
  maxPromptChars: 2600,
  allowlistedSources: [
    {
      sourceId: 'handoffs-docs-reports',
      sourceType: 'structured-handoff',
      root: 'docs/reports',
      include: ['.md'],
      mode: 'directory',
    },
    {
      sourceId: 'handoff-project-state',
      sourceType: 'structured-handoff',
      root: 'docs/project-state-snapshot.md',
      include: ['.md'],
      mode: 'file',
    },
    {
      sourceId: 'support-activity-events',
      sourceType: 'support-snapshot',
      root: 'stephanos-server/data/activity/events.json',
      include: ['.json'],
      mode: 'file',
    },
    {
      sourceId: 'support-memory-snapshot',
      sourceType: 'support-snapshot',
      root: 'stephanos-server/data/memory.json',
      include: ['.json'],
      mode: 'file',
    },
    {
      sourceId: 'notes-local',
      sourceType: 'project-note',
      root: 'docs/notes',
      include: ['.md', '.txt', '.json'],
      mode: 'directory',
      optional: true,
    },
    {
      sourceId: 'routing-reference-tests',
      sourceType: 'project-summary',
      root: 'stephanos-ui/src/ai/freshnessRouting.test.mjs',
      include: ['.mjs'],
      mode: 'file',
    },
    {
      sourceId: 'console-scroll-reference-tests',
      sourceType: 'project-summary',
      root: 'stephanos-ui/src/components/AIConsole.render.test.mjs',
      include: ['.mjs'],
      mode: 'file',
    },
  ],
});

export function resolveRetrievalDataPaths(repoRoot) {
  const baseDir = path.resolve(repoRoot, 'stephanos-server/data/local-rag');
  return {
    baseDir,
    indexFile: path.join(baseDir, 'index.json'),
  };
}
