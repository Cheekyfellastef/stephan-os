import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function ActivityPanel({ commandHistory }) {
  const { uiLayout, togglePanel, missionPacketWorkflow } = useAIStore();
  const events = commandHistory.findLast((entry) => entry.data_payload?.events)?.data_payload?.events ?? [];
  const missionPacketEvents = missionPacketWorkflow?.activity || [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="activityPanel"
      title="Activity Log"
      description="Recent autonomous and operator-visible system events."
      className="activity-panel"
      isOpen={uiLayout.activityPanel}
      onToggle={() => togglePanel('activityPanel')}
    >
      <ul className="compact-list">
        {missionPacketEvents.slice(0, 4).map((event) => <li key={event.id}>{event.type} · {event.summary}</li>)}
        {events.slice(0, 4).map((event) => <li key={event.id}>{event.type} · {event.summary}</li>)}
        {events.length === 0 && missionPacketEvents.length === 0 && <li className="muted">Run /activity recent</li>}
      </ul>
    </CollapsiblePanel>
  );
}
