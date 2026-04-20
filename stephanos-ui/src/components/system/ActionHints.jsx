import React from 'react';
import CollapsiblePanel from '../CollapsiblePanel';
import { useAIStore } from '../../state/aiStore';
import { collectActionHints } from './actionHints.js';
import { buildFinalRouteTruthView } from '../../state/finalRouteTruthView.js';

export default function ActionHints({ runtimeStatusModel }) {
  const { uiLayout, togglePanel } = useAIStore();
  const projectedRouteTruth = runtimeStatusModel
    ? buildFinalRouteTruthView(runtimeStatusModel)
    : null;
  const hints = collectActionHints(
    projectedRouteTruth,
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
          <li
            key={typeof hint === 'string' ? hint : `${hint.subsystem}:${hint.text}`}
            className="action-hints-item"
          >
            {typeof hint === 'string' ? hint : `[${hint.subsystem}] ${hint.text}`}
          </li>
        ))}
      </ul>
    </CollapsiblePanel>
  );
}
