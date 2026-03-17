import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseCommand, resolveRoute } from '../services/commandRouter.js';
import { memoryService } from '../services/memoryService.js';
import { proposalService } from '../services/proposalService.js';
import { knowledgeGraphService } from '../services/knowledgeGraphService.js';
import { simulationHistoryService } from '../services/simulationHistoryService.js';
import { simulationEngine } from '../services/simulationEngine.js';
import { activityLogService } from '../services/activityLogService.js';
import { roadmapService } from '../services/roadmapService.js';
import { buildErrorResponse } from '../services/responseBuilder.js';

const dataDir = path.resolve(process.cwd(), 'data');

function resetStores() {
  fs.rmSync(dataDir, { recursive: true, force: true });
  memoryService.loaded = false;
  memoryService.memory = [];
}

test('deterministic command parsing for new families', () => {
  const commands = ['/proposals accept proposal_1', '/activity show evt_1', '/roadmap done roadmap_1', '/simulate history show run_1', '/simulate compare a b'];
  const tools = commands.map((raw) => resolveRoute(parseCommand(raw), raw).tool);
  assert.deepEqual(tools, ['proposalAccept', 'activityShow', 'roadmapDone', 'simHistoryShow', 'simCompareRuns']);
});

test('proposal create/accept/reject lifecycle with provenance mutation', () => {
  resetStores();
  const mem = memoryService.saveMemory({ text: 'Cockpit mode preference', tags: ['preference'] });
  const proposal = proposalService.create({ type: 'create_graph_node', summary: 'Create preference node', payload: { label: 'Cockpit Mode', type: 'preference' }, relatedMemoryIds: [mem.id] });
  assert.equal(proposal.status, 'pending');

  const accepted = proposalService.accept(proposal.id);
  assert.equal(accepted.proposal.status, 'accepted');
  assert.equal(accepted.mutation.provenance.proposal_id, proposal.id);
  assert.deepEqual(accepted.mutation.provenance.source_ids, [mem.id]);

  const p2 = proposalService.create({ type: 'create_graph_node', summary: 'Rejected node', payload: { label: 'Reject Me', type: 'note' } });
  const rejected = proposalService.reject(p2.id, 'not needed');
  assert.equal(rejected.status, 'rejected');
});

test('simulation history persistence and comparison', () => {
  resetStores();
  const runA = simulationEngine.runSimulation('trajectory-demo', { startValue: 1000, monthlyContribution: 100, annualRate: 0.05, years: 2 });
  const savedA = simulationHistoryService.recordRun({ simulationId: 'trajectory-demo', input: runA.validatedInput, result: runA.result, timingMs: runA.timingMs });
  const runB = simulationEngine.runSimulation('trajectory-demo', { startValue: 2000, monthlyContribution: 100, annualRate: 0.05, years: 2 });
  const savedB = simulationHistoryService.recordRun({ simulationId: 'trajectory-demo', input: runB.validatedInput, result: runB.result, timingMs: runB.timingMs });
  const cmp = simulationHistoryService.compare(savedA.run_id, savedB.run_id);
  assert.equal(cmp.run_a.run_id, savedA.run_id);
  assert.ok(Object.keys(cmp.input_differences).includes('startValue'));
});

test('activity log recording and roadmap add/list/done', () => {
  resetStores();
  const roadmap = roadmapService.add('Implement near-term intelligence pack');
  roadmapService.markDone(roadmap.id);
  const events = activityLogService.list();
  assert.ok(events.some((evt) => evt.type === 'roadmap_item_added'));
  assert.ok(events.some((evt) => evt.type === 'roadmap_item_done'));
});

test('error response contract carries new error code', () => {
  const resp = buildErrorResponse({ route: 'proposals', command: '/proposals show', error: 'missing', error_code: 'PROPOSAL_NOT_FOUND' });
  assert.equal(resp.success, false);
  assert.equal(resp.error_code, 'PROPOSAL_NOT_FOUND');
});
