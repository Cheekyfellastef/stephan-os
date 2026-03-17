export default function ProposalPanel({ commandHistory }) {
  const proposals = commandHistory.findLast((entry) => entry.data_payload?.proposals)?.data_payload?.proposals ?? [];
  const stats = commandHistory.findLast((entry) => entry.data_payload?.stats)?.data_payload?.stats;

  return (
    <section className="panel">
      <h3>Proposal Queue</h3>
      {stats && <p className="muted">Pending {stats.pending} / Total {stats.total}</p>}
      <ul className="compact-list">
        {proposals.slice(0, 4).map((proposal) => <li key={proposal.id}>{proposal.status} · {proposal.summary}</li>)}
        {proposals.length === 0 && <li className="muted">Run /proposals list</li>}
      </ul>
    </section>
  );
}
