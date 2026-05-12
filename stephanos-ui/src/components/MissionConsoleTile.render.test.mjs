import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'MissionConsoleTile.jsx');

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
    'Target: Agents',
    'Mission Bridge',
    'Target: Stephanos',
    'Assistant Router',
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
    'Mission Routing / Delegation Readiness',
    'Mission Command Packet',
    'Agent Assignment Matrix',
    'Copy Packet Markdown',
    'Copy Packet JSON',
    'included systems summary:',
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
    'Mission Evidence Ledger',
    'evidence completeness:',
    'next required evidence:',
    'PR Evidence Intake',
    'normalized PR status:',
    'parse confidence:',
    'Parsed PR Evidence Preview',
    'Parse PR Evidence',
    'PR Evidence Input',
    'No PR evidence supplied yet.',
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
  assert.equal(source.includes("Target: Agents") && source.includes("Mission Bridge"), true);
  assert.equal(source.includes("Target: Stephanos") && source.includes("Assistant Router"), true);
  assert.equal(source.includes("responder: 'Stephanos'"), true);
  assert.equal(source.includes('You are speaking to Stephanos through the Agent Mission Console.'), true);
  assert.equal(source.includes('You are routed to Agents') && source.includes('Mission Bridge'), true);
  assert.equal(source.includes('You are routed to OpenClaw') && source.includes('Bounded Analysis'), true);
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


test('MissionConsoleTile renders dedicated wide workspace classes for command deck surface', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['mission-console-workspace', 'mission-console-workspace-wide', 'stephanos-workspace-surface', 'stephanos-workspace-surface--mission'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing workspace width token: ${token}`);
  });
});


test('MissionConsoleTile uses collapsible panel canon wiring for Agent Mission Console', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('panelId="missionConsolePanel"'), true);
  assert.equal(source.includes("isOpen={uiLayout.missionConsolePanel !== false}"), true);
  assert.equal(source.includes("onToggle={() => togglePanel('missionConsolePanel')}"), true);
  assert.equal(source.includes('aria-expanded={isOpen}'), false, 'aria-expanded should come from CollapsiblePanel canon, not duplicated locally');
});

test('MissionConsoleTile exposes Copy Perf Diagnostics control in diagnostics area', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('Copy Perf Diagnostics'), true);
  assert.equal(source.includes('copyPerfDiagnosticsSnapshot'), true);
});

test('MissionConsoleTile wraps operator overview and runtime status walls in canonical collapsible panels', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('panelId="missionConsoleOperatorOverviewPanel"'), true);
  assert.equal(source.includes("isOpen={uiLayout.missionConsoleOperatorOverviewPanel !== false}"), true);
  assert.equal(source.includes("onToggle={() => togglePanel('missionConsoleOperatorOverviewPanel')}"), true);
  assert.equal(source.includes('panelId="missionConsoleRuntimeRouteStatusPanel"'), true);
  assert.equal(source.includes("isOpen={uiLayout.missionConsoleRuntimeRouteStatusPanel !== false}"), true);
  assert.equal(source.includes("onToggle={() => togglePanel('missionConsoleRuntimeRouteStatusPanel')}"), true);
});
