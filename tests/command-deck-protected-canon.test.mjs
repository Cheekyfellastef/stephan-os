import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const aiConsolePath = new URL('../stephanos-ui/src/components/AIConsole.jsx', import.meta.url);
const stylesPath = new URL('../stephanos-ui/src/styles.css', import.meta.url);

const missionConsoleTilePath = new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url);
const appPath = new URL('../stephanos-ui/src/App.jsx', import.meta.url);
const missionCommandDeckPath = new URL('../stephanos-ui/src/components/MissionCommandDeck.jsx', import.meta.url);

async function read(fileUrl) {
  return fs.readFile(fileUrl, 'utf8');
}

test('protected canon: command deck composer/input/execute selectors are present for DOM proof', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /data-testid="command-deck-root"/);
  assert.match(source, /data-testid="command-deck-body"/);
  assert.match(source, /data-testid="command-deck-answer-history"/);
  assert.match(source, /data-testid="command-deck-composer"/);
  assert.match(source, /data-testid="command-deck-input"/);
  assert.match(source, /data-testid="command-deck-execute"/);
});

test('protected canon: layout diagnostics include visibility and non-zero-height verdict fields', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /resolveVisibleCommandDeckRoot/);
  assert.match(source, /commandDeckComposerBottomWithinView/);
  assert.match(source, /commandDeckInputVisible/);
  assert.match(source, /commandDeckExecuteButtonVisible/);
  assert.match(source, /commandDeckLayoutVerdict/);
  assert.match(source, /commandDeckLayoutBlocker/);
  assert.match(source, /viewPaneHeight/);
  assert.match(source, /latestAssistantAnswerDomFound/);
  assert.match(source, /answerViewportFitsLatestAnswer/);
  assert.match(source, /answerViewportFitVerdict/);
  assert.match(source, /standardAnswerFitTarget/);
  assert.match(source, /standardTenItemAnswerFitVerdict/);
  assert.match(source, /answerViewportTooSmallReason/);
  assert.match(source, /latestAssistantVisualProof/);
  assert.match(source, /latestAssistantVisibilityBlocker/);
  assert.match(source, /deriveLatestAssistantVisibilityBlocker/);
  assert.match(source, /outerRevealRequested/);
  assert.match(source, /outerRevealSkipped/);
  assert.match(source, /outerRevealSkipReason/);
  assert.match(source, /pageJumpPrevented/);
  assert.match(source, /innerHistoryScrollCompleted/);
});



test('protected canon: support snapshot keeps missing visible command deck diagnostics as hard failures', async () => {
  const source = await read(new URL('../stephanos-ui/src/state/supportSnapshot.js', import.meta.url));
  assert.match(source, /Visible Deck Root Found:/);
  assert.match(source, /History Container Found:/);
  assert.match(source, /Composer Found:/);
  assert.match(source, /Input Found:/);
  assert.match(source, /Execute Found:/);
  assert.match(source, /Answer Pane Count:/);
  assert.match(source, /Command Deck Render Proof Source:/);
  assert.match(source, /Latest Assistant DOM Proof Source:/);
  assert.match(source, /Answer Delivery Rendered Zero Pane Explanation:/);
  assert.match(source, /Latest Assistant Visual Proof:/);
  assert.match(source, /Latest Assistant Visibility Blocker:/);
  assert.match(source, /Latest Assistant Text Length Drift:/);
  assert.match(source, /\[data-answer-role=\"assistant\"\]\[data-answer-final=\"true\"\]\[data-assistant-answer-id\]/);
  assert.match(source, /render-proof-from-local-ref/);
  assert.match(source, /Command Deck Ownership Instance Count:/);
  assert.match(source, /Command Deck DOM Fallback Root Found:/);
});

test('protected canon: answer history scrolls while composer is fixed in flow and non-shrinking', async () => {
  const styles = await read(stylesPath);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*flex:\s*1\s+1\s+auto;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*min-height:\s*clamp\(20rem,\s*46vh,\s*34rem\);/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*max-height:\s*clamp\(28rem,\s*66vh,\s*50rem\);/m);
  assert.match(styles, /\.mission-console-input,[\s\S]*\.mission-console__composer[\s\S]*flex-shrink:\s*0;/m);
});

test('protected canon: composer sits after answer history inside command deck and before lower status/tools surfaces', async () => {
  const source = await read(aiConsolePath);
  const historyIndex = source.lastIndexOf('data-testid="command-deck-answer-history"');
  const composerIndex = source.lastIndexOf('data-testid="command-deck-composer"');
  const executeIndex = source.lastIndexOf('data-testid="command-deck-execute"');
  assert.ok(historyIndex >= 0);
  assert.ok(composerIndex > historyIndex);
  assert.ok(executeIndex > composerIndex);
});

test('protected canon: dev-mode inline failure marker exists if composer contract breaks', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /Command Deck composer missing — protected canon failure\./);
  assert.match(source, /setComposerContractFailure\(/);
});


test('protected canon: no silent none scroll reason after final assistant answer render path', async () => {
  const source = await read(aiConsolePath);
  assert.match(source, /skipReason: 'already-revealed-current-answer'/);
  assert.match(source, /requestReason: 'missing-target-diagnostic-failure'/);
  assert.match(source, /requestReason: 'missing-container-diagnostic-failure'/);
  assert.match(source, /requestReason: 'reveal-skipped-by-policy'/);
  assert.doesNotMatch(source, /same-answer-signature-already-scrolled'\s*\}\)/);
});


test('protected canon: mission brain top-3 stays inside existing operator relief surface with no parallel command deck framework', async () => {
  const source = await read(missionConsoleTilePath);
  assert.match(source, /title="Operator Relief v2 · Mission Brain"/);
  assert.match(source, /Top 3 Problems \/ Next Moves/);
  assert.match(source, /<div data-testid="mission-console-inner-command-deck">/);
  assert.match(source, /<MissionCommandDeck/);
  assert.match(source, /<AIConsole/);
  assert.doesNotMatch(source, /mission-console-duplicate-pane/i);
  assert.doesNotMatch(source, /parallel-pane-framework/i);

  const aiConsoleMatches = source.match(/<AIConsole/g) || [];
  const commandDeckMatches = source.match(/<MissionCommandDeck/g) || [];
  assert.equal(aiConsoleMatches.length, 1);
  assert.equal(commandDeckMatches.length, 1);

  const top3Index = source.indexOf('Top 3 Problems / Next Moves');
  const operatorReliefIndex = source.indexOf('mission-console-section--operator-relief');
  assert.ok(top3Index > operatorReliefIndex);
});


test('protected canon: render sites pass canonical and non-canonical AIConsole identities', async () => {
  const appSource = await read(appPath);
  const missionSource = await read(missionConsoleTilePath);
  assert.match(appSource, /<AIConsole[\s\S]*surfaceOwnerKey="commandDeck-pane"[\s\S]*panelId="commandDeck"/m);
  assert.match(appSource, /submissionSource: 'stephanos-command-deck'/);
  assert.match(missionSource, /<AIConsole[\s\S]*surfaceOwnerKey="mission-console-section"[\s\S]*panelId="aiCoreMissionConsolePanel"/m);
  assert.match(missionSource, /submissionSource: 'stephanos-mission-console'/);
});

test('protected canon: agent reality loop repair stays on existing projection path without scroll/autoscroll changes', async () => {
  const hookSource = await read(new URL('../stephanos-ui/src/hooks/useAIConsole.js', import.meta.url));
  const missionSource = await read(missionConsoleTilePath);
  assert.match(hookSource, /submitRuntimeContextWithOperatorReliefBridge/);
  assert.match(hookSource, /createAgentRealityLoopDeterministicResult/);
  assert.match(hookSource, /agent_reality_loop_unavailable_claim_suppressed: 'yes'/);
  assert.match(missionSource, /data-mission-console-registration-callback-invoked=\{registrationTraceState\.callbackInvoked\}/);
  assert.doesNotMatch(hookSource, /manual-scroll suppression/i);
});

test('protected canon: builder harness stays inside Operator Relief and keeps Codex fallback-only', async () => {
  const source = await read(missionConsoleTilePath);
  assert.match(source, /title="Operator Relief v2 · Mission Brain"/);
  assert.match(source, /panelId="missionConsoleBuilderHarnessPanel"/);
  assert.match(source, /OpenClaw Builder Harness V1/);
  assert.match(source, /Copy Local AI Review Packet/);
  assert.match(source, /Copy OpenClaw Patch Plan Packet/);
  assert.match(source, /Copy GitHub PR Inspection Packet/);
  assert.match(source, /Copy Codex Fallback Packet/);
  assert.match(source, /fallback\/specialist only/);
  assert.match(source, /fallback-specialist-only/);
  assert.doesNotMatch(source, /builder-harness-duplicate-pane/i);
  assert.match(source, /No auto-merge:/);

  const builderHarnessIndex = source.indexOf('missionConsoleBuilderHarnessPanel');
  const operatorReliefIndex = source.indexOf('mission-console-section--operator-relief');
  const commandDeckIndex = source.indexOf('data-testid="mission-console-inner-command-deck"');
  assert.ok(builderHarnessIndex > operatorReliefIndex);
  assert.ok(builderHarnessIndex > commandDeckIndex);
});

test('protected canon: Mission Console internal boxes use pane canon without duplicate AI Core nesting', async () => {
  const missionConsoleSource = await read(missionConsoleTilePath);
  const appSource = await read(appPath);
  assert.match(missionConsoleSource, /missionConsoleAssistantCommandConsolePanel/);
  assert.match(missionConsoleSource, /getMissionConsoleMoveControls\('missionConsoleOperatorOverviewPanel'\)/);
  assert.match(missionConsoleSource, /getMissionConsoleMoveControls\('missionConsoleGuardrailsPanel'\)/);
  assert.match(missionConsoleSource, /getMissionConsoleSectionOrderStyle\('missionConsoleConversationWorkspacePanel'\)/);
  assert.match(appSource, /const operationalPaneIds = \[\];/);
  assert.match(appSource, /missionConsoleCanonicalSectionPaneIds/);
});

test('protected canon: compact Mission Console feed panes preserve Command Deck answer surface boundaries', async () => {
  const missionConsoleSource = await read(missionConsoleTilePath);
  const commandDeckSource = await read(missionCommandDeckPath);
  const styles = await read(stylesPath);
  assert.match(commandDeckSource, /panelId="missionConsoleMissionCommandDeckActivityPanel"/);
  assert.match(missionConsoleSource, /panelId="missionConsoleBrowserProofChecklistPanel"/);
  assert.match(missionConsoleSource, /panelId="missionConsoleRuntimeEvidenceWarningsPanel"/);
  assert.match(missionConsoleSource, /compact-feed-row compact-feed-row--empty/);
  assert.match(styles, /\.compact-feed-row,[\s\S]*min-height:\s*0;/m);
  assert.match(styles, /\.openclaw-prompt-box,[\s\S]*max-height:\s*14rem;/m);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history[\s\S]*overflow-y:\s*auto;/m);
});

test('protected canon: Mission Command Deck packs packet support and activity cards with compact Agent Assignment Matrix', async () => {
  const commandDeckSource = await read(missionCommandDeckPath);
  const styles = await read(stylesPath);

  assert.match(commandDeckSource, /mission-deck-card--compact-matrix/);
  assert.match(commandDeckSource, /mission-deck-assignment-row--compact/);
  assert.match(commandDeckSource, /mission-deck-assignment-facts/);
  assert.match(commandDeckSource, /summarizeList\(row\.allowedActions, 2\)/);
  assert.match(commandDeckSource, /summarizeList\(row\.blockedActions, 2\)/);
  assert.match(commandDeckSource, /mission-deck-grid-command-packet/);
  assert.match(commandDeckSource, /mission-deck-grid-support-snapshot/);
  assert.match(commandDeckSource, /mission-deck-grid-activity-feed/);
  assert.match(commandDeckSource, /panelId="missionConsoleMissionCommandDeckActivityPanel"/);
  assert.match(commandDeckSource, /togglePanel\('missionConsoleMissionCommandDeckActivityPanel'\)/);

  assert.match(styles, /\.mission-command-deck-grid\s*\{[\s\S]*grid-auto-flow:\s*dense;/m);
  assert.match(styles, /\.mission-command-deck-grid\s*\{[\s\S]*grid-auto-rows:\s*minmax\(0, auto\);/m);
  assert.match(styles, /\.mission-deck-card\.mission-deck-card--compact-matrix\s*\{[\s\S]*padding:\s*8px;/m);
  assert.match(styles, /\.mission-deck-assignment-row\.mission-deck-assignment-row--compact\s*\{[\s\S]*line-height:\s*1\.22;/m);
});

test('protected canon: nested Mission Console Agent Assignment Matrix keeps compact rows without losing move or collapse persistence', async () => {
  const missionConsoleSource = await read(missionConsoleTilePath);
  const styles = await read(stylesPath);

  assert.match(missionConsoleSource, /panelId="missionConsoleAgentAssignmentMatrixPanel"/);
  assert.match(missionConsoleSource, /onToggle=\{\(\) => dispatchPanelToggle\('missionConsoleAgentAssignmentMatrixPanel'\)\}/);
  assert.match(missionConsoleSource, /actions=\{getMissionConsoleMoveControls\('missionConsoleAgentAssignmentMatrixPanel'\)\}/);
  assert.match(missionConsoleSource, /style=\{getMissionConsoleSectionOrderStyle\('missionConsoleAgentAssignmentMatrixPanel'\)\}/);
  assert.match(missionConsoleSource, /mission-console-compact-summary-grid/);
  assert.match(missionConsoleSource, /mission-console__status-list mission-console-agent-matrix-list/);
  assert.match(missionConsoleSource, /mission-console-agent-matrix-row/);

  assert.match(styles, /\.mission-console-agent-matrix-row\s*\{[\s\S]*font-size:\s*0\.75rem;[\s\S]*line-height:\s*1\.22;/m);
  assert.match(styles, /\.mission-console-workspace \.mission-console-agent-matrix-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(20rem, 100%\), 1fr\)\);/m);
});

test('protected canon: builder mesh stays in Builder Harness and uses deterministic answer finalization path', async () => {
  const missionConsoleSource = await read(missionConsoleTilePath);
  const useAIConsoleSource = await read(new URL('../stephanos-ui/src/hooks/useAIConsole.js', import.meta.url));
  assert.match(missionConsoleSource, /panelId="missionConsoleBuilderHarnessPanel" title="OpenClaw Builder Harness V1"/);
  assert.match(missionConsoleSource, /panelId="missionConsoleBuilderMeshPanel" title="Zero-Cost Builder Mesh V1"/);
  assert.doesNotMatch(missionConsoleSource, /mission-console-section--builder-mesh/);
  assert.match(useAIConsoleSource, /createBuilderMeshDeterministicResult/);
  assert.match(useAIConsoleSource, /providerDispatchResult = routeUnavailableOutcome \|\| identityRecallDeterministicResult \|\| agentRealityLoopDeterministicResult \|\| builderMeshDeterministicResult \|\| operatorExplanationDeterministicResult \|\| await sendPrompt/);
  assert.match(useAIConsoleSource, /return upsertCommandHistoryById\(prev, entry, streamEntryId\);/);
});
