import CockpitSummaryView from './CockpitSummaryView.jsx';
import { cockpitRenderSignature } from './cockpitRenderSignature.js';

function ProofList({ title, items = [] }) {
  return <section><h4>{title}</h4>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">none</p>}</section>;
}

export default function CockpitDetailView({ projection } = {}) {
  const p = projection || {};
  return (
    <section className="cockpit-detail-view" data-cockpit-surface="expanded-pane" data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={cockpitRenderSignature(p)}>
      <CockpitSummaryView projection={p} />
      <div className="cockpit-detail-grid" data-cockpit-block="detail-text" data-cockpit-text="true" data-cockpit-text-current-status={p.currentStatus || 'unknown'} data-cockpit-text-accepted-proof={(p.acceptedProof || []).join('|') || 'none'} data-cockpit-text-missing-proof={(p.missingProof || []).join('|') || 'none'} data-cockpit-text-missing-count={String(Number(p.missingProofCount || 0))} data-cockpit-text-next-action={p.nextBestAction || 'Collect runtime proof.'} data-cockpit-text-merge-safety={p.mergeSafety || 'no / hold'} data-cockpit-text-openclaw-lock={p.openClawMutationLockState || 'locked'} data-cockpit-text-codex-lock={p.codexMutationLockState || 'locked'}>
        <section><h4>Current Status</h4><p data-cockpit-text-current-status={p.currentStatus || 'unknown'}>{p.currentStatus || 'unknown'}</p></section>
        <section><h4>Current Mission</h4><p>{p.currentMission || 'Current Stephanos mission'}</p></section>
        <ProofList title="Accepted Proof" items={p.acceptedProof || []} />
        <ProofList title="Missing Proof" items={p.missingProof || []} />
        <section><h4>Next Best Action</h4><p>{p.nextBestAction || 'Collect runtime proof.'}</p></section>
        <section><h4>Next Proof to Collect</h4><p>{p.nextProofToCollect || 'operator-review'}</p></section>
        <section><h4>Evidence Intake</h4><p>{p.evidenceIntakeState || 'unavailable'}</p></section>
        <section><h4>Latest Command Deck Intake</h4><p>{p.latestCommandDeckIntakeClassification || p.lastCommandDeckIntakeResult || 'unavailable'}</p></section>
        <section><h4>Packet Bay Recommendation</h4><p>{p.packetBayRecommendation || p.recommendedPacket || 'Collect missing proof.'}</p></section>
        <section><h4>ARL Recommendation</h4><p>{p.arlRecommendation || 'Hold mutation until evidence is trusted.'}</p></section>
        <section><h4>Merge Readiness and Blockers</h4><p>{p.mergeSafety || 'no / hold'}</p><ul>{(p.mergeBlockers || []).map((b) => <li key={b}>{b}</li>)}</ul></section>
        <section><h4>Mutation Lock</h4><p>OpenClaw / Codex: {p.openClawMutationLockState || 'locked'} / {p.codexMutationLockState || 'locked'}</p></section>
      </div>
      <details className="cockpit-debug-drilldown" data-cockpit-block="debug-drilldown"><summary>Debug / raw diagnostics drilldown</summary><pre>{JSON.stringify(p.debugDrilldown || {}, null, 2)}</pre></details>
    </section>
  );
}
