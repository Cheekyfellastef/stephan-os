import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildStarfieldVrProjectPerformanceLoop } from './starfield-vr-project-performance-loop.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const identity = {
  status: 'VERIFIED_PROVIDER',
  provider: 'mutar-openxr',
  profileSha256: 'abc',
  launchSessionId: 'launch-1',
  sourceHead: '1'.repeat(40),
  telemetrySessionId: 'starfield-vr-performance-test',
};

test('project performance loop pulls MutaR, Air Link, quad-view, RDR2/Cyberpunk and Skyrim guidance into one packet', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
    metrics: { avgGpuUtilPct: 85, maxGpuMemoryPct: 98, avgSystemCpuPct: 50, minGameDriveFreePct: 20 },
  });
  assert.equal(loop.generatedFromProject, true);
  assert.equal(loop.runIdentity.provider, 'mutar-openxr');
  assert.ok(loop.telemetryRequirements.some((item) => item.id === 'application-frame-time'));
  assert.ok(loop.telemetryRequirements.some((item) => item.id === 'air-link-latency-chain'));
  assert.ok(loop.candidateTechniques.some((item) => item.id === 'mutar-openxr-resolution-scaling'));
  assert.ok(loop.candidateTechniques.some((item) => item.id === 'quad-view-foveation-compatibility'));
  assert.ok(loop.candidateTechniques.some((item) => item.id === 'rdr2-layer-cost-isolation'));
  assert.ok(loop.candidateTechniques.some((item) => item.id === 'cyberpunk-stage-instrumentation'));
  assert.ok(loop.candidateTechniques.some((item) => item.id === 'skyrim-vr-quality-guardrail'));
  assert.equal(loop.benchmarkProtocol.oneChangeAtATime, true);
  assert.equal(loop.benchmarkProtocol.rollbackRequired, true);
  assert.equal(loop.authority.automaticRuntimeMutation, false);
});

test('missing project-required frame timing becomes the next loop action', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'FRAME_TIME_PROOF', signals: ['frame-time-source-not-yet-captured'] },
    metrics: { avgGpuUtilPct: 70, maxGpuMemoryPct: 80 },
  });
  assert.equal(loop.nextExperiment.id, 'close-frame-timing-telemetry-gap');
  assert.ok(loop.telemetryGapCount > 0);
});

test('unverified provider identity blocks tuning before project experiments', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: { status: 'UNKNOWN_PROVIDER', provider: 'UNKNOWN' },
    diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
    metrics: { avgGpuUtilPct: 99, maxGpuMemoryPct: 99 },
  });
  assert.equal(loop.nextExperiment.id, 'prove-run-provider-identity');
  assert.equal(loop.loopState, 'UNKNOWN_PROVIDER');
});

test('telemetry reporter publishes the project loop into shared workspace', async () => {
  const report = await readFile(new URL('./report-starfield-vr-telemetry.mjs', import.meta.url), 'utf8');
  assert.match(report, /buildStarfieldVrProjectPerformanceLoop/);
  assert.match(report, /projectPerformanceLoop/);
  assert.match(report, /loop-current\.json/);
  assert.match(report, /projectTelemetryGapCount/);
  assert.match(report, /projectNextExperiment/);
});

test('observed system CPU pressure prioritizes missing game-thread and background attribution', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'CPU_LOAD', signals: ['system-cpu-load-high'] },
    metrics: { avgSystemCpuPct: 100, avgStarfieldCpuPct: 36.7, avgGpuUtilPct: 28.8 },
  });
  assert.equal(loop.nextExperiment.id, 'qualify-starfield-cpu-attribution-collector');
  assert.match(loop.nextExperiment.rationale, /PR #3187/);
  assert.match(loop.nextExperiment.title, /PR #3187: Record ChatGPT Desktop and browser CPU pressure during Starfield VR playtests/);
  assert.ok(loop.missingTelemetry.some((entry) => entry.id === 'starfield-cpu-attribution'));
  assert.equal(loop.authority.automaticRuntimeMutation, false);
});

test('matched CPU evidence chooses safe per-stage investigation before graphics tuning', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'CPU_LOAD', signals: ['starfield-single-thread-saturation-observed'] },
    metrics: {
      avgSystemCpuPct: 100, avgStarfieldCpuPct: 36.7, maxStarfieldBusiestThreadCpuPct: 97,
      avgChatGptCpuPct: 7, avgMetaVrCpuPct: 10, avgApplicationFrameTimeMs: 44.9,
      starfieldThreadCpuMeasuredSampleCount: 4, cpuConsumersAvailableSampleCount: 4,
      avgDeliveredCadenceHz: 71.6, headsetRefreshRateHz: 72,
      avgGpuUtilPct: 28.8, maxGpuMemoryPct: 40,
    },
  });
  assert.equal(loop.nextExperiment.id, 'starfield-cpu-stage-isolation');
  assert.equal(loop.telemetryRequirements.find((entry) => entry.id === 'starfield-cpu-attribution').available, true);
  assert.equal(loop.nextExperiment.authority.automaticMutation, false);
});

test('motion and stereo skew prioritise AER isolation without silently enabling the experimental DLL', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'RENDERING_OR_STEREO', signals: ['stereo-eye-timing-skew-observed'] },
    metrics: {
      avgApplicationFrameTimeMs: 15, avgDeliveredCadenceHz: 72, headsetRefreshRateHz: 72,
      avgGpuUtilPct: 40, maxGpuMemoryPct: 42,
    },
  });
  assert.equal(loop.nextExperiment.id, 'starfield-aer-motion-isolation');
  assert.equal(loop.nextExperiment.authority.automaticMutation, false);
  assert.equal(loop.nextExperiment.authority.rollbackRequired, true);
  assert.equal(loop.authority.operatorAcceptancePreserved, true);
});

test('pose-latency focus alone cannot masquerade as evidence of AER stereo faults', async () => {
  const loop = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'RENDERING_OR_STEREO', signals: ['pose-age-high'] },
    metrics: {
      avgApplicationFrameTimeMs: 15, avgDeliveredCadenceHz: 72, headsetRefreshRateHz: 72,
      avgGpuUtilPct: 40, maxGpuMemoryPct: 42,
    },
  });
  assert.notEqual(loop.nextExperiment.id, 'starfield-aer-motion-isolation');
  assert.equal(loop.candidateTechniques.some((item) => item.id === 'starfield-aer-motion-isolation'), false);
  assert.equal(loop.authority.automaticRuntimeMutation, false);
});

test('CPU stage isolation requires same-run measured sample counts and finite CPU percentages', async () => {
  const base = {
    avgSystemCpuPct: 100, avgStarfieldCpuPct: 36.7,
    maxStarfieldBusiestThreadCpuPct: 97, avgChatGptCpuPct: 0, avgMetaVrCpuPct: 0,
    avgApplicationFrameTimeMs: 44.9, avgDeliveredCadenceHz: 71.6, headsetRefreshRateHz: 72,
  };
  const missingOrInvalid = [
    {},
    { starfieldThreadCpuMeasuredSampleCount: 0, cpuConsumersAvailableSampleCount: 4 },
    { starfieldThreadCpuMeasuredSampleCount: 4, cpuConsumersAvailableSampleCount: 0 },
    { starfieldThreadCpuMeasuredSampleCount: 4, cpuConsumersAvailableSampleCount: 4,
      maxStarfieldBusiestThreadCpuPct: '97' },
    { starfieldThreadCpuMeasuredSampleCount: 4, cpuConsumersAvailableSampleCount: 4,
      avgChatGptCpuPct: Number.NaN },
    { starfieldThreadCpuMeasuredSampleCount: 4, cpuConsumersAvailableSampleCount: 4,
      avgMetaVrCpuPct: -1 },
  ];
  for (const caseFields of missingOrInvalid) {
    const loop = await buildStarfieldVrProjectPerformanceLoop({
      repoRoot, runIdentity: identity,
      diagnosis: { focus: 'CPU_LOAD', signals: ['starfield-single-thread-saturation-observed'] },
      metrics: { ...base, ...caseFields },
    });
    assert.equal(loop.nextExperiment.id, 'qualify-starfield-cpu-attribution-collector');
    assert.equal(loop.telemetryRequirements.find((item) => item.id === 'starfield-cpu-attribution').available, false);
    assert.equal(loop.authority.automaticRuntimeMutation, false);
  }
  const measured = await buildStarfieldVrProjectPerformanceLoop({
    repoRoot, runIdentity: identity,
    diagnosis: { focus: 'CPU_LOAD', signals: ['starfield-single-thread-saturation-observed'] },
    metrics: { ...base, starfieldThreadCpuMeasuredSampleCount: 4,
      cpuConsumersAvailableSampleCount: 4 },
  });
  assert.equal(measured.nextExperiment.id, 'starfield-cpu-stage-isolation');
  assert.equal(measured.telemetryRequirements.find((item) => item.id === 'starfield-cpu-attribution').available, true);
});


test('resource-pressure availability requires complete measured percent evidence', async () => {
  const complete = {
    avgGpuUtilPct: 48,
    maxGpuMemoryPct: 61,
    avgSystemCpuPct: 72,
    minGameDriveFreePct: 16,
  };
  const cases = [
    { avgGpuUtilPct: 48, maxGpuMemoryPct: 61 },
    { ...complete, avgSystemCpuPct: undefined },
    { ...complete, minGameDriveFreePct: null },
    { ...complete, avgSystemCpuPct: '72' },
    { ...complete, maxGpuMemoryPct: Infinity },
    { ...complete, minGameDriveFreePct: -2 },
  ];
  const project = async (metrics) => buildStarfieldVrProjectPerformanceLoop({
    repoRoot,
    runIdentity: identity,
    diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
    metrics,
  });
  for (const metrics of cases) {
    const loop = await project(metrics);
    const required = loop.telemetryRequirements.find((item) => item.id === 'resource-pressure');
    assert.equal(required.available, false);
    assert.ok(loop.missingTelemetry.some((item) => item.id === 'resource-pressure'));
    assert.equal(loop.authority.automaticRuntimeMutation, false);
  }
  const valid = await project(complete);
  assert.equal(valid.telemetryRequirements.find((item) => item.id === 'resource-pressure').available, true);
});
