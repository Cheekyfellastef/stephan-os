import CockpitVisualDashboard from './CockpitVisualDashboard.jsx';
import { cockpitRenderSignature } from './cockpitRenderSignature.js';

export default function CockpitSummaryView({ projection, compact = false, onOpenCockpit = null } = {}) {
  const p = projection || {};
  const signature = cockpitRenderSignature(p);
  if (compact) {
    return (
      <section className="cockpit-summary-view cockpit-summary-compact" data-cockpit-surface="landing-tile" data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={signature} data-cockpit-visible-detail-field-count="0" data-cockpit-shortcut-role="preserved">
        <CockpitVisualDashboard projection={p} compact />
        <div className="cockpit-shortcut-copy" data-cockpit-block="summary-readout" data-cockpit-kind="text" data-cockpit-text="true"><strong>Cockpit</strong><span>Shortcut to the canonical Stephanos cockpit.</span><span className="cockpit-pointer">Open Cockpit →</span></div>
        {onOpenCockpit ? <button type="button" onClick={onOpenCockpit}>Open Cockpit</button> : null}
      </section>
    );
  }
  return (
    <section className="cockpit-summary-view" data-cockpit-block="summary-readout" data-cockpit-kind="text" data-cockpit-surface="expanded-pane" data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={signature} data-cockpit-text="true">
      <span data-cockpit-text-current-status={p.currentStatus || 'unknown'}><strong>Status</strong> {p.currentStatus || 'unknown'}</span>
      <span data-cockpit-text-missing-count={String(Number(p.missingProofCount || 0))}><strong>Missing</strong> {Number(p.missingProofCount || 0)}</span>
      <span data-cockpit-text-merge-safety={p.mergeSafety || 'no / hold'}><strong>Merge</strong> {p.mergeSafety || 'no / hold'}</span>
      <span data-cockpit-text-openclaw-lock={p.openClawMutationLockState || 'locked'}><strong>OpenClaw</strong> {p.openClawMutationLockState || 'locked'}</span>
      <span data-cockpit-text-codex-lock={p.codexMutationLockState || 'locked'}><strong>Codex</strong> {p.codexMutationLockState || 'locked'}</span>
      <span><strong>Surface</strong> {p.recommendedSurface || 'Command Deck'}</span>
      <span><strong>Packet</strong> {p.recommendedPacket || 'proof-collection-packet'}</span>
    </section>
  );
}
