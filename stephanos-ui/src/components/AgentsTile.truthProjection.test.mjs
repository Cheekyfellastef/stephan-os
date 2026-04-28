import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AgentsTile.jsx');

test('AgentsTile consumes finalAgentView projection and does not read runtime authority directly', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('runtimeStatusModel'), false);
  assert.equal(source.includes('runtimeTruth'), false);
  assert.equal(source.includes('canonicalRouteRuntimeTruth'), false);
  assert.equal(source.includes('finalAgentView'), true);
});

test('AgentsTile includes Agent Task Layer projection labels for shared adjudicated truth', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  const requiredLabels = [
    'Agent Task Layer v1',
    'Recommended agent:',
    'Codex readiness:',
    'OpenClaw readiness:',
    'Codex handoff readiness:',
    'Handoff mode:',
    'Copy Codex Packet',
    'Compact packet preview',
    'Current blockers:',
    'Approval gates pending:',
    'Handoff readiness:',
    'Verification:',
    'Verification return status:',
    'Return source:',
    'Verification decision:',
    'Merge readiness:',
    'Verification return next action:',
    'Manual return mode:',
    'Manual verification return paste (non-persistent v1 placeholder)',
    'Next best agent action:',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
});
