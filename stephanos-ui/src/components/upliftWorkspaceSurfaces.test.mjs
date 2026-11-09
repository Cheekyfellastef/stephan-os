import '../../../shared/skill-forge/gateRepairSkillIntakeV1.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { deriveConversationLearningJourneyV1 } from '../../../shared/runtime/conversationLearningJourneyV1.mjs';
// Reuse the existing surface/Skill Forge test lane; do not create another GitHub authority workflow.
import '../../../shared/skill-forge/pinnedGithubSkillIntakeV2.test.mjs';

const flywheelUrl = new URL('./FlywheelPanel.jsx', import.meta.url);
const flywheelCanvasUrl = new URL('./FlywheelWorkspaceCanvas.jsx', import.meta.url);
const flywheelSeedCanopyUrl = new URL('./FlywheelSeedCanopy.jsx', import.meta.url);
const agentsUrl = new URL('./AgentsTile.jsx', import.meta.url);
const agentsCanvasUrl = new URL('./AgentsWorkspaceCanvas.jsx', import.meta.url);
const appUrl = new URL('../App.jsx', import.meta.url);
const stylesUrl = new URL('../styles.css', import.meta.url);
const sharedWorkspaceRouteUrl = new URL('../../../stephanos-server/routes/shared-workspace.js', import.meta.url);
const flywheelLauncherUrl = new URL('../../../apps/flywheel/index.html', import.meta.url);

test('Flywheel tile always renders the seed observatory while live evidence remains truth-gated', async () => {
  const [panel, canvas, canopy] = await Promise.all([
    readFile(flywheelUrl, 'utf8'),
    readFile(flywheelCanvasUrl, 'utf8'),
    readFile(flywheelSeedCanopyUrl, 'utf8'),
  ]);
  assert.match(panel, /requestWorkspaceHydration/);
  assert.match(panel, /workspaceId: 'flywheel'/);
  assert.match(panel, /datasets: \['dashboard'\]/);
  assert.match(panel, /deriveFlywheelWorkspaceView/);
  assert.match(panel, /<FlywheelWorkspaceCanvas/);
  assert.match(panel, /The observatory remains visible/);
  assert.doesNotMatch(panel, /No live Flywheel data is being claimed/);
  assert.equal(panel.indexOf('<FlywheelWorkspaceCanvas'), panel.lastIndexOf('<FlywheelWorkspaceCanvas'));
  assert.match(panel, /<FlywheelWorkspaceCanvas[\s\S]*\{view\.valid \? \(/);
  assert.match(canvas, /Flywheel Uplift Workspace/);
  assert.match(canvas, /Agent Uplift Field/);
  assert.match(canvas, /Uplift Heatmap/);
  assert.match(canvas, /Learning Timeline/);
  assert.match(canvas, /Brain Bay/);
  assert.match(canvas, /Starfield VR Outcome Ownership Seed/);
  assert.match(canvas, /CONTRACT READY · LIVE UNPROVEN/);
  assert.match(canvas, /Mission contract/);
  assert.match(canvas, /Live growth evidence/);
  assert.match(canvas, /PRESERVED ROUTES/);
  assert.match(canvas, /OPERATING LOOP/);
  assert.match(canvas, /CURRENT GROWTH GAPS/);
  assert.match(canvas, /Missing evidence stays UNKNOWN/);
  assert.match(canvas, /recent \/.* total/);
  assert.match(canvas, /source evidence/);
  assert.match(panel, /Source evidence/);
  assert.match(panel, /freshness window/);
  assert.match(canopy, /LIVING OUTCOME GARDEN/);
  assert.match(canopy, /Seed Canopy/);
  assert.match(canopy, /Project Foreman/);
  assert.match(canopy, /Conversation Intelligence/);
  assert.match(canopy, /Sovereign Commander Parity/);
  assert.match(canopy, /Full Sovereignty/);
  assert.match(canopy, /Meter Independence/);
  assert.match(canopy, /Current rung/);
  assert.match(canopy, /Growth pressure/);
  assert.match(canopy, /Open roots/);
  assert.match(canopy, /Proof/);
  assert.match(canopy, /NEXT RUNG/);
  assert.match(canopy, /NORTH STAR/);
});

test('Agents tile renders command constellation and receives canonical backend routing context', async () => {
  const [tile, canvas, app] = await Promise.all([readFile(agentsUrl, 'utf8'), readFile(agentsCanvasUrl, 'utf8'), readFile(appUrl, 'utf8')]);
  assert.match(tile, /dashboard-feed\?scope=full-history/);
  assert.match(tile, /deriveAgentsWorkspaceView/);
  assert.match(tile, /<AgentsWorkspaceCanvas/);
  assert.match(tile, /workspaceSelectedAgentId/);
  assert.match(tile, /handleWorkspaceSelectAgent/);
  assert.match(tile, /setWorkspaceSelectedAgentId\(nextAgentId\)/);
  assert.match(tile, /visibleAgents\.some\(\(entry\) => entry\.agentId === nextAgentId\)\) onSelectAgent\?\.\(nextAgentId\)/);
  assert.match(tile, /selectedAgentId=\{workspaceSelectedAgentId \|\| selectedAgentId\}/);
  assert.match(app, /bridgeTransportTruth=\{runtimeStatusModel\?\.runtimeContext\?\.bridgeTransportTruth \|\| null\}/);
  assert.match(app, /homeBridgeUrl=\{runtimeStatusModel\?\.runtimeContext\?\.homeNodeBridge\?\.backendUrl \|\| ''\}/);
  assert.match(app, /runtimeStatusModel=\{runtimeStatusModel\}/);
  assert.match(canvas, /Agents Intelligence Observatory/);
  assert.match(canvas, /Agent Constellation/);
  assert.match(canvas, /Capability Vector/);
  assert.match(canvas, /Evidence fabric/);
  assert.match(canvas, /FLYWHEEL UPLIFT QUEUE/);
  assert.match(canvas, /AGENT PASSPORT/);
  assert.match(canvas, /FLYWHEEL DIAGNOSIS/);
  assert.match(canvas, /GROWTH FRONTIER/);
  assert.match(canvas, /CURRENT GAPS · WHY UPLIFT\?/);
  assert.match(canvas, /RESOLVED HISTORY · STILL REMEMBERED/);
  assert.match(canvas, /EVIDENCE TIMELINE/);
});

test('uplift workspace styling provides shared starship visual system without hiding truth states', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /\.uplift-workspace/);
  assert.match(styles, /\.uplift-truth-orb\.current/);
  assert.match(styles, /\.uplift-heat-cell\.unknown/);
  assert.match(styles, /\.agent-constellation-card/);
  assert.match(styles, /\.agent-capability-vector/);
  assert.match(styles, /\.agent-uplift-queue-card/);
  assert.match(styles, /\.agent-passport-grid/);
  assert.match(styles, /\.agent-gap-columns/);
  assert.match(styles, /\.agent-growth-frontier/);
  assert.match(styles, /\.outcome-seed-observatory/);
  assert.match(styles, /\.outcome-seed-growth-grid/);
  assert.match(styles, /\.outcome-seed-loop/);
});


test('Shared Workspace historical scope is an opt-in read-only projection path', async () => {
  const source = await readFile(sharedWorkspaceRouteUrl, 'utf8');
  assert.match(source, /router\.get\('\/dashboard-feed'/);
  assert.match(source, /req\.query\?\.scope/);
  assert.match(source, /requestedScope === 'full-history'/);
  assert.match(source, /recordScope/);
  assert.match(source, /Cache-Control/);
});


test('landing-page Flywheel tile opens the dedicated Flywheel surface', async () => {
  const [app, launcher] = await Promise.all([readFile(appUrl, 'utf8'), readFile(flywheelLauncherUrl, 'utf8')]);
  assert.match(app, /const flywheelSurfaceMode = surfaceMode === 'flywheel'/);
  assert.match(app, /if \(flywheelSurfaceMode\)/);
  assert.match(app, /FLYWHEEL SURFACE/);
  assert.match(launcher, /searchParams\.set\('surface', 'flywheel'\)/);
  assert.match(launcher, /stephanosLauncherShellUrl/);
});


test('dedicated Agents landing surface opens the canonical workspace while normal pane remains collapsible', async () => {
  const [app, tile, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(agentsUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);
  const dedicatedStart = app.indexOf('if (agentsSurfaceMode)');
  const dedicatedEnd = app.indexOf('if (flywheelSurfaceMode)', dedicatedStart);
  const dedicatedBlock = app.slice(dedicatedStart, dedicatedEnd);
  const normalPaneStart = app.indexOf("id: 'agentsPanel'");
  const normalPaneEnd = app.indexOf("id: 'promptBuilderPanel'", normalPaneStart);
  const normalPaneBlock = app.slice(normalPaneStart, normalPaneEnd);
  assert.match(dedicatedBlock, /<AgentsTile[\s\S]*forcePanelOpen/);
  assert.equal((dedicatedBlock.match(/forcePanelOpen/g) || []).length, 1);
  assert.doesNotMatch(normalPaneBlock, /forcePanelOpen/);
  assert.match(tile, /const resolvedIsOpen = forcePanelOpen \|\| uiLayout\.agentsPanel !== false/);
  assert.match(tile, /agents-tile--workspace-surface/);
  assert.match(styles, /\.agents-tile--workspace-surface > \.panel-header-row[\s\S]*display:\s*none/);
});


test('fleet care marker stays asserted in the existing trusted UI test suite', async () => {
  const source = await readFile(flywheelSeedCanopyUrl, 'utf8');
  assert.match(source, /goal-conveyor-fleet-care/);
  assert.match(source, /Conveyor & Fleet Care/);
});


const skillForgeUrl = new URL('./SkillForgeTile.jsx', import.meta.url);
const skillForgeStylesUrl = new URL('./SkillForgeObservatory.css', import.meta.url);
const stephanosOverviewUrl = new URL('./StephanosCommandObservatory.jsx', import.meta.url);
const stephanosOverviewStylesUrl = new URL('./StephanosCommandObservatory.css', import.meta.url);
const skillForgeModelUrl = new URL('../../../shared/skill-forge/skillGrowthProjectionV1.mjs', import.meta.url);

test('dedicated Skill Forge workspace and parent Stephanos command observatory are truth-linked', async () => {
  const [app, forge, forgeCss, overview, overviewCss, model] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(skillForgeUrl, 'utf8'),
    readFile(skillForgeStylesUrl, 'utf8'),
    readFile(stephanosOverviewUrl, 'utf8'),
    readFile(stephanosOverviewStylesUrl, 'utf8'),
    readFile(skillForgeModelUrl, 'utf8'),
  ]);
  assert.match(app, /if \(skillForgeSurfaceMode\)/);
  assert.match(app, /SKILL FORGE SURFACE/);
  assert.match(app, /<SkillForgeTile[\s\S]*forcePanelOpen/);
  assert.match(app, /<StephanosCommandObservatory/);
  assert.match(forge, /dashboard-feed\?scope=full-history/);
  assert.match(forge, /Capability Genesis Observatory/);
  assert.match(forge, /Cross-agent qualification gate/);
  assert.match(forge, /Skill blueprint vault/);
  assert.match(forge, /forcePanelOpen/);
  assert.match(forgeCss, /\.skill-observatory__hero/);
  assert.match(overview, /Command Observatory/);
  assert.match(overview, /Shared Workspace/);
  assert.match(overview, /Skill Forge/);
  assert.match(overviewCss, /\.stephanos-ops-metrics/);
  assert.match(model, /autoGrant: false/);
  assert.match(model, /activated: false/);
});

test('skill provenance never infers activation from an exam or static seed', async () => {
  const { deriveSkillGrowthObservatoryV1, buildSkillTransferAssessmentV1 } = await import(skillForgeModelUrl);
  const lesson = {
    schemaVersion:'stephanos.closed-loop-learning.v1',
    eventId:'capability-diagnostic',
    capabilityId:'diagnostics',
    teacherId:'openclaw-local',
    state:'RETRY_READY',
    learningCandidate:{lessonId:'diagnostics'},
    exam:{passed:true,proofRefs:['exam:1']},
    verification:{passed:true,proofRefs:['runtime:1']},
  };
  const view = deriveSkillGrowthObservatoryV1({
    seedSkills:[{id:'seed',status:'ACTIVE'}],
    payload:{state:'ready',records:{eventRecords:[{eventId:'capability-diagnostic',closedLoopLearning:lesson}]}}
  });
  assert.equal(view.summary.proposals, 2); // one seed and one conjured, still uninstalled
  assert.equal(view.summary.verifiedLessons, 1);
  assert.equal(view.summary.provenActiveTargets, 0);
  const transfer = buildSkillTransferAssessmentV1({
    learning:lesson,sourceActor:'openclaw-local',targetActor:'openclaw-standalone',
  });
  assert.equal(transfer.activated,false);
  assert.equal(transfer.eligibleForExistingApprovedActivationRoute,false);
  assert.ok(transfer.blockers.includes('operatorApprovalPresent'));
});


test('Flywheel and Skill Forge both render one shared, truth-gated conversation improvement journey', async () => {
  const [panel, canvas, forge, component, css] = await Promise.all([
    readFile(flywheelUrl, 'utf8'),
    readFile(flywheelCanvasUrl, 'utf8'),
    readFile(skillForgeUrl, 'utf8'),
    readFile(new URL('./ConversationLearningJourney.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./ConversationLearningJourney.css', import.meta.url), 'utf8'),
  ]);
  assert.match(panel, /conversationUplift=\{telemetry\.payload\?\.conversationUplift \|\| null\}/);
  assert.match(panel, /conversationFeedState=\{telemetry\.state === 'unreachable'/);
  assert.match(canvas, /<ConversationLearningJourney[\s\S]*placement="flywheel"/);
  assert.match(forge, /<ConversationLearningJourney[\s\S]*placement="skill-forge"/);
  assert.match(forge, /feedState=\{refreshState === 'RECEIVED'/);
  assert.match(component, /Conversation Intelligence · Improvement Journey/);
  assert.match(component, /KNOWLEDGE → CAPABILITY → PROOF/);
  assert.match(component, /UNKNOWN/);
  assert.match(component, /builder and runtime evidence/);
  assert.match(component, /view\.provenanceNote/);
  assert.match(css, /max-width: 760px/);
});

test('conversation journey never promotes unverified conversation hints into builder completions', () => {
  const uplift = {
    state: 'ready', turnCount: 301,
    candidates: [{
      id: 'goal-conveyor', title: 'Investigate conveyor',
      classification: 'CONVERSATION_HINT_REVIEW_REQUIRED',
      provenCapabilityFailure: false, eligibleForBoundedInvestigation: true,
      mentionCount: 4, sourceTurnRefs: ['workspace://one', 'workspace://two'],
    }],
  };
  const ready = deriveConversationLearningJourneyV1({ uplift, feedState: 'ready' });
  assert.equal(ready.indexedTurns, 301);
  assert.equal(ready.investigationEligible, 1);
  assert.equal(ready.admittedGoals, null);
  assert.equal(ready.builderPickups, null);
  assert.equal(ready.provenImprovements, null);
  assert.equal(JSON.stringify(ready).includes('workspace://one'), false);

  for (const state of ['unavailable', 'connecting']) {
    const result = deriveConversationLearningJourneyV1({ uplift, feedState: state });
    assert.equal(result.indexedTurns, null);
    assert.equal(result.provenImprovements, null);
    assert.notEqual(result.state, 'REPORTED');
  }
  assert.equal(deriveConversationLearningJourneyV1({ uplift, feedState: 'stale' }).indexedTurns, 301);
});
