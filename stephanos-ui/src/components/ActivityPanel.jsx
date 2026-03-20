import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function ActivityPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const events = commandHistory.findLast((entry) => entry.data_payload?.events)?.data_payload?.events ?? [];

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
        {events.slice(0, 4).map((event) => <li key={event.id}>{event.type} · {event.summary}</li>)}
        {events.length === 0 && <li className="muted">Run /activity recent</li>}
      </ul>
    </CollapsiblePanel>
  );
}
