import { cockpitRenderSignature } from './cockpitRenderSignature.js';

export default function CockpitVisualDashboard({ projection, compact = false } = {}) {
  const p = projection || {};
  const acceptedCount = Array.isArray(p.acceptedProof) ? p.acceptedProof.length : 0;
  const missingCount = Number(p.missingProofCount || 0);
  const totalProof = Math.max(acceptedCount + missingCount, 1);
  const acceptedPct = Math.round((acceptedCount / totalProof) * 100);
  const renderSignature = cockpitRenderSignature(p);
  return (
    <section
      className={`cockpit-visual-dashboard ${compact ? 'cockpit-visual-compact' : ''}`}
      data-cockpit-block={compact ? 'shortcut-visual' : 'primary-dashboard'}
      data-cockpit-kind="visual"
      data-cockpit-surface={compact ? 'landing-tile' : 'expanded-pane'}
      data-cockpit-visual="true"
      data-cockpit-projection-source="canonical cockpit projection"
      data-cockpit-render-signature={renderSignature}
      data-cockpit-animation-enabled="yes"
      data-cockpit-animation-mode="subtle"
      data-cockpit-animated-elements="status-orb|proof-progress-sweep|next-action-beacon|lock-chip-glow"
      data-cockpit-animation-truth-impact="none"
      data-cockpit-reduced-motion-respected="yes"
      aria-label={compact ? 'Cockpit shortcut visual' : 'Primary Cockpit Dashboard'}
    >
      <div className="cockpit-dashboard-core">
        <div className="cockpit-visual-orb" data-state={p.currentStatus || 'unknown'} data-cockpit-visual-current-status={p.currentStatus || 'unknown'}>
          <span>{compact ? 'Cockpit' : (p.currentStatus || 'monitoring')}</span>
        </div>
        {!compact ? <div className="cockpit-dashboard-mission"><strong>{p.currentMission || 'Current Stephanos mission'}</strong><span>{p.whoShouldActNext || 'Operator'}</span></div> : null}
      </div>
      <div className="cockpit-visual-proof-strip" aria-label={`Accepted proof ${acceptedCount}; missing proof ${missingCount}`} data-cockpit-visual-accepted-proof={(p.acceptedProof || []).join('|') || 'none'} data-cockpit-visual-missing-proof={(p.missingProof || []).join('|') || 'none'} data-cockpit-visual-missing-count={String(missingCount)}>
        <div className="cockpit-proof-meter" style={{ '--accepted-pct': `${acceptedPct}%` }}>
          <span className="cockpit-proof-sweep" />
        </div>
        <span className="proof-accepted">accepted {acceptedCount}</span>
        <span className="proof-missing">missing {missingCount}</span>
      </div>
      <div className="cockpit-visual-indicators">
        <span className="cockpit-chip cockpit-merge-chip" data-cockpit-visual-merge-safety={p.mergeSafety || 'no / hold'}>Merge {p.mergeSafety || 'no / hold'}</span>
        <span className="cockpit-chip cockpit-lock-chip" data-cockpit-visual-openclaw-lock={p.openClawMutationLockState || 'locked'}>OpenClaw {p.openClawMutationLockState || 'locked'}</span>
        <span className="cockpit-chip cockpit-lock-chip" data-cockpit-visual-codex-lock={p.codexMutationLockState || 'locked'}>Codex {p.codexMutationLockState || 'locked'}</span>
      </div>
      {!compact ? <div className="cockpit-next-beacon" data-cockpit-visual-next-action={p.nextBestAction || 'Collect runtime proof.'}>Next: {p.nextBestAction || 'Collect runtime proof.'}</div> : null}
      <div className="cockpit-pointer" data-cockpit-visual-projection-source="canonical cockpit projection" data-cockpit-visual-render-signature={renderSignature}>{p.recommendedSurface || 'Command Deck'} · {p.recommendedPacket || 'proof-collection-packet'}</div>
    </section>
  );
}
