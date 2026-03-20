import { useAIStore } from '../state/aiStore';
import SimulationResultCard from './SimulationResultCard';
import CollapsiblePanel from './CollapsiblePanel';

export default function SimulationPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const latestResult = [...commandHistory]
    .reverse()
    .find((entry) => entry.route === 'simulation' && entry.response?.data?.result);

  return (
    <CollapsiblePanel
      as="aside"
      panelId="simulationPanel"
      title="Simulation Core"
      description="Latest simulation run output and execution summary."
      className="simulation-panel"
      isOpen={uiLayout.simulationPanel}
      onToggle={() => togglePanel('simulationPanel')}
    >
      <div>
        <h3>Latest Result</h3>
        {!latestResult ? (
          <p className="muted">Run /simulate run trajectory-demo --start 1000 --monthly 100 --rate 0.05 --years 10</p>
        ) : (
          <SimulationResultCard payload={latestResult.response.data} />
        )}
      </div>
    </CollapsiblePanel>
  );
}
