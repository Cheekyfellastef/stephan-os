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
    'Mission Intelligence Brief',
    'Current phase:',
    'Recommended next mission:',
    'Execution posture:',
    'Mission Finish Authority:',
    'Routine finish allowed:',
    'Retry/Rebuild allowed:',
    'Merge authority:',
    'Auto-merge state:',
    'Operator Approval Recorded:',
    'Actual Merge State:',
    'Finish Warnings:',
    'Finish Next Action:',
    'Architecture Map / Likely Impact',
    'Affected Subsystems:',
    'Likely Source Files:',
    'Likely Tests:',
    'Generated Outputs:',
    'Source Truth Warnings:',
    'Architecture Risk Notes:',
    'verification judge:',
    'Memory Librarian / Canon Curator',
    'pending memory candidates:',
    'judgment:',
    'proof-of-done status:',
    'Merge Still Operator Controlled:',
    'Memory Review Needed:',
    'Rebuild / Verify Needed:',
    'Codex Repair Needed:',
    'Required Operator Decisions:',
    'Blocked Tasks:',
    'Recommended Routine Tasks:',
    'Safe to Continue Routine Finish:',
    'Task Finisher / Routine Finish Plan:',
    'merge-ready candidate:',
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
  assert.equal(source.includes('You are speaking to Stephanos through the Agent Mission Console.'), true);
  assert.equal(source.includes('You are routed to Agents → Mission Bridge.'), true);
  assert.equal(source.includes('You are routed to OpenClaw → Bounded Analysis.'), true);
});

test('MissionConsoleTile canonical OpenClaw fields are surfaced in compact truth summary', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'openClawHealthValidationStatus',
    'openClawHealthState',
    'openClawHandshakeState',
    'openClawProtocolCompatible',
    'openClawCapabilityTrial',
    'openClawProposalPacket',
    'openClawOperatorReviewQueue',
    'openClawOperatorReviewWorkflow',
    'openClawCodexProposalExport',
    'openClawCodexReviewResult',
    'openClawImplementationPlan',
    'openClawApprovalGateReadiness',
    'openClawDryRunPlan',
    'openClawControlledExecutionGate',
    'openClawExecutionAllowed',
  ].forEach((token) => assert.equal(source.includes(token), true, `missing canonical token: ${token}`));
  assert.equal(source.includes('openClawOperatorReviewWorkflowStatus'), true);
  assert.equal(source.includes('openClawCodexReviewResultStatus'), true);
});


test('MissionConsoleTile includes agent command console v1 non-executing workflow labels', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'Agent Command Console Mission Card',
    'Agent Command Queue',
    'Current Work Item Details',
    'Execution allowed:',
    'Codex mode:',
    'Proposal packet summary:',
  ].forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
  assert.equal(source.includes('manual_prompt'), true);
  assert.equal(source.includes('buildMissionIntelligenceLayer'), true);
});
