import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'StatusPanel.jsx'), 'utf8');

test('StatusPanel copy buttons use shared Mission Console clipboard state model', () => {
  assert.match(source, /import \{ COPY_STATE, useClipboardButtonState \} from '\.\.\/hooks\/useClipboardButtonState'/);
  assert.match(source, /writeTextToClipboard\(supportSnapshot, \{ navigatorObject: browserNavigator \}\)/);
  assert.match(source, /writeTextToClipboard\(payload, \{ navigatorObject: browserNavigator \}\)/);
});

test('StatusPanel copy buttons hold independent transient success and failure states', () => {
  assert.match(source, /copyState: supportSnapshotCopyState, setCopyState: setSupportSnapshotCopyState/);
  assert.match(source, /copyState: codexHandoffCopyState, setCopyState: setCodexHandoffCopyState/);
  assert.match(source, /className=\{`status-panel-copy-button \$\{supportSnapshotCopyState\}`\}/);
  assert.match(source, /className=\{`status-panel-copy-button \$\{codexHandoffCopyState\}`\}/);
});

test('StatusPanel copy buttons expose explicit non-silent failure feedback', () => {
  assert.match(source, /setSupportSnapshotCopyState\(COPY_STATE\.FAILURE\)/);
  assert.match(source, /setCodexHandoffCopyState\(COPY_STATE\.FAILURE\)/);
  assert.match(source, /Copy Support Snapshot failed/);
  assert.match(source, /Copy Codex Handoff Packet failed/);
  assert.match(source, /role="status" aria-live="polite"/);
});

test('StatusPanel live Support Snapshot sampling overwrites cached Mission Console componentTrace from live DOM marker', () => {
  assert.match(source, /const aiCorePane = document\.querySelector\('\[data-pane-id="aiCoreMissionConsolePanel"\]'\);/);
  assert.match(source, /const marker =[\s\S]*aiCoreNode\?\.querySelector\('\[data-mission-console-component="MissionConsoleTile"\]'\)[\s\S]*aiCorePane\?\.querySelector\('\[data-mission-console-component="MissionConsoleTile"\]'\)[\s\S]*\|\| null;/m);
  assert.match(source, /componentTrace:?[\s\S]*source: marker && aiCoreNode\?\.contains\(marker\) \? 'dom' : marker \? 'pane-fallback' : 'missing'/m);
  assert.match(source, /aiCoreMissionConsole:\s*\{[\s\S]*componentTrace,/m);
});

test('StatusPanel live Support Snapshot sampling keeps Mission Console componentTrace diagnostic-only defaults', () => {
  assert.match(source, /isMissionConsoleTile: marker \? 'yes' : 'no'/);
  assert.match(source, /registrationDropBoundary: marker\?\.getAttribute\('data-mission-console-registration-drop-boundary'\) \|\| 'visible-surface-not-missionconsoletile'/);
  assert.doesNotMatch(source, /missionConsoleInstanceCount\s*:\s*componentTrace/);
});
