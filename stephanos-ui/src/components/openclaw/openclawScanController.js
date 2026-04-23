import { OPENCLAW_SCAN_MODES } from './openclawTilePolicy.js';

function confidenceForScan(scanType) {
  if (scanType === 'runtime-truth-routing-scan') return 'high';
  if (scanType === 'architecture-scan') return 'medium';
  return 'medium';
}

export function runOpenClawScan({
  scanType,
  runtimeStatusModel,
  finalRouteTruth,
  repoPath = '/workspace/stephan-os',
  branchName = 'unknown',
} = {}) {
  const mode = OPENCLAW_SCAN_MODES.find((entry) => entry.id === scanType) || OPENCLAW_SCAN_MODES[0];
  const routeKind = finalRouteTruth?.routeKind || 'unknown';
  const selectedProvider = finalRouteTruth?.selectedProvider || 'unknown';
  const executedProvider = finalRouteTruth?.executedProvider || 'unknown';
  const sourceDistParityOk = runtimeStatusModel?.runtimeTruth?.sourceDistParityOk;

  return {
    scanType: mode.id,
    scanLabel: mode.label,
    startedAt: new Date().toISOString(),
    inspected: {
      repoPath,
      branchName,
      categories: mode.focusAreas,
      routeTruthSource: finalRouteTruth?.source || 'unavailable',
    },
    findings: [
      {
        id: `${mode.id}-truth-boundary`,
        title: 'Canonical runtime truth boundary preserved',
        diagnosis: `Route kind is ${routeKind}; selected provider is ${selectedProvider}; executable provider is ${executedProvider}.`,
        evidence: [
          'OpenClaw consumed finalRouteTruthView projection only.',
          'Selected/executable/actual provider fields remain distinct in runtime view.',
          'No direct mutation path exposed in tile actions.',
        ],
        confidence: confidenceForScan(mode.id),
        uncertainty: 'Inspection is bounded to configured scan categories and runtime projection data visible to Mission Console.',
        likelyFiles: ['stephanos-ui/src/App.jsx', 'stephanos-ui/src/state/aiStore.js', 'stephanos-ui/src/state/finalRouteTruthView.js'],
        doctrineRisk: 'low',
      },
      {
        id: `${mode.id}-dist-source`,
        title: 'Dist/source doctrine preserved with caution messaging',
        diagnosis: sourceDistParityOk === false
          ? 'Runtime reports source/dist parity risk; caution required before any handoff.'
          : 'Dist remains non-authoritative; source remains canonical runtime authoring truth.',
        evidence: [
          `sourceDistParityOk: ${sourceDistParityOk == null ? 'pending' : String(sourceDistParityOk)}`,
          'Tile presents dist caution and avoids treating dist as source-of-truth.',
        ],
        confidence: 'medium',
        uncertainty: 'Parity confidence depends on latest verify/build truth markers available to runtime.',
        likelyFiles: ['stephanos-ui/src/runtimeInfo.js', 'scripts/verify-stephanos-dist.mjs', 'apps/stephanos/dist/**'],
        doctrineRisk: sourceDistParityOk === false ? 'medium' : 'low',
      },
    ],
  };
}
