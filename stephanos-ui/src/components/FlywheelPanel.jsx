import { useMemo } from 'react';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

const FLYWHEEL_STATE_PLACEHOLDERS = [
  {
    id: 'mission-state',
    label: 'Mission State',
    sourceFile: 'MISSION_STATE.md',
    summary: 'Stephanos is expanding the operator mission dashboard with a persistent flywheel view.',
  },
  {
    id: 'current-thinking',
    label: 'Current Thinking',
    sourceFile: 'CURRENT_THINKING.md',
    summary: 'Preserve pane/navigation canon while making shared state easy to recover at a glance.',
  },
  {
    id: 'next-action',
    label: 'Next Action',
    sourceFile: 'NEXT_ACTION.md',
    summary: 'Connect this pane to OpenClaw Standalone shared state files once a safe loader contract is available.',
  },
  {
    id: 'agent-notes',
    label: 'Agent Notes',
    sourceFile: 'AGENT_NOTES.md',
    summary: 'Codex V1 uses source-truth placeholders and leaves file-backed loading as an explicit follow-up.',
  },
  {
    id: 'decision-log',
    label: 'Decision Log',
    sourceFile: 'DECISION_LOG.md',
    summary: 'Flywheel visibility belongs in the existing Stephanos pane wall, not a separate app or generated dist edit.',
  },
];

const FLYWHEEL_METRICS = [
  { label: 'Flywheel Index', value: 'Seeded', detail: 'Composite continuity momentum signal pending file-backed truth.' },
  { label: 'Context Recovery Time', value: '< 2 min target', detail: 'Goal for returning from cold start to current mission context.' },
  { label: 'Human Routing Load', value: 'Lowering', detail: 'Tracks how much manual operator routing is still required.' },
  { label: 'Capability Discoveries', value: 'Capture-ready', detail: 'Discovery count will come from shared agent notes / decision records.' },
  { label: 'Time From Idea To Reality', value: 'Instrument next', detail: 'Measures elapsed time from mission idea to visible verified change.' },
];

export default function FlywheelPanel() {
  const { uiLayout, togglePanel } = useAIStore();

  const stateItems = useMemo(() => FLYWHEEL_STATE_PLACEHOLDERS, []);
  const metrics = useMemo(() => FLYWHEEL_METRICS, []);

  return (
    <CollapsiblePanel
      as="aside"
      panelId="flywheelPanel"
      title="Flywheel"
      description="Mission continuity dashboard for shared state, routing load, and idea-to-reality momentum."
      className="flywheel-panel"
      isOpen={uiLayout.flywheelPanel}
      onToggle={() => togglePanel('flywheelPanel')}
    >
      <div className="flywheel-panel__intro" data-testid="flywheel-pane-dashboard">
        <p>
          The Flywheel pane keeps mission state, agent context, and execution momentum visible inside the canonical Stephanos pane wall.
        </p>
        <p className="muted">
          TODO: Replace V1 placeholders with a governed shared-state loader for MISSION_STATE.md, CURRENT_THINKING.md, NEXT_ACTION.md, AGENT_NOTES.md, and DECISION_LOG.md once the OpenClaw Standalone file contract is safely exposed to the runtime.
        </p>
      </div>

      <div className="flywheel-state-grid" aria-label="Flywheel shared state files">
        {stateItems.map((item) => (
          <article className="flywheel-state-card" key={item.id} data-testid={`flywheel-state-${item.id}`}>
            <div className="flywheel-card-header">
              <h3>{item.label}</h3>
              <span>{item.sourceFile}</span>
            </div>
            <p>{item.summary}</p>
          </article>
        ))}
      </div>

      <div className="flywheel-metrics-grid" aria-label="Flywheel metrics">
        {metrics.map((metric) => (
          <article className="flywheel-metric-card" key={metric.label}>
            <span className="flywheel-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </div>
    </CollapsiblePanel>
  );
}
