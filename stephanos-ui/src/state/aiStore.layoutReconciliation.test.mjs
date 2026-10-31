import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const thisFilePath = fileURLToPath(import.meta.url);
const thisDirPath = path.dirname(thisFilePath);
const source = fs.readFileSync(path.join(thisDirPath, 'aiStore.js'), 'utf8');

test('fresh default layout includes missionConsolePanel in canonical defaults', () => {
  assert.match(source, /const DEFAULT_UI_LAYOUT = \{[\s\S]*missionConsolePanel: true/m);
  assert.match(source, /const DEFAULT_UI_LAYOUT = \{[\s\S]*aiCoreMissionConsolePanel: true/m);
});

test('persisted pane order reconciliation restores missionConsolePanel and preserves user order', () => {
  assert.match(source, /function normalizeOperatorPaneOrder\([\s\S]*canonicalOrder\.forEach\([\s\S]*normalized\.push\(paneId\)/m);
  assert.match(source, /const DEFAULT_OPERATOR_PANE_ORDER = \[[\s\S]*'commandDeck'/m);
  assert.match(source, /const DEFAULT_OPERATOR_PANE_ORDER = \[[\s\S]*'aiCoreMissionConsolePanel'[\s\S]*'missionConsolePanel'/m);
  assert.match(source, /legacyPaneAliasMap[\s\S]*aiConsole:\s*'commandDeck'/m);
  assert.match(source, /reconcilePersistedOperatorPaneLayout\([\s\S]*operatorPaneLayout\?\.order[\s\S]*legacyPaneOrder/m);
});

test('reconciliation avoids duplicate missionConsolePanel entries', () => {
  assert.match(source, /seen\.has\(canonicalPaneId\)/m);
});


test('protected AI Core restores legacy panes while Command Deck honours persisted collapse state', () => {
  assert.match(source, /shouldForceMissionConsoleOpen = !persistedPaneOrderIncludesPane\(persistedSession, 'missionConsolePanel'\)/m);
  assert.match(source, /shouldForceAiCoreMissionConsoleOpen = !persistedPaneOrderIncludesPane\(persistedSession, 'aiCoreMissionConsolePanel'\)/m);
  assert.match(source, /aiCoreMissionConsolePanel: true/m);
  assert.match(source, /commandDeck: true/m); // Open by default, not permanently forced open.

  const layoutNormalizer = source.match(/function normalizeUiLayout\(value = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const panelSetter = source.match(/const setPanelState = useCallback\(\(panelId, isOpen, source = 'unknown'\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';
  assert.ok(layoutNormalizer, 'layout normalizer is present');
  assert.ok(panelSetter, 'panel state setter is present');
  assert.doesNotMatch(layoutNormalizer, /commandDeck:\s*true/, 'restoring layout must preserve commandDeck: false');
  assert.doesNotMatch(panelSetter, /if \(panelId === 'commandDeck'\)[\s\S]*?isOpen = true/, 'clicking the Command Deck chevron must not force it open');
  assert.match(panelSetter, /\[panelId\]: resolvedOpen/, 'panel state persists the requested open or closed value');
  assert.match(source, /setPanelState\(panelId, \(prev\) => !prev, source\)/, 'toggle flips the current persisted state');
});

test('Command Deck answer history fills its parent and remains scrollable', () => {
  const styles = fs.readFileSync(path.join(thisDirPath, '../styles.css'), 'utf8');
  const panel = fs.readFileSync(path.join(thisDirPath, '../components/AIConsole.jsx'), 'utf8');
  assert.match(panel, /data-testid="command-deck-body"/);
  assert.match(panel, /data-testid="command-deck-answer-history"/);
  assert.match(panel, /isOpen=\{safeUiLayout\.commandDeck !== false\}/);
  assert.match(panel, /onToggle=\{\(\) => togglePanel\('commandDeck'\)\}/);
  assert.match(styles, /\.mission-console-shell > \.mission-console-pane\[data-testid="command-deck-body"\] \{[^}]*width:\s*100%;/);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history \{[^}]*width:\s*100%;/);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history \{[^}]*box-sizing:\s*border-box;/);
  assert.match(styles, /\.mission-console-pane__body\.mission-console__history \{[^}]*overflow-y:\s*auto;/);
});

test('persisted pane order reconciliation keeps commandDeck at the top for Universal Intake reachability', () => {
  assert.match(source, /return \['commandDeck', \.\.\.normalized\.filter\(\(paneId\) => paneId !== 'commandDeck'\)\]/m);
});

test('DEFAULT_UI_LAYOUT registers compact Mission Console activity feed panel ids', () => {
  [
    'missionConsoleMissionCommandDeckActivityPanel: true',
    'missionConsoleCodexChangeSummaryPanel: false',
    'missionConsoleTestsBuildVerifyPanel: false',
    'missionConsoleBrowserProofChecklistPanel: false',
    'missionConsoleRuntimeEvidenceWarningsPanel: false',
    'missionConsoleMergeSafetyVerdictPanel: false',
    'missionConsoleNextBestActionPanel: true',
    'missionConsoleLessonCandidatesPanel: false',
    'missionConsoleOperatorDecisionQueuePanel: false',
  ].forEach((token) => assert.equal(source.includes(token), true, `missing default uiLayout token: ${token}`));
});
