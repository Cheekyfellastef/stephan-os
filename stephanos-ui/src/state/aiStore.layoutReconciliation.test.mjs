import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'aiStore.js'), 'utf8');

test('fresh default layout includes missionConsolePanel in canonical defaults', () => {
  assert.match(source, /const DEFAULT_UI_LAYOUT = \{[\s\S]*missionConsolePanel: true/m);
  assert.match(source, /const DEFAULT_UI_LAYOUT = \{[\s\S]*aiCoreMissionConsolePanel: true/m);
});

test('persisted pane order reconciliation restores missionConsolePanel and preserves user order', () => {
  assert.match(source, /function normalizeOperatorPaneOrder\([\s\S]*canonicalOrder\.forEach\([\s\S]*normalized\.push\(paneId\)/m);
  assert.match(source, /const DEFAULT_OPERATOR_PANE_ORDER = \[[\s\S]*'aiCoreMissionConsolePanel'[\s\S]*'missionConsolePanel'/m);
  assert.match(source, /reconcilePersistedOperatorPaneLayout\([\s\S]*operatorPaneLayout\?\.order[\s\S]*legacyPaneOrder/m);
});

test('reconciliation avoids duplicate missionConsolePanel entries', () => {
  assert.match(source, /seen\.has\(normalizedPaneId\)/m);
});


test('uiLayout forces missionConsolePanel open when persisted pane order omitted it', () => {
  assert.match(source, /shouldForceMissionConsoleOpen = !persistedPaneOrderIncludesPane\(persistedSession, 'missionConsolePanel'\)/m);
  assert.match(source, /shouldForceAiCoreMissionConsoleOpen = !persistedPaneOrderIncludesPane\(persistedSession, 'aiCoreMissionConsolePanel'\)/m);
  assert.match(source, /aiCoreMissionConsolePanel: true/m);
});
