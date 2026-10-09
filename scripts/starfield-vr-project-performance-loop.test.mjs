import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { fileURLToPath } from 'node:url';
import { buildStarfieldVrPerformanceRecommendations } from './starfield-vr-performance-recommendations.mjs';
import { buildStarfieldVrProjectPerformanceLoop } from './starfield-vr-project-performance-loop.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
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


test('provider recommendation gate rejects a verified flag without telemetry-bound provider identity', async () => {
  for (const missingProvider of ['', 'UNKNOWN', 'unapproved-route']) {
    const plan = await buildStarfieldVrPerformanceRecommendations({
      repoRoot,
      provider: 'vorpx', // Untrusted hint must never fill a missing verified identity.
      runIdentity: { status: 'VERIFIED_PROVIDER', provider: missingProvider },
      diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
    });
    assert.equal(plan.verdict, 'UNKNOWN_PROVIDER');
    assert.equal(plan.currentProvider, 'UNKNOWN');
    assert.equal(plan.recommendationCount, 0);
    assert.equal(plan.nextExperiment, null);
    assert.equal(plan.boundaries.automaticRecommendation, false);
    assert.equal(plan.boundaries.automaticRuntimeMutation, false);
  }
});

test('telemetry-bound supported provider remains eligible for advisory recommendations', async () => {
  const plan = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    provider: 'vorpx', // Conflicting hint cannot override verified MutaR identity.
    runIdentity: identity,
    diagnosis: { focus: 'GPU_RENDER_LOAD', signals: ['gpu-saturation-high'] },
  });
  assert.equal(plan.verdict, 'RECOMMENDATIONS_READY');
  assert.equal(plan.currentProvider, 'mutar-openxr');
  assert.ok(plan.recommendationCount > 0);
  assert.equal(plan.boundaries.providerAutoSwitch, false);
});
