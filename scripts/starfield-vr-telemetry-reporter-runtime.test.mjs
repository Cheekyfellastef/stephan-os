import assert from 'node:assert/strict';
import test from 'node:test';

test('Starfield VR telemetry reporter parses and exports its runtime entrypoints', async () => {
  const module = await import('./report-starfield-vr-telemetry.mjs');
  assert.equal(module.STARFIELD_VR_TELEMETRY_REPORT_SCHEMA, 'stephanos.starfield-vr-telemetry-report.v1');
  assert.equal(module.STARFIELD_VR_TELEMETRY_HISTORY_SCHEMA, 'stephanos.starfield-vr-telemetry-history-index.v1');
  assert.equal(typeof module.reportStarfieldVrTelemetry, 'function');
  assert.equal(typeof module.starfieldVrTelemetryProcessExitCode, 'function');
  assert.equal(typeof module.main, 'function');
});


test('Starfield VR telemetry reporter builds a compact safe headline before verbose output', async () => {
  const module = await import('./report-starfield-vr-telemetry.mjs');
  const projection = module.buildStarfieldVrTelemetryHeadlineProjection({
    ok: true,
    generatedAtUtc: '2026-10-02T20:15:00.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED',
    sessionId: 'starfield-vr-performance-test',
    headline: {
      focus: 'VRAM_PRESSURE',
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      launchSessionId: 'launch-1',
      sourceHead: 'a'.repeat(40),
      telemetrySessionId: 'starfield-vr-performance-test',
      signals: ['vram-pressure-high'],
      sessionOutcome: 'COMPLETED',
      partialTelemetry: false,
      crashEvidenceCount: 0,
      sampleCount: 100,
      avgGpuUtilPct: 79.4,
      maxGpuUtilPct: 100,
      maxGpuMemoryPct: 98.4,
      avgStarfieldCpuPct: 11.2,
      maxLlamaServerCount: 1,
      airLinkRuntimeSamplePct: 100,
      topRecommendation: 'Lower one bounded render-scale step',
      topRecommendationSource: 'VR Research Lab',
      projectLoopState: 'READY',
      projectTelemetryGapCount: 2,
      projectNextExperiment: 'Repeat same-save lateral-motion segment',
    },
    history: { sessionCount: 5, newestSessionId: 'starfield-vr-performance-test' },
    sharedWorkspace: {
      packetWrite: { ok: true, path: 'C:\\private\\packet.json' },
      loopWrite: { ok: true, path: 'C:\\private\\loop.json' },
      historyWrite: { ok: true, path: 'C:\\private\\history.json' },
      eventWrite: { ok: true, path: 'C:\\private\\event.json' },
      root: 'C:\\private\\workspace',
    },
  });
  assert.equal(module.STARFIELD_VR_TELEMETRY_HEADLINE_SCHEMA, 'stephanos.starfield-vr-telemetry-headline.v1');
  assert.equal(module.STARFIELD_VR_TELEMETRY_HEADLINE_MARKER, 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=');
  assert.equal(projection.primaryTelemetryPublished, true);
  assert.equal(projection.auxiliaryProjectionPublished, true);
  assert.equal(projection.sharedWorkspacePublished, true);
  assert.deepEqual(projection.publication, { packet: true, history: true, loop: true, event: true });
  assert.equal(projection.headline.maxGpuMemoryPct, 98.4);
  assert.equal(projection.headline.airLinkRuntimeSamplePct, 100);
  assert.equal(projection.rawTelemetryReturned, false);
  assert.equal(projection.hostPathsReturned, false);
  assert.equal(projection.secretMaterialReturned, false);
  assert.equal(JSON.stringify(projection).includes('C:\\private'), false);
});


test('Starfield telemetry process stays readable when only auxiliary projection is degraded', async () => {
  const module = await import('./report-starfield-vr-telemetry.mjs');
  const degraded = {
    sharedWorkspace: {
      packetWrite: { ok: true },
      historyWrite: { ok: true },
      loopWrite: { ok: false },
      eventWrite: { ok: true },
    },
  };
  assert.equal(module.starfieldVrTelemetryProcessExitCode(degraded), 0);
  const unavailable = {
    sharedWorkspace: {
      packetWrite: { ok: false },
      historyWrite: { ok: true },
      loopWrite: { ok: true },
      eventWrite: { ok: true },
    },
  };
  assert.equal(module.starfieldVrTelemetryProcessExitCode(unavailable), 1);
});
