import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function SimulationHistoryPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const runs = commandHistory.findLast((entry) => entry.data_payload?.runs)?.data_payload?.runs ?? [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="simulationHistoryPanel"
      title="Simulation History"
      description="Recent saved runs and quick output summaries."
      className="simulation-history-panel"
      isOpen={uiLayout.simulationHistoryPanel}
      onToggle={() => togglePanel('simulationHistoryPanel')}
    >
      <ul className="compact-list">
        {runs.slice(0, 4).map((run) => <li key={run.run_id}>{run.simulation_id} · {run.output_summary?.headline ?? 'run'}</li>)}
        {runs.length === 0 && <li className="muted">Run /simulate history list</li>}
      </ul>
    </CollapsiblePanel>
  );
}
