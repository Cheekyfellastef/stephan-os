#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const STARFIELD_VR_PERFORMANCE_RECOMMENDATIONS_SCHEMA =
  'stephanos.starfield-vr-performance-recommendations.v1';

function text(value = '') {
  return String(value ?? '').trim();
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function rankRecommendation(item) {
  return Object.freeze({
    ...item,
    priority: Number(item.priority) || 0,
    authority: Object.freeze({
      advisoryOnly: true,
      mutatesGameConfig: false,
      switchesProvider: false,
      launchesGame: false,
      requiresOperatorAcceptanceForRuntimeChange: true,
    }),
  });
}

function teachingByKey(packet) {
  return new Map(
    Array.isArray(packet?.records)
      ? packet.records.map((record) => [text(record?.teachingKey), record])
      : [],
  );
}

function techniqueByName(workspace) {
  return new Map(
    Array.isArray(workspace?.techniques)
      ? workspace.techniques.map((record) => [text(record?.name), record])
      : [],
  );
}

function teachingRecommendation(record, { priority, sourceLabel, rationale, experiment }) {
  if (!record) return null;
  return rankRecommendation({
    kind: 'teaching-method',
    id: text(record.teachingKey),
    title: text(record.reusableMethod),
    sourceLabel,
    sourceId: text(record.sourceId),
    evidencePlanes: Array.isArray(record.evidencePlanes) ? record.evidencePlanes : [],
    confidence: text(record.confidence),
    proofRefs: Array.isArray(record.proofRefs) ? record.proofRefs : [],
    applicability: text(record.applicability),
    nonApplicability: text(record.nonApplicability),
    constraints: Array.isArray(record.constraints) ? record.constraints : [],
    rationale,
    experiment,
    priority,
  });
}

function labRecommendation(record, { priority, sourceLabel, rationale, experiment }) {
  if (!record) return null;
  return rankRecommendation({
    kind: 'research-technique',
    id: text(record.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title: text(record.name),
    sourceLabel,
    status: text(record.status),
    path: text(record.path),
    goal: text(record.goal),
    rationale,
    experiment,
    priority,
  });
}

export async function buildStarfieldVrPerformanceRecommendations({
  repoRoot,
  diagnosis = {},
  provider = '',
  runIdentity = null,
} = {}) {
  const root = resolve(repoRoot || '.');
  const [teachingPacket, labWorkspace] = await Promise.all([
    readJson(resolve(
      root,
      'VR-Research-Lab',
      'knowledge-sources',
      'battle-bridge-installed-vr-corpus',
      'teaching-records.json',
    )),
    readJson(resolve(root, 'VR-Research-Lab', 'lab-workspace.json')),
  ]);

  const corpusAvailable = Boolean(teachingPacket && labWorkspace);
  const signals = new Set(Array.isArray(diagnosis?.signals) ? diagnosis.signals.map(text) : []);
  const focus = text(diagnosis?.focus, 'UNCLASSIFIED');
  const identityStatus = text(runIdentity?.status, 'UNKNOWN_PROVIDER');
  const verifiedProvider = identityStatus === 'VERIFIED_PROVIDER' ? text(runIdentity?.provider || provider) : '';
  if (identityStatus !== 'VERIFIED_PROVIDER') {
    return {
      schemaVersion: STARFIELD_VR_PERFORMANCE_RECOMMENDATIONS_SCHEMA,
      corpusAvailable,
      verdict: identityStatus,
      diagnosisFocus: focus,
      diagnosisSignals: [...signals],
      currentProvider: 'UNKNOWN',
      recommendationCount: 0,
      recommendations: [],
      nextExperiment: null,
      blockedReason: identityStatus === 'PROVIDER_IDENTITY_CONFLICT'
        ? 'Provider identity conflicts across telemetry-bound evidence.'
        : 'Provider identity is not proven by this telemetry session.',
      boundaries: {
        advisoryOnly: true,
        automaticCollection: true,
        automaticRecommendation: false,
        automaticRuntimeMutation: false,
        providerAutoSwitch: false,
        graphicsAutoMutation: false,
      },
    };
  }
  const teaching = teachingByKey(teachingPacket);
  const techniques = techniqueByName(labWorkspace);
  const recommendations = [];

  const add = (candidate) => {
    if (candidate) recommendations.push(candidate);
  };

  const renderPressure =
    ['VRAM_PRESSURE', 'GPU_RENDER_LOAD', 'MULTI_RESOURCE_PRESSURE', 'FRAME_TIME_PROOF'].includes(focus) ||
    signals.has('vram-pressure-high') ||
    signals.has('gpu-saturation-high');

  const transportPressure =
    signals.has('air-link-runtime-not-observed') ||
    signals.has('gpu-encoder-load-high');

  if (renderPressure) {
    add(teachingRecommendation(
      teaching.get('vr.method.graphics-proxy-openxr-config-seam'),
      {
        priority: 100,
        sourceLabel: 'Installed Starfield conversion corpus',
        rationale: 'Use Starfield\'s graphics-proxy, OpenXR loader and title configuration as separate tuning surfaces before reducing broad visual quality.',
        experiment: 'Measure OpenXR/render-resolution and title-config changes one at a time, with rollback and the same save-route benchmark.',
      },
    ));
    add(teachingRecommendation(
      teaching.get('vr.method.temporal-stereo-repair-layer'),
      {
        priority: 95,
        sourceLabel: 'Starfield + Red Dead Redemption 2 VR corpus',
        rationale: 'The installed corpus shows Starfield DLSS/AER controls and RDR2 stereo/TAA repair and render-mode controls as a distinct temporal/stereo layer.',
        experiment: 'Test one reversible temporal/stereo reconstruction change at a time and compare per-eye coherence plus frame timing.',
      },
    ));
    add(labRecommendation(
      techniques.get('Starfield Mutar OpenXR Baseline'),
      {
        priority: verifiedProvider.toLowerCase() === 'mutar-openxr' ? 84 : 92,
        sourceLabel: 'MutaR / NoMoreFlat',
        rationale: verifiedProvider.toLowerCase() === 'mutar-openxr'
          ? 'The current provider is already the MutaR/OpenXR route, so use its exact configuration as the controlled comparison baseline.'
          : 'Compare the current route with the approved MutaR/OpenXR architecture instead of assuming the present provider is the only viable renderer.',
        experiment: 'Run the same save-route through the verified MutaR/OpenXR profile only after its existing proof gate is satisfied; do not auto-switch providers.',
      },
    ));
    add(labRecommendation(
      techniques.get('Genuine Dual-view Engine Rendering'),
      {
        priority: 78,
        sourceLabel: 'Installed Cyberpunk VR research',
        rationale: 'Use the Cyberpunk dual-view/frame-graph work as a diagnostic reference for the cost of genuine stereo and graceful lower-complexity fallback.',
        experiment: 'Compare rendering-stage cost and eye-generation strategy without assuming REDengine hooks exist in Creation Engine.',
      },
    ));
    add(teachingRecommendation(
      teaching.get('vr.method.common-framework-title-adapter'),
      {
        priority: 74,
        sourceLabel: 'Red Dead Redemption 2 R.E.A.L. VR topology',
        rationale: 'RDR2 demonstrates separating common VR/interception work from the title adapter so expensive or unstable stages can be isolated instead of tuning the whole stack blindly.',
        experiment: 'Attribute frametime cost to framework, title-adapter, stereo/temporal repair and transport stages before changing unrelated settings.',
      },
    ));
  }

  if (transportPressure || focus === 'FRAME_TIME_PROOF') {
    add(labRecommendation(
      techniques.get('Quest 3 Air Link Acceptance'),
      {
        priority: transportPressure ? 100 : 68,
        sourceLabel: 'Meta Quest 3 / Air Link research',
        rationale: 'Keep application render cost separate from encode, network, decode and compositor latency so an Air Link problem is not mistaken for a game-render problem.',
        experiment: 'Correlate game frametime with encoder load, Air Link presence and transport telemetry using the same playtest route.',
      },
    ));
    add(teachingRecommendation(
      teaching.get('vr.method.multi-runtime-device-abstraction'),
      {
        priority: transportPressure ? 82 : 60,
        sourceLabel: 'Cyberpunk VR + VRChat + GORN + Hellblade VR corpus',
        rationale: 'The installed corpus keeps runtime/device state explicit so transport failures remain isolated from title rendering and tracking logic.',
        experiment: 'Preserve Meta Air Link as the selected transport while measuring it independently from the Starfield provider.',
      },
    ));
  }

  if (focus === 'STORAGE_PRESSURE' || focus === 'MULTI_RESOURCE_PRESSURE') {
    add(rankRecommendation({
      kind: 'system-diagnostic',
      id: 'storage-pressure-first',
      title: 'Remove storage pressure before renderer tuning',
      sourceLabel: 'Starfield performance telemetry',
      rationale: 'Low free space, high active time, latency or queue depth can create stalls that would contaminate a renderer comparison.',
      experiment: 'Re-run the same route after restoring drive headroom; only tune rendering if storage pressure is no longer the dominant signal.',
      priority: focus === 'STORAGE_PRESSURE' ? 110 : 98,
    }));
  }

  if (focus === 'CPU_LOAD') {
    add(rankRecommendation({
      kind: 'system-diagnostic',
      id: 'cpu-stage-isolation',
      title: 'Isolate CPU-side Starfield and VR runtime cost',
      sourceLabel: 'Starfield performance telemetry',
      rationale: 'CPU pressure should be separated from stereo, transport and GPU changes before image-quality settings are reduced.',
      experiment: 'Compare Starfield process CPU, system CPU and VR runtime processes across the same fixed route.',
      priority: 105,
    }));
  }

  add(labRecommendation(
    techniques.get('Skyrim VR Parity Decomposition'),
    {
      priority: 40,
      sourceLabel: 'Skyrim VR + VRIK/HIGGS/PLANCK',
      rationale: 'Keep the long-term quality target separate from the immediate performance repair so optimisations do not silently destroy the intended native-VR feel.',
      experiment: 'After performance stabilises, re-run parity checks for camera comfort, body/interaction attachment points and seated play quality.',
    },
  ));

  const deduped = [];
  const seen = new Set();
  for (const recommendation of recommendations.sort((a, b) => b.priority - a.priority)) {
    if (!recommendation || seen.has(recommendation.id)) continue;
    seen.add(recommendation.id);
    deduped.push(recommendation);
  }

  return {
    schemaVersion: STARFIELD_VR_PERFORMANCE_RECOMMENDATIONS_SCHEMA,
    corpusAvailable,
    diagnosisFocus: focus,
    diagnosisSignals: [...signals],
    verdict: 'RECOMMENDATIONS_READY',
    currentProvider: verifiedProvider,
    recommendationCount: deduped.length,
    recommendations: deduped.slice(0, 6),
    nextExperiment: deduped[0] || null,
    boundaries: {
      advisoryOnly: true,
      automaticCollection: true,
      automaticRecommendation: true,
      automaticRuntimeMutation: false,
      providerAutoSwitch: false,
      graphicsAutoMutation: false,
    },
  };
}
