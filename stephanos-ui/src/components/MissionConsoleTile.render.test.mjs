import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MissionConsoleTile.jsx');

test('MissionConsoleTile includes mission router labels, governed routing, and explicit approval rail actions', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  const requiredLabels = [
    'Current Workspace:',
    'Agent Mission Console (Mission Router)',
    'Operator Authority:',
    'Runtime Truth Source:',
    'Current addressed target:',
    'Zero-Cost Guardrails:',
    'Approval Mode:',
    'Current session mode:',
    'Target: Agents → Mission Bridge',
    'Target: Stephanos → Assistant Router',
    'mission bridge mission id:',
    'mission bridge target agents:',
    'mission bridge approval-needed:',
    'mission bridge current packet state:',
    'Approve for Codex handoff',
    'Refine',
    'Archive',
    'Reject',
    'Integration Topology in Agent Mission Console',
    'Guardrails',
    'Intent-to-Build Control Loop',
    'Generate Mission Spec',
    'Copy Mission Spec',
    'Copy Codex Prompt',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
  assert.equal(source.includes('responder'), true);
  assert.equal(source.includes('approvalNeeded'), true);
  assert.equal(source.includes('linkedProposalId'), true);
});

test('MissionConsoleTile routes agent-targeted submit through mission bridge and labels routing distinction', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes("if (request.target.id === 'agents')"), true);
  assert.equal(source.includes('const bridgeResult = processMissionBridgeIntent({'), true);
  assert.equal(source.includes('applyMissionBridgeResult(bridgeResult);'), true);
  assert.equal(source.includes("if (request.target.id === 'stephanos')"), true);
  assert.equal(source.includes("Target: Agents → Mission Bridge"), true);
  assert.equal(source.includes("Target: Stephanos → Assistant Router"), true);
  assert.equal(source.includes("responder: 'Stephanos'"), true);
});
