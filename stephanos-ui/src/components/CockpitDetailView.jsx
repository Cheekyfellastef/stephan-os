import CockpitSummaryView from './CockpitSummaryView.jsx';
import CockpitVisualDashboard from './CockpitVisualDashboard.jsx';
import { cockpitRenderSignature } from './cockpitRenderSignature.js';

function ProofList({ title, items = [], kind }) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  return <section className="cockpit-detail-card cockpit-proof-card" data-cockpit-block="detail-card" data-cockpit-kind="card"><h4>{title}</h4>{safeItems.length ? <div className="cockpit-proof-chips" data-cockpit-block="proof-chip-list" data-cockpit-kind="chip-list" data-proof-kind={kind}>{safeItems.map((item) => <span className="cockpit-proof-chip" key={item}>{item}</span>)}</div> : <span className="cockpit-muted-chip" data-cockpit-empty-field-collapsed="yes">none</span>}</section>;
}

function DetailCard({ title, children, compact = false }) {
  return <section className={`cockpit-detail-card ${compact ? 'cockpit-detail-card-compact' : ''}`} data-cockpit-block="detail-card" data-cockpit-kind="card"><h4>{title}</h4>{children}</section>;
}

export default function CockpitDetailView({ projection, onPrimaryAction = null } = {}) {
  const p = projection || {};
  const signature = cockpitRenderSignature(p);
  return (
    <section className="cockpit-detail-view" data-cockpit-surface="expanded-pane" data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={signature}>
      <CockpitVisualDashboard projection={p} />
      <CockpitSummaryView projection={p} />
      <section className="cockpit-action-strip" data-cockpit-block="action-routing" data-cockpit-action-source={p.cockpitActionSource || 'canonical cockpit projection'} data-cockpit-rendered-text-used-for-routing="no">
        <button type="button" className="cockpit-primary-action" data-testid="cockpit-primary-action" data-cockpit-action-kind={p.cockpitPrimaryActionKind || 'unavailable'} data-cockpit-action-target-pane-id={p.cockpitPrimaryActionTargetPaneId || 'unresolved'} data-cockpit-action-mutation-allowed="no" disabled={!onPrimaryAction || p.cockpitActionStatus !== 'available'} title={p.cockpitPrimaryActionReason || 'Derived from canonical cockpit projection'} onClick={() => onPrimaryAction?.(p)}>
          {p.cockpitPrimaryActionLabel || 'Action unavailable'} · {p.cockpitPrimaryActionTargetSurface || 'target unresolved'}
        </button>
        <span className="cockpit-muted-chip">Routing source: canonical projection · mutation no</span>
      </section>
      <div className="cockpit-detail-grid" data-cockpit-block="detail-grid" data-cockpit-kind="grid" data-cockpit-layout-density="compact" data-cockpit-card-count="10" data-cockpit-empty-space-warning="no" data-cockpit-collapsed-empty-fields-count="0" data-cockpit-text="true" data-cockpit-text-current-status={p.currentStatus || 'unknown'} data-cockpit-text-accepted-proof={(p.acceptedProof || []).join('|') || 'none'} data-cockpit-text-missing-proof={(p.missingProof || []).join('|') || 'none'} data-cockpit-text-missing-count={String(Number(p.missingProofCount || 0))} data-cockpit-text-next-action={p.nextBestAction || 'Collect runtime proof.'} data-cockpit-text-merge-safety={p.mergeSafety || 'no / hold'} data-cockpit-text-openclaw-lock={p.openClawMutationLockState || 'locked'} data-cockpit-text-codex-lock={p.codexMutationLockState || 'locked'}>
        <DetailCard title="Current Mission"><p>{p.currentMission || 'Current Stephanos mission'}</p></DetailCard>
        <DetailCard title="Next Best Action"><p data-cockpit-text-next-action={p.nextBestAction || 'Collect runtime proof.'}>{p.nextBestAction || 'Collect runtime proof.'}</p></DetailCard>
        <ProofList title="Accepted Proof" items={p.acceptedProof || []} kind="accepted" />
        <ProofList title="Missing Proof" items={p.missingProof || []} kind="missing" />
        <DetailCard title="Last Intake Status" compact><p>{p.latestCommandDeckIntakeClassification || p.lastCommandDeckIntakeResult || 'unavailable'}</p></DetailCard>
        <DetailCard title="Packet Bay Recommendation"><p>{p.packetBayRecommendation || p.recommendedPacket || 'Collect missing proof.'}</p></DetailCard>
        <DetailCard title="ARL Recommendation"><p>{p.arlRecommendation || 'Hold mutation until evidence is trusted.'}</p></DetailCard>
        <DetailCard title="Merge Readiness and Blockers" compact><p>{p.mergeSafety || 'no / hold'}</p><div className="cockpit-proof-chips">{(p.mergeBlockers || []).length ? p.mergeBlockers.map((b) => <span className="cockpit-proof-chip" key={b}>{b}</span>) : <span className="cockpit-muted-chip" data-cockpit-empty-field-collapsed="yes">no blockers listed</span>}</div></DetailCard>
        <DetailCard title="Mutation Lock" compact><p>OpenClaw / Codex: {p.openClawMutationLockState || 'locked'} / {p.codexMutationLockState || 'locked'}</p></DetailCard>
        <DetailCard title="Recommended Surface" compact><p>{p.recommendedSurface || 'Command Deck'} · {p.recommendedPacket || 'proof-collection-packet'}</p></DetailCard>
      </div>
      <details className="cockpit-debug-drilldown" data-cockpit-block="debug-drilldown" data-cockpit-kind="diagnostic" data-cockpit-debug-collapsed-default="yes"><summary>Debug / raw diagnostics drilldown</summary><pre>{JSON.stringify(p.debugDrilldown || {}, null, 2)}</pre></details>
    </section>
  );
}
