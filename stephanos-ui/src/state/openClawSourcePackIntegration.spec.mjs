import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveOperatorReliefProjection } from './operatorReliefProjection.js';
import { buildSupportSnapshot } from './supportSnapshot.js';

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

const BAD_SOURCE_PACK_TEXT = `SOURCE PACK START
Topic:
Operator route hygiene
Source 1 title:
Internal route note
Source 1 URL:
none
Source 1 notes:
OpenClaw must stay source-bounded and cannot ask for next.
SOURCE PACK END`;

const BAD_SOURCE_PACK_OUTPUT = `SOURCE_PACK_STATUS
failed
SUMMARY
As a language model, ask away or say next.
USEFUL_FACTS
- <your response>
UNKNOWNS
- unknown
RISKS
- template leakage
NEXT_RESEARCH_QUESTIONS
- none
STEPHANOS_HANDOFF_PACKET
Do not trust.`;

function sourcePackWorkbenchProjection(overrides = {}) {
  return deriveOperatorReliefProjection({
    supportSnapshot: {
      localAiConnected: true,
      githubConnected: true,
      builderWorkbenchInput: {
        activePacketType: 'openclaw-source-pack-runner',
        openClawSourcePackText: BAD_SOURCE_PACK_TEXT,
        openClawSourcePackOutput: BAD_SOURCE_PACK_OUTPUT,
        openClawSourcePackJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawSourcePackLastJudgedText: BAD_SOURCE_PACK_TEXT,
        openClawSourcePackLastJudgedOutput: BAD_SOURCE_PACK_OUTPUT,
        ...overrides,
      },
    },
    builderWorkbenchInput: {
      activePacketType: 'openclaw-source-pack-runner',
      openClawSourcePackText: BAD_SOURCE_PACK_TEXT,
      openClawSourcePackOutput: BAD_SOURCE_PACK_OUTPUT,
      openClawSourcePackJudgedAt: '2026-05-30T00:00:00.000Z',
      openClawSourcePackLastJudgedText: BAD_SOURCE_PACK_TEXT,
      openClawSourcePackLastJudgedOutput: BAD_SOURCE_PACK_OUTPUT,
      ...overrides,
    },
  }).builderMeshProjection.builderWorkbenchProjection;
}

test('bad Source Pack output publishes failed projection truth without canon or research trust', () => {
  const runner = sourcePackWorkbenchProjection().openClawSourcePackRunner;

  assert.equal(runner.sourcePackStatus, 'failed');
  assert.equal(runner.sourcePackResultPresent, 'yes');
  assert.equal(runner.templateLeakageDetected, 'yes');
  assert.equal(runner.asksForNextDetected, 'yes');
  assert.equal(runner.sourcePackProjectionWritten, 'yes');
  assert.equal(runner.trustedForCanon, 'no');
  assert.equal(runner.trustedForResearch, 'no');
});

test('Source Pack judgment becomes stale after judged text changes', () => {
  const runner = sourcePackWorkbenchProjection({
    openClawSourcePackText: `${BAD_SOURCE_PACK_TEXT}\nEdited after judgment.`,
  }).openClawSourcePackRunner;

  assert.equal(runner.sourcePackStatus, 'stale');
  assert.equal(runner.sourcePackJudgmentStale, 'yes');
  assert.equal(runner.sourcePackProjectionWritten, 'yes');
  assert.equal(runner.sourcePackProjectionSource, 'source-pack-input-changed-after-judgment');
  assert.equal(runner.trustedForCanon, 'no');
  assert.equal(runner.trustedForResearch, 'no');
  assert.notEqual(runner.sourcePackLastJudgedTextLength, runner.sourcePackCurrentTextLength);
});

test('Source Pack judgment becomes stale after judged output changes', () => {
  const runner = sourcePackWorkbenchProjection({
    openClawSourcePackOutput: `${BAD_SOURCE_PACK_OUTPUT}\nEdited after judgment.`,
  }).openClawSourcePackRunner;

  assert.equal(runner.sourcePackStatus, 'stale');
  assert.equal(runner.sourcePackJudgmentStale, 'yes');
  assert.equal(runner.sourcePackProjectionWritten, 'yes');
  assert.equal(runner.sourcePackProjectionSource, 'source-pack-input-changed-after-judgment');
  assert.equal(runner.trustedForCanon, 'no');
  assert.equal(runner.trustedForResearch, 'no');
  assert.notEqual(runner.sourcePackLastJudgedOutputLength, runner.sourcePackCurrentOutputLength);
});

test('Support Snapshot exposes Source Pack stale lengths and projection publication truth', () => {
  const workbench = sourcePackWorkbenchProjection({
    openClawSourcePackOutput: `${BAD_SOURCE_PACK_OUTPUT}\nEdited after judgment.`,
  });
  const snapshot = buildSupportSnapshot({
    runtimeStatus: {
      operatorReliefProjection: {
        builderMeshProjection: {
          builderWorkbenchProjection: workbench,
        },
      },
    },
  });

  assert.match(snapshot, /OpenClaw Source Pack Judgment Stale: yes/);
  assert.match(snapshot, new RegExp(`OpenClaw Source Pack Last Judged Text Length: ${BAD_SOURCE_PACK_TEXT.length}`));
  assert.match(snapshot, new RegExp(`OpenClaw Source Pack Current Text Length: ${BAD_SOURCE_PACK_TEXT.length}`));
  assert.match(snapshot, new RegExp(`OpenClaw Source Pack Last Judged Output Length: ${BAD_SOURCE_PACK_OUTPUT.length}`));
  assert.match(snapshot, /OpenClaw Source Pack Current Output Length: \d+/);
  assert.match(snapshot, /OpenClaw Source Pack Projection Written: yes/);
  assert.match(snapshot, /OpenClaw Source Pack Projection Source: source-pack-input-changed-after-judgment/);
});

test('stale Source Pack judgment is never trusted for canon or research', () => {
  const runner = sourcePackWorkbenchProjection({
    openClawSourcePackText: `${BAD_SOURCE_PACK_TEXT}\nOperator changed source after judgment.`,
    openClawSourcePackOutput: `${BAD_SOURCE_PACK_OUTPUT}\nOperator changed output after judgment.`,
  }).openClawSourcePackRunner;

  assert.equal(runner.sourcePackStatus, 'stale');
  assert.equal(runner.trustedForCanon, 'no');
  assert.equal(runner.trustedForResearch, 'no');
  assert.match(runner.nextOperatorAction, /Rerun Source Pack Intake Judgment/);
});
