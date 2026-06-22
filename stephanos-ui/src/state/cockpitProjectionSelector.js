import { derivePacketBayProjection } from './packetBayProjection.js';
import { buildProjectAwarenessProjection } from './projectAwarenessProjection.js';
import { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } from './missionEvidenceLedgerModel.js';
import { deriveEvidenceReturnIntakeProjection } from './evidenceReturnIntakeModel.js';
import { buildMissionProofReconciliation } from './missionProofReconciliation.js';

function firstObject(...values) { return values.find((v) => v && typeof v === 'object') || null; }
function liveBuilderMesh(runtimeStatus = {}) { return firstObject(runtimeStatus.operatorReliefProjection?.builderMeshProjection, runtimeStatus.runtimeContext?.operatorReliefProjection?.builderMeshProjection, runtimeStatus.missionState?.operatorReliefProjection?.builderMeshProjection, runtimeStatus.inputMissionState?.operatorReliefProjection?.builderMeshProjection) || {}; }
function liveBuilderWorkbench(runtimeStatus = {}) { return firstObject(runtimeStatus.builderWorkbenchProjection, runtimeStatus.operatorReliefProjection?.builderWorkbenchProjection, runtimeStatus.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection, runtimeStatus.runtimeContext?.operatorReliefProjection?.builderWorkbenchProjection, runtimeStatus.missionState?.operatorReliefProjection?.builderWorkbenchProjection, runtimeStatus.inputMissionState?.operatorReliefProjection?.builderWorkbenchProjection) || {}; }
function splitProof(value = '') { return String(value || '').split('|').map((item) => String(item).trim()).filter((item) => item && item !== 'none'); }

export function buildCanonicalCockpitProjectionRuntimeStatus(runtimeStatus = {}) {
  const executionMetadata = runtimeStatus?.lastExecutionMetadata && typeof runtimeStatus.lastExecutionMetadata === 'object'
    ? runtimeStatus.lastExecutionMetadata
    : (runtimeStatus?.runtimeContext?.lastExecutionMetadata && typeof runtimeStatus.runtimeContext.lastExecutionMetadata === 'object' ? runtimeStatus.runtimeContext.lastExecutionMetadata : {});
  const missionConsoleDiagnostics = runtimeStatus?.missionConsoleDiagnostics || runtimeStatus?.operatorReliefProjection?.missionConsoleDiagnostics || {};
  const commandDeckMetadataRoutedToEvidence = String(executionMetadata?.command_deck_universal_intake_routed_to || '').includes('evidence-return-intake');
  const commandDeckMetadataAcceptedProofItems = splitProof(executionMetadata?.command_deck_universal_intake_accepted_proof_items);
  const commandDeckMetadataRejectedProofItems = splitProof(executionMetadata?.command_deck_universal_intake_rejected_proof_items);
  const commandDeckCumulativeAcceptedProofItems = splitProof(executionMetadata?.command_deck_cumulative_accepted_proof_items || executionMetadata?.command_deck_proof_session_accepted_items);
  const commandDeckCumulativeRejectedProofItems = splitProof(executionMetadata?.command_deck_cumulative_rejected_proof_items || executionMetadata?.command_deck_proof_session_rejected_items);
  const commandDeckAcceptedProofChanged = commandDeckMetadataRoutedToEvidence && (commandDeckMetadataAcceptedProofItems.length > 0 || commandDeckCumulativeAcceptedProofItems.length > 0 || commandDeckMetadataRejectedProofItems.length > 0 || commandDeckCumulativeRejectedProofItems.length > 0);
  const commandDeckMetadataProofProjection = commandDeckMetadataRoutedToEvidence ? {
    acceptedProofItems: commandDeckMetadataAcceptedProofItems,
    rejectedProofItems: commandDeckMetadataRejectedProofItems,
    cumulativeAcceptedProofItems: commandDeckCumulativeAcceptedProofItems,
    cumulativeRejectedProofItems: commandDeckCumulativeRejectedProofItems,
  } : {};
  let missionProofReconciliation = buildMissionProofReconciliation({
    missionConsoleDiagnostics,
    supportSnapshot: runtimeStatus || {},
    missionVerification: runtimeStatus?.missionVerification || {},
    prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {},
    uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' },
    openClawSourcePackRunner: liveBuilderWorkbench(runtimeStatus)?.openClawSourcePackRunner || {},
    evidenceReturnIntakeProjection: commandDeckMetadataProofProjection,
  });
  const packetBayProjection = firstObject(runtimeStatus?.operatorReliefProjection?.packetBayProjection, runtimeStatus?.runtimeContext?.operatorReliefProjection?.packetBayProjection, runtimeStatus?.missionState?.operatorReliefProjection?.packetBayProjection, runtimeStatus?.inputMissionState?.operatorReliefProjection?.packetBayProjection)
    || derivePacketBayProjection({ builderMeshProjection: liveBuilderMesh(runtimeStatus), missionProofReconciliation });
  const agentRealityLoopProjection = firstObject(runtimeStatus?.operatorReliefProjection?.agentRealityLoopProjection, runtimeStatus?.runtimeContext?.operatorReliefProjection?.agentRealityLoopProjection, runtimeStatus?.missionState?.operatorReliefProjection?.agentRealityLoopProjection, runtimeStatus?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection) || {};
  const projectAwarenessProjection = firstObject(runtimeStatus?.operatorReliefProjection?.projectAwarenessProjection, runtimeStatus?.runtimeContext?.operatorReliefProjection?.projectAwarenessProjection, runtimeStatus?.missionState?.operatorReliefProjection?.projectAwarenessProjection, runtimeStatus?.inputMissionState?.operatorReliefProjection?.projectAwarenessProjection)
    || buildProjectAwarenessProjection({ activeMission: runtimeStatus?.activeMission || runtimeStatus?.missionState?.activeMission || {}, builderMeshProjection: liveBuilderMesh(runtimeStatus), packetBayProjection, agentRealityLoopProjection, missionVerification: runtimeStatus?.missionVerification || {}, uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' }, supportSnapshot: runtimeStatus || {}, missionProofReconciliation });
  const missionEvidenceLedgerProjection = firstObject(runtimeStatus?.missionEvidenceLedgerProjection, runtimeStatus?.operatorReliefProjection?.missionEvidenceLedgerProjection, runtimeStatus?.runtimeContext?.operatorReliefProjection?.missionEvidenceLedgerProjection, runtimeStatus?.missionState?.operatorReliefProjection?.missionEvidenceLedgerProjection, runtimeStatus?.inputMissionState?.operatorReliefProjection?.missionEvidenceLedgerProjection)
    || deriveMissionEvidenceLedgerProjection({ projectAwarenessProjection, agentRealityLoopProjection, packetBayProjection, builderMeshProjection: liveBuilderMesh(runtimeStatus), builderWorkbenchProjection: liveBuilderWorkbench(runtimeStatus), openClawSourcePackRunner: liveBuilderWorkbench(runtimeStatus)?.openClawSourcePackRunner || {}, openClawWorkspaceHygiene: liveBuilderWorkbench(runtimeStatus)?.openClawWorkspaceHygiene || {}, missionVerification: runtimeStatus?.missionVerification || {}, prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {}, uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' }, missionProofReconciliation });
  const derivedEvidenceReturnIntakeProjection = firstObject(runtimeStatus?.operatorReliefProjection?.evidenceReturnIntakeProjection, runtimeStatus?.runtimeContext?.operatorReliefProjection?.evidenceReturnIntakeProjection, runtimeStatus?.missionState?.operatorReliefProjection?.evidenceReturnIntakeProjection)
    || deriveEvidenceReturnIntakeProjection({ missionEvidenceLedgerProjection, missionEvidenceContextSummary: deriveMissionEvidenceContextSummary(missionEvidenceLedgerProjection), packetBayProjection, missionProofReconciliation, operatorPastedIntakeText: executionMetadata?.command_deck_universal_intake_echo || '', builderWorkbenchInput: runtimeStatus?.builderWorkbenchInput || runtimeStatus?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection?.builderWorkbenchInput || {} });
  const evidenceReturnIntakeProjection = commandDeckAcceptedProofChanged
    ? {
      ...derivedEvidenceReturnIntakeProjection,
      acceptedProofItems: Array.from(new Set([...(derivedEvidenceReturnIntakeProjection.acceptedProofItems || []), ...commandDeckMetadataAcceptedProofItems])),
      rejectedProofItems: Array.from(new Set([...(derivedEvidenceReturnIntakeProjection.rejectedProofItems || []), ...commandDeckMetadataRejectedProofItems])),
      cumulativeAcceptedProofItems: commandDeckCumulativeAcceptedProofItems,
      cumulativeRejectedProofItems: commandDeckCumulativeRejectedProofItems,
    }
    : derivedEvidenceReturnIntakeProjection;
  missionProofReconciliation = buildMissionProofReconciliation({ missionConsoleDiagnostics, supportSnapshot: runtimeStatus || {}, missionVerification: runtimeStatus?.missionVerification || {}, prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {}, uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' }, openClawSourcePackRunner: liveBuilderWorkbench(runtimeStatus)?.openClawSourcePackRunner || {}, evidenceReturnIntakeProjection });
  const providedReconciliation = firstObject(runtimeStatus?.operatorReliefProjection?.missionProofReconciliation, runtimeStatus?.missionProofReconciliation);
  if (!commandDeckAcceptedProofChanged && Array.isArray(providedReconciliation?.remainingMissingItems) && providedReconciliation.remainingMissingItems.length > 0) {
    missionProofReconciliation = {
      ...missionProofReconciliation,
      ...providedReconciliation,
      acceptedItems: providedReconciliation.acceptedItems || missionProofReconciliation.acceptedItems,
      remainingMissingItems: providedReconciliation.remainingMissingItems,
      nextBestAction: providedReconciliation.nextBestAction || missionProofReconciliation.nextBestAction,
    };
  }
  return {
    ...(runtimeStatus || {}),
    operatorReliefProjection: { ...(runtimeStatus?.operatorReliefProjection || {}), missionProofReconciliation, missionEvidenceLedgerProjection, packetBayProjection, projectAwarenessProjection, agentRealityLoopProjection, evidenceReturnIntakeProjection },
    missionProofReconciliation,
    missionEvidenceLedgerProjection,
    packetBayProjection,
    projectAwarenessProjection,
    agentRealityLoopProjection,
    evidenceReturnIntakeProjection,
  };
}
