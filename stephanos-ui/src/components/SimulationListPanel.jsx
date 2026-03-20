import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function SimulationListPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const latest = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.simulations));

  const simulations = latest?.response?.data?.simulations ?? [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="simulationListPanel"
      title="Available Simulations"
      description="Registered simulations and current availability state."
      className="simulation-list-panel"
      isOpen={uiLayout.simulationListPanel}
      onToggle={() => togglePanel('simulationListPanel')}
    >
      {simulations.length === 0 ? (
        <p className="muted">Run /simulate list to inspect the simulation registry.</p>
      ) : (
        <ul className="compact-list">
          {simulations.map((simulation) => (
            <li key={simulation.id}>{simulation.id} ({simulation.state})</li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
