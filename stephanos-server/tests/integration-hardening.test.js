import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseCommand, resolveRoute } from '../services/commandRouter.js';
import { knowledgeGraphService } from '../services/knowledgeGraphService.js';
import { simulationEngine } from '../services/simulationEngine.js';
import { savePreset, loadPreset, deletePreset } from '../services/simulationPresets.js';
import { buildErrorResponse } from '../services/responseBuilder.js';

const kgDir = path.resolve(process.cwd(), 'data', 'knowledge-graph');
const simDir = path.resolve(process.cwd(), 'data', 'simulations');

function resetStores() {
  fs.rmSync(kgDir, { recursive: true, force: true });
  fs.rmSync(simDir, { recursive: true, force: true });
}

test('parser routes /kg and /simulate deterministically', () => {
  const kg = parseCommand('/kg delete node node_1');
  const sim = parseCommand('/simulate preset save baseline --simulation trajectory-demo --start 10 --years 2');
  assert.equal(resolveRoute(kg, kg.raw).tool, 'kgDeleteNode');
  assert.equal(resolveRoute(sim, sim.raw).tool, 'simPresetSave');
});

test('simulation engine happy path + invalid input path', () => {
  const run = simulationEngine.runSimulation('trajectory-demo', { startValue: 1000, monthlyContribution: 100, annualRate: 0.05, years: 2 });
  assert.equal(run.simulation.id, 'trajectory-demo');
  assert.throws(() => simulationEngine.runSimulation('trajectory-demo', { startValue: '', monthlyContribution: 100, annualRate: 0.05, years: 2 }));
});

test('graph create/search/related/duplicate prevention + edge creation', () => {
  resetStores();
  const n1 = knowledgeGraphService.createNode({ label: 'Alpha', type: 'project', tags: 'core' });
  const n2 = knowledgeGraphService.createNode({ label: 'Beta', type: 'project', tags: 'sim' });
  const edge = knowledgeGraphService.createEdge({ from: n1.id, to: n2.id, type: 'depends_on' });
  assert.ok(edge.id);
  const search = knowledgeGraphService.searchGraph('alp');
  assert.equal(search.node_matches.length, 1);
  const related = knowledgeGraphService.findRelatedNodes(n1.id);
  assert.equal(related.related.length, 1);
  assert.throws(() => knowledgeGraphService.createNode({ label: 'Alpha', type: 'project' }));
});

test('preset save/load/delete', () => {
  resetStores();
  savePreset('baseline', 'trajectory-demo', { startValue: 1 });
  const preset = loadPreset('baseline');
  assert.equal(preset.simulationId, 'trajectory-demo');
  const deleted = deletePreset('baseline');
  assert.equal(deleted.name, 'baseline');
});

test('standard deterministic error response contract includes error_code', () => {
  const resp = buildErrorResponse({ route: 'simulation', command: '/simulate run', error: 'bad input', error_code: 'SIM_INPUT_INVALID' });
  assert.equal(resp.success, false);
  assert.equal(resp.error_code, 'SIM_INPUT_INVALID');
  assert.equal(resp.type, 'error_result');
});
