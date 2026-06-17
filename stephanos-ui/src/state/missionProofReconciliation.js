function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean);
  return String(value || '').split('|').map((item) => asText(item)).filter(Boolean);
}

function yes(value) { return asText(value).toLowerCase() === 'yes' || value === true; }
function none(value) { return ['none', ''].includes(asText(value).toLowerCase()); }

export function isMissionConsoleBridgeProofLabel(value = '') {
  const label = asText(value).toLowerCase();
  if (!label) return false;
  return /mission\s*console.*(bridge|open|proof|instance)/i.test(label)
    || /operator\s*relief\s*bridge/i.test(label)
    || /projection-bridge-loss/i.test(label);
}

export function removeAcceptedMissionProof(values = [], reconciliation = {}) {
  const list = Array.isArray(values) ? values : String(values || '').split('|');
  if (reconciliation?.missionConsoleBridgeProofAccepted !== true) return list.map((item) => asText(item)).filter(Boolean);
  return list.map((item) => asText(item)).filter(Boolean).filter((item) => !isMissionConsoleBridgeProofLabel(item));
}

export function buildMissionProofReconciliation({ missionConsoleDiagnostics = {}, supportSnapshot = {}, missionVerification = {}, prEvidence = {}, openClawSourcePackRunner = {}, uiRealityTruth = {} } = {}) {
  const diagnostics = missionConsoleDiagnostics && typeof missionConsoleDiagnostics === 'object' ? missionConsoleDiagnostics : {};
  const projectionKeys = asList(diagnostics.operatorReliefBridgeProjectionKeysSeen || diagnostics.projectionKeysSeen || supportSnapshot.operatorReliefBridgeProjectionKeysSeen);
  const instanceCount = Number(diagnostics.missionConsoleInstanceCount || supportSnapshot.missionConsoleInstanceCount || 0);
  const bridgeParityOk = asText(diagnostics.missionConsoleBridgeParityStatus || supportSnapshot.missionConsoleBridgeParityStatus).toUpperCase() === 'OK';
  const runtimeDiagnosticsPresent = yes(diagnostics.runtimeDiagnosticsPresent || supportSnapshot.missionConsoleRuntimeDiagnosticsPresent);
  const dropBoundaryNone = none(diagnostics.runtimeDiagnosticsDropBoundary || supportSnapshot.missionConsoleRuntimeDiagnosticsDropBoundary);
  const visibleInstancePublished = yes(diagnostics.missionConsoleVisibleInstancePublished || supportSnapshot.missionConsoleVisibleInstancePublished);
  const operatorReliefBridgePublished = yes(diagnostics.operatorReliefBridgePublished || supportSnapshot.operatorReliefBridgePublished);
  const projectionKeysNonEmpty = projectionKeys.length > 0 && projectionKeys.join('|').toLowerCase() !== 'none';
  const missionConsoleBridgeProofAccepted = bridgeParityOk && runtimeDiagnosticsPresent && dropBoundaryNone && instanceCount >= 1 && visibleInstancePublished && operatorReliefBridgePublished && projectionKeysNonEmpty;
  const acceptedItems = missionConsoleBridgeProofAccepted ? ['mission-console-bridge'] : [];
  const missing = [];
  if (!missionConsoleBridgeProofAccepted) missing.push('mission-console-bridge');
  if (missionVerification.buildRun !== true && missionVerification.buildPassed !== true) missing.push('build-proof');
  if (missionVerification.verifyRun !== true && missionVerification.verifyPassed !== true) missing.push('verify-proof');
  const browserOk = (missionVerification.browserProof || []).length > 0 || ['ok', 'OK'].includes(uiRealityTruth.status || supportSnapshot.uiRealityStatus);
  if (!browserOk) missing.push('browser-proof-checklist');
  const prStatus = asText(prEvidence.evidenceTruthStatus || prEvidence.status || prEvidence.availability || supportSnapshot.prEvidenceStatus || supportSnapshot.githubPrEvidenceTruthStatus, 'unknown').toLowerCase();
  if (['unavailable', 'disabled', 'unknown', 'unknown-disabled', 'no_pr_evidence', ''].includes(prStatus)) missing.push('pr-evidence');
  if (openClawSourcePackRunner.sourcePackStatus === 'needs-output' || openClawSourcePackRunner.needsOutput === true) missing.push('source-pack-output');
  const remainingMissingItems = Array.from(new Set(missing));
  return {
    status: missionConsoleBridgeProofAccepted || remainingMissingItems.length ? 'active' : 'ready',
    acceptedItems,
    acceptedCount: acceptedItems.length,
    remainingMissingItems,
    remainingMissingCount: remainingMissingItems.length,
    nextBestAction: remainingMissingItems.length ? `Collect ${remainingMissingItems[0]}.` : 'Review reconciliation proof; merge readiness still requires explicit PR/build/verify/browser evidence.',
    missionConsoleBridgeProofAccepted,
    missionConsoleBridgeProofSource: missionConsoleBridgeProofAccepted ? 'support-snapshot-runtime-diagnostics' : 'not-accepted',
  };
}

export function missionProofReconciliationSupportSnapshotFields(reconciliation = {}) {
  const r = reconciliation && typeof reconciliation === 'object' ? reconciliation : {};
  return {
    mission_proof_reconciliation_status: r.status || 'unavailable',
    mission_proof_accepted_count: String(r.acceptedCount || 0),
    mission_proof_accepted_items: (r.acceptedItems || []).join('|') || 'none',
    mission_proof_remaining_missing_count: String(r.remainingMissingCount || 0),
    mission_proof_remaining_missing_items: (r.remainingMissingItems || []).join('|') || 'none',
    mission_proof_next_best_action: r.nextBestAction || 'Collect runtime proof.',
    mission_console_bridge_proof_accepted: r.missionConsoleBridgeProofAccepted ? 'yes' : 'no',
    mission_console_bridge_proof_source: r.missionConsoleBridgeProofSource || 'none',
  };
}
