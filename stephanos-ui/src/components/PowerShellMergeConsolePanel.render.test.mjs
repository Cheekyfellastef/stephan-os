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
  assert.match(panelSource, /Copy Box 1<\/button>/);
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
