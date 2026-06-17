import { cockpitRenderSignature } from './cockpitRenderSignature.js';


export default function CockpitVisualDashboard({ projection, compact = false } = {}) {
  const p = projection || {};
  const acceptedCount = Array.isArray(p.acceptedProof) ? p.acceptedProof.length : 0;
  const missingCount = Number(p.missingProofCount || 0);
  const renderSignature = cockpitRenderSignature(p);
  return (
    <section
      className={`cockpit-visual-dashboard ${compact ? 'cockpit-visual-compact' : ''}`}
      data-cockpit-block="primary-visual"
      data-cockpit-visual="true"
      data-cockpit-projection-source="canonical cockpit projection"
      data-cockpit-render-signature={renderSignature}
      data-cockpit-animation-enabled="yes"
      data-cockpit-animation-mode="subtle"
      data-cockpit-animated-elements="status-orb|proof-strip|next-action-beacon|lock-chips"
      data-cockpit-animation-truth-impact="none"
      data-cockpit-reduced-motion-respected="yes"
      aria-label="Operator cockpit visual status dashboard"
    >
      <div className="cockpit-visual-orb" data-state={p.currentStatus || 'unknown'} data-cockpit-visual-current-status={p.currentStatus || 'unknown'}>
        <span>{p.currentStatus || 'monitoring'}</span>
      </div>
      <div className="cockpit-visual-proof-strip" aria-label={`Accepted proof ${acceptedCount}; missing proof ${missingCount}`} data-cockpit-visual-accepted-proof={(p.acceptedProof || []).join('|') || 'none'} data-cockpit-visual-missing-proof={(p.missingProof || []).join('|') || 'none'} data-cockpit-visual-missing-count={String(missingCount)}>
        <span className="proof-accepted">✓ {acceptedCount}</span>
        <span className="proof-missing">! {missingCount}</span>
      </div>
      <div className="cockpit-visual-indicators">
        <span className="cockpit-chip" data-cockpit-visual-merge-safety={p.mergeSafety || 'no / hold'}>Merge: {p.mergeSafety || 'no / hold'}</span>
        <span className="cockpit-chip cockpit-lock-chip" data-cockpit-visual-openclaw-lock={p.openClawMutationLockState || 'locked'}>OpenClaw: {p.openClawMutationLockState || 'locked'}</span>
        <span className="cockpit-chip cockpit-lock-chip" data-cockpit-visual-codex-lock={p.codexMutationLockState || 'locked'}>Codex: {p.codexMutationLockState || 'locked'}</span>
      </div>
      <div className="cockpit-next-beacon" data-cockpit-visual-next-action={p.nextBestAction || 'Collect runtime proof.'}>Next: {p.nextBestAction || 'Collect runtime proof.'}</div>
      <div className="cockpit-pointer" data-cockpit-visual-projection-source="canonical cockpit projection" data-cockpit-visual-render-signature={renderSignature}>{p.recommendedSurface || 'Command Deck'} · {p.recommendedPacket || 'proof-collection-packet'}</div>
    </section>
  );
}
