import { useEffect, useRef, useState } from 'react';
import CollapsiblePanel from '../CollapsiblePanel';
import { useAIStore } from '../../state/aiStore';
import {
  appendTelemetryHistory,
  createTelemetryBaselineEvent,
  extractTelemetryEvents,
  TELEMETRY_MAX_HISTORY,
} from './telemetryEvents.js';

export default function TelemetryFeed({ runtimeStatusModel }) {
  const { uiLayout, togglePanel } = useAIStore();
  const finalRouteTruth = runtimeStatusModel?.finalRouteTruth ?? null;
  const [events, setEvents] = useState([]);
  const previousTruthRef = useRef(null);
  const baselineAddedRef = useRef(false);

  useEffect(() => {
    if (!finalRouteTruth) {
      previousTruthRef.current = null;
      baselineAddedRef.current = false;
      setEvents([]);
      return;
    }

    const timestamp = new Date().toISOString();
    const nextEvents = [];

    if (!baselineAddedRef.current) {
      nextEvents.push(createTelemetryBaselineEvent(finalRouteTruth, timestamp));
      baselineAddedRef.current = true;
    }

    const transitionEvents = extractTelemetryEvents(previousTruthRef.current, finalRouteTruth, timestamp);
    nextEvents.push(...transitionEvents);
    previousTruthRef.current = finalRouteTruth;

    if (nextEvents.length > 0) {
      setEvents((previousEvents) => appendTelemetryHistory(previousEvents, nextEvents, TELEMETRY_MAX_HISTORY));
    }
  }, [finalRouteTruth]);

  return (
    <CollapsiblePanel
      as="aside"
      panelId="telemetryFeedPanel"
      title="Telemetry Feed"
      description="Runtime truth transitions over time."
      className="telemetry-feed-panel"
      isOpen={uiLayout.telemetryFeedPanel !== false}
      onToggle={() => togglePanel('telemetryFeedPanel')}
    >
      {!finalRouteTruth ? <p className="muted">No telemetry available yet</p> : null}
      {finalRouteTruth && events.length === 0 ? <p className="muted">Telemetry feed active. Awaiting state changes.</p> : null}

      {events.length > 0 ? (
        <ul className="telemetry-feed-list" aria-live="polite">
          {events.map((event) => (
            <li key={event.id} className="telemetry-feed-event">
              <p className="telemetry-feed-primary">
                <span className="telemetry-feed-time">{event.timestamp}</span>
                <span className="telemetry-feed-subsystem">{event.subsystem}</span>
                <span>{event.change}</span>
              </p>
              {event.reason ? <p className="telemetry-feed-detail">Reason: {event.reason}</p> : null}
              {event.impact ? <p className="telemetry-feed-detail">Impact: {event.impact}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </CollapsiblePanel>
  );
}
