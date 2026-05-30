import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentDir = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.resolve(componentDir, 'MissionConsoleTile.jsx');
const commandDeckPath = path.resolve(componentDir, 'MissionCommandDeck.jsx');
const stylesPath = path.resolve(componentDir, '../styles.css');

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
  assert.equal(source.includes('panelId={panelId}'), true);
  assert.equal(source.includes("isOpen={missionConsolePanelOpen}"), true);
  assert.equal(source.includes("onToggle={handleMissionConsolePanelToggle}"), true);
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
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleOperatorOverviewPanel')}"), true);
  assert.equal(source.includes('panelId="missionConsoleRuntimeRouteStatusPanel"'), true);
  assert.equal(source.includes("isOpen={uiLayout.missionConsoleRuntimeRouteStatusPanel !== false}"), true);
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleRuntimeRouteStatusPanel')}"), true);
});

test('MissionConsoleTile keeps priority mission console panels wired to canonical togglePanel ids', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'missionConsoleOperatorOverviewPanel',
    'missionConsoleRuntimeRouteStatusPanel',
    'missionConsoleOperatorReliefPanel',
    'missionConsoleSecondaryDiagnosticsPanel',
    'missionConsoleConnectedTileContextsPanel',
  ].forEach((panelId) => {
    assert.equal(source.includes(`panelId="${panelId}"`), true, `missing panelId ${panelId}`);
    assert.equal(source.includes(`isOpen={uiLayout.${panelId} !== false}`), true, `missing isOpen wiring for ${panelId}`);
    assert.equal(source.includes(`onToggle={() => dispatchPanelToggle('${panelId}')}`), true, `missing toggle wiring for ${panelId}`);
  });
});

test('MissionConsoleTile does not reuse panel ids across collapsible panels', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  const panelIds = [...source.matchAll(/panelId=\"([^\"]+)\"/g)].map((match) => match[1]);
  const seen = new Set();
  const duplicates = new Set();
  panelIds.forEach((id) => {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  assert.deepEqual([...duplicates], []);
});

test('MissionConsoleTile forcePanelOpen is scoped to missionConsolePanel and does not alter other panel toggle wiring', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /const missionConsolePanelOpen = forcePanelOpen \? true : uiLayout\[panelId\] !== false;/);
  assert.match(source, /if \(forcePanelOpen\) \{[\s\S]*return;\s*\}/m);
  assert.match(source, /dispatchPanelToggle\(panelId\)/);
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleOperatorOverviewPanel')}"), true);
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleRuntimeRouteStatusPanel')}"), true);
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleOperatorReliefPanel')}"), true);
});

test('MissionConsoleTile updates live pane diagnostics for landing-page agent mission console mount', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'actualPanelId',
    'forcePanelOpen',
    'isOpenFromUiLayout',
    'renderedOpenState',
    'lastToggleEvent',
    'togglePanelKey',
    'visibleChevronLayer',
    'visibleContentLayer',
  ].forEach((token) => assert.equal(source.includes(token), true, `missing diagnostics token: ${token}`));
  assert.equal(source.includes("if (panelId !== 'missionConsolePanel') return;"), true);
});

test('MissionConsoleTile passes explicit assistant-console surface owner key to AIConsole', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /<AIConsole[\s\S]*surfaceOwnerKey="mission-console-section"/m);
});

test('MissionConsoleTile promotes every internal mission console box to canonical CollapsiblePanel wiring', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  const canonicalPanelIds = [
    'missionConsoleOperatorOverviewPanel',
    'missionConsoleRuntimeRouteStatusPanel',
    'missionConsoleOperatorReliefPanel',
    'missionConsoleAssistantCommandConsolePanel',
    'missionConsoleSecondaryDiagnosticsPanel',
    'missionConsoleConnectedTileContextsPanel',
    'missionConsoleQuickContextPanel',
    'missionConsoleRoutingControlsPanel',
    'missionConsoleIntentToBuildPanel',
    'missionConsoleAgentAssignmentMatrixPanel',
    'missionConsoleRoutingReadinessPanel',
    'missionConsolePrEvidencePanel',
    'missionConsoleEvidenceLedgerPanel',
    'missionConsoleMissionIntelligencePanel',
    'missionConsoleRealityUpgradePanel',
    'missionConsoleConversationWorkspacePanel',
    'missionConsoleAgentCommandPanel',
    'missionConsoleSharedAgentContextPanel',
    'missionConsoleProposalApprovalRailPanel',
    'missionConsoleIntegrationTopologyPanel',
    'missionConsoleGuardrailsPanel',
  ];
  for (const panelId of canonicalPanelIds) {
    assert.equal(source.includes(`panelId="${panelId}"`), true, `missing canonical CollapsiblePanel for ${panelId}`);
    assert.equal(source.includes(`dispatchPanelToggle('${panelId}')`), true, `missing persisted collapse toggle for ${panelId}`);
    assert.equal(source.includes(`getMissionConsoleMoveControls('${panelId}')`), true, `missing Arrange Mode move controls for ${panelId}`);
    assert.equal(source.includes(`getMissionConsoleSectionOrderStyle('${panelId}')`), true, `missing persisted section order style for ${panelId}`);
  }
  assert.equal(source.includes('className="paneSection"'), false, 'legacy non-canonical paneSection wrappers should not remain');
});

test('MissionConsoleTile separates first-class AI Core Mission Console from internal assistant command console', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('<CollapsiblePanel\n          panelId="aiCoreMissionConsolePanel"'), false);
  assert.equal(source.includes('missionConsoleAssistantCommandConsolePanel'), true);
  assert.equal(source.includes('panelId="aiCoreMissionConsolePanel"'), true);
});

test('Mission Console activity and evidence feeds use compact canonical collapsible panels', async () => {
  const source = `${await fs.readFile(componentPath, 'utf8')}\n${await fs.readFile(commandDeckPath, 'utf8')}`;
  [
    'missionConsoleMissionCommandDeckActivityPanel',
    'missionConsoleCodexChangeSummaryPanel',
    'missionConsoleTestsBuildVerifyPanel',
    'missionConsoleBrowserProofChecklistPanel',
    'missionConsoleRuntimeEvidenceWarningsPanel',
    'missionConsoleMergeSafetyVerdictPanel',
    'missionConsoleNextBestActionPanel',
    'missionConsoleLessonCandidatesPanel',
    'missionConsoleOperatorDecisionQueuePanel',
  ].forEach((panelId) => {
    assert.equal(source.includes(`panelId="${panelId}"`), true, `missing compact feed panel: ${panelId}`);
    assert.equal(source.includes(`dispatchPanelToggle('${panelId}')`) || source.includes(`togglePanel('${panelId}')`), true, `missing uiLayout toggle persistence for: ${panelId}`);
  });
  assert.equal(source.includes('compact-feed-row compact-feed-row--empty'), true, 'empty feed state must use compact row class');
  assert.equal(source.includes('No recent activity'), true, 'empty feeds should not render giant blank cards');
  assert.equal(source.includes('aria-label="Mission Evidence Ledger compact event rows"'), true);
});

test('Mission Command Deck protects compact Agent Assignment Matrix structure', async () => {
  const source = await fs.readFile(commandDeckPath, 'utf8');
  assert.equal(source.includes('mission-deck-card--compact-matrix'), true, 'matrix card must opt into compact density styling');
  assert.equal(source.includes('mission-deck-assignment-rows--compact'), true, 'matrix rows must use compact row stack');
  assert.equal(source.includes('mission-deck-assignment-row--compact'), true, 'each matrix row must use compact row structure');
  assert.equal(source.includes('mission-deck-assignment-facts'), true, 'matrix entries must use grouped facts instead of tall paragraph gutters');
  assert.equal(source.includes('summarizeList(row.allowedActions, 2)'), true, 'allowed actions should be summarized to prevent tall rows');
  assert.equal(source.includes('summarizeList(row.blockedActions, 2)'), true, 'blocked actions should be summarized to prevent tall rows');
});

test('Mission Command Deck packet support and activity panes use dense packing hooks', async () => {
  const source = await fs.readFile(commandDeckPath, 'utf8');
  assert.equal(source.includes('mission-deck-grid-command-packet'), true, 'Mission Command Packet must expose a grid hook for dense packing');
  assert.equal(source.includes('mission-deck-grid-support-snapshot'), true, 'Support Snapshot must expose a grid hook for dense packing');
  assert.equal(source.includes('mission-deck-grid-activity-feed'), true, 'Activity Feed must keep a grid hook for dense packing');
  assert.equal(source.includes('as="article"'), true, 'Activity Feed must remain canonical CollapsiblePanel article');
  assert.equal(source.includes('panelId="missionConsoleMissionCommandDeckActivityPanel"'), true, 'Activity Feed collapse state must remain persisted by panel id');
  assert.equal(source.includes("togglePanel('missionConsoleMissionCommandDeckActivityPanel')"), true, 'Activity Feed toggle must still route through uiLayout persistence');
});

test('Mission Console nested Agent Assignment Matrix keeps canonical compact rows with move and collapse persistence', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('panelId="missionConsoleAgentAssignmentMatrixPanel"'), true, 'nested matrix must remain canonical CollapsiblePanel');
  assert.equal(source.includes("onToggle={() => dispatchPanelToggle('missionConsoleAgentAssignmentMatrixPanel')}"), true, 'nested matrix collapse must persist through dispatchPanelToggle');
  assert.equal(source.includes("actions={getMissionConsoleMoveControls('missionConsoleAgentAssignmentMatrixPanel')}"), true, 'nested matrix move controls must remain canonical and non-orphaned');
  assert.equal(source.includes("style={getMissionConsoleSectionOrderStyle('missionConsoleAgentAssignmentMatrixPanel')}"), true, 'nested matrix order persistence must remain canonical');
  assert.equal(source.includes('mission-console-compact-summary-grid'), true, 'nested matrix summary must use compact metric grid');
  assert.equal(source.includes('mission-console-agent-matrix-row'), true, 'nested matrix assignments must use compact rows');
  assert.equal(source.includes('mission-console__status-list mission-console-agent-matrix-list'), true, 'nested matrix should retain status-list canon while adding compact matrix styling');
});


test('Mission Console CSS protects dense Tetris packing and compact matrix rhythm', async () => {
  const source = await fs.readFile(stylesPath, 'utf8');
  assert.match(source, /\.mission-command-deck-grid\s*\{[\s\S]*grid-auto-flow:\s*dense;/, 'deck grid must use dense auto-placement to avoid vertical holes');
  assert.match(source, /\.mission-command-deck-grid\s*\{[\s\S]*grid-auto-rows:\s*minmax\(0, auto\);/, 'deck grid rows must remain content-height driven');
  assert.match(source, /\.mission-deck-card\.mission-deck-card--compact-matrix\s*\{[\s\S]*padding:\s*8px;/, 'matrix card padding must remain compact after legacy deck rules');
  assert.match(source, /\.mission-deck-assignment-row\.mission-deck-assignment-row--compact\s*\{[\s\S]*line-height:\s*1\.22;/, 'matrix rows must keep compact line-height');
  assert.match(source, /\.mission-console-agent-matrix-row\s*\{[\s\S]*font-size:\s*0\.75rem;[\s\S]*line-height:\s*1\.22;/, 'nested matrix rows must keep compact readable typography');
});

test('MissionConsoleTile Source Pack judgment button marks intake diagnostics and keeps existing workbench surface', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /data-testid="builder-workbench-openclaw-source-pack-text"/);
  assert.match(source, /data-testid="builder-workbench-openclaw-source-pack-output"/);
  assert.match(source, /Run Source Pack Intake Judgment/);
  assert.match(source, /openClawSourcePackIntakeButtonClicked: 'yes'/);
  assert.match(source, /openClawSourcePackJudgmentAttempted: 'yes'/);
  assert.match(source, /activePacketType: 'openclaw-source-pack-runner'/);
  assert.doesNotMatch(source, /title="OpenClaw Source Pack Dashboard/);
});
