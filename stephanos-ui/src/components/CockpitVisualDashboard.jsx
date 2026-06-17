function signature(projection = {}) {
  return [
    Array.isArray(projection.missingProof) ? projection.missingProof.join('|') : String(projection.missingProof || 'none'),
    String(Number(projection.missingProofCount || 0)),
    String(projection.nextBestAction || 'n/a'),
    String(projection.mergeSafety || 'no / hold'),
    String(projection.openClawMutationLockState || 'locked'),
  ].join(' :: ');
}

export default function CockpitVisualDashboard({ projection, compact = false } = {}) {
  const p = projection || {};
  const acceptedCount = Array.isArray(p.acceptedProof) ? p.acceptedProof.length : 0;
  const missingCount = Number(p.missingProofCount || 0);
  const renderSignature = signature(p);
  return (
    <section
      className={`cockpit-visual-dashboard ${compact ? 'cockpit-visual-compact' : ''}`}
      data-cockpit-visual="true"
      data-cockpit-projection-source="canonical cockpit projection"
      data-cockpit-render-signature={renderSignature}
      aria-label="Operator cockpit visual status dashboard"
    >
      <div className="cockpit-visual-orb" data-state={p.currentStatus || 'unknown'}>
        <span>{p.currentStatus || 'monitoring'}</span>
      </div>
      <div className="cockpit-visual-proof-strip" aria-label={`Accepted proof ${acceptedCount}; missing proof ${missingCount}`}>
        <span className="proof-accepted">✓ {acceptedCount}</span>
        <span className="proof-missing">! {missingCount}</span>
      </div>
      <div className="cockpit-visual-indicators">
        <span className="cockpit-chip">Merge: {p.mergeSafety || 'no / hold'}</span>
        <span className="cockpit-chip">OpenClaw: {p.openClawMutationLockState || 'locked'}</span>
        <span className="cockpit-chip">Codex: {p.codexMutationLockState || 'locked'}</span>
      </div>
      <div className="cockpit-next-beacon">Next: {p.nextBestAction || 'Collect runtime proof.'}</div>
      <div className="cockpit-pointer">{p.recommendedSurface || 'Command Deck'} · {p.recommendedPacket || 'proof-collection-packet'}</div>
    </section>
  );
}
