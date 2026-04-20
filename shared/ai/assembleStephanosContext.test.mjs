import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleStephanosContext } from './assembleStephanosContext.mjs';
import { publishTileContextSnapshot, setActiveTileContextHint } from '../runtime/tileContextRegistry.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('assembleStephanosContext prioritizes active tile then relevant snapshots', () => {
  const storage = createStorage();

  publishTileContextSnapshot('wealthapp', {
    tileTitle: 'Wealth App',
    tileType: 'simulation',
    summary: 'ISA bridge assumptions configured.',
    structuredData: { retirementAge: 60 },
  }, { storage });

  publishTileContextSnapshot('wealth-simulation-scenarios', {
    tileTitle: 'Wealth Simulation Scenarios',
    tileType: 'simulation',
    summary: 'Energy shock scenario configured.',
    structuredData: { selectedScenario: 'energy-shock' },
  }, { storage });

  setActiveTileContextHint({ tileId: 'wealthapp', tileTitle: 'Wealth App' }, { storage });

  const assembled = assembleStephanosContext({
    userPrompt: 'How does my ISA bridge strategy work?',
    runtimeContext: { frontendOrigin: 'http://localhost:5173' },
    storage,
  });

  assert.equal(assembled.activeTileContext?.tileId, 'wealthapp');
  assert.equal(assembled.diagnostics.usedTileContextInjection, true);
  assert.equal(assembled.diagnostics.includedTileIds.includes('wealthapp'), true);
  assert.equal(assembled.contextVersion, 2);
});

test('assembleStephanosContext includes bounded ideas knowledge digest and retrieval excerpts', () => {
  const assembled = assembleStephanosContext({
    userPrompt: 'summarize my idea links',
    runtimeContext: {
      ideasState: {
        records: [{
          id: 'idea_1',
          title: 'Canonical retrieval',
          summary: 'Move retrieval toward shared governed memory.',
          tags: ['ideas', 'retrieval'],
          knowledge: {
            nodeType: 'idea-node',
            promotionStatus: 'promoted',
            actionTarget: 'runtime',
            collectionId: 'ops',
            relations: [{ targetId: 'idea_2', relationType: 'depends-on', notes: '' }],
            evidence: [{ id: 'ev-1', type: 'note', title: 'Runtime note', source: 'repo://note', notes: '' }],
          },
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }, {
          id: 'idea_2',
          title: 'Related idea',
          summary: 'Supports retrieval path.',
          tags: ['retrieval'],
          media: [],
          createdAt: '2026-04-19T00:00:00.000Z',
          updatedAt: '2026-04-19T00:00:00.000Z',
        }],
      },
      retrievalContext: [{
        sourceRef: 'idea:idea_1',
        document: 'A long retrieval body that should be bounded to a small excerpt for context assembly safety.',
        storageMode: 'local-fallback',
      }],
    },
  });

  assert.equal(assembled.ideasKnowledge.selectedIdea.id, 'idea_1');
  assert.equal(assembled.ideasKnowledge.relatedIdeas.length > 0, true);
  assert.equal(assembled.ideasKnowledge.retrievalExcerpts.length, 1);
  assert.equal(assembled.diagnostics.ideasKnowledgeIncluded, true);
});
