import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function RoadmapPanel({ commandHistory }) {
  const { uiLayout, togglePanel, missionPacketWorkflow } = useAIStore();
  const items = commandHistory.findLast((entry) => entry.data_payload?.items)?.data_payload?.items ?? [];
  const missionPacketQueue = missionPacketWorkflow?.roadmapQueue || [];
  const summary = commandHistory.findLast((entry) => entry.data_payload?.summary)?.data_payload?.summary;

  return (
    <CollapsiblePanel
      as="aside"
      panelId="roadmapPanel"
      title="Roadmap"
      description="Open and completed roadmap items surfaced from recent planning commands."
      className="roadmap-panel"
      isOpen={uiLayout.roadmapPanel}
      onToggle={() => togglePanel('roadmapPanel')}
    >
      {summary && <p className="muted">Open {summary.open} · Done {summary.done}</p>}
      <ul className="compact-list">
        {missionPacketQueue.slice(0, 3).map((item) => (
          <li key={item.id}>queued · {item.moveTitle || item.moveId} (mission-packet)</li>
        ))}
        {items.slice(0, 4).map((item) => <li key={item.id}>{item.status} · {item.text}</li>)}
        {items.length === 0 && missionPacketQueue.length === 0 && <li className="muted">Run /roadmap list</li>}
      </ul>
    </CollapsiblePanel>
  );
}
