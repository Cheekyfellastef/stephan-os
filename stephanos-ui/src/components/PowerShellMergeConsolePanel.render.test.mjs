import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelSource = fs.readFileSync(path.join(__dirname, 'PowerShellMergeConsolePanel.jsx'), 'utf8');

test('panel requests local git ritual truth from backend in local mode', () => {
  assert.match(panelSource, /getLocalGitRitualState\(runtimeConfig\)/);
  assert.match(panelSource, /Could not load local ritual state\. Standard ritual guidance unavailable\./);
});

test('panel exposes hosted limitation without faking local git truth', () => {
  assert.match(panelSource, /normalizeGitRitualTruthSnapshot\(current, \{ hosted: true \}\)/);
});

test('ritual copy buttons are truth-aware and disabled when not applicable', () => {
  assert.match(panelSource, /Copy Box 1/);
  assert.match(panelSource, /disabled=\{!buttonState\.box1\.enabled\}/);
  assert.match(panelSource, /disabled=\{!buttonState\.box2\.enabled\}/);
  assert.match(panelSource, /disabled=\{!buttonState\.box3\.enabled\}/);
});

test('manual override keeps raw copy helpers available', () => {
  assert.match(panelSource, /Manual Override \/ Raw Mode/);
  assert.match(panelSource, /Copy Raw Box 1/);
  assert.match(panelSource, /Copy Raw Box 2/);
  assert.match(panelSource, /Copy Raw Box 3/);
});

test('copy buttons only show green success styling after successful clipboard copies', () => {
  assert.match(panelSource, /const \[copiedButtonId, setCopiedButtonId\] = useState\(''\)/);
  assert.match(panelSource, /setCopiedButtonId\(copyTargetId\)/);
  assert.match(panelSource, /setCopiedButtonId\(''\)/);
  assert.match(panelSource, /power-shell-copy-success/);
});

test('local shell buttons return truthful unsupported message outside local desktop runtime', () => {
  assert.match(panelSource, /Local shell controls are only available in local desktop runtime\./);
});


test('ritual phase transitions only advance after successful clipboard copy', () => {
  assert.match(panelSource, /transitionKey: 'box1'/);
  assert.match(panelSource, /if \(copied && transitionKey\) \{\s*setPhaseState\(\(prev\) => applyPhaseCopyTransition\(prev, transitionKey\)\);\s*\}/);
});

test('clipboard failures surface explicit reasoned operator feedback', () => {
  assert.match(panelSource, /resolveClipboardFailureMessage/);
  assert.match(panelSource, /Clipboard permission denied in this runtime\./);
  assert.match(panelSource, /Clipboard unavailable in this runtime\./);
  assert.match(panelSource, /\[POWER SHELL MERGE CONSOLE\] Clipboard copy failed/);
  assert.match(panelSource, /\[POWER SHELL MERGE CONSOLE\] clipboard copy requested/);
  assert.match(panelSource, /payloadLength/);
});
