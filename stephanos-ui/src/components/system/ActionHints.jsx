import React from 'react';
import CollapsiblePanel from '../CollapsiblePanel';
import { useAIStore } from '../../state/aiStore';
import { collectActionHints } from './actionHints.js';

export default function ActionHints({ runtimeStatusModel }) {
  const { uiLayout, togglePanel } = useAIStore();
  const hints = collectActionHints(
    runtimeStatusModel?.finalRouteTruth ?? null,
    runtimeStatusModel?.orchestration || {},
  );

  return (
    <CollapsiblePanel
      as="aside"
      panelId="actionHintsPanel"
      title="Action Hints"
      description="Mission-aware operator guidance derived from canonical orchestration selectors and runtime truth."
      className="action-hints-panel"
      isOpen={uiLayout.actionHintsPanel !== false}
      onToggle={() => togglePanel('actionHintsPanel')}
    >
      <ul className="action-hints-list" aria-live="polite">
        {hints.map((hint) => (
          <li key={hint} className="action-hints-item">{hint}</li>
        ))}
      </ul>
    </CollapsiblePanel>
  );
}
