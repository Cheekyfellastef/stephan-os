import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const supportSnapshotSource = readFileSync(new URL('./supportSnapshot.js', import.meta.url), 'utf8');
const aiConsoleSource = readFileSync(new URL('../hooks/useAIConsole.js', import.meta.url), 'utf8');
const operatorReliefSource = readFileSync(new URL('./operatorReliefProjection.js', import.meta.url), 'utf8');
const missionConsoleTileSource = readFileSync(new URL('../components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('Support Snapshot includes all OpenClaw Source Pack Runner fields', () => {
  for (const field of [
    'OpenClaw Source Pack Runner Status',
    'OpenClaw Source Pack Route',
    'OpenClaw Source Pack Model',
    'OpenClaw Source Pack Result Present',
    'OpenClaw Source Pack Source-Bounded',
    'OpenClaw Source Pack Hallucinated Sources Detected',
    'OpenClaw Source Pack Template Leakage Detected',
    'OpenClaw Source Pack Asks For Next Detected',
    'OpenClaw Source Pack Useful Fact Count',
    'OpenClaw Source Pack Unknown Count',
    'OpenClaw Source Pack Risk Count',
    'OpenClaw Source Pack Next Question Count',
    'OpenClaw Source Pack Handoff Present',
    'OpenClaw Source Pack Trusted For Canon',
    'OpenClaw Source Pack Trusted For Research',
    'OpenClaw Source Pack Codex Fallback Needed',
    'OpenClaw Source Pack Next Operator Action',
  ]) {
    assert.match(supportSnapshotSource, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Command Deck deterministic answer mentions bounded CLI source-pack route and Codex fallback', () => {
  assert.match(aiConsoleSource, /Can OpenClaw process a source pack safely\?/);
  assert.match(aiConsoleSource, /stephanos-scout \/ llama3\.2 CLI route/);
  assert.match(aiConsoleSource, /dashboard\/qwen remain untrusted/);
  assert.match(aiConsoleSource, /Codex remains fallback implementation capacity/);
  assert.match(aiConsoleSource, /operator approval is required before mutation/);
});

test('Builder Mesh recommends OpenClaw only for bounded source-pack processing and keeps mutation locked', () => {
  assert.match(operatorReliefSource, /llama3\.2-cli-bounded-source-pack-only-after-proof/);
  assert.match(operatorReliefSource, /Ask OpenClaw only for bounded llama3\.2 CLI source-pack processing/);
  assert.match(operatorReliefSource, /openClawSourcePackPacket/);
  assert.match(operatorReliefSource, /mutationAuthority: 'locked'/);
});

test('existing Builder Workbench surface exposes Source Pack Runner controls without a duplicate dashboard', () => {
  assert.match(missionConsoleTileSource, /Zero-Cost Builder Workbench V1/);
  assert.match(missionConsoleTileSource, /Copy Source Pack CLI Prompt/);
  assert.match(missionConsoleTileSource, /Paste Source Pack Output/);
  assert.match(missionConsoleTileSource, /Run Source Pack Intake Judgment/);
  assert.match(missionConsoleTileSource, /Copy Cleaned Source Pack Handoff/);
  assert.doesNotMatch(missionConsoleTileSource, /title="OpenClaw Source Pack Dashboard/);
});
