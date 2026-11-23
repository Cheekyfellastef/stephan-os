const failures = new Set([
  'fetch failed', // Legacy provider result; never sufficient without terminal proof.
  'PROVIDER_NEUTRAL_MODEL_REQUEST_DEADLINE_EXCEEDED',
  'PROVIDER_NEUTRAL_MODEL_RESPONSE_STALLED',
  // A bounded provider response rejected before source mutation. The existing
  // exact terminal proof, owner-plan revalidation and remaining-round cap apply.
  'PROVIDER_NEUTRAL_MODEL_RESPONSE_TOO_LARGE',
  ...['ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']
    .map(code => `PROVIDER_NEUTRAL_MODEL_TRANSPORT_FAILED:${code}`),
]);
export const isModelTransportFailureV1 = value => failures.has(value);

export function projectModelTransportFailureProofV1(result, receipt) {
  if (result?.schemaVersion !== 'stephanos.provider-neutral-source-builder.v1'
      || result.processed !== true || result.success !== false || result.providerInvoked !== true
      || result.providerCompleted !== false || result.failureStage !== 'PROVIDER'
      || result.finalVerdict !== 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED'
      || !isModelTransportFailureV1(result.error)
      || receipt?.executionId !== result.actionId || receipt.state !== 'failed'
      || receipt.phase !== 'provider-neutral-result-blocked' || receipt.blocker !== result.error) return null;
  const proof = Object.freeze({schemaVersion:'stephanos.model-transport-failure-proof.v1',
    missionId:result.missionId,actionId:result.actionId,blocker:result.error,
    receiptId:receipt.receiptId,sourceHead:receipt.sourceHead});
  return modelTransportFailureProofMatchesV1(proof, result.missionId, result.actionId, result.error) ? proof : null;
}

export function modelTransportFailureProofMatchesV1(proof, missionId, actionId, blocker) {
  return proof?.schemaVersion === 'stephanos.model-transport-failure-proof.v1'
    && typeof missionId === 'string' && /^[a-z0-9][a-z0-9._-]{1,127}$/.test(missionId)
    && typeof actionId === 'string' && /^[a-z0-9][a-z0-9._-]{1,127}$/.test(actionId)
    && proof.missionId === missionId && proof.actionId === actionId
    && proof.blocker === blocker && isModelTransportFailureV1(blocker)
    && typeof proof.receiptId === 'string' && proof.receiptId.startsWith(`${actionId}-`)
    && /^[a-z0-9][a-z0-9._-]{1,127}$/.test(proof.receiptId)
    && /^[a-f0-9]{40}$/.test(proof.sourceHead);
}
