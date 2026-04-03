import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  createStephanosBuildMetadata,
  extractEmbeddedHtmlMetadata,
  readDistMetadataJson,
  stephanosDistIndexPath,
} from './stephanos-build-utils.mjs';
import { createStephanosLocalUrls } from '../shared/runtime/stephanosLocalUrls.mjs';

const LAUNCHER_CRITICAL_SOURCE_PATHS = Object.freeze([
  'main.js',
  'modules/command-deck/command-deck.js',
  'system/module_loader.js',
  'system/workspace.js',
]);

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getLauncherCriticalSourceTruth() {
  return LAUNCHER_CRITICAL_SOURCE_PATHS.map((relativePath) => {
    if (!existsSync(relativePath)) {
      return { path: relativePath, exists: false, sha256: null };
    }

    const source = readFileSync(relativePath, 'utf8');
    return {
      path: relativePath,
      exists: true,
      sha256: hashText(source),
    };
  });
}

function metadataMatchesExpected(metadata, expectedMetadata) {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }

  const requiredFields = [
    'appName',
    'version',
    'sourceIdentifier',
    'sourceFingerprint',
    'buildTarget',
    'buildTargetIdentifier',
    'runtimeId',
    'runtimeMarker',
    'sourceTruth',
  ];

  return requiredFields.every((field) => metadata[field] === expectedMetadata[field]);
}

function extractModuleScriptEntryFromHtml(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return null;
  }

  const scriptEntryMatch =
    html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["'][^>]*>/i) ||
    html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return scriptEntryMatch?.[1] || null;
}

export function evaluateBuildPreflight({
  expectedMetadata,
  distIndexExists,
  distMetadata,
  embeddedMetadata,
  distMetadataReadable = true,
  embeddedMetadataReadable = true,
}) {
  if (!distIndexExists || !distMetadata) {
    return {
      state: 'build-missing',
      reason: 'dist index or metadata missing',
      action: 'rebuild',
    };
  }

  if (!distMetadataReadable || !embeddedMetadataReadable) {
    return {
      state: 'build-unverifiable',
      reason: 'metadata could not be read safely',
      action: 'rebuild',
    };
  }

  const fileMatches = metadataMatchesExpected(distMetadata, expectedMetadata);
  const htmlMatches = metadataMatchesExpected(embeddedMetadata, expectedMetadata);

  if (!fileMatches || !htmlMatches) {
    return {
      state: 'build-stale',
      reason: 'source/dist parity metadata mismatch',
      action: 'rebuild',
    };
  }

  return {
    state: 'build-current',
    reason: 'source/dist parity markers match current source fingerprint',
    action: 'skip-build',
  };
}

export async function probeExistingLocalServer({ port = 4173, expectedRuntimeMarker }) {
  const { healthUrl, runtimeUrl, runtimeStatusPath } = createStephanosLocalUrls({ port });

  try {
    const [healthResponse, sourceTruthResponse, runtimeResponse, runtimeStatusResponse] = await Promise.all([
      fetch(healthUrl, { headers: { Accept: 'application/json' } }),
      fetch(`http://127.0.0.1:${port}/__stephanos/source-truth`, { headers: { Accept: 'application/json' } }),
      fetch(runtimeUrl, { headers: { 'Cache-Control': 'no-cache' } }),
      fetch(`http://127.0.0.1:${port}${runtimeStatusPath}`, { headers: { Accept: 'application/json' } }),
    ]);

    if (!healthResponse.ok || !sourceTruthResponse.ok || !runtimeResponse.ok || !runtimeStatusResponse.ok) {
      return { reusable: false, reason: 'required health/source/runtime probes failed' };
    }

    const [healthPayload, sourceTruthPayload, runtimeHtml] = await Promise.all([
      healthResponse.json(),
      sourceTruthResponse.json(),
      runtimeResponse.text(),
    ]);

    const runtimeMarkerMatch = runtimeHtml.match(/<meta\b[^>]*\bname=["']stephanos-build-runtime-marker["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i);
    const servedRuntimeMarker = runtimeMarkerMatch?.[1] || null;
    const servedScriptEntry = extractModuleScriptEntryFromHtml(runtimeHtml);
    const expectedScriptEntry = existsSync(stephanosDistIndexPath)
      ? extractModuleScriptEntryFromHtml(readFileSync(stephanosDistIndexPath, 'utf8'))
      : null;
    const sourceTruthEntries = Array.isArray(sourceTruthPayload?.launcherCriticalSourceTruth)
      ? sourceTruthPayload.launcherCriticalSourceTruth
      : [];

    const expectedSources = getLauncherCriticalSourceTruth();
    const servedMap = new Map(sourceTruthEntries.map((entry) => [entry.path, entry.sha256]));
    const mismatches = expectedSources
      .filter((entry) => entry.sha256 !== servedMap.get(entry.path))
      .map((entry) => entry.path);

    const markerMatches =
      Boolean(expectedRuntimeMarker) &&
      healthPayload?.runtimeMarker === expectedRuntimeMarker &&
      servedRuntimeMarker === expectedRuntimeMarker;
    const scriptEntryMatches =
      Boolean(expectedScriptEntry) &&
      servedScriptEntry === expectedScriptEntry;

    const reusable =
      healthPayload?.service === 'stephanos-dist-server' &&
      markerMatches &&
      scriptEntryMatches &&
      mismatches.length === 0;

    return {
      reusable,
      reason: reusable ? 'health/runtime/source truth all match current marker' : 'marker or source truth mismatch',
      mismatches,
      observedMarkers: {
        health: healthPayload?.runtimeMarker || null,
        servedIndex: servedRuntimeMarker,
        expected: expectedRuntimeMarker || null,
      },
      observedScriptEntries: {
        servedIndex: servedScriptEntry || null,
        expected: expectedScriptEntry || null,
      },
    };
  } catch {
    return {
      reusable: false,
      reason: 'existing server probe failed',
    };
  }
}

export function readLocalBuildState() {
  const expectedMetadata = createStephanosBuildMetadata();
  const distIndexExists = existsSync(stephanosDistIndexPath);

  let distMetadata = null;
  let embeddedMetadata = null;
  let distMetadataReadable = true;
  let embeddedMetadataReadable = true;

  try {
    distMetadata = readDistMetadataJson();
  } catch {
    distMetadataReadable = false;
  }

  if (distIndexExists) {
    try {
      const html = readFileSync(stephanosDistIndexPath, 'utf8');
      embeddedMetadata = extractEmbeddedHtmlMetadata(html);
    } catch {
      embeddedMetadataReadable = false;
    }
  }

  const decision = evaluateBuildPreflight({
    expectedMetadata,
    distIndexExists,
    distMetadata,
    embeddedMetadata,
    distMetadataReadable,
    embeddedMetadataReadable,
  });

  return {
    expectedMetadata,
    distMetadata,
    decision,
  };
}
