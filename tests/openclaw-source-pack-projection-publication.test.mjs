import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';
import { buildSupportSnapshot } from '../stephanos-ui/src/state/supportSnapshot.js';
import { buildOpenClawSourcePackRunnerProjection } from '../shared/agents/openClawSourcePackRunner.mjs';

const badSourcePackText = 'SOURCE PACK START\nSource 1 notes:\nOperator provided only a source pack shell.\nSOURCE PACK END';
const badSourcePackOutput = 'As a language model, ask away or say next.\n<your response>';
const canonicalProjectionSource = 'runtimeContext.operatorReliefProjection.builderMeshProjection.builderWorkbenchProjection.openClawSourcePackRunner';

function buildJudgedProjection() {
  const judgment = buildOpenClawSourcePackRunnerProjection({
    rawResult: badSourcePackOutput,
    sourcePackText: badSourcePackText,
  });
  return deriveOperatorReliefProjection({
    supportSnapshot: {
      builderWorkbenchInput: {
        activePacketType: 'openclaw-source-pack-runner',
        activePacketTarget: 'openclaw',
        openClawSourcePackText: badSourcePackText,
        openClawSourcePackOutput: badSourcePackOutput,
        openClawSourcePackJudgedAt: '2026-05-30T00:00:00.000Z',
        openClawSourcePackButtonClicked: 'yes',
        openClawSourcePackTextLength: badSourcePackText.length,
        openClawSourcePackOutputLength: badSourcePackOutput.length,
        openClawSourcePackJudgmentAttempted: 'yes',
        openClawSourcePackProjectionWritten: 'yes',
        openClawSourcePackProjectionSource: canonicalProjectionSource,
        openClawSourcePackProjectionWriteError: 'none',
        openClawSourcePackJudgment: judgment,
      },
    },
  });
}

test('component contract: clicking Source Pack Intake Judgment publishes current source-pack input through deterministic judgment', () => {
  const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');
  assert.match(source, /onClick=\{handleSourcePackIntakeJudgment\}/);
  assert.match(source, /const sourcePackText = builderWorkbenchInput\.openClawSourcePackText \|\| '';/);
  assert.match(source, /const sourcePackOutput = builderWorkbenchInput\.openClawSourcePackOutput \|\| '';/);
  assert.match(source, /buildOpenClawSourcePackRunnerProjection\(\{\s*rawResult: sourcePackOutput,\s*sourcePackText,/s);
  assert.match(source, /openClawSourcePackJudgment: judgment/);
  assert.match(source, /openClawSourcePackProjectionWritten: 'yes'/);
  assert.match(source, new RegExp(canonicalProjectionSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('state: judged Source Pack result exists in builderWorkbenchProjection canonical path', () => {
  const projection = buildJudgedProjection();
  const workbench = projection.builderMeshProjection.builderWorkbenchProjection;
  assert.equal(workbench.openClawSourcePackRunner.sourcePackStatus, 'failed');
  assert.equal(workbench.openClawSourcePackRunner.sourcePackResultPresent, 'yes');
  assert.equal(workbench.openClawSourcePackRunner.templateLeakageDetected, 'yes');
  assert.equal(workbench.openClawSourcePackRunner.asksForNextDetected, 'yes');
  assert.equal(workbench.openClawSourcePackJudgmentAttempted, 'yes');
  assert.equal(workbench.openClawSourcePackProjectionWritten, 'yes');
  assert.equal(workbench.openClawSourcePackProjectionSource, canonicalProjectionSource);
});

test('support snapshot: bad source-pack judgment appears in snapshot fields from stored projection', () => {
  const operatorReliefProjection = buildJudgedProjection();
  const supportSnapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: { operatorReliefProjection },
    },
    runtimeContext: { operatorReliefProjection },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
  });
  assert.match(supportSnapshot, /OpenClaw Source Pack Runner Status: failed/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Result Present: yes/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Template Leakage Detected: yes/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Asks For Next Detected: yes/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Judgment Attempted: yes/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Projection Written: yes/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Trusted For Canon: no/);
  assert.match(supportSnapshot, /OpenClaw Source Pack Trusted For Research: no/);
});

test('regression: support snapshot does not return idle defaults after a source-pack judgment exists', () => {
  const operatorReliefProjection = buildJudgedProjection();
  const supportSnapshot = buildSupportSnapshot({
    runtimeStatus: {
      runtimeContext: { operatorReliefProjection },
    },
    runtimeContext: { operatorReliefProjection },
    routeTruthView: {},
    runtimeSessionTruth: {},
    runtimeRouteTruth: {},
    runtimeReachabilityTruth: {},
    runtimeProviderTruth: {},
    runtimeDiagnosticsTruth: {},
  });
  assert.doesNotMatch(supportSnapshot, /OpenClaw Source Pack Runner Status: idle/);
  assert.doesNotMatch(supportSnapshot, /OpenClaw Source Pack Result Present: no/);
  assert.doesNotMatch(supportSnapshot, /OpenClaw Source Pack Useful Fact Count: 0\nOpenClaw Source Pack Unknown Count: 0\nOpenClaw Source Pack Risk Count: 0\nOpenClaw Source Pack Next Question Count: 0\nOpenClaw Source Pack Handoff Present: no\nOpenClaw Source Pack Trusted For Canon: no\nOpenClaw Source Pack Trusted For Research: no\nOpenClaw Source Pack Codex Fallback Needed: unknown/);
  assert.match(supportSnapshot, /Builder Workbench Projection Source: runtimeStatus\.runtimeContext\.operatorReliefProjection\.builderMeshProjection\.builderWorkbenchProjection/);
});
