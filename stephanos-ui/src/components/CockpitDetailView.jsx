import CockpitSummaryView from './CockpitSummaryView.jsx';

function ProofList({ title, items = [] }) {
  return <section><h4>{title}</h4>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">none</p>}</section>;
}

export default function CockpitDetailView({ projection } = {}) {
  const p = projection || {};
  return (
    <section className="cockpit-detail-view" data-cockpit-surface="expanded-pane" data-cockpit-projection={p.projectionId || 'operator-cockpit-view-v1'} data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature={[Array.isArray(p.missingProof) ? p.missingProof.join('|') : String(p.missingProof || 'none'), String(Number(p.missingProofCount || 0)), String(p.nextBestAction || 'n/a'), String(p.mergeSafety || 'no / hold'), String(p.openClawMutationLockState || 'locked')].join(' :: ')}>
      <CockpitSummaryView projection={p} />
      <div className="cockpit-detail-grid" data-cockpit-text="true">
        <section><h4>Current Mission</h4><p>{p.currentMission || 'Current Stephanos mission'}</p></section>
        <ProofList title="Accepted Proof" items={p.acceptedProof || []} />
        <ProofList title="Missing Proof" items={p.missingProof || []} />
        <section><h4>Next Proof to Collect</h4><p>{p.nextProofToCollect || 'operator-review'}</p></section>
        <section><h4>Evidence Intake</h4><p>{p.evidenceIntakeState || 'unavailable'}</p></section>
        <section><h4>Latest Command Deck Intake</h4><p>{p.latestCommandDeckIntakeClassification || p.lastCommandDeckIntakeResult || 'unavailable'}</p></section>
        <section><h4>Packet Bay Recommendation</h4><p>{p.packetBayRecommendation || p.recommendedPacket || 'Collect missing proof.'}</p></section>
        <section><h4>ARL Recommendation</h4><p>{p.arlRecommendation || 'Hold mutation until evidence is trusted.'}</p></section>
        <section><h4>Merge Readiness and Blockers</h4><p>{p.mergeSafety || 'no / hold'}</p><ul>{(p.mergeBlockers || []).map((b) => <li key={b}>{b}</li>)}</ul></section>
        <section><h4>Mutation Lock</h4><p>OpenClaw / Codex: {p.openClawMutationLockState || 'locked'} / {p.codexMutationLockState || 'locked'}</p></section>
      </div>
      <details className="cockpit-debug-drilldown"><summary>Debug / raw diagnostics drilldown</summary><pre>{JSON.stringify(p.debugDrilldown || {}, null, 2)}</pre></details>
    </section>
  );
}
