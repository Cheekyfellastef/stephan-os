export function cockpitRenderSignature(projection = {}) {
  const txt = (value, fallback = '') => {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
  };
  return [
    txt(projection.currentStatus, 'unknown'),
    Array.isArray(projection.acceptedProof) ? projection.acceptedProof.join('|') : txt(projection.acceptedProof, 'none'),
    Array.isArray(projection.missingProof) ? projection.missingProof.join('|') : txt(projection.missingProof, 'none'),
    String(Number(projection.missingProofCount || 0)),
    txt(projection.nextBestAction, 'n/a'),
    txt(projection.mergeSafety, 'no / hold'),
    txt(projection.openClawMutationLockState, 'locked'),
    txt(projection.codexMutationLockState, 'locked'),
  ].join(' :: ');
}
