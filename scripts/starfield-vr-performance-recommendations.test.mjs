import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStarfieldVrPerformanceRecommendations } from './starfield-vr-performance-recommendations.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const identity = (provider = 'mutar-openxr') => ({
  status: 'VERIFIED_PROVIDER',
  provider,
  launchSessionId: 'launch-1',
  telemetrySessionId: 'starfield-vr-performance-test',
});

test('VRAM pressure recommends cross-game corpus methods without automatic mutation', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    provider: 'vorpx',
    runIdentity: identity('vorpx'),
    diagnosis: {
      focus: 'VRAM_PRESSURE',
      signals: ['vram-pressure-high'],
    },
  });
  assert.equal(result.corpusAvailable, true);
  assert.equal(result.boundaries.automaticRuntimeMutation, false);
  assert.equal(result.boundaries.providerAutoSwitch, false);
  const labels = result.recommendations.map((item) => item.sourceLabel);
  assert.ok(labels.includes('MutaR / NoMoreFlat'));
  assert.ok(labels.includes('Starfield + Red Dead Redemption 2 VR corpus'));
  assert.ok(labels.includes('Installed Cyberpunk VR research'));
});

test('storage pressure is promoted ahead of renderer tuning', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    runIdentity: identity(),
    diagnosis: {
      focus: 'STORAGE_PRESSURE',
      signals: ['drive-space-pressure-high'],
    },
  });
  assert.equal(result.nextExperiment.id, 'storage-pressure-first');
});

test('Air Link evidence triggers transport-specific recommendations', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    runIdentity: identity(),
    diagnosis: {
      focus: 'FRAME_TIME_PROOF',
      signals: ['air-link-runtime-not-observed'],
    },
  });
  assert.ok(result.recommendations.some((item) => item.sourceLabel === 'Meta Quest 3 / Air Link research'));
  assert.ok(result.recommendations.some((item) => item.sourceLabel.includes('Cyberpunk VR')));
});

test('Skyrim VR remains a quality-parity guardrail', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    runIdentity: identity(),
    diagnosis: {
      focus: 'GPU_RENDER_LOAD',
      signals: ['gpu-saturation-high'],
    },
  });
  assert.ok(result.recommendations.some((item) => item.sourceLabel === 'Skyrim VR + VRIK/HIGGS/PLANCK'));
});


test('unknown provider identity blocks provider-specific recommendations', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    runIdentity: { status: 'UNKNOWN_PROVIDER', provider: 'UNKNOWN' },
    diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
  });
  assert.equal(result.verdict, 'UNKNOWN_PROVIDER');
  assert.equal(result.recommendationCount, 0);
  assert.equal(result.nextExperiment, null);
});

test('conflicting provider identity blocks provider-specific recommendations', async () => {
  const result = await buildStarfieldVrPerformanceRecommendations({
    repoRoot,
    runIdentity: { status: 'PROVIDER_IDENTITY_CONFLICT', provider: 'UNKNOWN' },
    diagnosis: { focus: 'VRAM_PRESSURE', signals: ['vram-pressure-high'] },
  });
  assert.equal(result.verdict, 'PROVIDER_IDENTITY_CONFLICT');
  assert.equal(result.recommendationCount, 0);
});
