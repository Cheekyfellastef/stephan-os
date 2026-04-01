import CollapsiblePanel from '../CollapsiblePanel';
import { useAIStore } from '../../state/aiStore';
import { getActionHints } from './actionHints.js';

export default function ActionHints({ finalRouteTruth }) {
  const { uiLayout, togglePanel } = useAIStore();
  const hints = getActionHints(finalRouteTruth);

  return (
    <CollapsiblePanel
      as="aside"
      panelId="actionHintsPanel"
      title="Action Hints"
      description="Deterministic operator guidance projected from final route truth."
      className="action-hints-panel"
      isOpen={uiLayout.actionHintsPanel !== false}
      onToggle={() => togglePanel('actionHintsPanel')}
    >
      {!finalRouteTruth ? <p className="muted">No action hints available</p> : null}
      {finalRouteTruth && hints.length === 0 ? <p className="muted">No action required</p> : null}

      {hints.length > 0 ? (
        <ul className="action-hints-list" aria-live="polite">
          {hints.map((hint) => (
            <li key={hint.id} className={`action-hints-item severity-${hint.severity}`}>
              <p className="action-hints-meta">
                <span className={`action-hints-severity severity-${hint.severity}`}>{hint.severity}</span>
                <span className="action-hints-subsystem">{hint.subsystem}</span>
              </p>
              <p className="action-hints-text">{hint.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </CollapsiblePanel>
  );
}
