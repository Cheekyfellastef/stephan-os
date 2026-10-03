#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const STARFIELD_VR_PROJECT_PERFORMANCE_LOOP_SCHEMA =
  'stephanos.starfield-vr-project-performance-loop.v1';

function text(value = '') {
  return String(value ?? '').trim();
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

function metricPresent(metrics, key) {
  const value = metrics?.[key];
  return value !== null && value !== undefined && value !== '' && value !== false;
}

function sourceRevision(registry, sourceId) {
  const source = Array.isArray(registry?.sources)
    ? registry.sources.find((entry) => text(entry?.source_id) === sourceId)
    : null;
  return text(
    source?.snapshot_commit ||
    source?.snapshot_release ||
    source?.snapshot_version ||
    source?.snapshot_date ||
    'unresolved',
  );
}

function requirement({
  id,
  title,
  metricKeys = [],
  sourceRef,
  rationale,
  available = null,
}) {
  return Object.freeze({
    id,
    title,
    metricKeys,
    sourceRef,
    rationale,
    available,
  });
}

function technique({
  id,
  title,
  sources,
  rationale,
  experiment,
  compatibleWhen = 'measure-before-enable',
  priority = 0,
}) {
  return Object.freeze({
    id,
    title,
    sources,
    rationale,
    experiment,
    compatibleWhen,
    priority,
    authority: Object.freeze({
      advisoryOnly: true,
      automaticMutation: false,
      rollbackRequired: true,
      oneChangePerExperiment: true,
    }),
  });
}

export async function buildStarfieldVrProjectPerformanceLoop({
  repoRoot,
  runIdentity = {},
  diagnosis = {},
  metrics = {},
  recommendationPlan = {},
} = {}) {
  const root = resolve(repoRoot || '.');
  const [registry, workspace] = await Promise.all([
    readJson(resolve(root, 'VR-Research-Lab', 'knowledge-sources.json')),
    readJson(resolve(root, 'VR-Research-Lab', 'lab-workspace.json')),
  ]);

  const provider = text(runIdentity?.provider || 'UNKNOWN');
  const identityStatus = text(runIdentity?.status || 'UNKNOWN_PROVIDER');
  const signals = new Set(Array.isArray(diagnosis?.signals) ? diagnosis.signals.map(text) : []);
  const focus = text(diagnosis?.focus || 'UNCLASSIFIED');

  const sources = Object.freeze({
    mutar: {
      sourceId: 'github-mutars-nomoreflat',
      revision: sourceRevision(registry, 'github-mutars-nomoreflat'),
      path: 'VR-Research-Lab/knowledge-sources/mutar-nomoreflat/knowledge-extraction.md',
    },
    airLink: {
      sourceId: 'official-meta-quest-link-air-link',
      revision: sourceRevision(registry, 'official-meta-quest-link-air-link'),
      path: 'VR-Research-Lab/knowledge-sources/meta-quest-link-air-link/knowledge-extraction.md',
    },
    quadViews: {
      sourceId: 'github-mbucchia-quad-views-foveated',
      revision: sourceRevision(registry, 'github-mbucchia-quad-views-foveated'),
      path: 'VR-Research-Lab/knowledge-sources/quad-views-foveated/knowledge-extraction.md',
    },
    installedCorpus: {
      sourceId: 'battle-bridge-installed-vr-corpus',
      revision: 'sha256:1e9b4ed9a990d8f576b91be4fb94e968f657a73c92af9a8091f53c1aa08af1c8',
      path: 'VR-Research-Lab/knowledge-sources/battle-bridge-installed-vr-corpus/knowledge-extraction.md',
    },
    referenceImplementations: {
      sourceId: 'starfield-vr-reference-implementations',
      revision: 'repository-main',
      path: 'VR-Research-Lab/examples/starfield-vr/reference-implementations.md',
    },
    parityRoadmap: {
      sourceId: 'starfield-vr-skyrim-parity-roadmap',
      revision: 'repository-main',
      path: 'VR-Research-Lab/examples/starfield-vr/skyrim-vr-parity-roadmap.md',
    },
    cyberpunk: {
      sourceId: 'github-dariulone-cyberpunk-vr-port',
      revision: sourceRevision(registry, 'github-dariulone-cyberpunk-vr-port'),
      path: 'VR-Research-Lab/knowledge-sources/cyberpunk-vr-port/knowledge-extraction.md',
    },
  });

  const requirements = [
    requirement({
      id: 'application-frame-time',
      title: 'Application frame time',
      metricKeys: ['avgApplicationFrameTimeMs', 'p95ApplicationFrameTimeMs'],
      sourceRef: sources.airLink.path,
      rationale: 'Project Air Link acceptance requires application frame time and delivered cadence.',
      available: metricPresent(metrics, 'avgApplicationFrameTimeMs'),
    }),
    requirement({
      id: 'delivered-cadence',
      title: 'Delivered headset cadence',
      metricKeys: ['deliveredCadenceHz'],
      sourceRef: sources.airLink.path,
      rationale: 'Low or oscillating delivered cadence distinguishes render misses from transport instability.',
      available: metricPresent(metrics, 'deliveredCadenceHz'),
    }),
    requirement({
      id: 'headset-refresh',
      title: 'Quest refresh rate',
      metricKeys: ['headsetRefreshRateHz'],
      sourceRef: sources.airLink.path,
      rationale: 'Delivered cadence must be interpreted against the selected Quest refresh rate.',
      available: metricPresent(metrics, 'headsetRefreshRateHz'),
    }),
    requirement({
      id: 'dropped-frames-reprojection',
      title: 'Dropped frames and reprojection',
      metricKeys: ['droppedFrames', 'reprojectionState'],
      sourceRef: sources.airLink.path,
      rationale: 'The project explicitly requires dropped-frame and smoothing/reprojection evidence.',
      available: metricPresent(metrics, 'droppedFrames') && metricPresent(metrics, 'reprojectionState'),
    }),
    requirement({
      id: 'air-link-latency-chain',
      title: 'Encode, network and decode latency',
      metricKeys: ['encodeLatencyMs', 'networkLatencyMs', 'decodeLatencyMs'],
      sourceRef: sources.airLink.path,
      rationale: 'Air Link is a pipeline; latency must be attributed to the correct stage.',
      available: ['encodeLatencyMs', 'networkLatencyMs', 'decodeLatencyMs'].every((key) => metricPresent(metrics, key)),
    }),
    requirement({
      id: 'air-link-network-quality',
      title: 'Bitrate, packet loss and jitter',
      metricKeys: ['airLinkBitrateMbps', 'packetLossPct', 'jitterMs'],
      sourceRef: sources.airLink.path,
      rationale: 'Project transport proof requires bitrate, loss, jitter and congestion evidence where available.',
      available: ['airLinkBitrateMbps', 'packetLossPct', 'jitterMs'].every((key) => metricPresent(metrics, key)),
    }),
    requirement({
      id: 'render-resolution',
      title: 'OpenXR/render resolution',
      metricKeys: ['openXrRenderWidth', 'openXrRenderHeight', 'renderScalePct'],
      sourceRef: sources.mutar.path,
      rationale: 'MutaR exposes OpenXR resolution scaling as a first-class performance surface.',
      available: metricPresent(metrics, 'renderScalePct') ||
        (metricPresent(metrics, 'openXrRenderWidth') && metricPresent(metrics, 'openXrRenderHeight')),
    }),
    requirement({
      id: 'resource-pressure',
      title: 'GPU, VRAM, CPU and storage pressure',
      metricKeys: ['avgGpuUtilPct', 'maxGpuMemoryPct', 'avgSystemCpuPct', 'minGameDriveFreePct'],
      sourceRef: sources.installedCorpus.path,
      rationale: 'Resource attribution remains the first coarse performance split.',
      available: metricPresent(metrics, 'avgGpuUtilPct') && metricPresent(metrics, 'maxGpuMemoryPct'),
    }),
    requirement({
      id: 'long-session-drift',
      title: 'Long-session thermal/network drift',
      metricKeys: ['runtimeSeconds', 'longSessionDriftVerdict'],
      sourceRef: sources.airLink.path,
      rationale: 'The project requires stability evidence beyond a successful launch or short smooth burst.',
      available: metricPresent(metrics, 'longSessionDriftVerdict'),
    }),
  ];

  const missingTelemetry = requirements.filter((item) => item.available !== true);

  const techniques = [];
  const add = (item) => techniques.push(technique(item));

  if (provider === 'mutar-openxr') {
    add({
      id: 'mutar-openxr-resolution-scaling',
      title: 'MutaR OpenXR resolution-scaling experiment',
      sources: [sources.mutar],
      rationale: 'The project records OpenXR resolution scaling as a directly evidenced MutaR capability.',
      experiment: 'Keep the same save and movement route; lower only OpenXR/render scale one bounded step, record frame timing and image quality, then keep or roll back.',
      priority: focus === 'VRAM_PRESSURE' || focus === 'GPU_RENDER_LOAD' || focus === 'MULTI_RESOURCE_PRESSURE' ? 110 : 80,
    });
    add({
      id: 'mutar-alternate-eye-temporal-isolation',
      title: 'MutaR alternate-eye / temporal-stereo isolation',
      sources: [sources.referenceImplementations, sources.installedCorpus],
      rationale: 'The project explicitly records alternate-eye temporal disparity and lateral-motion instability as Starfield acceptance risks.',
      experiment: 'Use a repeatable lateral-motion segment and compare temporal/stereo repair settings independently from transport and HUD changes.',
      priority: focus === 'FRAME_TIME_PROOF' ? 105 : 86,
    });
  }

  add({
    id: 'quad-view-foveation-compatibility',
    title: 'Quad-view / foveation compatibility experiment',
    sources: [sources.mutar, sources.quadViews],
    rationale: 'MutaR records quad-view compatibility and the project has a dedicated performance reference for negotiated foveation.',
    experiment: 'First prove the application/runtime/headset capability chain. If compatible, compare focus/peripheral resolution and frame time with an explicit disable path.',
    compatibleWhen: 'only-after-capability-proof',
    priority: focus === 'VRAM_PRESSURE' || focus === 'GPU_RENDER_LOAD' ? 96 : 62,
  });

  add({
    id: 'rdr2-layer-cost-isolation',
    title: 'RDR2-style conversion-layer cost isolation',
    sources: [sources.installedCorpus],
    rationale: 'The installed RDR2 route teaches framework → title adapter → stereo/temporal repair → camera/HUD separation.',
    experiment: 'Attribute cost and instability to rendering, temporal/stereo repair, camera/HUD or transport before changing unrelated quality settings.',
    priority: 88,
  });

  add({
    id: 'cyberpunk-stage-instrumentation',
    title: 'Cyberpunk-style stage instrumentation',
    sources: [sources.cyberpunk],
    rationale: 'The project records stage-by-stage stereo, view capture, frame submission and pose diagnostics as a reusable method.',
    experiment: 'Instrument the Starfield route so a bad run can identify view generation, submission, pose or presentation as the failing stage.',
    priority: missingTelemetry.some((item) => ['application-frame-time', 'delivered-cadence'].includes(item.id)) ? 94 : 70,
  });

  add({
    id: 'air-link-pipeline-isolation',
    title: 'Air Link render/encode/network/decode isolation',
    sources: [sources.airLink],
    rationale: 'The project treats Air Link as a layered transport and forbids collapsing all latency into one supported/not-supported flag.',
    experiment: 'Correlate game frame time, encode, network and decode evidence over the same route before changing bitrate or render settings.',
    priority: signals.has('air-link-runtime-not-observed') || signals.has('gpu-encoder-load-high') ? 108 : 76,
  });

  add({
    id: 'vorpx-control-baseline',
    title: 'VorpX controlled comparison baseline',
    sources: [sources.referenceImplementations],
    rationale: 'The project explicitly requires same-save-route MutaR versus VorpX comparison while preserving rollback.',
    experiment: 'Use VorpX only as a measured control: exact versions, same save, same movement, one variable at a time, then restore the active MutaR route.',
    priority: 58,
  });

  add({
    id: 'skyrim-vr-quality-guardrail',
    title: 'Skyrim VR parity guardrail',
    sources: [sources.parityRoadmap],
    rationale: 'Performance gains must not silently destroy stable stereo, head tracking, scale, frame pacing or comfort.',
    experiment: 'After every retained performance change, re-check stereo stability, head-motion comfort, scale and seated gameplay against the parity criteria.',
    priority: 45,
  });

  const ranked = techniques.sort((a, b) => b.priority - a.priority);
  const identityBlocked = identityStatus !== 'VERIFIED_PROVIDER';
  const nextExperiment = identityBlocked
    ? {
        id: 'prove-run-provider-identity',
        title: 'Prove exact VR run identity before tuning',
        rationale: 'Provider-specific fixes are unsafe when the run identity is unknown or conflicting.',
      }
    : missingTelemetry.some((item) => ['application-frame-time', 'delivered-cadence', 'headset-refresh'].includes(item.id))
      ? {
          id: 'close-frame-timing-telemetry-gap',
          title: 'Capture application frame time, delivered cadence and headset refresh rate',
          rationale: 'The project requires these measurements before frame-pacing diagnosis can be considered complete.',
          sourceRef: sources.airLink.path,
        }
      : ranked[0] || recommendationPlan?.nextExperiment || null;

  const benchmarkProtocol = Object.freeze({
    saveRoutePinned: true,
    oneChangeAtATime: true,
    exactProviderIdentityRequired: true,
    exactProfileHashRequired: true,
    captureFrameTiming: true,
    recordHeadsetAndTransportState: true,
    rollbackRequired: true,
    compareAgainstVorpXControlWhenUseful: true,
    retainOnlyMeasuredImprovements: true,
  });

  const qualityGuardrails = Object.freeze([
    'Stable stereo without alternate-eye discomfort or temporal divergence.',
    'Low-latency 6DoF head tracking and coherent world scale.',
    'Stable frame pacing and seated Quest 3 comfort.',
    'No regression in HUD readability, aiming alignment or cockpit usability.',
    'No silent provider switch and no unproven runtime substitution.',
  ]);

  return {
    schemaVersion: STARFIELD_VR_PROJECT_PERFORMANCE_LOOP_SCHEMA,
    generatedFromProject: true,
    projectWorkspaceSchema: text(workspace?.schemaVersion || 'unknown'),
    runIdentity,
    focus,
    signals: [...signals],
    telemetryRequirements: requirements,
    telemetryGapCount: missingTelemetry.length,
    missingTelemetry,
    sources,
    candidateTechniques: ranked,
    nextExperiment,
    benchmarkProtocol,
    qualityGuardrails,
    loopState: identityBlocked
      ? identityStatus
      : missingTelemetry.length
        ? 'MEASURE_GAPS_THEN_EXPERIMENT'
        : 'EXPERIMENT_READY',
    authority: {
      automaticObservation: true,
      automaticPlanning: true,
      automaticGraphicsMutation: false,
      automaticProviderSwitch: false,
      automaticRuntimeMutation: false,
      operatorAcceptancePreserved: true,
    },
  };
}
