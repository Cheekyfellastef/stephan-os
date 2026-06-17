import CockpitVisualDashboard from './CockpitVisualDashboard.jsx';

export default function CockpitSummaryView({ projection, compact = false, onOpenCockpit = null } = {}) {
  const p = projection || {};
  return (
    <section className={`cockpit-summary-view ${compact ? 'cockpit-summary-compact' : ''}`} data-cockpit-surface={compact ? 'landing-tile' : undefined} data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={[Array.isArray(p.missingProof) ? p.missingProof.join('|') : String(p.missingProof || 'none'), String(Number(p.missingProofCount || 0)), String(p.nextBestAction || 'n/a'), String(p.mergeSafety || 'no / hold'), String(p.openClawMutationLockState || 'locked')].join(' :: ')}>
      <CockpitVisualDashboard projection={p} compact={compact} />
      <div data-cockpit-text="true"><strong>Mission status:</strong> {p.currentStatus || 'unknown'}</div>
      <div><strong>Next best action:</strong> {p.nextBestAction || 'Collect runtime proof.'}</div>
      <div><strong>Missing proof:</strong> {Number(p.missingProofCount || 0)}</div>
      <div><strong>Merge safety:</strong> {p.mergeSafety || 'no / hold'}</div>
      {onOpenCockpit ? <button type="button" onClick={onOpenCockpit}>Open canonical cockpit pane</button> : null}
    </section>
  );
}
